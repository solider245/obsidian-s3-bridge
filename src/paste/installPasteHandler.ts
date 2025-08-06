// 概述: 安装 editor-paste 监听，直接上传图片并替换为 Markdown 链接。
import type { Editor, Plugin } from 'obsidian';
import { Notice } from 'obsidian';
import { performUpload } from '../upload/performUpload';
import { t, tp } from '../l10n';
import { makeObjectKey } from '../core/objectKey';
import { buildPublicUrl, loadS3Config } from '../../s3/s3Manager';
import { logger } from '../logger';

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
          logger.error('Paste upload failed', { error: errorMsg, fileName: file.name });
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

        new Notice(t('Image uploaded successfully!'));
        logger.info('Paste upload success', { url: finalUrl, fileName: file.name });

      } catch (e: any) {
        const errorMsg = e?.message ?? String(e);
        new Notice(tp('Upload failed: {error}', { error: errorMsg }));
        logger.error('Paste upload unexpected error', { error: errorMsg });
      }
    })
  );
}
