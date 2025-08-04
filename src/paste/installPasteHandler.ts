// 概述: 安装 editor-paste 监听，针对图片内容执行“乐观占位 -> 后台上传 -> 成功替换/失败占位”，支持本地临时附件模式与 Blob 占位。
// 导出: installPasteHandler(ctx: PasteCtx): void
// 依赖: Obsidian Editor 事件、optimistic 占位工具、performUpload、makeObjectKey、MIME 推断、阈值检查、S3 配置。
// 用法:
//   installPasteHandler({ plugin, getExt, makeObjectKey, ensureWithinLimitOrConfirm, generateUploadId });
// 相关: [src/uploader/optimistic.ts()](src/uploader/optimistic.ts:1), [src/upload/performUpload.ts()](src/upload/performUpload.ts:1), [src/objectKey/makeKey.ts()](src/objectKey/makeKey.ts:1), [src/mime/extension.ts()](src/mime/extension.ts:1)

import type { Editor, Plugin } from 'obsidian';
import { Notice } from 'obsidian';
import * as optimistic from '../uploader/optimistic';
import { performUpload } from '../upload/performUpload';
import { loadS3Config } from '../../s3/s3Manager';
import { t, tp } from '../l10n';

export interface PasteCtx {
  plugin: Plugin;
  getExt: (mime: string) => string;
  makeObjectKey: (originalName: string | null, ext: string, prefix: string, uploadId?: string, dateFormat?: string) => string;
  ensureWithinLimitOrConfirm: (bytes: number, limitBytes?: number) => Promise<boolean>;
  generateUploadId: () => string;
}

export function installPasteHandler(ctx: PasteCtx): void {
  const { plugin, getExt, makeObjectKey, ensureWithinLimitOrConfirm, generateUploadId } = ctx;

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

        // 动态阈值检查与二次确认
        const maxMB = (window as any).__obS3_maxUploadMB__ ?? 5;
        const limitBytes = Math.max(1, Number(maxMB)) * 1024 * 1024;
        if (file.size > limitBytes) {
          evt.preventDefault();
          const ok = await ensureWithinLimitOrConfirm(file.size, limitBytes);
          if (!ok) {
            new Notice(t('Upload canceled by user'));
            return;
          }
        }

        // 阻止默认粘贴为附件
        evt.preventDefault();

        // 读取文件到 base64
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const mime = file.type || 'application/octet-stream';

        // 读取“临时附件模式”设置
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

        // 1) 构造占位：blob 或 临时文件
        const uploadId = generateUploadId();
        let previewUrl: string;

        if (!enableTempLocal) {
          // 内存 blob 模式
          const blobUrl = URL.createObjectURL(file);
          previewUrl = blobUrl;
        } else {
          // 临时附件模式
          try {
            const ext = getExt(mime);
            const ts = Date.now();
            const rand = Math.random().toString(36).slice(2);
            const safeDir = (tempDir as string).replace(/^\/+/, '');
            // 同名后缀重试最多 3 次
            const makeName = (n: number) => n === 0 ? `${tempPrefix}${ts}_${rand}.${ext}` : `${tempPrefix}${ts}_${rand}-${n}.${ext}`;
            const vault = plugin.app.vault as any;
    
            // 确保目录存在
            if (vault.adapter && typeof vault.adapter.mkdir === 'function') {
              try {
                await vault.adapter.mkdir(safeDir);
              } catch {
                try { await plugin.app.vault.createFolder(safeDir); } catch {}
              }
            } else {
              try { await plugin.app.vault.createFolder(safeDir); } catch {}
            }
    
            const hasCreateBinary = typeof (vault as any).createBinary === 'function';
            const hasModifyBinary = typeof (vault as any).modifyBinary === 'function';
            const bin = Buffer.from(base64, 'base64');
    
            let finalFullPath = '';
            let lastErr: any = null;
            for (let attempt = 0; attempt < 4; attempt++) {
              const fileName = makeName(attempt);
              const fullPath = `${safeDir}/${fileName}`;
              const existing = plugin.app.vault.getAbstractFileByPath(fullPath);
              try {
                if (!existing) {
                  if (hasCreateBinary) {
                    await (vault as any).createBinary(fullPath, bin);
                  } else {
                    await plugin.app.vault.create(fullPath, bin.toString('binary'));
                  }
                  finalFullPath = fullPath;
                  break;
                } else {
                  // @ts-ignore TFile 原型安全检测
                  if (existing instanceof (window as any).app.vault.constructor.prototype.constructor.TFile) {
                    if (hasModifyBinary) {
                      await (vault as any).modifyBinary(existing, bin);
                    } else {
                      await plugin.app.vault.modify(existing as any, bin.toString('binary'));
                    }
                    finalFullPath = fullPath;
                    break;
                  }
                }
              } catch (err) {
                lastErr = err;
                // 尝试下一个后缀
              }
            }
    
            if (!finalFullPath) {
              // 所有尝试都失败，回退为 blob 预览
              const blobUrl = URL.createObjectURL(file);
              previewUrl = blobUrl;
              new Notice(tp('Local temp file write failed, fallback to blob: {error}', { error: (lastErr as any)?.message ?? String(lastErr) }));
            } else {
              previewUrl = finalFullPath;
              optimistic.cacheUploadPayload(uploadId, { base64, mime, fileName: file.name || undefined });
              try {
                const mark = (window as any).__obS3_tempFiles__ as Map<string, string> | undefined;
                if (!mark) (window as any).__obS3_tempFiles__ = new Map<string, string>();
                ((window as any).__obS3_tempFiles__ as Map<string, string>).set(uploadId, finalFullPath);
              } catch {}
            }
          } catch (e: any) {
            const blobUrl = URL.createObjectURL(file);
            previewUrl = blobUrl;
            new Notice(tp('Local temp file write failed, fallback to blob: {error}', { error: e?.message ?? String(e) }));
          }
        }
    
        // 将占位链接转换为 app 资源路径，避免“找不到 .assets 文件”提示
        try {
          const useAppLink = enableTempLocal
            && typeof (plugin.app as any)?.vault?.adapter?.getResourcePath === 'function'
            && previewUrl
            && !previewUrl.startsWith('blob:')
            && !previewUrl.startsWith('app://');
          if (useAppLink) {
            const abs = (plugin.app.vault as any).adapter.getResourcePath(previewUrl);
            if (abs && typeof abs === 'string') {
              previewUrl = abs;
            }
          }
        } catch {}
    
        const placeholderMd = optimistic.buildUploadingMarkdown(uploadId, previewUrl);
        editor.replaceSelection(placeholderMd);

        // 2) 内存缓存用于“重试”（非临时模式才需要；临时模式在上面已缓存）
        if (!enableTempLocal) {
          optimistic.cacheUploadPayload(uploadId, { base64, mime, fileName: file.name || undefined });
        }

        // 3) 异步上传与最终替换/清理
        // ===== STAGE-1 ABSOLUTE ISOLATION =====
        // 已根据策略暂时屏蔽“异步上传与最终替换/清理”逻辑，确保仅验证本地写入的 100% 成功率。
        // 占位已插入，内存缓存已建立；此处不再执行网络上传，避免干扰压力测试。
        try {
          // 结构化日志，便于观察是否出现重复触发
          console.info('[ob-s3-gemini][isolation] paste handled without upload', { uploadId, enableTempLocal, previewUrl });
        } catch {}
        // ======================================
      } catch (e: any) {
        new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
      }
    })
  );
}

export default { installPasteHandler };