import { Plugin, Notice } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 兼容旧版的单账户配置（历史）
 */
export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region?: string;
  keyPrefix?: string;
  useSSL: boolean;
  baseUrl?: string;
}

/**
 * 多账户配置：Profile
 */
export type ProviderType = 'aws-s3' | 'cloudflare-r2' | 'minio' | 'custom';

export interface S3Profile {
  id: string;                // 稳定标识，重命名不变
  name: string;              // 展示名称
  providerType: ProviderType;
  endpoint: string;          // API 端点
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region?: string;
  keyPrefix?: string;
  useSSL: boolean;
  baseUrl?: string;          // 公共访问域名，用于拼接展示链接
}

/**
 * 多账户配置文件根结构
 */
export interface S3ProfilesFile {
  currentProfileId: string | null;
  profiles: S3Profile[];
}

/**
 * 插件配置目录与文件路径
 */
function getPluginFolder(plugin: Plugin): string {
  return `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}
function getLegacyConfigPath(plugin: Plugin): string {
  return path.join(getPluginFolder(plugin), 'config/s3Config.json');
}
function getProfilesPath(plugin: Plugin): string {
  return path.join(getPluginFolder(plugin), 'config/s3Profiles.json');
}

/**
 * 构造默认空 Profile
 */
function createEmptyProfile(overrides: Partial<S3Profile> = {}): S3Profile {
  return {
    id: `pf_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? 'Default',
    providerType: overrides.providerType ?? 'custom',
    endpoint: overrides.endpoint ?? '',
    accessKeyId: overrides.accessKeyId ?? '',
    secretAccessKey: overrides.secretAccessKey ?? '',
    bucketName: overrides.bucketName ?? '',
    region: overrides.region ?? '',
    keyPrefix: overrides.keyPrefix ?? '',
    useSSL: overrides.useSSL ?? true,
    baseUrl: overrides.baseUrl ?? '',
  };
}

/**
 * 读取 profiles 文件（不存在则返回空骨架）
 */
function readProfilesFile(plugin: Plugin): S3ProfilesFile {
  const file = getProfilesPath(plugin);
  try {
    if (!fs.existsSync(file)) {
      return { currentProfileId: null, profiles: [] };
    }
    const raw = fs.readFileSync(file, 'utf-8');
    if (!raw) return { currentProfileId: null, profiles: [] };
    const parsed = JSON.parse(raw) as S3ProfilesFile;
    // 基础校验与兜底
    if (!parsed || !Array.isArray(parsed.profiles)) {
      return { currentProfileId: null, profiles: [] };
    }
    return {
      currentProfileId: parsed.currentProfileId ?? null,
      profiles: parsed.profiles.map(p => ({
        ...createEmptyProfile(), // 提供字段完整性兜底
        ...p,
        keyPrefix: p.keyPrefix ?? '',
        baseUrl: (p as any).baseUrl ?? '',
      })),
    };
  } catch (e) {
    new Notice('S3 多账户配置损坏，已回退为空。请检查 config/s3Profiles.json');
    return { currentProfileId: null, profiles: [] };
  }
}

/**
 * 写入 profiles 文件（确保目录存在）
 */
function writeProfilesFile(plugin: Plugin, data: S3ProfilesFile): void {
  const file = getProfilesPath(plugin);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const normalized: S3ProfilesFile = {
    currentProfileId: data.currentProfileId ?? (data.profiles[0]?.id ?? null),
    profiles: (data.profiles ?? []).map(p => ({
      ...createEmptyProfile(),
      ...p,
      keyPrefix: p.keyPrefix ?? '',
      baseUrl: (p as any).baseUrl ?? '',
    })),
  };
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), 'utf-8');
}

/**
 * 第一次升级迁移：
 * - 如发现旧版 s3/config/s3Config.json，则读取并迁移为一个 Default profile
 * - 写入到 config/s3Profiles.json
 * - 旧文件保留不再读取（兼容安全）
 */
function tryMigrateFromLegacy(plugin: Plugin): void {
  const legacy = getLegacyConfigPath(plugin);
  const profilesPath = getProfilesPath(plugin);
  if (fs.existsSync(profilesPath)) return; // 已存在新文件则不迁移
  if (!fs.existsSync(legacy)) {
    // 新安装场景：写入一个空 profiles 骨架，用户自行新增
    writeProfilesFile(plugin, { currentProfileId: null, profiles: [] });
    return;
  }
  try {
    const raw = fs.readFileSync(legacy, 'utf-8');
    const legacyCfg = raw ? (JSON.parse(raw) as Partial<S3Config>) : {};
    const defaultProfile = createEmptyProfile({
      name: 'Default',
      providerType: 'custom',
      endpoint: legacyCfg.endpoint ?? '',
      accessKeyId: legacyCfg.accessKeyId ?? '',
      secretAccessKey: legacyCfg.secretAccessKey ?? '',
      bucketName: (legacyCfg as any).bucketName ?? '',
      region: legacyCfg.region ?? '',
      keyPrefix: legacyCfg.keyPrefix ?? '',
      useSSL: (legacyCfg as any).useSSL ?? true,
      baseUrl: (legacyCfg as any).baseUrl ?? '',
    });
    writeProfilesFile(plugin, { currentProfileId: defaultProfile.id, profiles: [defaultProfile] });
    new Notice('已自动将旧版 S3 配置迁移为多账户结构');
  } catch (e) {
    // 迁移失败则仍写入空骨架
    writeProfilesFile(plugin, { currentProfileId: null, profiles: [] });
    new Notice('旧版配置迁移失败，已创建空的多账户配置');
  }
}

/**
 * 获取当前激活的 Profile（若不存在则返回一个空默认 Profile 但不落盘）
 */
export function loadActiveProfile(plugin: Plugin): S3Profile {
  tryMigrateFromLegacy(plugin);
  const data = readProfilesFile(plugin);
  const active = data.profiles.find(p => p.id === data.currentProfileId) ?? data.profiles[0];
  return active ?? createEmptyProfile({ name: 'Default' });
}

/**
 * 列出所有 Profile
 */
export function listProfiles(plugin: Plugin): S3Profile[] {
  tryMigrateFromLegacy(plugin);
  return readProfilesFile(plugin).profiles;
}

/**
 * 保存或更新某个 Profile（若不存在则新增；可用于编辑）
 * 若保存的 Profile 没有 id，则自动赋 id
 */
export function upsertProfile(plugin: Plugin, profile: Partial<S3Profile>): S3Profile {
  tryMigrateFromLegacy(plugin);
  const data = readProfilesFile(plugin);
  const id = profile.id ?? `pf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const existingIdx = data.profiles.findIndex(p => p.id === id);
  const merged: S3Profile = {
    ...createEmptyProfile(),
    ...data.profiles[existingIdx] /* 若存在则在其基础上覆盖 */,
    ...profile,
    id,
    keyPrefix: profile.keyPrefix ?? (data.profiles[existingIdx]?.keyPrefix ?? ''),
    baseUrl: profile.baseUrl ?? (data.profiles[existingIdx]?.baseUrl ?? ''),
  };
  if (existingIdx >= 0) {
    data.profiles.splice(existingIdx, 1, merged);
  } else {
    data.profiles.push(merged);
    if (!data.currentProfileId) data.currentProfileId = merged.id;
  }
  writeProfilesFile(plugin, data);
  return merged;
}

/**
 * 删除某个 Profile
 * 若删除的是当前激活项，则将 currentProfileId 置为剩余第一个或 null
 */
export function removeProfile(plugin: Plugin, profileId: string): void {
  tryMigrateFromLegacy(plugin);
  const data = readProfilesFile(plugin);
  const filtered = data.profiles.filter(p => p.id !== profileId);
  const nextCurrent = data.currentProfileId === profileId ? (filtered[0]?.id ?? null) : data.currentProfileId;
  writeProfilesFile(plugin, { currentProfileId: nextCurrent, profiles: filtered });
}

/**
 * 切换当前激活 Profile
 */
export function setCurrentProfile(plugin: Plugin, profileId: string): void {
  tryMigrateFromLegacy(plugin);
  const data = readProfilesFile(plugin);
  if (!data.profiles.some(p => p.id === profileId)) {
    new Notice('指定的配置不存在');
    return;
  }
  data.currentProfileId = profileId;
  writeProfilesFile(plugin, data);
}

/**
 * 向后兼容函数：返回与旧接口 S3Config 形态一致的“当前配置”
 * 以便 main.ts 与 uploader 现有逻辑最小改动即可继续工作
 */
export function loadS3Config(plugin: Plugin): S3Config {
  const p = loadActiveProfile(plugin);
  const compat: S3Config = {
    endpoint: p.endpoint ?? '',
    accessKeyId: p.accessKeyId ?? '',
    secretAccessKey: p.secretAccessKey ?? '',
    bucketName: p.bucketName ?? '',
    region: p.region ?? '',
    useSSL: p.useSSL ?? true,
    keyPrefix: p.keyPrefix ?? '',
    baseUrl: p.baseUrl ?? '',
  };
  return compat;
}

/**
 * 生成面向用户的公开访问链接
 * 规则：
 * - 优先使用 baseUrl（必须是面向公网的域名，如 R2 的 <bucket>.r2.dev 或自定义域）
 * - 若 baseUrl 为空：
 *    * cloudflare-r2: 抛错提示用户必须配置 baseUrl
 *    * aws-s3: 使用 https://{bucket}.s3.{region}.amazonaws.com/{key}
 *    * minio/custom: 退化到 {endpoint}/{bucket}/{key}（仅当 endpoint 可被公网访问时才有效）
 */
export function buildPublicUrl(plugin: Plugin, key: string): string {
  const p = loadActiveProfile(plugin);
  const bucket = (p.bucketName || '').trim();
  const prefix = (p.keyPrefix || '').replace(/^\/+|\/+$/g, '');
  const finalKey = (prefix ? `${prefix}/` : '') + key.replace(/^\/+/, '');

  // 优先 baseUrl
  const base = (p.baseUrl || '').trim();
  if (base) {
    // 去除多余斜杠
    const baseClean = base.replace(/\/+$/g, '');
    // 对于 R2，通常 baseUrl 已经是 <bucket>.r2.dev 或自定义域，不应再追加 bucket 段
    // 其他提供商若 baseUrl 就是自定义 CDN/域名，同理不应重复 bucket
    return `${baseClean}/${finalKey}`;
  }

  // 无 baseUrl 的兜底行为
  if (p.providerType === 'cloudflare-r2') {
    // R2 的 API 端点不可作为公开直链域名
    throw new Error('Cloudflare R2 需要在配置中填写 Public Base URL（例如 https://<bucket>.r2.dev 或你的自定义域）以生成正确的公开链接');
  }

  if (p.providerType === 'aws-s3') {
    const region = (p.region || 'us-east-1').trim();
    // 兼容 us-east-1 域名形态（现代通常也带区域）
    const host = region === 'us-east-1'
      ? `${bucket}.s3.amazonaws.com`
      : `${bucket}.s3.${region}.amazonaws.com`;
    return `https://${host}/${finalKey}`;
  }

  // minio/custom 退化到 endpoint 路径风格
  const ep = (p.endpoint || '').trim().replace(/\/+$/g, '');
  if (!ep) {
    // 没有 endpoint、没有 baseUrl 的情况下无法构造
    throw new Error('缺少 Public Base URL，且无法从 endpoint 推导公开访问地址，请在配置中填写 Public Base URL');
  }
  return `${ep}/${bucket}/${finalKey}`;
}

/**
 * 向后兼容函数：保存当前 Profile 的字段
 * 旧调用方继续可用；内部会更新当前激活 Profile
 */
export function saveS3Config(plugin: Plugin, config: S3Config): void {
  tryMigrateFromLegacy(plugin);
  const data = readProfilesFile(plugin);
  const current = data.profiles.find(p => p.id === data.currentProfileId) ?? createEmptyProfile({ name: 'Default' });
  const merged: S3Profile = {
    ...current,
    endpoint: config.endpoint ?? '',
    accessKeyId: config.accessKeyId ?? '',
    secretAccessKey: config.secretAccessKey ?? '',
    bucketName: (config as any).bucketName ?? '',
    region: config.region ?? '',
    useSSL: (config as any).useSSL ?? true,
    keyPrefix: config.keyPrefix ?? '',
    baseUrl: (config as any).baseUrl ?? '',
  };
  // 如果 current 不在列表中，插入，并设为 current
  if (!data.profiles.some(p => p.id === current.id)) {
    data.profiles.push(merged);
    data.currentProfileId = merged.id;
  } else {
    const idx = data.profiles.findIndex(p => p.id === current.id);
    data.profiles.splice(idx, 1, merged);
  }
  writeProfilesFile(plugin, data);
}