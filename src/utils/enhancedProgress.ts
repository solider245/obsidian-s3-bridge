/**
 * 增强的进度反馈系统
 *
 * 提供更精确的上传进度计算、速度估算和用户反馈
 */

import { configManager } from '../config/ConfigurationManager'
import { Notice } from 'obsidian'

export interface EnhancedProgressUpdate {
	id: string
	progress: number
	stage: 'preparing' | 'uploading' | 'processing' | 'completed' | 'error' | 'paused'
	message: string
	fileName: string
	fileSize: number
	uploadedBytes: number
	speed: number
	eta: number
	averageSpeed: number
	peakSpeed: number
	timeElapsed: number
	timeRemaining: number
	retryCount: number
	error?: string
	warnings: string[]
}

export interface ProgressNotificationOptions {
	showNotifications: boolean
	notificationThreshold: number
	showSpeedUpdates: boolean
	showCompletionAlerts: boolean
	showErrorDetails: boolean
	customMessages?: {
		start?: string
		progress?: string
		complete?: string
		error?: string
	}
}

export interface SpeedCalculator {
	calculateSpeed(bytes: number, timeMs: number): number
	getAverageSpeed(): number
	getPeakSpeed(): number
	reset(): void
}

/**
 * 速度计算器
 */
class SpeedCalculatorImpl implements SpeedCalculator {
	private samples: Array<{ bytes: number; time: number; speed: number }> = []
	private maxSamples = 10
	private currentSpeed = 0
	private averageSpeed = 0
	private peakSpeed = 0

	calculateSpeed(bytes: number, timeMs: number): number {
		if (timeMs <= 0) return 0

		const speed = (bytes / timeMs) * 1000 // bytes per second

		// 添加到样本
		this.samples.push({ bytes, time: timeMs, speed })

		// 保持样本数量在限制内
		if (this.samples.length > this.maxSamples) {
			this.samples.shift()
		}

		// 计算平均速度
		const totalBytes = this.samples.reduce((sum, sample) => sum + sample.bytes, 0)
		const totalTime = this.samples.reduce((sum, sample) => sum + sample.time, 0)
		this.averageSpeed = totalTime > 0 ? (totalBytes / totalTime) * 1000 : 0

		// 更新峰值速度
		if (speed > this.peakSpeed) {
			this.peakSpeed = speed
		}

		this.currentSpeed = speed
		return speed
	}

	getAverageSpeed(): number {
		return this.averageSpeed
	}

	getPeakSpeed(): number {
		return this.peakSpeed
	}

	reset(): void {
		this.samples = []
		this.currentSpeed = 0
		this.averageSpeed = 0
		this.peakSpeed = 0
	}
}

/**
 * 增强的进度管理器
 */
export class EnhancedProgressManager {
	private uploads = new Map<string, EnhancedProgressUpdate>()
	private listeners = new Set<(update: EnhancedProgressUpdate) => void>()
	private notificationOptions: ProgressNotificationOptions
	private lastNotificationTime = new Map<string, number>()
	private speedCalculators = new Map<string, SpeedCalculator>()

	constructor(options: Partial<ProgressNotificationOptions> = {}) {
		this.notificationOptions = {
			showNotifications: configManager.get('showUploadNotifications', true),
			notificationThreshold: configManager.get('notificationThreshold', 10),
			showSpeedUpdates: configManager.get('showSpeedUpdates', false),
			showCompletionAlerts: configManager.get('showCompletionAlerts', true),
			showErrorDetails: configManager.get('showErrorDetails', true),
			...options,
		}
	}

	/**
	 * 开始新的上传任务
	 */
	startUpload(id: string, fileName: string, fileSize: number): EnhancedProgressUpdate {
		const update: EnhancedProgressUpdate = {
			id,
			progress: 0,
			stage: 'preparing',
			message: '准备上传...',
			fileName,
			fileSize,
			uploadedBytes: 0,
			speed: 0,
			eta: 0,
			averageSpeed: 0,
			peakSpeed: 0,
			timeElapsed: 0,
			timeRemaining: 0,
			retryCount: 0,
			warnings: [],
		}

		this.uploads.set(id, update)
		this.speedCalculators.set(id, new SpeedCalculatorImpl())

		this.notifyListeners(update)
		this.showNotification('start', update)

		return update
	}

	/**
	 * 更新上传进度
	 */
	updateProgress(id: string, progress: number, uploadedBytes: number): void {
		const update = this.uploads.get(id)
		const speedCalculator = this.speedCalculators.get(id)

		if (!update || !speedCalculator) return

		const now = Date.now()
		const startTime = (update as any).startTime || now
		const timeElapsed = (now - startTime) / 1000

		// 计算速度
		const bytesDiff = uploadedBytes - update.uploadedBytes
		const timeDiff = now - ((update as any).lastUpdate || now)
		const speed = speedCalculator.calculateSpeed(bytesDiff, timeDiff)

		// 计算剩余时间
		const remainingBytes = update.fileSize - uploadedBytes
		const eta = speed > 0 ? remainingBytes / speed : 0

		// 更新进度信息
		update.progress = progress
		update.uploadedBytes = uploadedBytes
		update.speed = speed
		update.averageSpeed = speedCalculator.getAverageSpeed()
		update.peakSpeed = speedCalculator.getPeakSpeed()
		update.timeElapsed = timeElapsed
		update.timeRemaining = eta
		update.eta = eta

		// 更新阶段和消息
		if (progress === 0) {
			update.stage = 'preparing'
			update.message = '准备上传...'
		} else if (progress < 100) {
			update.stage = 'uploading'
			update.message = this.generateProgressMessage(update)
		} else {
			update.stage = 'processing'
			update.message = '处理中...'
		}

		// 保存更新时间
		;(update as any).lastUpdate = now
		if (!(update as any).startTime) {
			;(update as any).startTime = now
		}

		this.notifyListeners(update)
		this.checkProgressNotifications(update)
	}

	/**
	 * 完成上传
	 */
	completeUpload(id: string, url?: string): void {
		const update = this.uploads.get(id)
		if (!update) return

		update.progress = 100
		update.stage = 'completed'
		update.message = '上传完成'
		update.timeRemaining = 0
		update.eta = 0

		this.notifyListeners(update)
		this.showNotification('complete', update)

		// 清理资源
		this.uploads.delete(id)
		this.speedCalculators.delete(id)
		this.lastNotificationTime.delete(id)
	}

	/**
	 * 标记上传失败
	 */
	failUpload(id: string, error: string, retryCount = 0): void {
		const update = this.uploads.get(id)
		if (!update) return

		update.stage = 'error'
		update.message = `上传失败: ${error}`
		update.error = error
		update.retryCount = retryCount

		this.notifyListeners(update)
		this.showNotification('error', update)

		// 清理资源
		this.uploads.delete(id)
		this.speedCalculators.delete(id)
		this.lastNotificationTime.delete(id)
	}

	/**
	 * 暂停上传
	 */
	pauseUpload(id: string): void {
		const update = this.uploads.get(id)
		if (!update) return

		update.stage = 'paused'
		update.message = '上传已暂停'

		this.notifyListeners(update)
	}

	/**
	 * 恢复上传
	 */
	resumeUpload(id: string): void {
		const update = this.uploads.get(id)
		if (!update) return

		update.stage = 'uploading'
		update.message = this.generateProgressMessage(update)

		this.notifyListeners(update)
	}

	/**
	 * 添加警告
	 */
	addWarning(id: string, warning: string): void {
		const update = this.uploads.get(id)
		if (!update) return

		update.warnings.push(warning)
		this.notifyListeners(update)
	}

	/**
	 * 获取上传状态
	 */
	getProgress(id: string): EnhancedProgressUpdate | undefined {
		return this.uploads.get(id)
	}

	/**
	 * 获取所有活跃的上传
	 */
	getActiveUploads(): EnhancedProgressUpdate[] {
		return Array.from(this.uploads.values())
	}

	/**
	 * 获取统计信息
	 */
	getStats(): {
		totalUploads: number
		activeUploads: number
		completedUploads: number
		failedUploads: number
		totalBytesUploaded: number
		averageSpeed: number
		peakSpeed: number
		totalTime: number
	} {
		const activeUploads = this.getActiveUploads()
		const totalBytesUploaded = activeUploads.reduce((sum, upload) => sum + upload.uploadedBytes, 0)
		const averageSpeed =
			activeUploads.length > 0
				? activeUploads.reduce((sum, upload) => sum + upload.averageSpeed, 0) / activeUploads.length
				: 0
		const peakSpeed = Math.max(...activeUploads.map(upload => upload.peakSpeed), 0)
		const totalTime = Math.max(...activeUploads.map(upload => upload.timeElapsed), 0)

		return {
			totalUploads: activeUploads.length,
			activeUploads: activeUploads.filter(u => u.stage === 'uploading').length,
			completedUploads: activeUploads.filter(u => u.stage === 'completed').length,
			failedUploads: activeUploads.filter(u => u.stage === 'error').length,
			totalBytesUploaded,
			averageSpeed,
			peakSpeed,
			totalTime,
		}
	}

	/**
	 * 添加进度监听器
	 */
	addListener(listener: (update: EnhancedProgressUpdate) => void): void {
		this.listeners.add(listener)
	}

	/**
	 * 移除进度监听器
	 */
	removeListener(listener: (update: EnhancedProgressUpdate) => void): void {
		this.listeners.delete(listener)
	}

	/**
	 * 更新通知选项
	 */
	updateNotificationOptions(options: Partial<ProgressNotificationOptions>): void {
		this.notificationOptions = { ...this.notificationOptions, ...options }
	}

	/**
	 * 生成进度消息
	 */
	private generateProgressMessage(update: EnhancedProgressUpdate): string {
		const { progress, speed, eta, fileName } = update

		if (progress === 0) return '准备上传...'
		if (progress === 100) return '上传完成'

		const speedText = this.formatSpeed(speed)
		const etaText = this.formatTime(eta)

		return `${fileName} - ${progress.toFixed(1)}% - ${speedText} - 剩余 ${etaText}`
	}

	/**
	 * 检查进度通知
	 */
	private checkProgressNotifications(update: EnhancedProgressUpdate): void {
		if (!this.notificationOptions.showNotifications) return

		const now = Date.now()
		const lastNotification = this.lastNotificationTime.get(update.id) || 0
		const timeSinceLastNotification = now - lastNotification

		// 检查是否达到通知阈值
		if (timeSinceLastNotification >= this.notificationOptions.notificationThreshold * 1000) {
			this.showNotification('progress', update)
			this.lastNotificationTime.set(update.id, now)
		}
	}

	/**
	 * 显示通知
	 */
	private showNotification(
		type: 'start' | 'progress' | 'complete' | 'error',
		update: EnhancedProgressUpdate
	): void {
		if (!this.notificationOptions.showNotifications) return

		let message = ''
		let duration = 3000

		switch (type) {
			case 'start':
				message = this.notificationOptions.customMessages?.start || `开始上传: ${update.fileName}`
				break
			case 'progress':
				if (!this.notificationOptions.showSpeedUpdates) return
				message = this.notificationOptions.customMessages?.progress || update.message
				duration = 2000
				break
			case 'complete':
				if (!this.notificationOptions.showCompletionAlerts) return
				const timeText = this.formatTime(update.timeElapsed)
				message =
					this.notificationOptions.customMessages?.complete ||
					`上传完成: ${update.fileName} (${timeText})`
				duration = 5000
				break
			case 'error':
				message =
					this.notificationOptions.customMessages?.error ||
					`上传失败: ${update.fileName} - ${update.error}`
				duration = 8000
				break
		}

		if (message) {
			new Notice(message, duration)
		}
	}

	/**
	 * 通知监听器
	 */
	private notifyListeners(update: EnhancedProgressUpdate): void {
		this.listeners.forEach(listener => {
			try {
				listener(update)
			} catch (e) {
				console.error('Error in progress listener:', e)
			}
		})
	}

	/**
	 * 格式化文件大小
	 */
	private formatSize(bytes: number): string {
		if (bytes === 0) return '0 B'
		const k = 1024
		const sizes = ['B', 'KB', 'MB', 'GB']
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
	}

	/**
	 * 格式化时间
	 */
	private formatTime(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}秒`
		if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
		return `${Math.round(seconds / 3600)}小时`
	}

	/**
	 * 格式化速度
	 */
	private formatSpeed(bytesPerSecond: number): string {
		return `${this.formatSize(bytesPerSecond)}/s`
	}
}

// 全局实例
export const enhancedProgressManager = new EnhancedProgressManager()

// 导出便捷函数
export function startEnhancedUpload(
	id: string,
	fileName: string,
	fileSize: number
): EnhancedProgressUpdate {
	return enhancedProgressManager.startUpload(id, fileName, fileSize)
}

export function updateEnhancedProgress(id: string, progress: number, uploadedBytes: number): void {
	enhancedProgressManager.updateProgress(id, progress, uploadedBytes)
}

export function completeEnhancedUpload(id: string, url?: string): void {
	enhancedProgressManager.completeUpload(id, url)
}

export function failEnhancedUpload(id: string, error: string, retryCount?: number): void {
	enhancedProgressManager.failUpload(id, error, retryCount)
}

export function getEnhancedProgress(id: string): EnhancedProgressUpdate | undefined {
	return enhancedProgressManager.getProgress(id)
}

export function getEnhancedStats() {
	return enhancedProgressManager.getStats()
}
