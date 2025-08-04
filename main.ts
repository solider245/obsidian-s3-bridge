/**
 * 概述: 插件主入口，仅负责装配与生命周期；功能逻辑在 src/* 子模块。
 * 导出: ObS3GeminiPlugin (默认导出)
 * 依赖入口:
 *   - [src/bootstrap/i18nBootstrap.ts.registerBuiltinPacksAndLoad()](src/bootstrap/i18nBootstrap.ts:1)
 *   - [settingsTab.ts.MyPluginSettingTab()](settingsTab.ts:1)
 *   - [src/commands/registerCommands.ts.registerCommands()](src/commands/registerCommands.ts:1)
 *   - [src/paste/installPasteHandler.ts.installPasteHandler()](src/paste/installPasteHandler.ts:1)
 *   - [src/retry/installRetryHandler.ts.installRetryHandler()](src/retry/installRetryHandler.ts:1)
 *   - [src/uploader/optimistic.ts.generateUploadId()](src/uploader/optimistic.ts:1)
 */

import { Notice, Plugin } from 'obsidian';
import { t, tp } from './src/l10n';
import { MyPluginSettingTab, DEFAULT_SETTINGS } from './settingsTab';

import { registerBuiltinPacksAndLoad } from './src/bootstrap/i18nBootstrap';
import { registerCommands } from './src/commands/registerCommands';
import { installPasteHandler } from './src/paste/installPasteHandler';
import { installRetryHandler } from './src/retry/installRetryHandler';
import * as optimistic from './src/uploader/optimistic';

export default class ObS3GeminiPlugin extends Plugin {
  async onload() {
    await registerBuiltinPacksAndLoad(this);

    this.addSettingTab(new MyPluginSettingTab(this.app, this, DEFAULT_SETTINGS));

    try {
      const ribbon = this.addRibbonIcon('cloud', t('S3 Uploader'), async () => {
        try {
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
      ribbon?.setAttr('aria-label', t('S3 Uploader'));
    } catch (e) {
      console.warn('[ob-s3-gemini] addRibbonIcon failed:', e);
    }

    // 安装失败占位“重试”点击拦截（回调内部逻辑下放至模块）
    const retry = installRetryHandler(this, async ({ editor, uploadId }) => {
      try {
        const payload = optimistic.takeUploadPayload(uploadId);
        if (!payload) {
          new Notice(tp('Upload failed: {error}', { error: t('Please paste again to retry upload') }));
          return;
        }
        // 仅在此发出占位切换信号；具体上传/替换由 optimistic 与 upload 模块完成
        optimistic.findAndReplaceByUploadId(editor, uploadId, () => `![${t('Uploading...')} ob-s3:id=${uploadId} status=uploading](#)`);

        const [{ loadS3Config }, { performUpload }, { makeObjectKey }] = await Promise.all([
          import('./s3/s3Manager'),
          import('./src/upload/performUpload'),
          import('./src/objectKey/makeKey'),
        ]);
        const cfg = await loadS3Config(this);
        const keyPrefix = (cfg.keyPrefix || '').replace(/^\/+|\/+$/g, '');
        const ext = (payload.mime || 'application/octet-stream').toLowerCase().includes('image/') ? (payload.mime.split('/')[1] || 'bin') : 'bin';
        const key = makeObjectKey(payload.fileName || null, ext, keyPrefix, uploadId, (window as any).__obS3_keyPrefixFormat__);
        const url = await performUpload(this, { key, mime: payload.mime || 'application/octet-stream', base64: payload.base64 });

        optimistic.findAndReplaceByUploadId(editor, uploadId, () => `![](${url})`);
        optimistic.removeUploadPayload(uploadId);
      } catch (e:any) {
        optimistic.findAndReplaceByUploadId(editor, uploadId, () => optimistic.buildFailedMarkdown(uploadId));
        new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
      }
    });
    this.register(() => { try { retry.uninstall(); } catch {} });

    // 注册命令与粘贴处理（装配注入在其模块内部完成）
    registerCommands({
      plugin: this,
      // 其余依赖在模块内动态导入，主入口不再直接关心实现细节
      makeObjectKey: (...args: any[]) => (require('./src/objectKey/makeKey') as any).makeObjectKey(...args),
      getExt: (mime: string) => (require('./src/mime/extension') as any).getFileExtensionFromMime(mime),
      ensureWithinLimitOrConfirm: (bytes: number, limit?: number) => (require('./src/threshold/sizeGuard') as any).ensureWithinLimitOrConfirm(bytes, limit),
      readClipboardImageAsBase64: () => (require('./src/clipboard/readClipboard') as any).readClipboardImageAsBase64(),
      generateUploadId: optimistic.generateUploadId,
    });

    installPasteHandler({
      plugin: this,
      getExt: (mime: string) => (require('./src/mime/extension') as any).getFileExtensionFromMime(mime),
      makeObjectKey: (...args: any[]) => (require('./src/objectKey/makeKey') as any).makeObjectKey(...args),
      ensureWithinLimitOrConfirm: (bytes: number, limit?: number) => (require('./src/threshold/sizeGuard') as any).ensureWithinLimitOrConfirm(bytes, limit),
      generateUploadId: optimistic.generateUploadId,
    });
  }

  async onunload() {}
}