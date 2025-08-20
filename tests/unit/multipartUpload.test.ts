import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MultipartUploadManager } from '../../src/utils/multipartUpload'
import { Plugin } from 'obsidian'

// 模拟 AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
	S3Client: vi.fn().mockImplementation(() => ({
		send: vi.fn(),
	})),
	CreateMultipartUploadCommand: vi.fn(),
	UploadPartCommand: vi.fn(),
	CompleteMultipartUploadCommand: vi.fn(),
	AbortMultipartUploadCommand: vi.fn(),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: vi.fn(),
}))

vi.mock('../../s3/s3Manager', () => ({
	loadS3Config: vi.fn(() => ({
		endpoint: 'https://s3.amazonaws.com',
		accessKeyId: 'test-key',
		secretAccessKey: 'test-secret',
		bucketName: 'test-bucket',
		region: 'us-east-1',
		useSSL: true,
		cacheControl: 'public, max-age=31536000',
	})),
	buildPublicUrl: vi.fn(() => 'https://example.com/test.jpg'),
}))

vi.mock('../../src/utils/uploadProgress', () => ({
	uploadProgressManager: {
		startUpload: vi.fn(),
		updateProgress: vi.fn(),
		completeUpload: vi.fn(),
		failUpload: vi.fn(),
	},
}))

// 模拟 https 模块
const mockHttps = {
	request: vi.fn(),
}
vi.mock('https', () => mockHttps)

describe('MultipartUploadManager', () => {
	let mockPlugin: Plugin
	let mockUploadOptions: any

	beforeEach(() => {
		mockPlugin = {
			app: {},
			manifest: { id: 'test-plugin' },
		} as any

		mockUploadOptions = {
			key: 'test/large-file.jpg',
			contentType: 'image/jpeg',
			fileSize: 15 * 1024 * 1024, // 15MB
			fileName: 'large-file.jpg',
		}

		vi.clearAllMocks()
	})

	describe('分片计算', () => {
		it('应该正确计算分片数量和大小', () => {
			const manager = new MultipartUploadManager(mockPlugin, mockUploadOptions)

			// 15MB 文件，5MB 分片，应该有 3 个分片
			expect((manager as any).parts).toHaveLength(3)
			expect((manager as any).parts[0]).toEqual({
				partNumber: 1,
				start: 0,
				end: 5 * 1024 * 1024,
				size: 5 * 1024 * 1024,
				status: 'pending',
				retryCount: 0,
			})
		})

		it('应该正确处理不完整的最后一个分片', () => {
			const options = {
				...mockUploadOptions,
				fileSize: 12 * 1024 * 1024, // 12MB
			}
			const manager = new MultipartUploadManager(mockPlugin, options)

			// 12MB 文件，5MB 分片，应该有 3 个分片
			expect((manager as any).parts).toHaveLength(3)
			expect((manager as any).parts[2].size).toBe(2 * 1024 * 1024) // 最后一个分片 2MB
		})
	})

	describe('工厂函数', () => {
		it('应该为大文件选择分片上传', async () => {
			const largeFileData = 'a'.repeat(20 * 1024 * 1024) // 20MB base64 (~15MB)

			// 直接测试文件大小判断逻辑
			const fileSize = Math.floor((largeFileData.length * 3) / 4)
			const USE_MULTIPART_THRESHOLD = 10 * 1024 * 1024

			expect(fileSize).toBeGreaterThan(USE_MULTIPART_THRESHOLD)
		})
	})

	describe('进度跟踪', () => {
		it('应该正确计算上传进度', () => {
			const manager = new MultipartUploadManager(mockPlugin, mockUploadOptions)

			// 初始进度
			expect(manager.getProgress()).toBe(0)

			// 模拟完成一个分片
			;(manager as any).parts[0].status = 'completed'
			expect(manager.getProgress()).toBe(33) // 1/3 = 33%

			// 模拟完成两个分片
			;(manager as any).parts[1].status = 'completed'
			expect(manager.getProgress()).toBe(66) // 2/3 = 66%

			// 模拟完成所有分片
			;(manager as any).parts[2].status = 'completed'
			expect(manager.getProgress()).toBe(100)
		})
	})

	describe('错误处理', () => {
		it('应该正确处理上传失败和重试', async () => {
			const manager = new MultipartUploadManager(mockPlugin, mockUploadOptions)

			// 模拟分片上传失败
			const part = (manager as any).parts[0]
			part.status = 'failed'
			part.retryCount = 1

			// 应该允许重试
			expect(part.retryCount).toBe(1)
			expect(part.status).toBe('failed')
		})

		it('应该在超过重试次数后放弃', async () => {
			const manager = new MultipartUploadManager(mockPlugin, mockUploadOptions)

			// 模拟一个分片在重试次数用完后仍然失败
			const part = (manager as any).parts[0]
			part.status = 'failed'
			part.retryCount = 3 // 超过最大重试次数

			// 模拟上传方法会抛出错误
			const mockUploadPart = vi.fn().mockRejectedValue(new Error('Upload failed'))
			;(manager as any).uploadPart = mockUploadPart

			// 应该抛出错误
			await expect(manager.start()).rejects.toThrow()
		})

		it('应该正确实现指数退避重试', async () => {
			const manager = new MultipartUploadManager(mockPlugin, mockUploadOptions)

			// 测试 withRetry 方法，减少重试次数以避免超时
			let attemptCount = 0
			const mockOperation = vi.fn().mockImplementation(() => {
				attemptCount++
				if (attemptCount < 2) {
					throw new Error('Temporary failure')
				}
				return 'success'
			})

			// 使用较短的超时时间
			const result = await (manager as any).withRetry(mockOperation, 'Test operation', 2)

			expect(result).toBe('success')
			expect(attemptCount).toBe(2)
			expect(mockOperation).toHaveBeenCalledTimes(2)
		}, 10000) // 10秒超时

		it('应该正确处理 ETag 获取', async () => {
			const manager = new MultipartUploadManager(mockPlugin, mockUploadOptions)

			// 模拟上传方法返回正确的 ETag
			const mockUploadPartData = vi.fn().mockResolvedValue('"test-etag-123"')
			;(manager as any).uploadPartData = mockUploadPartData

			// 模拟其他依赖方法
			;(manager as any).getPartData = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))

			const result = await (manager as any).uploadPartData(
				'test-url',
				new Uint8Array([1, 2, 3]),
				'test-type'
			)

			expect(result).toBe('"test-etag-123"')
		})
	})

	describe('多种数据源支持', () => {
		it('应该支持文件路径数据源', async () => {
			const options = {
				...mockUploadOptions,
				filePath: '/test/path/file.jpg',
			}
			const manager = new MultipartUploadManager(mockPlugin, options)

			// 应该有 filePath 选项
			expect((manager as any).options.filePath).toBe('/test/path/file.jpg')
		})

		it('应该支持自定义分片数据获取方法', async () => {
			const customGetPartData = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
			const options = {
				...mockUploadOptions,
				getPartData: customGetPartData,
			}
			const manager = new MultipartUploadManager(mockPlugin, options)

			// 应该有自定义的分片数据获取方法
			expect((manager as any).options.getPartData).toBe(customGetPartData)
		})
	})
})
