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
  // 最简方案：存储“当下即可用”的预览地址（blob: 或 vault 相对路径），后续仅在上传成功时替换为云端链接
  previewUrl?: string;
  // 兼容旧结构：不再依赖 path 读取，可置空
  path: string;
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
        // 架构更新：统一写入 Vault 根的专属目录 /.obs3/assets
        // 插入到笔记中的链接也统一为 "/.obs3/assets/xxx.png"
        const OBS3_ROOT = '.obs3';
        const OBS3_ASSETS = `${OBS3_ROOT}/assets`;
        const tempDir = OBS3_ASSETS as string;

        // 1) 构造占位：始终先用 blob URL 作为编辑器即时预览，避免“找不到”闪烁
        const uploadId = generateUploadId();
        // 用于编辑器占位的即时预览地址（总是 blob）
        let previewUrl: string = URL.createObjectURL(file);

        if (!enableTempLocal) {
          // 非临时模式：仅使用内存 blob，后续直接依赖缓存上传
        } else {
          // 临时附件模式：后台同时把文件写入 vault 以便持久化与重试
          try {
            const ext = getExt(mime);
            const ts = Date.now();
            const rand = Math.random().toString(36).slice(2);
            const safeDir = (tempDir as string).replace(/^\/+/, '');
            // 同名后缀重试最多 3 次
            const makeName = (n: number) => n === 0 ? `${tempPrefix}${ts}_${rand}.${ext}` : `${tempPrefix}${ts}_${rand}-${n}.${ext}`;
            const vault = plugin.app.vault as any;

            // 确保目录 /.obs3 与 /.obs3/assets 存在（逐级创建）
            try {
              if (!(await plugin.app.vault.adapter.exists('.obs3'))) {
                try { await plugin.app.vault.createFolder('.obs3'); } catch {}
              }
            } catch {}
            try {
              if (!(await plugin.app.vault.adapter.exists('.obs3/assets'))) {
                try { await plugin.app.vault.createFolder('.obs3/assets'); } catch {}
              }
            } catch {}

            // 兜底：再尝试直接 mkdir safeDir
            if (vault.adapter && typeof vault.adapter.mkdir === 'function') {
              try { await vault.adapter.mkdir(safeDir); } catch {}
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
              // 所有尝试都失败；占位仍用 blob，无需更改
              new Notice(tp('Local temp file write failed, fallback to blob: {error}', { error: (lastErr as any)?.message ?? String(lastErr) }));
            } else {
              // 重要修正：Obsidian 资源解析遵循 “vault 相对路径（不以 / 开头）”
              // 将写入成功的真实 vault 相对路径记录到映射，供队列读取；编辑器占位仍保持 blob，避免闪烁
              const vaultRel = finalFullPath.replace(/^\.?\/?\.obs3\/assets\//, '.obs3/assets/');
              try { optimistic.cacheUploadPayload(uploadId, { base64, mime, fileName: file.name || undefined }); } catch {}
              try {
                const mark = (window as any).__obS3_tempFiles__ as Map<string, string> | undefined;
                if (!mark) (window as any).__obS3_tempFiles__ = new Map<string, string>();
                ((window as any).__obS3_tempFiles__ as Map<string, string>).set(uploadId, vaultRel);
              } catch {}
            }
          } catch (e: any) {
            // 失败情况下占位仍为 blob
            new Notice(tp('Local temp file write failed, fallback to blob: {error}', { error: e?.message ?? String(e) }));
          }
        }

        // 简化至“零转换”：粘贴后不对图片地址做任何处理
        // - 非临时模式：previewUrl 是 blob:，直接用于占位
        // - 临时模式：previewUrl 已是 vault 相对路径（如 ".obs3/assets/xxx.png"），保持不变，不再转 app:// 或相对化
        // 统一遵循：占位里放当下拿到的原始 previewUrl，后续仅在“上传成功时”替换为云端链接
        try { /* no-op: 保持 previewUrl 原样 */ } catch {}

        // 重要：保持 vault 相对路径/原始 blob，不再转换为 app://
        // 计算人类可读大小，放入占位，提升可见性
        const approxBytesForLabel = typeof (file as any)?.size === 'number'
          ? Number((file as any).size)
          : Math.floor((base64.length * 3) / 4);
        const humanSize = (() => {
          const kb = approxBytesForLabel / 1024;
          const mb = kb / 1024;
          if (mb >= 1) return `${mb.toFixed(2)} MB`;
          if (kb >= 1) return `${kb.toFixed(1)} KB`;
          return `${approxBytesForLabel} B`;
        })();

        // 在占位里追加“大小”信息；不改变原有结构，避免影响查找/替换
        const placeholderMd = optimistic.buildUploadingMarkdown(uploadId, previewUrl)
          .replace(/!\[(Uploading\.\.\.)/, '![$1')
          .replace(/\]\(#\)/, ` size=${humanSize}]()`);
        editor.replaceSelection(placeholderMd);
 
        // —— 入队：仅在隔离阶段追加队列，不触发上传 ——
        try {
          const approxBytes = typeof (file as any)?.size === 'number'
            ? Number((file as any).size)
            : Math.floor((base64.length * 3) / 4);
 
          // 队列仅记录“真实文件位置”，不依赖占位里用的链接形式
          // - 临时模式：直接从映射取回写入时的 finalFullPath（形如 ".obs3/assets/xxx.png"）
          // - 非临时：保持空，后续依赖缓存/重试
          const safeDir = (tempDir as string).replace(/^\/+/, '');
          // 最简方案：不依赖磁盘路径，统一置空；仅记录当下可用的 previewUrl
          let pathForQueue = '';
          try {
            const m: Map<string, string> | undefined = (window as any).__obS3_tempFiles__;
            const mapped = m?.get(uploadId);
            // 如需兼容后续清理，可在此选择使用 mapped；现在先统一置空以避免“找不到”分歧
            void mapped;
          } catch {}

          const item = {
            id: uploadId,
            filename: (file.name || '').trim() || ((previewUrl.split('/').pop() || 'image')),
            mime,
            previewUrl, // 关键：把占位实际使用的地址直接写入 data.json
            path: pathForQueue, // 置空，不依赖文件系统
            createdAt: Date.now(),
            size: approxBytes,
            base64Length: base64.length
          } as QueueItem;
          await appendToQueue(plugin, item);

          // 追加到本地“上传历史”，便于后续管理器/设置页展示（最多 200 条，成功/失败后会再更新 URL 与状态）
          try {
            const key = 'obS3Uploader.history';
            const raw = localStorage.getItem(key) ?? '[]';
            const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
            arr.unshift({
              id: uploadId,
              fileName: item.filename,
              mime: item.mime,
              size: item.size,
              time: item.createdAt,
              url: null,      // 成功后由上传流程填充
              key: null,      // 成功后由上传流程填充（对象键）
              status: 'queued'
            });
            localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
          } catch { /* non-fatal */ }
        } catch (e) {
          try { console.warn('[ob-s3-gemini][queue] append skipped', { id: uploadId, err: (e as any)?.message }); } catch {}
        }

        // 2) 内存缓存用于“重试”（非临时模式才需要；临时模式在上面已缓存）
        if (!enableTempLocal) {
          optimistic.cacheUploadPayload(uploadId, { base64, mime, fileName: file.name || undefined });
        }

        // 3) 异步上传与最终替换/清理
        // 重新启用：粘贴后主动触发一次队列处理，确保占位尽快被云端 URL 替换
        try {
          const { processNext } = require('../queue/processNext') as typeof import('../queue/processNext');
          // 由 processNext 内部的 __obS3_inflight_processNext__ 保证并发安全
          processNext(plugin).catch((e: any) => {
            try { console.warn('[ob-s3-gemini][paste] processNext failed after paste', { id: uploadId, err: e?.message }); } catch {}
          });
        } catch (e) {
          try { console.warn('[ob-s3-gemini][paste] failed to trigger processNext', { id: uploadId, err: (e as any)?.message }); } catch {}
        }

        // —— 入队后再补一条可观测日志 ——
        try { console.info('[ob-s3-gemini][queue] state snapshot stored via saveData'); } catch {}

      } catch (e: any) {
        new Notice(tp('Upload failed: {error}', { error: e?.message ?? String(e) }));
      }
    })
  );
}

export default { installPasteHandler };
