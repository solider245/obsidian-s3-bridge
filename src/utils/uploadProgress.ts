// 概述: 上传进度管理器，提供上传进度显示和状态管理
// 导出: UploadProgressManager, ProgressUpdate
// 依赖: 无（纯工具类）

export interface ProgressUpdate {
	id: string
	progress: number // 0-100
	stage: 'preparing' | 'uploading' | 'processing' | 'completed' | 'error'
	message: string
	fileName?: string
	fileSize?: number
	uploadedBytes?: number
	speed?: number // bytes per second
	eta?: number // estimated time to completion in seconds
}

export interface UploadProgressOptions {
	fileName?: string
	fileSize?: number
	onProgress?: (update: ProgressUpdate) => void
	onComplete?: (result: { success: boolean; url?: string; error?: string }) => void
	onError?: (error: Error) => void
}

export class UploadProgressManager {
	private uploads = new Map<string, ProgressUpdate>()
	private listeners = new Set<(update: ProgressUpdate) => void>()

	/**
	 * 开始一个新的上传任务
	 */
	startUpload(id: string, options: UploadProgressOptions = {}): ProgressUpdate {
		const update: ProgressUpdate = {
			id,
			progress: 0,
			stage: 'preparing',
			message: 'Preparing upload...',
			fileName: options.fileName,
			fileSize: options.fileSize,
		}

		this.uploads.set(id, update)
		this.notifyListeners(update)
		return update
	}

	/**
	 * 更新上传进度
	 */
	updateProgress(
		id: string,
		progress: number,
		stage: ProgressUpdate['stage'],
		message: string
	): void {
		const update = this.uploads.get(id)
		if (!update) return

		const now = Date.now()
		const uploadedBytes = (progress * (update.fileSize || 0)) / 100

		// 计算上传速度和ETA
		let speed: number | undefined
		let eta: number | undefined
		if (update.uploadedBytes !== undefined && update.uploadedBytes > 0) {
			const timeDiff = (now - (update as any).lastUpdate || now) / 1000
			const bytesDiff = uploadedBytes - update.uploadedBytes
			if (timeDiff > 0 && bytesDiff > 0) {
				speed = bytesDiff / timeDiff
				if (speed > 0 && progress < 100) {
					const remainingBytes = (update.fileSize || 0) - uploadedBytes
					eta = remainingBytes / speed
				}
			}
		}

		update.progress = progress
		update.stage = stage
		update.message = message
		update.uploadedBytes = uploadedBytes
		update.speed = speed
		update.eta = eta
		;(update as any).lastUpdate = now

		this.notifyListeners(update)
	}

	/**
	 * 完成上传
	 */
	completeUpload(id: string, url?: string): void {
		const update = this.uploads.get(id)
		if (!update) return

		update.progress = 100
		update.stage = 'completed'
		update.message = 'Upload completed'

		this.notifyListeners(update)
		this.uploads.delete(id)
	}

	/**
	 * 标记上传失败
	 */
	failUpload(id: string, error: string): void {
		const update = this.uploads.get(id)
		if (!update) return

		update.stage = 'error'
		update.message = `Upload failed: ${error}`

		this.notifyListeners(update)
		this.uploads.delete(id)
	}

	/**
	 * 获取上传状态
	 */
	getProgress(id: string): ProgressUpdate | undefined {
		return this.uploads.get(id)
	}

	/**
	 * 获取所有活跃的上传
	 */
	getActiveUploads(): ProgressUpdate[] {
		return Array.from(this.uploads.values())
	}

	/**
	 * 添加进度监听器
	 */
	addListener(listener: (update: ProgressUpdate) => void): void {
		this.listeners.add(listener)
	}

	/**
	 * 移除进度监听器
	 */
	removeListener(listener: (update: ProgressUpdate) => void): void {
		this.listeners.delete(listener)
	}

	private notifyListeners(update: ProgressUpdate): void {
		this.listeners.forEach(listener => {
			try {
				listener(update)
			} catch (e) {
				console.error('Error in progress listener:', e)
			}
		})
	}
}

// 全局实例
export const uploadProgressManager = new UploadProgressManager()

// 辅助函数：格式化文件大小
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B'
	const k = 1024
	const sizes = ['B', 'KB', 'MB', 'GB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 辅助函数：格式化时间
export function formatEta(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`
	return `${Math.round(seconds / 3600)}h`
}

// 辅助函数：格式化速度
export function formatSpeed(bytesPerSecond: number): string {
	return `${formatFileSize(bytesPerSecond)}/s`
}
