import { Plugin } from 'obsidian'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { loadS3Config, buildPublicUrl, buildS3Client } from '../../s3/s3Manager'
import { UPLOAD, TIMEOUTS } from '../constants/defaults'

import * as https from 'https'
import { URL } from 'url'

/**
 * 生成预签名 PUT URL（带超时）
 * @param plugin Obsidian 插件实例
 * @param key 目标对象键
 * @param contentType Content-Type
 * @param expiresInSeconds 预签名有效期，默认 300 秒
 * @param timeoutMs 超时毫秒，默认从 window.__obS3_presignTimeout__ 读取，空则 10s
 */
export async function getPresignedPutUrl(
	plugin: Plugin,
	key: string,
	contentType: string,
	expiresInSeconds = UPLOAD.DEFAULT_EXPIRY_SECONDS,
	timeoutMs?: number
): Promise<string> {
	const { client, bucket } = buildS3Client(plugin)
	const cacheControl = loadS3Config(plugin).cacheControl

	const cmd = new PutObjectCommand({
		Bucket: bucket,
		Key: key,
		ContentType: contentType || 'application/octet-stream',
		CacheControl: cacheControl,
	})

	const to =
		typeof timeoutMs === 'number' && timeoutMs > 0
			? Math.floor(timeoutMs)
			: Math.max(TIMEOUTS.PRESIGN_MIN, Number(window.__obS3_presignTimeout__ ?? TIMEOUTS.PRESIGN_DEFAULT))

	// 超时包装
	const url = await Promise.race([
		getSignedUrl(client, cmd, { expiresIn: expiresInSeconds }),
		new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Presign timeout')), to)),
	])
	return url as string
}

/**
 * 通过 node:https 执行 PUT 到预签名 URL（带总超时）
 * @param presignedUrl 由 getPresignedPutUrl 生成的 URL
 * @param body 要上传的二进制数据
 * @param contentType Content-Type
 * @param timeoutMs 超时毫秒，默认从 window.__obS3_uploadTimeout__ 读取，空则 25000
 */
export async function putWithHttps(
	presignedUrl: string,
	body: Uint8Array,
	contentType: string,
	timeoutMs?: number,
	cacheControl?: string
): Promise<void> {
	const url = new URL(presignedUrl)

	const headers: Record<string, string> = {
		'Content-Type': contentType || 'application/octet-stream',
		'Content-Length': String(body.byteLength),
	}
	if (cacheControl) {
		headers['Cache-Control'] = cacheControl
	}

	const options: https.RequestOptions = {
		method: 'PUT',
		protocol: url.protocol,
		hostname: url.hostname,
		port: url.port || (url.protocol === 'https:' ? 443 : 80),
		path: url.pathname + url.search,
		headers,
	}

	const to =
		typeof timeoutMs === 'number' && timeoutMs > 0
			? Math.floor(timeoutMs)
			: Math.max(TIMEOUTS.UPLOAD_MIN, Number(window.__obS3_uploadTimeout__ ?? TIMEOUTS.UPLOAD_DEFAULT))

	await new Promise<void>((resolve, reject) => {
		let finished = false
		const failOnce = (err: Error) => {
			if (finished) return
			finished = true
			try {
				timer && clearTimeout(timer)
			} catch {}
			reject(err)
		}
		const okOnce = () => {
			if (finished) return
			finished = true
			try {
				timer && clearTimeout(timer)
			} catch {}
			resolve()
		}

		const req = https.request(options, (res: import('http').IncomingMessage) => {
			const chunks: Buffer[] = []
			res.on('data', (c: Buffer | string) =>
				chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
			)
			res.on('end', () => {
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					okOnce()
				} else {
					const msg = Buffer.concat(chunks).toString('utf-8')
					failOnce(
						new Error(
							`Presigned PUT failed: ${res.statusCode} ${res.statusMessage}${msg ? ' - ' + msg : ''}`
						)
					)
				}
			})
		})
		req.on('error', failOnce)

		// Node 原生超时：防止底层 socket 长时间无响应
		try {
			req.setTimeout(Math.max(1000, to), () => failOnce(new Error('Upload timeout')))
		} catch {}

		// 额外保险：Promise.race 风格的计时器
		const timer = setTimeout(() => {
			try {
				req.destroy(new Error('Upload timeout'))
			} catch {}
			failOnce(new Error('Upload timeout'))
		}, to)

		try {
			req.write(body)
			req.end()
		} catch (e) {
			failOnce(e)
		}
	})
}

/**
 * 主进程组合动作：生成预签名 URL，然后执行 PUT（端到端超时）
 * 调用方传入 base64 字符串以避免渲染端直接接触二进制
 * 返回值：公开访问链接（基于 Profile.baseUrl 等规则）
 */
export async function presignAndPutObject(
	plugin: Plugin,
	opts: {
		key: string
		contentType: string
		bodyBase64: string
		expiresInSeconds?: number
		presignTimeoutMs?: number
		uploadTimeoutMs?: number
	}
): Promise<string> {
	const {
		key,
		contentType,
		bodyBase64,
		expiresInSeconds = 300,
		presignTimeoutMs,
		uploadTimeoutMs,
	} = opts

	const cacheControl = loadS3Config(plugin).cacheControl
	const url = await getPresignedPutUrl(plugin, key, contentType, expiresInSeconds, presignTimeoutMs)
	const body = Buffer.from(bodyBase64, 'base64')
	await putWithHttps(url, body, contentType, uploadTimeoutMs, cacheControl)

	// 生成最终公开链接
	const publicUrl = buildPublicUrl(plugin, key)
	return publicUrl
}

