/**
 * processNext: 从队列取出首项并完成一次上传与占位替换、临时文件清理与出队
 * 设计目标：
 *  - 纯函数风格（除读写队列/文件/编辑器外无外部副作用），便于被命令与 Scheduler 复用
 *  - 幂等：读取来源优先内存缓存，其次本地文件；失败不出队
 *  - 健壮：剥离 path 上可能的查询串，兼容二进制/文本适配器
 */

import type { Editor, Plugin } from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';
import { t, tp } from '../l10n';
import { performUpload } from '../upload/performUpload';
import { loadS3Config } from '../../s3/s3Manager';

// 与 registerCommands 中的定义保持一致
export type QueueItem = {
  id: string;
  filename: string;
  mime: string;
  // 与粘贴阶段一致：存储“当下即可用”的预览地址（blob: 或 vault 相对路径）
  previewUrl?: string;
  // 兼容旧结构：不依赖 path，允许为空
  path: string;
  createdAt: number;
  size?: number;
  base64Length?: number;
};

async function loadQueue(plugin: Plugin): Promise<QueueItem[]> {
  const existing = (await (plugin as any).loadData()) ?? {};
  return Array.isArray(existing.uploadQueue) ? (existing.uploadQueue as QueueItem[]) : [];
}

/**
 * saveQueue 带轻量写入互斥，避免并发覆盖（同一渲染进程内）
 */
async function saveQueue(plugin: Plugin, list: QueueItem[]): Promise<void> {
  const g: any = window as any;
  if (!g.__obS3_savingQueue__) g.__obS3_savingQueue__ = Promise.resolve();
  // 串行化：将本次写入拼接到前一次之后
  g.__obS3_savingQueue__ = g.__obS3_savingQueue__.then(async () => {
    const existing = (await (plugin as any).loadData()) ?? {};
    (existing as any).uploadQueue = list;
    await (plugin as any).saveData(existing);
  }).catch(() => {/* 忽略前序错误，防止链条中断 */});
  await g.__obS3_savingQueue__;
}

function replaceInEditor(plugin: Plugin, uploadId: string, url: string, fileLabel: string) {
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return false;
  const editor: Editor = view.editor;
  // 复用 optimistic 的查找与替换能力
  const opt = require('../uploader/optimistic') as any;
  return opt.findAndReplaceByUploadId(editor, uploadId, (full: string, _line: string) => {
    // 升级：占位中优先使用云端链接；若模板含有备用文本/链接结构，统一替换为最终 URL
    if (/\!\[/.test(full)) return `![](${url})`;
    const safe = (fileLabel || 'file').replace(/\]/g, '');
    return `[${safe}](${url})`;
  });
}

/**
 * 尝试读取 base64：优先 optimistic 缓存，其次从 vault 文件读取（若 path 可用）
 * 关键修复：
 *  - 若 path 为空（空字符串），强制依赖缓存；不直接返回 null，而是再尝试从 __obS3_tempFiles__ 映射回查路径。
 *  - 当本地文件缺失但缓存仍在时，返回缓存以避免“找不到 .assets/xxx.png”后续失败。
 */
async function readBase64For(plugin: Plugin, item: QueueItem): Promise<string | null> {
  // 0) 优先缓存（非临时模式靠它）
  try {
    const cached = (require('../uploader/optimistic') as any).takeUploadPayload(item.id);
    if (cached?.base64) return cached.base64;
  } catch { /* ignore */ }

  // 1) 若 previewUrl 是 vault 相对路径（以 ".obs3/" 或 ".assets/" 开头），尝试读取文件
  const fromPreview = (item.previewUrl || '').split('?')[0];
  const isVaultRel = typeof fromPreview === 'string' && (/^\.obs3\//.test(fromPreview) || /^\.assets\//.test(fromPreview));
  if (isVaultRel) {
    try {
      const adapter: any = (plugin.app.vault as any)?.adapter;
      if (adapter && typeof adapter.readBinary === 'function') {
        const bin: ArrayBuffer = await adapter.readBinary(fromPreview);
        return Buffer.from(bin).toString('base64');
      }
      const txt = await plugin.app.vault.adapter.read(fromPreview);
      return Buffer.from(txt, 'binary').toString('base64');
    } catch { /* ignore */ }
  }

  // 2) 回退使用旧 path 读取（向后兼容）
  let pathCandidate = (item.path || '').split('?')[0];
  if (pathCandidate) {
    try {
      const adapter: any = (plugin.app.vault as any)?.adapter;
      if (adapter && typeof adapter.readBinary === 'function') {
        const bin: ArrayBuffer = await adapter.readBinary(pathCandidate);
        return Buffer.from(bin).toString('base64');
      }
      const txt = await plugin.app.vault.adapter.read(pathCandidate);
      return Buffer.from(txt, 'binary').toString('base64');
    } catch { /* ignore */ }
  }

  // 3) 再次尝试缓存（可能稍后才写入）
  try {
    const cached2 = (require('../uploader/optimistic') as any).takeUploadPayload(item.id);
    if (cached2?.base64) return cached2.base64;
  } catch { /* ignore */ }

  return null;
}

/**
 * 执行一次处理：
 * - 无队列或失败：返回 { processed:false }
 * - 成功：返回 { processed:true }
 */
/**
 * 进程级并发保护：命令与调度器共享
 */
/**
 * 增强调试日志：打印队列头部 5 条与当前处理项的关键信息（id、path 及是否存在、本地/缓存命中）。
 */
export async function processNext(plugin: Plugin): Promise<{ processed: boolean }> {
  const g: any = window as any;
  if (g.__obS3_inflight_processNext__) {
    try { console.info('[ob-s3-gemini][processNext] skipped: inflight'); } catch {}
    return { processed: false };
  }
  g.__obS3_inflight_processNext__ = true;
  try {
    const list = await loadQueue(plugin);
    try {
      const head = list.slice(0, 5).map((x) => ({ id: x.id, path: x.path, mime: x.mime, createdAt: x.createdAt }));
      console.info('[ob-s3-gemini][processNext] queue head', { len: list.length, head });
    } catch {}
    if (!list.length) return { processed: false };

  const item = list[0];

  // 读取 base64
  // 先记录本地文件是否存在，帮助定位“找不到 .assets/xxx.png”
  try {
    const p = (item.path || '').split('?')[0];
    if (p) {
      const file = plugin.app.vault.getAbstractFileByPath(p);
      const exists = !!file || (await (async () => {
        try { return await plugin.app.vault.adapter.exists(p); } catch { return false; }
      })());
      console.info('[ob-s3-gemini][processNext] head item path check', { id: item.id, path: p, exists });
    } else {
      console.info('[ob-s3-gemini][processNext] head item has empty path, will rely on cache', { id: item.id });
    }
  } catch {}
  let base64 = await readBase64For(plugin, item);
  if (!base64) {
    // 兜底：从编辑器占位中反解析 /.obs3/assets 或历史 .assets 路径再尝试一次读取
    try {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const editor: Editor | undefined = view?.editor;
      if (editor) {
        const lineCount = editor.lineCount();
        const RE_ANY = new RegExp(String.raw`!\[[^\]]*?\bob-s3:id=(${item.id})\s+status=(uploading|failed)[^\]]*?\]\(([^)]+)?\)`, 'm');
        for (let i = 0; i < lineCount; i++) {
          const line = editor.getLine(i) || '';
          const m = line.match(RE_ANY);
          if (m) {
            const urlFromLine = (m[3] || '').split('?')[0];
            if (urlFromLine && (urlFromLine.includes('.obs3/assets/') || urlFromLine.includes('.assets/'))) {
              // 兼容两种前缀：/.obs3/assets 与 .assets
              const idxObs3 = urlFromLine.indexOf('.obs3/assets/');
              const idxLegacy = urlFromLine.indexOf('.assets/');
              const rel = idxObs3 >= 0 ? urlFromLine.slice(idxObs3) : (idxLegacy >= 0 ? urlFromLine.slice(idxLegacy) : urlFromLine);
              try {
                const adapter: any = (plugin.app.vault as any)?.adapter;
                let recovered: string | null = null;
                if (adapter && typeof adapter.readBinary === 'function') {
                  const bin: ArrayBuffer = await adapter.readBinary(rel);
                  recovered = Buffer.from(bin).toString('base64');
                } else {
                  const txt = await plugin.app.vault.adapter.read(rel);
                  recovered = Buffer.from(txt, 'binary').toString('base64');
                }
                if (recovered) {
                  try { console.info('[ob-s3-gemini][processNext] recovered base64 via editor placeholder URL', { id: item.id, path: rel }); } catch {}
                  try { (require('../uploader/optimistic') as any).cacheUploadPayload(item.id, { base64: recovered, mime: item.mime || 'application/octet-stream', fileName: item.filename }); } catch {}
                  base64 = recovered;
                }
              } catch { /* ignore read error */ }
            }
            break;
          }
        }
      }
    } catch {}
  }

  // 准备 key
  const cfgNow = await loadS3Config(plugin);
  const keyPrefix = (cfgNow.keyPrefix || '').replace(/^\/+|\/+$/g, '');
  const ext = (() => {
    // 简化：尽量少依赖，沿用现有 getExt 逻辑在命令处；这里兜底
    const m = (item.mime || '').toLowerCase();
    if (m.startsWith('image/')) return (m.split('/')[1] || 'png');
    if (m === 'text/plain') return 'txt';
    return 'bin';
  })();
  const makeObjectKey = (originalName: string | null, ext: string, prefix: string, uploadId?: string, dateFormat?: string) => {
    // 与现有签名保持兼容（调用侧传入同函数会覆盖本内置）
    const fn = (require('../core/objectKey') as any).makeObjectKey as Function;
    return typeof fn === 'function'
      ? fn(originalName, ext, prefix, uploadId, dateFormat)
      : `${prefix ? prefix + '/' : ''}${(uploadId || item.id)}.${ext}`;
  };
  const key = makeObjectKey(item.filename || null, ext, keyPrefix, item.id, (window as any).__obS3_keyPrefixFormat__);

  // 上传
  // 最终确保传入的是 string 类型的 base64
  let finalBase64: string | null = base64;
  if (!finalBase64) {
    try {
      const cached2 = (require('../uploader/optimistic') as any).takeUploadPayload(item.id);
      if (cached2?.base64) finalBase64 = cached2.base64;
    } catch { /* ignore */ }
  }
  if (!finalBase64) {
    try { console.warn('[ob-s3-gemini][processNext] final base64 still missing after placeholder recovery', { id: item.id }); } catch {}
    new Notice(tp('Upload failed: {error}', { error: 'Local temp missing and no cache' }));
    return { processed: false };
  }
  const url = await performUpload(plugin, {
    key,
    mime: item.mime || 'application/octet-stream',
    base64: finalBase64,
  });

  // 编辑器替换占位（粘贴阶段地址零处理；此处只在上传成功后用云端链接替换）
  replaceInEditor(plugin, item.id, url, item.filename);

  // 最简方案：不强制删除本地文件，避免误删；后续可加开关做清理
  try {
    void item;
  } catch { /* ignore */ }

  // 清缓存
  try { (require('../uploader/optimistic') as any).removeUploadPayload(item.id); } catch { /* ignore */ }

  // 出队
  await saveQueue(plugin, list.slice(1));

  new Notice(t('Upload successful!'));
  return { processed: true };
  } finally {
    try { (window as any).__obS3_inflight_processNext__ = false; } catch {}
  }
}

export default { processNext };
