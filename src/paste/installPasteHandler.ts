// 概述: 安装 editor-paste 监听，直接上传图片并替换为 Markdown 链接。
import type { Editor, Plugin } from 'obsidian';
import { Notice } from 'obsidian';
import { performUpload } from '../upload/performUpload';
import { t, tp } from '../l10n';
import { makeObjectKey } from '../core/objectKey';
import { buildPublicUrl, loadS3Config } from '../../s3/s3Manager';
import { activityLog } from '../activityLog';

export interface PasteCtx {
  plugin: Plugin;
  getExt: (mime: string) => string;
}

export function installPasteHandler(ctx: PasteCtx): void {
  const { plugin, getExt } = ctx;

  plugin.registerEvent(
    plugin.app.workspace.on('editor-paste', async (evt, editor: Editor) => {
      try {
        const items = evt.clipboardData?.items;
        if (!items || items.length === 0) return;

        const fileItem = Array.from(items).find(
          (it) => it.kind === 'file' && it.type.startsWith('image/')
        );
        if (!fileItem) return;

        const file = fileItem.getAsFile();
        if (!file) return;

        // 阻止默认粘贴行为
        evt.preventDefault();
        
        const placeholder = `![Uploading ${file.name}...]()`;
        editor.replaceSelection(placeholder);

        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const mime = file.type || 'application/octet-stream';
        const ext = getExt(mime);

        const config = loadS3Config(plugin);
        const key = makeObjectKey(file.name, ext, config.keyPrefix || '');

        let finalUrl = '';
        const startTime = Date.now();
        try {
          await performUpload(plugin, {
            key,
            mime,
            base64,
          });
          finalUrl = buildPublicUrl(plugin, key);
        } catch (e: any) {
          const errorMsg = e?.message ?? String(e);
          editor.replaceSelection(`![Upload Failed: ${file.name}]()`);
          new Notice(tp('Upload failed: {error}', { error: errorMsg }));
          await activityLog.add(plugin.app, 'upload_error', {
            error: errorMsg,
            fileName: file.name,
            source: 'paste',
          });
          return;
        }

        const markdownLink = `![${file.name}](${finalUrl})`;
        
        // 替换占位符
        const text = editor.getValue();
        const newText = text.replace(placeholder, markdownLink);
        if (text !== newText) {
            editor.setValue(newText);
        } else {
            // 如果找不到占位符，就在当前位置插入
            editor.replaceSelection(markdownLink);
        }

        const duration = Date.now() - startTime;
        const sizeMB = (file.size / 1024 / 1024).toFixed(2);
        new Notice(tp('Upload successful! Time: {duration}ms, Size: {size}MB', { duration, size: sizeMB }));
        await activityLog.add(plugin.app, 'upload_success', {
          url: finalUrl,
          fileName: file.name,
          source: 'paste',
          size: file.size,
          duration,
        });

      } catch (e: any) {
        const errorMsg = e?.message ?? String(e);
        new Notice(tp('Upload failed: {error}', { error: errorMsg }));
        await activityLog.add(plugin.app, 'upload_error', {
          error: errorMsg,
          source: 'paste_unexpected',
        });
      }
    })
  );
}
