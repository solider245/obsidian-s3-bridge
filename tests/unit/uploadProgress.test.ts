import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadProgressManager } from '../../src/utils/uploadProgress'

// 模拟 DOM 环境
global.window = {
	requestAnimationFrame: vi.fn(cb => setTimeout(cb, 0)),
} as any

describe('uploadProgress', () => {
	beforeEach(() => {
		// 清理所有上传进度
		const activeUploads = uploadProgressManager.getActiveUploads()
		activeUploads.forEach(upload => {
			uploadProgressManager.completeUpload(upload.id)
		})
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('uploadProgressManager', () => {
		it('应该正确开始上传并初始化进度', () => {
			const uploadId = 'test-upload-1'
			const fileName = 'test.jpg'
			const fileSize = 1024 * 1024 // 1MB

			uploadProgressManager.startUpload(uploadId, { fileName, fileSize })

			const progress = uploadProgressManager.getProgress(uploadId)
			expect(progress).toBeDefined()
			expect(progress?.fileName).toBe(fileName)
			expect(progress?.fileSize).toBe(fileSize)
			expect(progress?.progress).toBe(0)
			expect(progress?.stage).toBe('preparing')
		})

		it('应该正确更新上传进度', () => {
			const uploadId = 'test-upload-2'

			uploadProgressManager.startUpload(uploadId, { fileName: 'test.jpg', fileSize: 1000000 })
			uploadProgressManager.updateProgress(uploadId, 50, 'uploading', 'Uploading...')

			const progress = uploadProgressManager.getProgress(uploadId)
			expect(progress?.progress).toBe(50)
			expect(progress?.stage).toBe('uploading')
			expect(progress?.message).toBe('Uploading...')
		})

		it('应该正确计算上传速度和剩余时间', () => {
			const uploadId = 'test-upload-3'

			uploadProgressManager.startUpload(uploadId, { fileName: 'large.jpg', fileSize: 10000000 })

			// 模拟上传进度更新
			uploadProgressManager.updateProgress(uploadId, 20, 'uploading', 'Uploading...')
			vi.advanceTimersByTime(2000) // 2秒后

			uploadProgressManager.updateProgress(uploadId, 60, 'uploading', 'Uploading...')

			const progress = uploadProgressManager.getProgress(uploadId)
			expect(progress?.progress).toBe(60)
			expect(progress?.speed).toBeGreaterThan(0)
			expect(progress?.eta).toBeGreaterThan(0)
		})

		it('应该正确处理上传完成', () => {
			const uploadId = 'test-upload-4'

			uploadProgressManager.startUpload(uploadId, { fileName: 'test.jpg', fileSize: 1000000 })

			// 完成上传后会从Map中删除，所以需要测试之前的状态
			const progressBefore = uploadProgressManager.getProgress(uploadId)
			expect(progressBefore).toBeDefined()

			uploadProgressManager.completeUpload(uploadId, 'https://example.com/test.jpg')

			// 完成后应该从活跃上传中移除
			const progressAfter = uploadProgressManager.getProgress(uploadId)
			expect(progressAfter).toBeUndefined()
		})

		it('应该正确处理上传失败', () => {
			const uploadId = 'test-upload-5'
			const errorMessage = 'Network error'

			uploadProgressManager.startUpload(uploadId, { fileName: 'test.jpg', fileSize: 1000000 })

			// 失败上传后会从Map中删除，所以需要测试之前的状态
			const progressBefore = uploadProgressManager.getProgress(uploadId)
			expect(progressBefore).toBeDefined()

			uploadProgressManager.failUpload(uploadId, errorMessage)

			// 失败后应该从活跃上传中移除
			const progressAfter = uploadProgressManager.getProgress(uploadId)
			expect(progressAfter).toBeUndefined()
		})

		it('应该正确获取所有活动上传', () => {
			const uploadId1 = 'test-upload-6'
			const uploadId2 = 'test-upload-7'

			uploadProgressManager.startUpload(uploadId1, { fileName: 'test1.jpg', fileSize: 1000000 })
			uploadProgressManager.startUpload(uploadId2, { fileName: 'test2.jpg', fileSize: 2000000 })

			const allProgress = uploadProgressManager.getActiveUploads()
			expect(allProgress.length).toBe(2)
			expect(allProgress.some(p => p.id === uploadId1)).toBe(true)
			expect(allProgress.some(p => p.id === uploadId2)).toBe(true)
		})

		it('应该正确完成单个上传', () => {
			const uploadId = 'test-upload-8'

			uploadProgressManager.startUpload(uploadId, { fileName: 'test.jpg', fileSize: 1000000 })
			expect(uploadProgressManager.getProgress(uploadId)).toBeDefined()

			uploadProgressManager.completeUpload(uploadId)
			// 完成后应该从活跃上传中移除
			expect(uploadProgressManager.getActiveUploads().find(p => p.id === uploadId)).toBeUndefined()
		})

		it('应该正确处理所有上传的清理', () => {
			uploadProgressManager.startUpload('upload-1', { fileName: 'test1.jpg', fileSize: 1000000 })
			uploadProgressManager.startUpload('upload-2', { fileName: 'test2.jpg', fileSize: 2000000 })

			expect(uploadProgressManager.getActiveUploads().length).toBe(2)

			// 完成所有上传
			uploadProgressManager.getActiveUploads().forEach(upload => {
				uploadProgressManager.completeUpload(upload.id)
			})
			expect(uploadProgressManager.getActiveUploads().length).toBe(0)
		})
	})

	// UploadNotificationManager 测试需要 DOM 环境，暂时跳过
})
