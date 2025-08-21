/**
 * 统一错误处理器
 *
 * 提供统一的错误类型、处理逻辑和用户友好的错误提示
 */

export enum ErrorType {
	NETWORK_ERROR = 'NETWORK_ERROR',
	CONFIG_ERROR = 'CONFIG_ERROR',
	UPLOAD_ERROR = 'UPLOAD_ERROR',
	VALIDATION_ERROR = 'VALIDATION_ERROR',
	PERMISSION_ERROR = 'PERMISSION_ERROR',
	TIMEOUT_ERROR = 'TIMEOUT_ERROR',
	UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export enum ErrorSeverity {
	LOW = 'LOW',
	MEDIUM = 'MEDIUM',
	HIGH = 'HIGH',
	CRITICAL = 'CRITICAL',
}

export interface ErrorContext {
	operation?: string
	component?: string
	timestamp?: number
	userId?: string
	additionalData?: Record<string, any>
	attempt?: number
}

export interface UserFriendlyError {
	title: string
	message: string
	suggestion?: string
	action?: string
}

export class AppError extends Error {
	public readonly type: ErrorType
	public readonly severity: ErrorSeverity
	public readonly context: ErrorContext
	public readonly originalError?: Error
	public readonly retryable: boolean
	public readonly userFriendly: UserFriendlyError

	constructor(
		type: ErrorType,
		message: string,
		userFriendly: UserFriendlyError,
		severity: ErrorSeverity = ErrorSeverity.MEDIUM,
		context: ErrorContext = {},
		originalError?: Error,
		retryable = false
	) {
		super(message)
		this.name = 'AppError'
		this.type = type
		this.severity = severity
		this.context = {
			timestamp: Date.now(),
			...context,
		}
		this.originalError = originalError
		this.retryable = retryable
		this.userFriendly = userFriendly

		// 保持原型链
		Object.setPrototypeOf(this, AppError.prototype)
	}

	toJSON() {
		return {
			name: this.name,
			type: this.type,
			severity: this.severity,
			message: this.message,
			context: this.context,
			retryable: this.retryable,
			userFriendly: this.userFriendly,
			stack: this.stack,
			originalError: this.originalError?.message,
		}
	}

	toString() {
		return `[${this.type}] ${this.message}`
	}
}

/**
 * 错误类型映射
 */
const errorTypeMap: Record<string, ErrorType> = {
	NetworkError: ErrorType.NETWORK_ERROR,
	TimeoutError: ErrorType.TIMEOUT_ERROR,
	ValidationError: ErrorType.VALIDATION_ERROR,
	ConfigError: ErrorType.CONFIG_ERROR,
	PermissionError: ErrorType.PERMISSION_ERROR,
	UploadError: ErrorType.UPLOAD_ERROR,
}

/**
 * 用户友好的错误消息映射
 */
const userFriendlyMessages: Record<ErrorType, UserFriendlyError> = {
	[ErrorType.NETWORK_ERROR]: {
		title: '网络连接错误',
		message: '无法连接到服务器，请检查您的网络连接。',
		suggestion: '请检查网络连接是否正常，或稍后重试。',
		action: '重试',
	},
	[ErrorType.CONFIG_ERROR]: {
		title: '配置错误',
		message: '插件配置不正确，请检查设置。',
		suggestion: '请检查 S3 配置信息是否正确。',
		action: '打开设置',
	},
	[ErrorType.UPLOAD_ERROR]: {
		title: '上传失败',
		message: '文件上传过程中出现错误。',
		suggestion: '请检查文件格式和大小限制，然后重试。',
		action: '重试',
	},
	[ErrorType.VALIDATION_ERROR]: {
		title: '验证错误',
		message: '输入的数据格式不正确。',
		suggestion: '请检查您的输入是否符合要求。',
		action: '重新输入',
	},
	[ErrorType.PERMISSION_ERROR]: {
		title: '权限错误',
		message: '没有执行此操作的权限。',
		suggestion: '请检查您的 S3 权限设置。',
		action: '检查权限',
	},
	[ErrorType.TIMEOUT_ERROR]: {
		title: '操作超时',
		message: '操作耗时过长，已超时。',
		suggestion: '请检查网络连接，或稍后重试。',
		action: '重试',
	},
	[ErrorType.UNKNOWN_ERROR]: {
		title: '未知错误',
		message: '发生了未知错误。',
		suggestion: '请稍后重试，或联系开发者。',
		action: '重试',
	},
}

/**
 * 错误处理器类
 */
export class ErrorHandler {
	private static instance: ErrorHandler
	private errorListeners: Set<(error: AppError) => void> = new Set()
	private errorLog: AppError[] = []
	private readonly maxLogSize = 100

	private constructor() {
		this.setupGlobalErrorHandlers()
	}

	static getInstance(): ErrorHandler {
		if (!ErrorHandler.instance) {
			ErrorHandler.instance = new ErrorHandler()
		}
		return ErrorHandler.instance
	}

	/**
	 * 设置全局错误处理器
	 */
	private setupGlobalErrorHandlers(): void {
		if (typeof window !== 'undefined') {
			window.addEventListener('error', event => {
				this.handleError(event.error)
			})

			window.addEventListener('unhandledrejection', event => {
				this.handleError(event.reason)
			})
		}
	}

	/**
	 * 处理错误
	 */
	handleError(error: any, context: ErrorContext = {}): AppError {
		const appError = this.normalizeError(error, context)

		// 记录错误
		this.logError(appError)

		// 通知监听器
		this.notifyListeners(appError)

		// 显示用户友好的错误信息
		this.showUserFriendlyError(appError)

		return appError
	}

	/**
	 * 标准化错误
	 */
	private normalizeError(error: any, context: ErrorContext): AppError {
		if (error instanceof AppError) {
			return error
		}

		// 根据错误类型创建相应的 AppError
		let type = ErrorType.UNKNOWN_ERROR
		const severity = ErrorSeverity.MEDIUM
		let retryable = false

		if (error instanceof Error) {
			// 根据错误名称判断类型
			if (error.name in errorTypeMap) {
				type = errorTypeMap[error.name]
			}

			// 根据错误消息判断类型
			const message = error.message.toLowerCase()
			if (message.includes('network') || message.includes('fetch')) {
				type = ErrorType.NETWORK_ERROR
				retryable = true
			} else if (message.includes('timeout')) {
				type = ErrorType.TIMEOUT_ERROR
				retryable = true
			} else if (message.includes('permission') || message.includes('access denied')) {
				type = ErrorType.PERMISSION_ERROR
			} else if (message.includes('validation') || message.includes('invalid')) {
				type = ErrorType.VALIDATION_ERROR
			} else if (message.includes('config') || message.includes('setting')) {
				type = ErrorType.CONFIG_ERROR
			} else if (message.includes('upload')) {
				type = ErrorType.UPLOAD_ERROR
				retryable = true
			}
		}

		// 获取用户友好的错误信息
		const userFriendly = userFriendlyMessages[type]

		return new AppError(
			type,
			error?.message || '未知错误',
			userFriendly,
			severity,
			context,
			error,
			retryable
		)
	}

	/**
	 * 记录错误
	 */
	private logError(error: AppError): void {
		this.errorLog.push(error)

		// 保持日志大小限制
		if (this.errorLog.length > this.maxLogSize) {
			this.errorLog = this.errorLog.slice(-this.maxLogSize)
		}

		// 控制台输出
		console.error(`[${error.type}] ${error.message}`, error)
	}

	/**
	 * 通知监听器
	 */
	private notifyListeners(error: AppError): void {
		this.errorListeners.forEach(listener => {
			try {
				listener(error)
			} catch (e) {
				console.error('错误监听器执行失败:', e)
			}
		})
	}

	/**
	 * 显示用户友好的错误信息
	 */
	private showUserFriendlyError(error: AppError): void {
		if (typeof window !== 'undefined' && (window as any).Notice) {
			const { Notice } = window as any
			new Notice(`❌ ${error.userFriendly.title}: ${error.userFriendly.message}`)
		}
	}

	/**
	 * 添加错误监听器
	 */
	addErrorListener(listener: (error: AppError) => void): () => void {
		this.errorListeners.add(listener)

		return () => {
			this.errorListeners.delete(listener)
		}
	}

	/**
	 * 获取错误日志
	 */
	getErrorLog(): AppError[] {
		return [...this.errorLog]
	}

	/**
	 * 清除错误日志
	 */
	clearErrorLog(): void {
		this.errorLog = []
	}

	/**
	 * 获取错误统计
	 */
	getErrorStats(): {
		total: number
		byType: Record<ErrorType, number>
		bySeverity: Record<ErrorSeverity, number>
		recent: AppError[]
	} {
		const byType = Object.values(ErrorType).reduce(
			(acc, type) => {
				acc[type] = 0
				return acc
			},
			{} as Record<ErrorType, number>
		)

		const bySeverity = Object.values(ErrorSeverity).reduce(
			(acc, severity) => {
				acc[severity] = 0
				return acc
			},
			{} as Record<ErrorSeverity, number>
		)

		this.errorLog.forEach(error => {
			byType[error.type]++
			bySeverity[error.severity]++
		})

		return {
			total: this.errorLog.length,
			byType,
			bySeverity,
			recent: this.errorLog.slice(-10),
		}
	}

	/**
	 * 重试操作
	 */
	async retry<T>(
		operation: () => Promise<T>,
		context: ErrorContext = {},
		maxRetries = 3,
		delayMs = 1000
	): Promise<T> {
		let lastError: AppError

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				return await operation()
			} catch (error) {
				lastError = this.handleError(error, { ...context, attempt })

				if (attempt === maxRetries || !lastError.retryable) {
					throw lastError
				}

				// 指数退避
				const delay = delayMs * Math.pow(2, attempt - 1)
				await this.sleep(delay)
			}
		}

		throw lastError!
	}

	/**
	 * 延迟函数
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}
}

// 导出单例实例
export const errorHandler = ErrorHandler.getInstance()

// 便捷的错误处理函数
export function handleError(error: any, context?: ErrorContext): AppError {
	return errorHandler.handleError(error, context)
}

export function addErrorListener(listener: (error: AppError) => void): () => void {
	return errorHandler.addErrorListener(listener)
}

export async function retryOperation<T>(
	operation: () => Promise<T>,
	context?: ErrorContext,
	maxRetries?: number,
	delayMs?: number
): Promise<T> {
	return errorHandler.retry(operation, context, maxRetries, delayMs)
}

// 从decorators.ts重新导出
export { withErrorHandling, withErrorHandlingAsync, withErrorHandlingSync } from './decorators'
