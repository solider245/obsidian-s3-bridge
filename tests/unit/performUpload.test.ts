import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { performUpload } from '../../src/upload/performUpload'
import { uploadProgressManager } from '../../src/utils/uploadProgress'
import { Plugin } from 'obsidian'

// 模拟依赖
vi.mock('../../src/uploader/presignPut', () => ({
	presignAndPutObject: vi.fn(),
}))

vi.mock('../../src/utils/uploadProgress', () => ({
	uploadProgressManager: {
		startUpload: vi.fn(),
		updateProgress: vi.fn(),
		completeUpload: vi.fn(),
		failUpload: vi.fn(),
		getProgress: vi.fn(),
		clearAll: vi.fn(),
	},
}))

vi.mock('../../s3/s3Manager', () => ({
	buildPublicUrl: vi.fn(),
}))

// 模拟全局 window 对象
global.window = {} as any

// 动态导入以避免顶层await问题
let presignAndPutObject: any
let buildPublicUrl: any

beforeAll(async () => {
	const presignModule = await import('../../src/uploader/presignPut')
	const s3Module = await import('../../s3/s3Manager')
	presignAndPutObject = presignModule.presignAndPutObject
	buildPublicUrl = s3Module.buildPublicUrl
})

describe('performUpload', () => {
	let mockPlugin: Plugin
	const mockUploadArgs = {
		key: 'test/test.jpg',
		mime: 'image/jpeg',
		base64: 'dGVzdCBpbWFnZSBkYXRh', // base64 编码的测试数据
		fileName: 'test.jpg',
	}

	beforeEach(() => {
		mockPlugin = {
			app: {
				vault: {
					adapter: {
						read: vi.fn(),
						write: vi.fn(),
					},
				},
			},
			manifest: {
				id: 'test-plugin',
			},
		} as any

		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('应该成功执行上传并返回公开URL', async () => {
		const mockPresignedUrl = 'https://example.com/presigned-url'
		const mockPublicUrl = 'https://example.com/public/test.jpg'

		;(presignAndPutObject as any).mockResolvedValue(mockPresignedUrl)
		;(buildPublicUrl as any).mockReturnValue(mockPublicUrl)

		const result = await performUpload(mockPlugin, mockUploadArgs)

		expect(result).toBe(mockPublicUrl)
		expect(presignAndPutObject).toHaveBeenCalledWith(
			mockPlugin,
			expect.objectContaining({
				key: mockUploadArgs.key,
				contentType: mockUploadArgs.mime,
				bodyBase64: mockUploadArgs.base64,
			})
		)
		expect(buildPublicUrl).toHaveBeenCalledWith(mockPlugin, mockUploadArgs.key)
	})

	it('应该正确处理上传进度', async () => {
		const mockPresignedUrl = 'https://example.com/presigned-url'
		const mockPublicUrl = 'https://example.com/public/test.jpg'

		;(presignAndPutObject as any).mockResolvedValue(mockPresignedUrl)
		;(buildPublicUrl as any).mockReturnValue(mockPublicUrl)

		await performUpload(mockPlugin, mockUploadArgs)

		// 验证进度跟踪调用
		expect(uploadProgressManager.startUpload).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				fileName: mockUploadArgs.fileName,
				fileSize: expect.any(Number),
			})
		)

		expect(uploadProgressManager.updateProgress).toHaveBeenCalledWith(
			expect.any(String),
			10,
			'preparing',
			'Preparing upload...'
		)

		expect(uploadProgressManager.updateProgress).toHaveBeenCalledWith(
			expect.any(String),
			90,
			'processing',
			'Processing upload...'
		)

		expect(uploadProgressManager.completeUpload).toHaveBeenCalledWith(
			expect.any(String),
			mockPublicUrl
		)
	})

	it('应该正确处理上传错误', async () => {
		const mockError = new Error('Network error')
		;(presignAndPutObject as any).mockRejectedValue(mockError)

		await expect(performUpload(mockPlugin, mockUploadArgs)).rejects.toThrow('Network error')

		// 验证错误处理
		expect(uploadProgressManager.failUpload).toHaveBeenCalledWith(
			expect.any(String),
			'Network error'
		)
	})

	it('应该使用默认的MIME类型', async () => {
		const mockPresignedUrl = 'https://example.com/presigned-url'
		const mockPublicUrl = 'https://example.com/public/test.jpg'

		;(presignAndPutObject as any).mockResolvedValue(mockPresignedUrl)
		;(buildPublicUrl as any).mockReturnValue(mockPublicUrl)

		const argsWithoutMime = { ...mockUploadArgs, mime: '' }
		await performUpload(mockPlugin, argsWithoutMime)

		expect(presignAndPutObject).toHaveBeenCalledWith(
			mockPlugin,
			expect.objectContaining({
				contentType: 'application/octet-stream',
			})
		)
	})

	it('应该正确处理自定义超时时间', async () => {
		const mockPresignedUrl = 'https://example.com/presigned-url'
		const mockPublicUrl = 'https://example.com/public/test.jpg'

		;(presignAndPutObject as any).mockResolvedValue(mockPresignedUrl)
		;(buildPublicUrl as any).mockReturnValue(mockPublicUrl)

		const argsWithTimeout = {
			...mockUploadArgs,
			presignTimeoutMs: 5000,
			uploadTimeoutMs: 30000,
		}

		await performUpload(mockPlugin, argsWithTimeout)

		expect(presignAndPutObject).toHaveBeenCalledWith(
			mockPlugin,
			expect.objectContaining({
				presignTimeoutMs: 5000,
				uploadTimeoutMs: 30000,
			})
		)
	})

	it('应该使用全局超时配置作为后备', async () => {
		const mockPresignedUrl = 'https://example.com/presigned-url'
		const mockPublicUrl = 'https://example.com/public/test.jpg'

		;(presignAndPutObject as any).mockResolvedValue(mockPresignedUrl)
		;(buildPublicUrl as any).mockReturnValue(mockPublicUrl)

		// 模拟全局配置
		;(global as any).window = {
			__obS3_presignTimeout__: 15000,
			__obS3_uploadTimeout__: 35000,
		}

		await performUpload(mockPlugin, mockUploadArgs)

		expect(presignAndPutObject).toHaveBeenCalledWith(
			mockPlugin,
			expect.objectContaining({
				presignTimeoutMs: 15000,
				uploadTimeoutMs: 35000,
			})
		)
	})

	it('应该计算正确的文件大小', async () => {
		const mockPresignedUrl = 'https://example.com/presigned-url'
		const mockPublicUrl = 'https://example.com/public/test.jpg'

		;(presignAndPutObject as any).mockResolvedValue(mockPresignedUrl)
		;(buildPublicUrl as any).mockReturnValue(mockPublicUrl)

		await performUpload(mockPlugin, mockUploadArgs)

		// 验证文件大小计算（base64长度 * 3/4）
		const expectedFileSize = Math.floor((mockUploadArgs.base64.length * 3) / 4)
		expect(uploadProgressManager.startUpload).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				fileSize: expectedFileSize,
			})
		)
	})
})
