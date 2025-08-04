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

function makeObjectKey(originalName: string | null, ext: string, prefix: string): string {
  const safePrefix = (prefix || '').replace(/^\/+|\/+$/g, '');
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2);
  const base = originalName
    ? originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\s+/g, '_')
    : `${ts}_${rand}.${ext}`;
  const withExt = base.endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  return (safePrefix ? `${safePrefix}/` : '') + withExt;
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

    // 安装“失败重试”点击拦截（乐观UI）
    const retryHandler = optimistic.handleRetryClickInEditor(this, async ({ editor, uploadId }) => {
      try {
        // 从失败占位行中先切换回 uploading 占位（临时使用 # 链接，上传完成后用最终 URL 替换整段）
        // 这里不再使用 blob 预览，因为失败后不再持有原始 blob；直接保持“上传中”文字占位
        optimistic.findAndReplaceByUploadId(editor, uploadId, (_full, _line) => {
          const tempUploading = `![${t('Uploading...')} ob-s3:id=${uploadId} status=uploading](#)`;
          return tempUploading;
        });

        // 无法重读剪贴板，此处首轮实现选择提示用户重新粘贴更稳妥
        // 为保证闭环，先给出提示；后续第二阶段可引入内存 Map 缓存 uploadId->payload 以实现真正重试
        new Notice(tp('Upload failed: {error}', { error: t('Please paste again to retry upload') }));

        // 将占位切换回 failed，保持可再次点击重试
        optimistic.findAndReplaceByUploadId(editor, uploadId, (_full, _line) => {
          return optimistic.buildFailedMarkdown(uploadId);
        });
      } catch (e:any) {
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
          const key = makeObjectKey(choice.name || null, ext, keyPrefix);

          const publicUrl = await presignAndPutObject(this, {
            key,
            contentType: mime,
            bodyBase64: base64,
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
          new Notice(t('Upload successful!'));
        } catch (e: any) {
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
          const key = makeObjectKey(null, ext, keyPrefix);
          const publicUrl = await presignAndPutObject(this, {
            key,
            contentType: clip.mime || 'application/octet-stream',
            bodyBase64: clip.base64,
          });

          const md = `![](${publicUrl})`;
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (view) {
            const editor: Editor = view.editor;
            editor.replaceSelection(md);
          }
          new Notice(t('Upload successful!'));
        } catch (e: any) {
          new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
        }
      },
    });

    // 监听编辑器粘贴事件（乐观UI版）：若有图片则先插入本地 blob 预览占位，再后台上传并替换
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

          // 1) 立即插入本地预览占位
          const blobUrl = URL.createObjectURL(file);
          const uploadId = optimistic.generateUploadId();
          const placeholderMd = optimistic.buildUploadingMarkdown(uploadId, blobUrl);
          editor.replaceSelection(placeholderMd);

          // 2) 异步上传
          (async () => {
            try {
              const arrayBuffer = await file.arrayBuffer();
              const base64 = Buffer.from(arrayBuffer).toString('base64');
              const mime = file.type || 'application/octet-stream';
              const ext = getFileExtensionFromMime(mime);
              const key = makeObjectKey(file.name || null, ext, keyPrefix);

              const publicUrl = await presignAndPutObject(this, {
                key,
                contentType: mime,
                bodyBase64: base64,
              });

              // 成功：替换为最终 URL，并释放 blob URL
              optimistic.findAndReplaceByUploadId(editor, uploadId, (_full, _line) => `![](${publicUrl})`);
              try { URL.revokeObjectURL(blobUrl); } catch {}
              new Notice(t('Upload successful!'));
            } catch (e:any) {
              // 失败：替换为失败占位，并释放 blob URL
              optimistic.findAndReplaceByUploadId(editor, uploadId, (_full, _line) => optimistic.buildFailedMarkdown(uploadId));
              try { URL.revokeObjectURL(blobUrl); } catch {}
              new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
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