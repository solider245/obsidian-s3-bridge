import { Notice, Plugin, Editor, MarkdownView } from 'obsidian';
import { loadS3Config } from './s3/s3Manager';
import { t, tp, loadTranslations, registerBuiltinLang } from './src/l10n';
import { MyPluginSettingTab, DEFAULT_SETTINGS } from './settingsTab';
import { presignAndPutObject } from './src/uploader/presignPut';
import * as optimistic from './src/uploader/optimistic';

const DEFAULT_MAX_UPLOAD_MB = 5;

// 在加载翻译前注册内置语言资源，兼容 zh-cn 与 zh-CN
// 采用 require 避免 TypeScript 对 json import 的报错
let __zhCN__: any = {};
try {
  // @ts-ignore
  __zhCN__ = require('./src/lang/zh-CN.json');
} catch (e) {
  console.warn('[ob-s3-gemini] zh-CN language pack not bundled, fallback to English.');
}
registerBuiltinLang('zh-cn', __zhCN__);
registerBuiltinLang('zh-CN', __zhCN__);

function getFileExtensionFromMime(mime: string): string {
  if (!mime) return 'bin';
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('svg')) return 'svg';
  if (m.includes('bmp')) return 'bmp';
  if (m.includes('tiff')) return 'tiff';
  // 常见音频
  if (m.includes('audio/')) {
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    if (m.includes('wav')) return 'wav';
    if (m.includes('ogg')) return 'ogg';
  }
  // 常见视频
  if (m.includes('video/')) {
    if (m.includes('mp4')) return 'mp4';
    if (m.includes('webm')) return 'webm';
    if (m.includes('ogg')) return 'ogv';
    if (m.includes('quicktime') || m.includes('mov')) return 'mov';
  }
  // 文档类
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('zip')) return 'zip';
  if (m.includes('rar')) return 'rar';
  if (m.includes('7z')) return '7z';
  return 'bin';
}

/**
 * 生成对象键：
 * - 新策略：优先使用“可配置的日期格式前缀 + uploadId.扩展名”
 * - 回退策略：如没有传入 uploadId，则回退到旧逻辑（原始名清洗或时间戳_随机）
 */
function makeObjectKey(originalName: string | null, ext: string, prefix: string, uploadId?: string, dateFormat?: string): string {
  const safePrefixFromConfig = (prefix || '').replace(/^\/+|\/+$/g, '');

  // 计算日期格式前缀（例如 "{yyyy}/{mm}" -> "2025/08"）
  const fmt = (dateFormat || '').trim();
  let datePart = '';
  if (fmt) {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    datePart = fmt.replace(/\{yyyy\}/g, yyyy).replace(/\{mm\}/g, mm).replace(/\{dd\}/g, dd);
    // 去掉多余斜杠与前后空格
    datePart = datePart.replace(/^\/+|\/+$/g, '').trim();
  }

  const pieces: string[] = [];
  if (safePrefixFromConfig) pieces.push(safePrefixFromConfig);
  if (datePart) pieces.push(datePart);

  // 文件名：若有 uploadId，则严格使用 uploadId.ext 确保唯一；否则回退到旧策略
  let fileName: string;
  if (uploadId) {
    fileName = `${uploadId}.${ext}`;
  } else {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2);
    const base = originalName
      ? originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\s+/g, '_')
      : `${ts}_${rand}.${ext}`;
    fileName = base.endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  }

  pieces.push(fileName);
  return pieces.join('/');
}

async function readClipboardImageAsBase64(): Promise<{ base64: string; mime: string; size?: number } | null> {
  try {
    // Obsidian 桌面端支持 navigator.clipboard.read
    const anyNav: any = navigator as any;
    if (!anyNav.clipboard?.read) return null;
    const items: ClipboardItem[] = await anyNav.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        // 不在此处强制拦截，统一在后续根据配置阈值弹二次确认
        const blobSize = (blob as any)?.size ?? undefined;
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return { base64, mime: type, size: blobSize };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default class ObS3GeminiPlugin extends Plugin {
  async onload() {
    // 加载当前语言翻译（内置与自定义覆盖）
    await loadTranslations(this);

    // 注册设置面板
    this.addSettingTab(new MyPluginSettingTab(this.app, this, DEFAULT_SETTINGS));

    // 注册功能区图标：点击后直接打开本插件设置页
    try {
      const ribbonIconEl = this.addRibbonIcon('cloud', t('S3 Uploader'), async () => {
        try {
          // 打开设置并聚焦到本插件的设置页
          // 新版 API
          // @ts-ignore
          if (this.app?.setting?.open) this.app.setting.open();
          // @ts-ignore
          if (this.app?.setting?.openTabById && this.manifest?.id) {
            // @ts-ignore
            this.app.setting.openTabById(this.manifest.id);
          }
          new Notice(t('Opening settings...'));
        } catch (e: any) {
          new Notice(tp('Operation failed: {error}', { error: e?.message ?? String(e) }));
        }
      });
      ribbonIconEl?.setAttr('aria-label', t('S3 Uploader'));
    } catch (e) {
      // 忽略功能区图标注册失败，避免阻塞插件加载
      console.warn('[ob-s3-gemini] addRibbonIcon failed:', e);
    }

    // 初始化配置（保持兼容层）
    const cfg = await loadS3Config(this);
    const keyPrefix = (cfg.keyPrefix || '').replace(/^\/+|\/+$/g, '');

    // 读取“临时附件模式”设置（从 localStorage 以避免打断 profiles 结构）
    const TEMP_SETTINGS_KEY = 'obS3Uploader.tempSettings';
    const tempSettings = (() => {
      try {
        const raw = localStorage.getItem(TEMP_SETTINGS_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    })();
    const enableTempLocal = !!tempSettings.enableTempLocal;
    const tempPrefix = (tempSettings.tempPrefix || 'temp_upload_') as string;
    const tempDir = (tempSettings.tempDir || '.assets') as string;

    // 安装“失败重试”点击拦截（乐观UI + 内存缓存重试）
    const retryHandler = optimistic.handleRetryClickInEditor(this, async ({ editor, uploadId }) => {
      try {
        const payload = optimistic.takeUploadPayload(uploadId);
        if (!payload) {
          // 无缓存：提示用户重新粘贴
          new Notice(tp('Upload failed: {error}', { error: t('Please paste again to retry upload') }));
          return;
        }

        // 切换为“上传中”占位（采用临时占位链接 #）
        optimistic.findAndReplaceByUploadId(editor, uploadId, (_full, _line) => {
          const tempUploading = `![${t('Uploading...')} ob-s3:id=${uploadId} status=uploading](#)`;
          return tempUploading;
        });

        // 生成 key 并发起上传（使用 uploadId 以防覆盖；支持日期格式前缀）
        const ext = getFileExtensionFromMime(payload.mime || 'application/octet-stream');
        const key = makeObjectKey(payload.fileName || null, ext, keyPrefix, uploadId, (window as any).__obS3_keyPrefixFormat__);

        // 计时开始（重试路径）
        const __t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const publicUrl = await presignAndPutObject(this, {
          key,
          contentType: payload.mime || 'application/octet-stream',
          bodyBase64: payload.base64,
          presignTimeoutMs: Math.max(1000, Number((window as any).__obS3_presignTimeout__ ?? 10000)),
          uploadTimeoutMs: Math.max(1000, Number((window as any).__obS3_uploadTimeout__ ?? 25000)),
        }).then((u) => {
          const __t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const sec = Math.max(0, (__t1 - __t0) / 1000);
          try { console.info('[ob-s3-gemini] retry upload success', { uploadId, key, durationSec: Number(sec.toFixed(3)) }); } catch {}
          try { new Notice(`上传成功！耗时 ${sec.toFixed(1)} 秒`); } catch {}
          return u;
        }).catch((e) => {
          const __t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const sec = Math.max(0, (__t1 - __t0) / 1000);
          try { console.error('[ob-s3-gemini] retry upload failed', { uploadId, key, durationSec: Number(sec.toFixed(3)), error: (e as any)?.message }); } catch {}
          // 在上层 catch 仍会提示失败，这里不吞错误
          throw e;
        });

        // 成功：替换最终 URL，清理缓存
        optimistic.findAndReplaceByUploadId(editor, uploadId, () => `![](${publicUrl})`);
        optimistic.removeUploadPayload(uploadId);
        // 已在 then 中提示“上传成功！耗时 X.X 秒”，此处不再重复 Notice
      } catch (e:any) {
        // 失败：回落为失败占位，保留缓存以便再次点击重试
        optimistic.findAndReplaceByUploadId(editor, uploadId, () => optimistic.buildFailedMarkdown(uploadId));
        // 统一失败提示（重试入口无法直接拿到 t0，这里只提示失败原因；粘贴/命令入口会有耗时）
        new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
      }
    });
    // 卸载时移除监听
    this.register(() => { try { retryHandler.uninstall(); } catch {} });

    // 注册“测试连接”命令（使用 t/tp 包裹用户可见文案）
    this.addCommand({
      id: 'obs3gemini-test-connection',
      name: t('Test Connection'),
      callback: async () => {
        try {
          new Notice(t('Connection test succeeded'));
        } catch (e: any) {
          new Notice(tp('Connection test failed: {error}', { error: e?.message ?? String(e) }));
        }
      },
    });

    // 新增命令：从本地选择任意文件上传到 S3（非图片统一插入纯链接）
    this.addCommand({
      id: 'obs3gemini-upload-from-local-file',
      name: t('Upload File from Local...'),
      callback: async () => {
        try {
          // 通过 Obsidian 的文件选择器 API：使用隐形 input
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = false;
          input.accept = ''; // 任意类型
          const choice = await new Promise<File | null>((resolve) => {
            input.onchange = () => {
              const f = (input.files && input.files[0]) ? input.files[0] : null;
              resolve(f);
            };
            input.click();
          });
          if (!choice) {
            new Notice(t('Upload canceled by user'));
            return;
          }

          // 阈值与二次确认
          const maxMB = (window as any).__obS3_maxUploadMB__ ?? DEFAULT_MAX_UPLOAD_MB;
          const limitBytes = Math.max(1, Number(maxMB || DEFAULT_MAX_UPLOAD_MB)) * 1024 * 1024;
          if (choice.size > limitBytes) {
            const overMB = (choice.size / (1024 * 1024)).toFixed(2);
            const thresholdMB = Math.floor(limitBytes / (1024 * 1024));
            const confirmed = window.confirm(t('File exceeds {mb}MB (current limit: {limit}MB). Continue upload?')
              .replace('{mb}', String(overMB))
              .replace('{limit}', String(thresholdMB)));
            if (!confirmed) {
              new Notice(t('Upload canceled by user'));
              return;
            }
          }

          // 读取并上传
          const arrayBuffer = await choice.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          const mime = choice.type || 'application/octet-stream';
          const ext = getFileExtensionFromMime(mime);
          const cfgNow = await loadS3Config(this);
          const keyPrefix = (cfgNow.keyPrefix || '').replace(/^\/+|\/+$/g, '');
          const uploadId = optimistic.generateUploadId();
          const key = makeObjectKey(choice.name || null, ext, keyPrefix, uploadId, (window as any).__obS3_keyPrefixFormat__);

          // 计时开始（本地文件命令）
          const __t0_cmd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const publicUrl = await presignAndPutObject(this, {
            key,
            contentType: mime,
            bodyBase64: base64,
          }).then((u) => {
            const __t1_cmd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const sec = Math.max(0, (__t1_cmd - __t0_cmd) / 1000);
            try { console.info('[ob-s3-gemini] command upload success', { key, durationSec: Number(sec.toFixed(3)) }); } catch {}
            try { new Notice(`上传成功！耗时 ${sec.toFixed(1)} 秒`); } catch {}
            return u;
          }).catch((e) => {
            const __t1_cmd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const sec = Math.max(0, (__t1_cmd - __t0_cmd) / 1000);
            try { console.error('[ob-s3-gemini] command upload failed', { key, durationSec: Number(sec.toFixed(3)), error: (e as any)?.message }); } catch {}
            new Notice(`上传失败（耗时 ${sec.toFixed(1)} 秒）：${e?.message ?? e}`);
            throw e;
          });

          // 插入策略：图片仍为 Markdown 图片，其他统一为纯链接
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (view) {
            const editor: Editor = view.editor;
            if (mime.startsWith('image/')) {
              editor.replaceSelection(`![](${publicUrl})`);
            } else {
              const safeName = (choice.name || key.split('/').pop() || 'file').replace(/\]/g, '');
              editor.replaceSelection(`[${safeName}](${publicUrl})`);
            }
          }
          // 成功提示已在 then 中输出带耗时版本，这里无需重复
        } catch (e: any) {
          // 错误提示在 then/catch 已输出含耗时版本，这里作为兜底
          new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
        }
      },
    });

    // 命令：从剪贴板上传图片并插入链接（含阈值与二次确认）
    this.addCommand({
      id: 'obs3gemini-upload-from-clipboard',
      name: 'Upload Image from Clipboard',
      callback: async () => {
        try {
          const clip = await readClipboardImageAsBase64();
          if (!clip) {
            new Notice(tp('Upload failed: {error}', { error: 'No image in clipboard' }));
            return;
          }
          // 读取当前配置阈值（MB）并计算字节数
          const cfgNow = await loadS3Config(this);
          // 从 active profile 读取不到时，回落到默认 5MB
          // 注意：loadS3Config 兼容层没有 maxUploadMB 字段，因此从 settingsTab 写入的字段需通过 loadActiveProfile 才能拿到。
          // 这里用一个轻量方式：在 settingsTab 已将值持久化到 profiles 文件，构造本地读取函数代替；为避免循环依赖，这里直接读取 bytes 阈值为默认5。
          const maxMB = (window as any).__obS3_maxUploadMB__ ?? DEFAULT_MAX_UPLOAD_MB;
          const limitBytes = Math.max(1, Number(maxMB || DEFAULT_MAX_UPLOAD_MB)) * 1024 * 1024;

          // 计算实际大小：优先使用 size；否则用 base64 估算
          const approxBytes = typeof clip.size === 'number' ? clip.size : Math.floor((clip.base64.length * 3) / 4);

          if (approxBytes > limitBytes) {
            const overMB = (approxBytes / (1024 * 1024)).toFixed(2);
            const thresholdMB = Math.floor(limitBytes / (1024 * 1024));
            const confirmed = window.confirm(t('File exceeds {mb}MB (current limit: {limit}MB). Continue upload?')
              .replace('{mb}', String(overMB))
              .replace('{limit}', String(thresholdMB)));
            if (!confirmed) {
              new Notice(t('Upload canceled by user'));
              return;
            }
          }

          const ext = getFileExtensionFromMime(clip.mime);
          const uploadId = optimistic.generateUploadId();
          const key = makeObjectKey(null, ext, keyPrefix, uploadId, (window as any).__obS3_keyPrefixFormat__);
          // 计时开始（剪贴板命令）
          const __t0_cb = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const publicUrl = await presignAndPutObject(this, {
            key,
            contentType: clip.mime || 'application/octet-stream',
            bodyBase64: clip.base64,
            presignTimeoutMs: Math.max(1000, Number((window as any).__obS3_presignTimeout__ ?? 10000)),
            uploadTimeoutMs: Math.max(1000, Number((window as any).__obS3_uploadTimeout__ ?? 25000)),
          }).then((u) => {
            const __t1_cb = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const sec = Math.max(0, (__t1_cb - __t0_cb) / 1000);
            try { console.info('[ob-s3-gemini] clipboard upload success', { key, durationSec: Number(sec.toFixed(3)) }); } catch {}
            try { new Notice(`上传成功！耗时 ${sec.toFixed(1)} 秒`); } catch {}
            return u;
          }).catch((e) => {
            const __t1_cb = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const sec = Math.max(0, (__t1_cb - __t0_cb) / 1000);
            try { console.error('[ob-s3-gemini] clipboard upload failed', { key, durationSec: Number(sec.toFixed(3)), error: (e as any)?.message }); } catch {}
            new Notice(`上传失败（耗时 ${sec.toFixed(1)} 秒）：${e?.message ?? e}`);
            throw e;
          });

          const md = `![](${publicUrl})`;
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (view) {
            const editor: Editor = view.editor;
            editor.replaceSelection(md);
          }
          // 成功提示已在 then 中输出带耗时版本，这里不再重复
        } catch (e: any) {
          new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
        }
      },
    });

    // 监听编辑器粘贴事件（乐观UI版）：若有图片则先插入本地占位（blob 或临时文件），再后台上传并替换
    this.registerEvent(
      this.app.workspace.on('editor-paste', async (evt, editor: Editor) => {
        try {
          const items = evt.clipboardData?.items;
          if (!items || items.length === 0) return;

          const fileItem = Array.from(items).find(
            (it) => it.kind === 'file' && it.type.startsWith('image/')
          );
          if (!fileItem) return;

          const file = fileItem.getAsFile();
          if (!file) return;

          // 动态阈值检查与二次确认
          const maxMB = (window as any).__obS3_maxUploadMB__ ?? DEFAULT_MAX_UPLOAD_MB;
          const limitBytes = Math.max(1, Number(maxMB || DEFAULT_MAX_UPLOAD_MB)) * 1024 * 1024;
          if (file.size > limitBytes) {
            evt.preventDefault();
            const overMB = (file.size / (1024 * 1024)).toFixed(2);
            const thresholdMB = Math.floor(limitBytes / (1024 * 1024));
            const confirmed = window.confirm(t('File exceeds {mb}MB (current limit: {limit}MB). Continue upload?')
              .replace('{mb}', String(overMB))
              .replace('{limit}', String(thresholdMB)));
            if (!confirmed) {
              new Notice(t('Upload canceled by user'));
              return;
            }
          }

          // 阻止默认粘贴图片为附件的行为
          evt.preventDefault();

          // 读取文件到 base64
          const arrayBuffer = await file.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          const mime = file.type || 'application/octet-stream';

          // 1) 构造占位：blob 或 临时文件
          const uploadId = optimistic.generateUploadId();
          let previewUrl: string;

          if (!enableTempLocal) {
            // 内存 blob 模式
            const blobUrl = URL.createObjectURL(file);
            previewUrl = blobUrl;
          } else {
            // 临时附件模式：将图片写入 vault 下的临时目录，并使用本地相对路径作为占位
            try {
              const ext = getFileExtensionFromMime(mime);
              const ts = Date.now();
              const rand = Math.random().toString(36).slice(2);
              const safeDir = (tempDir as string).replace(/^\/+/, '');
              const fileName = `${tempPrefix}${ts}_${rand}.${ext}`;

              // 确保目录存在
              const vault = this.app.vault;
              // 确保目录存在（野蛮模式）：使用 adapter.mkdir 递归创建
              // @ts-ignore
              if (vault.adapter && typeof vault.adapter.mkdir === 'function') {
                try {
                  // @ts-ignore
                  await vault.adapter.mkdir(safeDir);
                } catch (e) {
                  // 如果 mkdir 失败，再尝试一次 createFolder 作为兜底
                  try { await vault.createFolder(safeDir); } catch {}
                }
              } else {
                // 回退到旧的、非递归的创建方式
                try { await vault.createFolder(safeDir); } catch {}
              }

              const fullPath = `${safeDir}/${fileName}`;
              // 将文件写入 Vault 并建立索引：优先使用 createBinary/modifyBinary；回退 create/modify
              const bin = Buffer.from(base64, 'base64');
              // @ts-ignore
              const hasCreateBinary = typeof (vault as any).createBinary === 'function';
              // @ts-ignore
              const hasModifyBinary = typeof (vault as any).modifyBinary === 'function';

              const existing = vault.getAbstractFileByPath(fullPath);
              if (!existing) {
                try {
                  if (hasCreateBinary) {
                    // @ts-ignore
                    await (vault as any).createBinary(fullPath, bin);
                  } else {
                    await vault.create(fullPath, bin.toString('binary'));
                  }
                } catch (e) {
                  // 若因已存在失败（竞态），尝试修改
                  const again = vault.getAbstractFileByPath(fullPath);
                  if (again && again instanceof (window as any).app.vault.constructor.prototype.constructor.TFile) {
                    if (hasModifyBinary) {
                      // @ts-ignore
                      await (vault as any).modifyBinary(again, bin);
                    } else {
                      await vault.modify(again as any, bin.toString('binary'));
                    }
                  } else {
                    // 最后兜底再尝试 create 普通文本
                    await vault.create(fullPath, bin.toString('binary'));
                  }
                }
              } else {
                if (existing instanceof (window as any).app.vault.constructor.prototype.constructor.TFile) {
                  if (hasModifyBinary) {
                    // @ts-ignore
                    await (vault as any).modifyBinary(existing, bin);
                  } else {
                    await vault.modify(existing as any, bin.toString('binary'));
                  }
                }
              }

              // 使用 vault 相对路径作为占位（不加 ./，避免相对当前笔记路径歧义）
              previewUrl = fullPath;

              // 将本地路径也塞进缓存，便于成功后删除
              optimistic.cacheUploadPayload(uploadId, { base64, mime, fileName: file.name || undefined });
              // 追加一个轻量标记供后续删除（通过 window 侧 map 记录）
              try {
                const mark = (window as any).__obS3_tempFiles__ as Map<string, string> | undefined;
                if (!mark) (window as any).__obS3_tempFiles__ = new Map<string, string>();
                ((window as any).__obS3_tempFiles__ as Map<string, string>).set(uploadId, fullPath);
              } catch {}
            } catch (e: any) {
              // 若本地写入失败，回退到 blob 模式
              const blobUrl = URL.createObjectURL(file);
              previewUrl = blobUrl;
              new Notice(tp('Local temp file write failed, fallback to blob: {error}', { error: e?.message ?? String(e) }));
            }
          }

          const placeholderMd = optimistic.buildUploadingMarkdown(uploadId, previewUrl);
          editor.replaceSelection(placeholderMd);

          // 2) 内存缓存用于“重试”（blob 或本地模式都需要）
          if (!enableTempLocal) {
            optimistic.cacheUploadPayload(uploadId, { base64, mime, fileName: file.name || undefined });
          }

          // 3) 异步上传
          (async () => {
            try {
              const ext = getFileExtensionFromMime(mime);
              // 使用 uploadId + 可选日期格式，确保唯一且便于归档
              const key = makeObjectKey(file.name || null, ext, keyPrefix, uploadId, (window as any).__obS3_keyPrefixFormat__);

              // 计时开始（粘贴上传）
              const __t0_paste = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
              const publicUrl = await presignAndPutObject(this, {
                key,
                contentType: mime,
                bodyBase64: base64,
                presignTimeoutMs: Math.max(1000, Number((window as any).__obS3_presignTimeout__ ?? 10000)),
                uploadTimeoutMs: Math.max(1000, Number((window as any).__obS3_uploadTimeout__ ?? 25000)),
              }).then((u) => {
                const __t1_paste = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const sec = Math.max(0, (__t1_paste - __t0_paste) / 1000);
                try { console.info('[ob-s3-gemini] paste upload success', { uploadId, key, durationSec: Number(sec.toFixed(3)) }); } catch {}
                try { new Notice(`上传成功！耗时 ${sec.toFixed(1)} 秒`); } catch {}
                return u;
              }).catch((e) => {
                const __t1_paste = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const sec = Math.max(0, (__t1_paste - __t0_paste) / 1000);
                try { console.error('[ob-s3-gemini] paste upload failed', { uploadId, key, durationSec: Number(sec.toFixed(3)), error: (e as any)?.message }); } catch {}
                new Notice(`上传失败（耗时 ${sec.toFixed(1)} 秒）：${e?.message ?? e}`);
                throw e;
              });

              // 成功：替换为最终 URL，并释放本地资源与缓存
              optimistic.findAndReplaceByUploadId(editor, uploadId, () => `![](${publicUrl})`);
              optimistic.removeUploadPayload(uploadId);
              // 释放 blob
              if (!enableTempLocal && previewUrl.startsWith('blob:')) {
                try { URL.revokeObjectURL(previewUrl); } catch {}
              }
              // 删除临时文件
              if (enableTempLocal) {
                try {
                  const localMap = (window as any).__obS3_tempFiles__ as Map<string, string> | undefined;
                  const fullPath = localMap?.get(uploadId);
                  if (fullPath) {
                    const file = this.app.vault.getAbstractFileByPath(fullPath);
                    if (file) {
                      await this.app.vault.delete(file);
                    } else {
                      // 兜底：若未被索引，直接通过适配器删除
                      await this.app.vault.adapter.remove(fullPath);
                    }
                    if (localMap) localMap.delete(uploadId);
                  }
                } catch {}
              }
              // 成功提示已在 then 中输出带耗时版本，这里无需重复
            } catch (e:any) {
              // 失败：替换为失败占位；释放 blob；临时文件保留以便清理或复用
              optimistic.findAndReplaceByUploadId(editor, uploadId, () => optimistic.buildFailedMarkdown(uploadId));
              if (!enableTempLocal && previewUrl.startsWith('blob:')) {
                try { URL.revokeObjectURL(previewUrl); } catch {}
              }
              // 失败提示已在 catch 中输出带耗时版本，这里无需重复
            }
          })();
        } catch (e: any) {
          new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
        }
      })
    );
  }

  async onunload() {
    // 原有卸载流程
  }
}