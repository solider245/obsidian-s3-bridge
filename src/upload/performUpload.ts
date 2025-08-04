// 概述: 统一封装预签名上传与计时/日志/提示，返回公开访问 URL。用于命令、粘贴与重试路径。
// 导出: performUpload(plugin: Plugin, args: { key: string; mime: string; base64: string; presignTimeoutMs?: number; uploadTimeoutMs?: number }): Promise<string>
// 依赖: [src/uploader/presignPut.ts()](src/uploader/presignPut.ts:1) presignAndPutObject
// 用法:
//   const url = await performUpload(plugin, { key, mime, base64 });
// 相关: [src/commands/registerCommands.ts()](src/commands/registerCommands.ts:1), [src/paste/installPasteHandler.ts()](src/paste/installPasteHandler.ts:1), [src/retry/installRetryHandler.ts()](src/retry/installRetryHandler.ts:1)

import type { Plugin } from 'obsidian';
import { presignAndPutObject } from '../uploader/presignPut';

export async function performUpload(
  plugin: Plugin,
  args: { key: string; mime: string; base64: string; presignTimeoutMs?: number; uploadTimeoutMs?: number }
): Promise<string> {
  const { key, mime, base64, presignTimeoutMs, uploadTimeoutMs } = args;

  const t0 = (typeof performance !== 'undefined' && (performance as any).now)
    ? (performance as any).now()
    : Date.now();

  const url = await presignAndPutObject(plugin, {
    key,
    contentType: mime || 'application/octet-stream',
    bodyBase64: base64,
    presignTimeoutMs: Math.max(1000, Number(presignTimeoutMs ?? (window as any).__obS3_presignTimeout__ ?? 10000)),
    uploadTimeoutMs: Math.max(1000, Number(uploadTimeoutMs ?? (window as any).__obS3_uploadTimeout__ ?? 25000)),
  }).then((u) => {
    const t1 = (typeof performance !== 'undefined' && (performance as any).now)
      ? (performance as any).now()
      : Date.now();
    const sec = Math.max(0, (t1 - t0) / 1000);
    try { console.info('[ob-s3-gemini] upload success', { key, durationSec: Number(sec.toFixed(3)) }); } catch {}
    return u;
  }).catch((e) => {
    const t1 = (typeof performance !== 'undefined' && (performance as any).now)
      ? (performance as any).now()
      : Date.now();
    const sec = Math.max(0, (t1 - t0) / 1000);
    try { console.error('[ob-s3-gemini] upload failed', { key, durationSec: Number(sec.toFixed(3)), error: (e as any)?.message }); } catch {}
    throw e;
  });

  return url;
}

export default { performUpload };