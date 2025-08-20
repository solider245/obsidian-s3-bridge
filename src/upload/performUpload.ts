// 概述: 统一封装预签名上传与计时/日志/提示，返回公开访问 URL。用于命令、粘贴与重试路径。
// 导出: performUpload(plugin: Plugin, args: { key: string; mime: string; base64: string; presignTimeoutMs?: number; uploadTimeoutMs?: number }): Promise<string>
// 依赖: [src/uploader/presignPut.ts()](src/uploader/presignPut.ts:1) presignAndPutObject
// 用法:
//   const url = await performUpload(plugin, { key, mime, base64 });
// 相关: [src/commands/registerCommands.ts()](src/commands/registerCommands.ts:1), [src/paste/installPasteHandler.ts()](src/paste/installPasteHandler.ts:1), [src/retry/installRetryHandler.ts()](src/retry/installRetryHandler.ts:1)

import type { Plugin } from 'obsidian';
import { presignAndPutObject } from '../uploader/presignPut';
import { uploadProgressManager } from '../utils/uploadProgress';
import { buildPublicUrl } from '../../s3/s3Manager';

export async function performUpload(
  plugin: Plugin,
  args: { key: string; mime: string; base64: string; presignTimeoutMs?: number; uploadTimeoutMs?: number; fileName?: string }
): Promise<string> {
  const { key, mime, base64, presignTimeoutMs, uploadTimeoutMs, fileName } = args;

  // 计算文件大小
  const fileSize = Math.floor(base64.length * 3 / 4);
  
  // 生成唯一的上传ID
  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  
  // 开始进度跟踪
  uploadProgressManager.startUpload(uploadId, {
    fileName,
    fileSize,
  });

  const t0 = (typeof performance !== 'undefined' && (performance as any).now)
    ? (performance as any).now()
    : Date.now();

  try {
    // 更新进度：准备阶段
    uploadProgressManager.updateProgress(uploadId, 10, 'preparing', 'Preparing upload...');
    
    const url = await presignAndPutObject(plugin, {
      key,
      contentType: mime || 'application/octet-stream',
      bodyBase64: base64,
      presignTimeoutMs: Math.max(1000, Number(presignTimeoutMs ?? (window as any).__obS3_presignTimeout__ ?? 10000)),
      uploadTimeoutMs: Math.max(1000, Number(uploadTimeoutMs ?? (window as any).__obS3_uploadTimeout__ ?? 25000)),
    });

    const t1 = (typeof performance !== 'undefined' && (performance as any).now)
      ? (performance as any).now()
      : Date.now();
    const sec = Math.max(0, (t1 - t0) / 1000);
    try { console.info('[ob-s3-gemini] upload success', { key, durationSec: Number(sec.toFixed(3)) }); } catch {}
    
    // 更新进度：处理阶段
    uploadProgressManager.updateProgress(uploadId, 90, 'processing', 'Processing upload...');
    
    // 构建公开URL
    const publicUrl = buildPublicUrl(plugin, key);
    
    // 完成上传
    uploadProgressManager.completeUpload(uploadId, publicUrl);
    
    return publicUrl;
  } catch (e) {
    const t1 = (typeof performance !== 'undefined' && (performance as any).now)
      ? (performance as any).now()
      : Date.now();
    const sec = Math.max(0, (t1 - t0) / 1000);
    const errorMsg = (e as any)?.message ?? String(e);
    try { console.error('[ob-s3-gemini] upload failed', { key, durationSec: Number(sec.toFixed(3)), error: errorMsg }); } catch {}
    
    // 标记上传失败
    uploadProgressManager.failUpload(uploadId, errorMsg);
    
    throw e;
  }
}

export default { performUpload };