// 概述: 集中注册插件命令：连接测试、本地文件上传、剪贴板上传。封装依赖注入，便于单元测试与复用。
// 导出: registerCommands(ctx: RegisterCtx): void
// 依赖: Obsidian APIs、上传封装 performUpload、键生成 makeObjectKey、MIME 推断、阈值检查、剪贴板读取、配置读取。
// 用法:
//   registerCommands({ plugin, makeObjectKey, getExt, ensureWithinLimitOrConfirm, readClipboardImageAsBase64 });
// 相关: [src/upload/performUpload.ts()](src/upload/performUpload.ts:1), [src/mime/extension.ts()](src/mime/extension.ts:1), [src/objectKey/makeKey.ts()](src/objectKey/makeKey.ts:1), [src/clipboard/readClipboard.ts()](src/clipboard/readClipboard.ts:1), [src/threshold/sizeGuard.ts()](src/threshold/sizeGuard.ts:1)

import type { Editor, Plugin } from 'obsidian';
import { Notice, MarkdownView } from 'obsidian';
import { t, tp } from '../l10n';
import { loadS3Config } from '../../s3/s3Manager';
import { performUpload } from '../upload/performUpload';

export interface RegisterCtx {
  plugin: Plugin;
  makeObjectKey: (originalName: string | null, ext: string, prefix: string, uploadId?: string, dateFormat?: string) => string;
  getExt: (mime: string) => string;
  ensureWithinLimitOrConfirm: (bytes: number, limitBytes?: number) => Promise<boolean>;
  readClipboardImageAsBase64: () => Promise<{ base64: string; mime: string; size?: number } | null>;
  generateUploadId: () => string;
}

export function registerCommands(ctx: RegisterCtx) {
  const { plugin, makeObjectKey, getExt, ensureWithinLimitOrConfirm, readClipboardImageAsBase64, generateUploadId } = ctx;

  // 测试连接
  plugin.addCommand({
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

  // 从本地选择文件上传
  plugin.addCommand({
    id: 'obs3gemini-upload-from-local-file',
    name: t('Upload File from Local...'),
    callback: async () => {
      try {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = false;
        input.accept = '';
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

        const maxMB = (window as any).__obS3_maxUploadMB__ ?? 5;
        const limitBytes = Math.max(1, Number(maxMB)) * 1024 * 1024;
        const ok = await ensureWithinLimitOrConfirm(choice.size, limitBytes);
        if (!ok) {
          new Notice(t('Upload canceled by user'));
          return;
        }

        const arrayBuffer = await choice.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const mime = choice.type || 'application/octet-stream';
        const ext = getExt(mime);
        const cfgNow = await loadS3Config(plugin);
        const keyPrefix = (cfgNow.keyPrefix || '').replace(/^\/+|\/+$/g, '');
        const uploadId = generateUploadId();
        const key = makeObjectKey(choice.name || null, ext, keyPrefix, uploadId, (window as any).__obS3_keyPrefixFormat__);

        const url = await performUpload(plugin, { key, mime, base64 });

        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          const editor: Editor = view.editor;
          if (mime.startsWith('image/')) {
            editor.replaceSelection(`![](${url})`);
          } else {
            const safeName = (choice.name || key.split('/').pop() || 'file').replace(/\]/g, '');
            editor.replaceSelection(`[${safeName}](${url})`);
          }
        }
      } catch (e: any) {
        new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
      }
    },
  });

  // 从剪贴板上传图片
  plugin.addCommand({
    id: 'obs3gemini-upload-from-clipboard',
    name: 'Upload Image from Clipboard',
    callback: async () => {
      try {
        const clip = await readClipboardImageAsBase64();
        if (!clip) {
          new Notice(tp('Upload failed: {error}', { error: 'No image in clipboard' }));
          return;
        }

        const maxMB = (window as any).__obS3_maxUploadMB__ ?? 5;
        const limitBytes = Math.max(1, Number(maxMB)) * 1024 * 1024;

        const approxBytes = typeof clip.size === 'number' ? clip.size : Math.floor((clip.base64.length * 3) / 4);
        const ok = await ensureWithinLimitOrConfirm(approxBytes, limitBytes);
        if (!ok) {
          new Notice(t('Upload canceled by user'));
          return;
        }

        const ext = getExt(clip.mime);
        const uploadId = generateUploadId();
        const cfgNow = await loadS3Config(plugin);
        const keyPrefix = (cfgNow.keyPrefix || '').replace(/^\/+|\/+$/g, '');
        const key = makeObjectKey(null, ext, keyPrefix, uploadId, (window as any).__obS3_keyPrefixFormat__);

        const url = await performUpload(plugin, { key, mime: clip.mime || 'application/octet-stream', base64: clip.base64 });

        const md = `![](${url})`;
        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          const editor: Editor = view.editor;
          editor.replaceSelection(md);
        }
      } catch (e: any) {
        new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
      }
    },
  });
}

export default { registerCommands };