/**
 * 错误处理装饰器
 *
 * 提供装饰器模式的错误处理，简化代码中的错误处理逻辑
 */

import { errorHandler, AppError, ErrorContext } from './ErrorHandler'

/**
 * 错误处理装饰器选项
 */
export interface ErrorHandlingOptions {
	/** 操作名称，用于错误上下文 */
	operation?: string
	/** 组件名称，用于错误上下文 */
	component?: string
	/** 用户友好的错误消息 */
	userMessage?: string
	/** 是否重试 */
	retryable?: boolean
	/** 最大重试次数 */
	maxRetries?: number
	/** 重试延迟（毫秒） */
	retryDelay?: number
	/** 是否显示错误通知 */
	showNotification?: boolean
	/** 错误回调函数 */
	onError?: (error: AppError) => void
	/** 成功回调函数 */
	onSuccess?: (result: any) => void
}

/**
 * 默认错误处理选项
 */
const defaultOptions: ErrorHandlingOptions = {
	showNotification: true,
	retryable: false,
	maxRetries: 3,
	retryDelay: 1000,
}

/**
 * 创建错误处理装饰器
 */
export function withErrorHandling(options: ErrorHandlingOptions = {}) {
	const mergedOptions = { ...defaultOptions, ...options }

	return function <T extends (...args: any[]) => any>(
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor
	) {
		const originalMethod = descriptor.value

		descriptor.value = async function (...args: any[]) {
			const context: ErrorContext = {
				operation: mergedOptions.operation || `${target.constructor.name}.${propertyKey}`,
				component: mergedOptions.component || target.constructor.name,
				timestamp: Date.now(),
				additionalData: { args },
			}

			try {
				const result = await originalMethod.apply(this, args)

				// 成功回调
				if (mergedOptions.onSuccess) {
					mergedOptions.onSuccess(result)
				}

				return result
			} catch (error) {
				const appError = errorHandler.handleError(error, context)

				// 错误回调
				if (mergedOptions.onError) {
					mergedOptions.onError(appError)
				}

				// 重试逻辑
				if (mergedOptions.retryable && appError.retryable) {
					return await retryWithBackoff(
						() => originalMethod.apply(this, args),
						context,
						mergedOptions.maxRetries!,
						mergedOptions.retryDelay!
					)
				}

				throw appError
			}
		}

		return descriptor
	}
}

/**
 * 同步方法的错误处理装饰器
 */
export function withSyncErrorHandling(options: ErrorHandlingOptions = {}) {
	const mergedOptions = { ...defaultOptions, ...options }

	return function <T extends (...args: any[]) => any>(
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor
	) {
		const originalMethod = descriptor.value

		descriptor.value = function (...args: any[]) {
			const context: ErrorContext = {
				operation: mergedOptions.operation || `${target.constructor.name}.${propertyKey}`,
				component: mergedOptions.component || target.constructor.name,
				timestamp: Date.now(),
				additionalData: { args },
			}

			try {
				const result = originalMethod.apply(this, args)

				// 成功回调
				if (mergedOptions.onSuccess) {
					mergedOptions.onSuccess(result)
				}

				return result
			} catch (error) {
				const appError = errorHandler.handleError(error, context)

				// 错误回调
				if (mergedOptions.onError) {
					mergedOptions.onError(appError)
				}

				throw appError
			}
		}

		return descriptor
	}
}

/**
 * 重试退避函数
 */
async function retryWithBackoff<T>(
	operation: () => Promise<T>,
	context: ErrorContext,
	maxRetries: number,
	baseDelay: number
): Promise<T> {
	let lastError: AppError

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation()
		} catch (error) {
			lastError = errorHandler.handleError(error, { ...context, attempt })

			if (attempt === maxRetries) {
				throw lastError
			}

			// 指数退避
			const delay = baseDelay * Math.pow(2, attempt - 1)
			await sleep(delay)
		}
	}

	throw lastError!
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 类级别的错误处理装饰器
 */
export function WithErrorHandling(options: ErrorHandlingOptions = {}) {
	return function <T extends { new (...args: any[]): any }>(constructor: T) {
		return class extends constructor {
			constructor(...args: any[]) {
				super(...args)
				this.setupErrorHandling(options)
			}

			private setupErrorHandling(options: ErrorHandlingOptions) {
				const originalMethods = Object.getOwnPropertyNames(constructor.prototype).filter(
					name => name !== 'constructor' && typeof this[name] === 'function'
				)

				originalMethods.forEach(methodName => {
					const originalMethod = this[methodName]
					const isAsync = originalMethod.constructor.name === 'AsyncFunction'

					const decorator = isAsync ? withErrorHandling : withSyncErrorHandling
					const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, methodName)!

					decorator.call(this, this, methodName, descriptor)
				})
			}
		}
	}
}

/**
 * 网络操作错误处理装饰器
 */
export function withNetworkHandling(options: Omit<ErrorHandlingOptions, 'retryable'> = {}) {
	return withErrorHandling({
		...options,
		retryable: true,
		maxRetries: 3,
		retryDelay: 1000,
		operation: options.operation || 'Network Operation',
	})
}

/**
 * 文件操作错误处理装饰器
 */
export function withFileHandling(options: Omit<ErrorHandlingOptions, 'retryable'> = {}) {
	return withErrorHandling({
		...options,
		retryable: false,
		operation: options.operation || 'File Operation',
	})
}

/**
 * 配置操作错误处理装饰器
 */
export function withConfigHandling(options: Omit<ErrorHandlingOptions, 'retryable'> = {}) {
	return withErrorHandling({
		...options,
		retryable: false,
		operation: options.operation || 'Config Operation',
	})
}

/**
 * 创建错误处理的高阶函数
 */
export function withErrorHandlingAsync<T extends any[], R>(
	fn: (...args: T) => Promise<R>,
	options: ErrorHandlingOptions = {}
): (...args: T) => Promise<R> {
	const mergedOptions = { ...defaultOptions, ...options }

	return async function (...args: T): Promise<R> {
		const context: ErrorContext = {
			operation: mergedOptions.operation || 'Async Operation',
			component: 'Function',
			timestamp: Date.now(),
			additionalData: { args },
		}

		try {
			const result = await fn(...args)

			if (mergedOptions.onSuccess) {
				mergedOptions.onSuccess(result)
			}

			return result
		} catch (error) {
			const appError = errorHandler.handleError(error, context)

			if (mergedOptions.onError) {
				mergedOptions.onError(appError)
			}

			if (mergedOptions.retryable && appError.retryable) {
				return await retryWithBackoff(
					() => fn(...args),
					context,
					mergedOptions.maxRetries!,
					mergedOptions.retryDelay!
				)
			}

			throw appError
		}
	}
}

/**
 * 创建同步错误处理的高阶函数
 */
export function withErrorHandlingSync<T extends any[], R>(
	fn: (...args: T) => R,
	options: ErrorHandlingOptions = {}
): (...args: T) => R {
	const mergedOptions = { ...defaultOptions, ...options }

	return function (...args: T): R {
		const context: ErrorContext = {
			operation: mergedOptions.operation || 'Sync Operation',
			component: 'Function',
			timestamp: Date.now(),
			additionalData: { args },
		}

		try {
			const result = fn(...args)

			if (mergedOptions.onSuccess) {
				mergedOptions.onSuccess(result)
			}

			return result
		} catch (error) {
			const appError = errorHandler.handleError(error, context)

			if (mergedOptions.onError) {
				mergedOptions.onError(appError)
			}

			throw appError
		}
	}
}

/**
 * 错误边界装饰器
 */
export function withErrorBoundary(options: ErrorHandlingOptions = {}) {
	return function <T extends (...args: any[]) => any>(
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor
	) {
		const originalMethod = descriptor.value

		descriptor.value = async function (...args: any[]) {
			try {
				return await originalMethod.apply(this, args)
			} catch (error) {
				const appError = errorHandler.handleError(error, {
					operation: options.operation || `${target.constructor.name}.${propertyKey}`,
					component: options.component || target.constructor.name,
					timestamp: Date.now(),
				})

				// 返回错误结果而不是抛出
				return {
					error: appError,
					success: false,
					message: appError.userFriendly.message,
				}
			}
		}

		return descriptor
	}
}

// 便捷的装饰器函数
export {
	withErrorHandling as catchErrors,
	withSyncErrorHandling as catchSyncErrors,
	withNetworkHandling as catchNetworkErrors,
	withFileHandling as catchFileErrors,
	withConfigHandling as catchConfigErrors,
}
