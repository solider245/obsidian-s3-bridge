// 概述: 大文件分片上传管理器，支持断点续传和并行上传
// 导出: MultipartUploadManager
// 依赖: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

import { Plugin, Notice } from 'obsidian'
import {
	S3Client,
	CreateMultipartUploadCommand,
	UploadPartCommand,
	CompleteMultipartUploadCommand,
	AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { loadS3Config, buildPublicUrl } from '../../s3/s3Manager'
import { uploadProgressManager } from './uploadProgress'

export interface MultipartUploadOptions {
	key: string
	contentType: string
	fileSize: number
	chunkSize?: number // 默认 5MB
	maxConcurrent?: number // 默认 3
	presignTimeoutMs?: number
	uploadTimeoutMs?: number
	fileName?: string
	onProgress?: (progress: number) => void
	// 支持多种数据源
	fileData?: string | ArrayBuffer
	filePath?: string
	getPartData?: (part: UploadPart) => Promise<Uint8Array>
}

export interface UploadPart {
	partNumber: number
	start: number
	end: number
	size: number
	etag?: string
	status: 'pending' | 'uploading' | 'completed' | 'failed'
	retryCount: number
}

export class MultipartUploadManager {
	private plugin: Plugin
	private options: MultipartUploadOptions
	private uploadId?: string
	private parts: UploadPart[] = []
	private client: S3Client
	private bucket: string
	private completedParts: Array<{ PartNumber: number; ETag: string }> = []
	private aborted = false
	private activeUploads = 0
	private maxConcurrent: number

	constructor(plugin: Plugin, options: MultipartUploadOptions) {
		this.plugin = plugin
		this.options = {
			chunkSize: 5 * 1024 * 1024, // 5MB
			maxConcurrent: 3,
			...options,
		}
		this.maxConcurrent = this.options.maxConcurrent!

		// 构建 S3 客户端
		const cfg = loadS3Config(plugin)
		if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
			throw new Error('S3 settings incomplete')
		}

		this.client = new S3Client({
			endpoint: cfg.endpoint,
			region: cfg.region || 'us-east-1',
			forcePathStyle: true,
			credentials: {
				accessKeyId: cfg.accessKeyId,
				secretAccessKey: cfg.secretAccessKey,
			},
			tls: cfg.useSSL,
		})
		this.bucket = cfg.bucketName

		// 计算分片
		this.calculateParts()
	}

	private calculateParts(): void {
		const { fileSize, chunkSize } = this.options
		const partCount = Math.ceil(fileSize / chunkSize!)

		this.parts = []
		for (let i = 0; i < partCount; i++) {
			const start = i * chunkSize!
			const end = Math.min(start + chunkSize!, fileSize)
			const size = end - start

			this.parts.push({
				partNumber: i + 1,
				start,
				end,
				size,
				status: 'pending',
				retryCount: 0,
			})
		}
	}

	async start(): Promise<string> {
		const uploadId = `multipart_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`

		// 开始进度跟踪
		uploadProgressManager.startUpload(uploadId, {
			fileName: this.options.fileName,
			fileSize: this.options.fileSize,
		})

		try {
			// 创建分片上传
			const createCommand = new CreateMultipartUploadCommand({
				Bucket: this.bucket,
				Key: this.options.key,
				ContentType: this.options.contentType,
				CacheControl: loadS3Config(this.plugin).cacheControl,
			})

			const createResponse = await this.client.send(createCommand)
			this.uploadId = createResponse.UploadId

			if (!this.uploadId) {
				throw new Error('Failed to create multipart upload')
			}

			uploadProgressManager.updateProgress(uploadId, 5, 'preparing', 'Starting multipart upload...')

			// 开始并行上传分片
			await this.uploadParts(uploadId)

			// 完成分片上传
			uploadProgressManager.updateProgress(uploadId, 95, 'processing', 'Completing upload...')
			const publicUrl = await this.completeUpload(uploadId)

			uploadProgressManager.completeUpload(uploadId, publicUrl)
			return publicUrl
		} catch (error) {
			uploadProgressManager.failUpload(uploadId, (error as Error).message)
			await this.abortUpload()
			throw error
		}
	}

	private async uploadParts(uploadId: string): Promise<void> {
		const uploadPromises: Promise<void>[] = []

		for (const part of this.parts) {
			if (this.aborted) break

			// 等待有可用的并发槽位
			while (this.activeUploads >= this.maxConcurrent && !this.aborted) {
				await new Promise(resolve => setTimeout(resolve, 100))
			}

			if (this.aborted) break

			this.activeUploads++
			const promise = this.uploadPart(uploadId, part).finally(() => {
				this.activeUploads--
			})

			uploadPromises.push(promise)
		}

		await Promise.all(uploadPromises)
	}

	private async uploadPart(uploadId: string, part: UploadPart): Promise<void> {
		if (this.aborted) return

		part.status = 'uploading'

		try {
			// 生成预签名 URL（带重试）
			const presignedUrl = await this.withRetry(async () => {
				const uploadPartCommand = new UploadPartCommand({
					Bucket: this.bucket,
					Key: this.options.key,
					PartNumber: part.partNumber,
					UploadId: this.uploadId,
				})
				return getSignedUrl(this.client, uploadPartCommand, {
					expiresIn: 3600, // 1小时
				})
			}, `Failed to generate presigned URL for part ${part.partNumber}`)

			// 获取分片数据
			const partData = await this.withRetry(
				async () => this.getPartData(part),
				`Failed to read part data for part ${part.partNumber}`
			)

			// 上传分片并获取 ETag
			const etag = await this.withRetry(
				async () => this.uploadPartData(presignedUrl, partData, this.options.contentType),
				`Failed to upload part ${part.partNumber}`
			)

			part.etag = etag
			part.status = 'completed'

			this.completedParts.push({
				PartNumber: part.partNumber,
				ETag: part.etag,
			})

			// 更新进度
			this.updateUploadProgress(uploadId)
		} catch (error) {
			part.status = 'failed'
			part.retryCount++

			if (part.retryCount < 3 && !this.aborted) {
				// 指数退避重试
				const delay = Math.min(30000, 1000 * Math.pow(2, part.retryCount)) // 最大30秒
				await new Promise(resolve => setTimeout(resolve, delay))
				await this.uploadPart(uploadId, part)
			} else {
				throw new Error(
					`Failed to upload part ${part.partNumber} after ${part.retryCount} attempts: ${(error as Error).message}`
				)
			}
		}
	}

	// 带重试的通用方法
	private async withRetry<T>(
		operation: () => Promise<T>,
		errorMessage: string,
		maxRetries = 3
	): Promise<T> {
		let lastError: Error | undefined

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				return await operation()
			} catch (error) {
				lastError = error as Error

				if (attempt === maxRetries) {
					break
				}

				// 指数退避
				const delay = Math.min(30000, 1000 * Math.pow(2, attempt))
				await new Promise(resolve => setTimeout(resolve, delay))
			}
		}

		throw new Error(`${errorMessage}: ${lastError?.message || 'Unknown error'}`)
	}

	// 更新上传进度
	private updateUploadProgress(uploadId: string): void {
		const uploadedSize = this.completedParts.reduce((sum, p) => {
			const partInfo = this.parts.find(part => part.partNumber === p.PartNumber)
			return sum + (partInfo?.size || 0)
		}, 0)
		const progress = Math.floor((uploadedSize / this.options.fileSize) * 80) + 10 // 10-90%

		uploadProgressManager.updateProgress(
			uploadId,
			progress,
			'uploading',
			`Uploading ${this.completedParts.length}/${this.parts.length} parts...`
		)

		this.options.onProgress?.(progress)
	}

	private async getPartData(part: UploadPart): Promise<Uint8Array> {
		// 优先使用自定义的分片数据获取方法
		if (this.options.getPartData) {
			return this.options.getPartData(part)
		}

		// 从文件路径读取（最优的内存使用方式）
		if (this.options.filePath) {
			const fs = await import('fs')
			const { promisify } = await import('util')
			const open = promisify(fs.open)
			const read = promisify(fs.read)
			const close = promisify(fs.close)

			const fd = await open(this.options.filePath, 'r')
			try {
				const buffer = Buffer.alloc(part.size)
				const { bytesRead } = await read(fd, buffer, 0, part.size, part.start)
				if (bytesRead !== part.size) {
					throw new Error(
						`Failed to read complete part data: expected ${part.size}, got ${bytesRead}`
					)
				}
				return buffer
			} finally {
				await close(fd)
			}
		}

		// 从内存数据中提取（用于向后兼容）
		if (this.options.fileData) {
			if (typeof this.options.fileData === 'string') {
				const fullData = Buffer.from(this.options.fileData, 'base64')
				return fullData.subarray(part.start, part.end)
			} else {
				return new Uint8Array(this.options.fileData.slice(part.start, part.end))
			}
		}

		throw new Error('No valid data source provided for multipart upload')
	}

	private async uploadPartData(
		url: string,
		data: Uint8Array,
		contentType: string
	): Promise<string> {
		// 使用 https 模块上传分片数据，并返回 ETag
		const https = await import('https')
		const { URL } = await import('url')

		const urlObj = new URL(url)

		return new Promise((resolve, reject) => {
			const req = https.request(
				urlObj,
				{
					method: 'PUT',
					headers: {
						'Content-Type': contentType,
						'Content-Length': String(data.length),
					},
				},
				res => {
					const chunks: Buffer[] = []
					res.on('data', (chunk: Buffer | string) => {
						chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
					})

					res.on('end', () => {
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							// 从响应头中获取 ETag
							const etag = res.headers['etag'] || res.headers['ETag']
							if (etag) {
								resolve(etag as string)
							} else {
								// 如果没有 ETag，使用简化的版本
								resolve(`"${data.length}-${Date.now()}"`)
							}
						} else {
							const errorMessage = Buffer.concat(chunks).toString('utf-8')
							reject(
								new Error(
									`Upload failed: ${res.statusCode} ${res.statusMessage}${errorMessage ? ' - ' + errorMessage : ''}`
								)
							)
						}
					})
				}
			)

			req.on('error', reject)
			req.write(data)
			req.end()
		})
	}

	private async completeUpload(uploadId: string): Promise<string> {
		if (!this.uploadId) {
			throw new Error('No upload ID')
		}

		// 按分片编号排序
		this.completedParts.sort((a, b) => a.PartNumber - b.PartNumber)

		const completeCommand = new CompleteMultipartUploadCommand({
			Bucket: this.bucket,
			Key: this.options.key,
			UploadId: this.uploadId,
			MultipartUpload: {
				Parts: this.completedParts,
			},
		})

		await this.client.send(completeCommand)
		return buildPublicUrl(this.plugin, this.options.key)
	}

	async abortUpload(): Promise<void> {
		if (!this.uploadId || this.aborted) return

		this.aborted = true
		try {
			const abortCommand = new AbortMultipartUploadCommand({
				Bucket: this.bucket,
				Key: this.options.key,
				UploadId: this.uploadId,
			})
			await this.client.send(abortCommand)
		} catch (error) {
			console.warn('Failed to abort multipart upload:', error)
		}
	}

	getProgress(): number {
		if (this.parts.length === 0) return 0
		const completed = this.parts.filter(p => p.status === 'completed').length
		return Math.floor((completed / this.parts.length) * 100)
	}
}

// 工厂函数，用于创建分片上传
export async function createMultipartUpload(
	plugin: Plugin,
	options: MultipartUploadOptions & { fileData?: string | ArrayBuffer; filePath?: string }
): Promise<string> {
	// 计算文件大小
	let fileSize: number

	if (options.fileSize) {
		fileSize = options.fileSize
	} else if (options.fileData) {
		fileSize =
			typeof options.fileData === 'string'
				? Math.floor((options.fileData.length * 3) / 4)
				: options.fileData.byteLength
	} else if (options.filePath) {
		const fs = await import('fs')
		const { promisify } = await import('util')
		const stat = promisify(fs.stat)
		const stats = await stat(options.filePath)
		fileSize = stats.size
	} else {
		throw new Error('Either fileSize, fileData, or filePath must be provided')
	}

	// 判断是否需要分片上传（超过 10MB）
	const USE_MULTIPART_THRESHOLD = 10 * 1024 * 1024 // 10MB

	if (fileSize < USE_MULTIPART_THRESHOLD) {
		// 小文件使用普通上传
		const { presignAndPutObject } = await import('../uploader/presignPut')
		let bodyBase64: string

		if (options.fileData) {
			bodyBase64 =
				typeof options.fileData === 'string'
					? options.fileData
					: Buffer.from(options.fileData).toString('base64')
		} else if (options.filePath) {
			const fs = await import('fs')
			const { promisify } = await import('util')
			const readFile = promisify(fs.readFile)
			const data = await readFile(options.filePath)
			bodyBase64 = data.toString('base64')
		} else {
			throw new Error('No data source provided for small file upload')
		}

		return presignAndPutObject(plugin, {
			key: options.key,
			contentType: options.contentType,
			bodyBase64,
			presignTimeoutMs: options.presignTimeoutMs,
			uploadTimeoutMs: options.uploadTimeoutMs,
		})
	}

	// 大文件使用分片上传
	const manager = new MultipartUploadManager(plugin, {
		...options,
		fileSize,
	})

	return manager.start()
}
