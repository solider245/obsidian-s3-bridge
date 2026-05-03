// 概述: 统一封装预签名上传与计时/日志/提示，返回公开访问 URL。用于命令、粘贴与重试路径。
// 导出: performUpload(plugin: Plugin, args: { key: string; mime: string; base64: string; presignTimeoutMs?: number; uploadTimeoutMs?: number }): Promise<string>
// 依赖: [src/uploader/presignPut.ts()](src/uploader/presignPut.ts:1) presignAndPutObject
// 用法:
//   const url = await performUpload(plugin, { key, mime, base64 });
// 相关: [src/commands/registerCommands.ts()](src/commands/registerCommands.ts:1), [src/paste/installPasteHandler.ts()](src/paste/installPasteHandler.ts:1), [src/retry/installRetryHandler.ts()](src/retry/installRetryHandler.ts:1)

import type { Plugin } from 'obsidian'
import { presignAndPutObject } from '../uploader/presignPut'
import { uploadProgressManager } from '../utils/uploadProgress'
import { createMultipartUpload } from '../utils/multipartUpload'
import { UPLOAD, TIMEOUTS } from '../constants/defaults'
import { nowMs } from '../utils/nowMs'
import { getErrorMessage } from '../utils/errorHandling'

export async function performUpload(
	plugin: Plugin,
	args: {
		key: string
		mime: string
		base64: string
		presignTimeoutMs?: number
		uploadTimeoutMs?: number
		fileName?: string
		uploadId?: string
		fileSize?: number
	}
): Promise<string> {
	const { key, mime, base64, presignTimeoutMs, uploadTimeoutMs, fileName } = args

	// 计算文件大小
	const fileSize = args.fileSize ?? Math.floor((base64.length * 3) / 4)

	// 复用调用方的 uploadId，或者自生成一个
	const uploadId = args.uploadId ?? `upload_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`

	// 开始进度跟踪
	uploadProgressManager.startUpload(uploadId, {
		fileName,
		fileSize,
	})

	const t0 = nowMs()

	try {
		// 更新进度：准备阶段
		uploadProgressManager.updateProgress(uploadId, 10, 'preparing', 'Preparing upload...')

		// 判断是否需要分片上传
		const USE_MULTIPART_THRESHOLD = UPLOAD.MULTIPART_THRESHOLD

		let url: string
		if (fileSize >= USE_MULTIPART_THRESHOLD) {
			// 大文件分片上传
			uploadProgressManager.updateProgress(
				uploadId,
				15,
				'preparing',
				'Preparing multipart upload...'
			)
			url = await createMultipartUpload(plugin, {
				key,
				contentType: mime || 'application/octet-stream',
				fileData: base64,
				fileSize,
				presignTimeoutMs: Math.max(
					TIMEOUTS.PRESIGN_MIN,
					Number(presignTimeoutMs ?? (window as any).__obS3_presignTimeout__ ?? TIMEOUTS.PRESIGN_DEFAULT)
				),
				uploadTimeoutMs: Math.max(
					TIMEOUTS.UPLOAD_MIN,
					Number(uploadTimeoutMs ?? (window as any).__obS3_uploadTimeout__ ?? TIMEOUTS.UPLOAD_DEFAULT)
				),
				fileName,
				onProgress: progress => {
					uploadProgressManager.updateProgress(
						uploadId,
						progress,
						'uploading',
						`Uploading (${progress}%)...`
					)
				},
			})
		} else {
			// 小文件普通上传
			url = await presignAndPutObject(plugin, {
				key,
				contentType: mime || 'application/octet-stream',
				bodyBase64: base64,
				presignTimeoutMs: Math.max(
					TIMEOUTS.PRESIGN_MIN,
					Number(presignTimeoutMs ?? (window as any).__obS3_presignTimeout__ ?? TIMEOUTS.PRESIGN_DEFAULT)
				),
				uploadTimeoutMs: Math.max(
					TIMEOUTS.UPLOAD_MIN,
					Number(uploadTimeoutMs ?? (window as any).__obS3_uploadTimeout__ ?? TIMEOUTS.UPLOAD_DEFAULT)
				),
			})
		}

		const sec = Math.max(0, (nowMs() - t0) / 1000)
		try {
			console.info('[ob-s3-gemini] upload success', { key, durationSec: Number(sec.toFixed(3)) })
		} catch {}

		// 更新进度：处理阶段
		uploadProgressManager.updateProgress(uploadId, 90, 'processing', 'Processing upload...')

		// 完成上传（url 已由 presignAndPutObject / createMultipartUpload 内部通过 buildPublicUrl 生成）
		uploadProgressManager.completeUpload(uploadId, url)

		return url
	} catch (e) {
		const sec = Math.max(0, (nowMs() - t0) / 1000)
		const errorMsg = getErrorMessage(e)
		try {
			console.error('[ob-s3-gemini] upload failed', {
				key,
				durationSec: Number(sec.toFixed(3)),
				error: errorMsg,
			})
		} catch {}

		// 标记上传失败
		uploadProgressManager.failUpload(uploadId, errorMsg)

		throw e
	}
}
