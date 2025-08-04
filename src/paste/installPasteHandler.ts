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

// 入队项结构定义（使用 plugin.loadData/saveData 进行持久化）
type QueueItem = {
  id: string;              // uploadId
  filename: string;        // 临时文件名或原始文件名
  mime: string;
  path: string;            // vault 内路径（如 .assets/xxx.png）
  createdAt: number;       // Date.now()
  size?: number;           // 字节数（若可得）
  base64Length?: number;   // base64 字符长度
};

async function appendToQueue(plugin: Plugin, item: QueueItem): Promise<void> {
  try {
    const existing = (await (plugin as any).loadData()) ?? {};
    const list: QueueItem[] = Array.isArray(existing.uploadQueue)
      ? existing.uploadQueue
      : [];
    // 幂等：避免重复 id
    if (!list.find((x) => x.id === item.id)) {
      list.push(item);
    }
    existing.uploadQueue = list;
    await (plugin as any).saveData(existing);
    try {
      // 轻量日志
      console.info('[ob-s3-gemini][queue] appended', { id: item.id, len: list.length });
    } catch {}
  } catch (e) {
    try { console.error('[ob-s3-gemini][queue] append failed', { err: (e as any)?.message }); } catch {}
    throw e;
  }
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
              previewUrl = finalFullPath; // 注意：finalFullPath 是 vault 相对路径，如 ".assets/temp_upload_*.png"
              // 无论是否启用临时模式，均缓存 base64 以便后续“手动处理”兜底可用
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
        // 注意：当启用临时附件且我们已拿到 vault 相对路径(finalFullPath)时，previewUrl 即形如 ".assets/xxx.png"
        // 这种情况下不要再转换为 app:// 资源 URL，否则队列 path 难以还原，命令侧也无法用 adapter 读取。
        try {
          const useAppLink =
            !enableTempLocal // 仅非临时模式才转换（blob 或 http 预览）
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
 
        // —— 入队：仅在隔离阶段追加队列，不触发上传 ——
        try {
          const approxBytes = typeof (file as any)?.size === 'number'
            ? Number((file as any).size)
            : Math.floor((base64.length * 3) / 4);
 
          // 保存“最原始、最准确”的 vault 相对路径：仅当启用临时附件且成功写入 finalFullPath
          // 回看上文：当 enableTempLocal=true 且写入成功时，finalFullPath 被赋值并用于预览；否则 previewUrl 可能是 blob: 或 app:// 资源URL
          const safeDir = (tempDir as string).replace(/^\/+/, '');
          const pathForQueue =
            enableTempLocal && typeof previewUrl === 'string' && !previewUrl.startsWith('blob:') && previewUrl.startsWith(safeDir + '/')
              ? previewUrl /* 这里的 previewUrl 即 finalFullPath（示例：.assets/temp_upload_xxx.png） */
              : '';
 
          const item = {
            id: uploadId,
            filename: (file.name || '').trim() || ((previewUrl.split('/').pop() || 'image')),
            mime,
            // 若启用临时模式并成功写入，pathForQueue 即 ".assets/xxx.png"
            // 若未成功，则置空，命令侧将从 optimistic 缓存读取
            path: pathForQueue,
            createdAt: Date.now(),
            size: approxBytes,
            base64Length: base64.length
          } as QueueItem;
          await appendToQueue(plugin, item);
        } catch (e) {
          try { console.warn('[ob-s3-gemini][queue] append skipped', { id: uploadId, err: (e as any)?.message }); } catch {}
        }

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

        // —— 入队后再补一条可观测日志 ——
        try { console.info('[ob-s3-gemini][queue] state snapshot stored via saveData'); } catch {}

      } catch (e: any) {
        new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
      }
    })
  );
}

export default { installPasteHandler };