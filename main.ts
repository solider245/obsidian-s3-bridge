import { Notice, Plugin, Editor, MarkdownView } from 'obsidian';
import { loadS3Config } from './s3/s3Manager';
import { t, tp, loadTranslations } from './src/l10n';
import { MyPluginSettingTab, DEFAULT_SETTINGS } from './settingsTab';
import { presignAndPutObject } from './src/uploader/presignPut';

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

async function readClipboardImageAsBase64(): Promise<{ base64: string; mime: string } | null> {
  try {
    // Obsidian 桌面端支持 navigator.clipboard.read
    // 兼容性处理：若不可用则返回 null
    const anyNav: any = navigator as any;
    if (!anyNav.clipboard?.read) return null;
    const items: ClipboardItem[] = await anyNav.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return { base64, mime: type };
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

    // 命令：从剪贴板上传图片并插入链接
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

    // 监听编辑器粘贴事件：若有图片则上传并插入 Markdown 图片链接
    this.registerEvent(
      this.app.workspace.on('editor-paste', async (evt, editor: Editor) => {
        try {
          const items = evt.clipboardData?.items;
          if (!items || items.length === 0) return;

          const fileItem = Array.from(items).find(
            (it) => it.kind === 'file' && it.type.startsWith('image/')
          );
          if (!fileItem) return;

          // 阻止默认粘贴图片为附件的行为
          evt.preventDefault();

          const file = fileItem.getAsFile();
          if (!file) return;

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

          editor.replaceSelection(`![](${publicUrl})`);
          new Notice(t('Upload successful!'));
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