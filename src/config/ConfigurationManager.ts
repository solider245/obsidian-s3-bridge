/**
 * 统一配置管理器
 *
 * 提供类型安全的配置访问，支持配置变更监听
 * 消除重复的配置读取代码
 */

export interface ConfigChangeListener<T = any> {
	(key: string, newValue: T, oldValue: T): void
}

export interface ValidationResult {
	valid: boolean
	error?: string
	value?: any
}

export class ConfigurationManager {
	private static instance: ConfigurationManager
	private config: Map<string, any> = new Map()
	private listeners: Map<string, Set<ConfigChangeListener>> = new Map()
	private validators: Map<string, (value: any) => ValidationResult> = new Map()

	// 默认配置
	private readonly defaults = {
		// 上传配置
		maxUploadMB: 5,
		presignTimeout: 10000,
		uploadTimeout: 25000,

		// S3 配置
		endpoint: '',
		accessKey: '',
		secretKey: '',
		bucket: '',
		region: 'auto',

		// 路径配置
		pathFormat: 'assets/{year}/{month}/{day}/{filename}{ext}',
		filenameFormat: '{timestamp}-{filename}{ext}',

		// 高级配置
		enableMultipart: false,
		multipartThreshold: 10 * 1024 * 1024, // 10MB
		chunkSize: 5 * 1024 * 1024, // 5MB
		maxConcurrentChunks: 3,

		// 缓存配置
		enableCache: true,
		cacheTTL: 5 * 60 * 1000, // 5分钟

		// UI 配置
		showProgress: true,
		showNotifications: true,
		enableDragDrop: true,
		enableBatchUpload: true,

		// 调试配置
		enableDebug: false,
		logLevel: 'info',
	}

	private constructor() {
		this.initializeConfig()
		this.setupWindowListeners()
	}

	static getInstance(): ConfigurationManager {
		if (!ConfigurationManager.instance) {
			ConfigurationManager.instance = new ConfigurationManager()
		}
		return ConfigurationManager.instance
	}

	/**
	 * 初始化配置
	 */
	private initializeConfig(): void {
		// 从 window 对象读取配置
		const windowConfig = (window as any).__obS3_config__ || {}

		// 设置默认值
		Object.entries(this.defaults).forEach(([key, defaultValue]) => {
			this.config.set(key, windowConfig[key] ?? defaultValue)
		})

		// 设置验证器
		this.setupValidators()
	}

	/**
	 * 设置配置验证器
	 */
	private setupValidators(): void {
		// 文件大小验证
		this.validators.set('maxUploadMB', (value: number) => {
			if (typeof value !== 'number' || value < 1 || value > 100) {
				return { valid: false, error: '文件大小限制必须在 1-100MB 之间' }
			}
			return { valid: true, value }
		})

		// 超时时间验证
		this.validators.set('presignTimeout', (value: number) => {
			if (typeof value !== 'number' || value < 1000 || value > 60000) {
				return { valid: false, error: '预签名超时必须在 1-60 秒之间' }
			}
			return { valid: true, value }
		})

		// 上传超时验证
		this.validators.set('uploadTimeout', (value: number) => {
			if (typeof value !== 'number' || value < 1000 || value > 300000) {
				return { valid: false, error: '上传超时必须在 1-300 秒之间' }
			}
			return { valid: true, value }
		})

		// 端点 URL 验证
		this.validators.set('endpoint', (value: string) => {
			if (value && !this.isValidUrl(value)) {
				return { valid: false, error: '无效的端点 URL' }
			}
			return { valid: true, value }
		})

		// 分片大小验证
		this.validators.set('chunkSize', (value: number) => {
			if (typeof value !== 'number' || value < 1024 * 1024 || value > 100 * 1024 * 1024) {
				return { valid: false, error: '分片大小必须在 1-100MB 之间' }
			}
			return { valid: true, value }
		})
	}

	/**
	 * 验证 URL
	 */
	private isValidUrl(url: string): boolean {
		try {
			new URL(url)
			return true
		} catch {
			return false
		}
	}

	/**
	 * 设置 window 监听器
	 */
	private setupWindowListeners(): void {
		// 监听配置变更
		if (typeof window !== 'undefined') {
			;(window as any).__obS3_onConfigChange__ = (key: string, value: any) => {
				this.set(key, value)
			}
		}
	}

	/**
	 * 获取配置值
	 */
	get<T>(key: string, defaultValue?: T): T {
		if (this.config.has(key)) {
			return this.config.get(key) as T
		}
		if (defaultValue !== undefined) {
			return defaultValue
		}
		throw new Error(`配置项 '${key}' 不存在且未提供默认值`)
	}

	/**
	 * 设置配置值
	 */
	set<T>(key: string, value: T): void {
		const oldValue = this.config.get(key)

		// 验证配置值
		const validator = this.validators.get(key)
		if (validator) {
			const result = validator(value)
			if (!result.valid) {
				throw new Error(`配置验证失败: ${result.error}`)
			}
			value = result.value
		}

		// 更新配置
		this.config.set(key, value)

		// 触发变更事件
		this.notifyChange(key, value, oldValue)

		// 更新 window 对象
		if (typeof window !== 'undefined') {
			if (!(window as any).__obS3_config__) {
				;(window as any).__obS3_config__ = {}
			}
			;(window as any).__obS3_config__[key] = value
		}
	}

	/**
	 * 监听配置变更
	 */
	onChange<T>(key: string, listener: ConfigChangeListener<T>): () => void {
		if (!this.listeners.has(key)) {
			this.listeners.set(key, new Set())
		}

		const listeners = this.listeners.get(key)!
		listeners.add(listener)

		// 返回取消监听的函数
		return () => {
			listeners.delete(listener)
			if (listeners.size === 0) {
				this.listeners.delete(key)
			}
		}
	}

	/**
	 * 通知配置变更
	 */
	private notifyChange(key: string, newValue: any, oldValue: any): void {
		const listeners = this.listeners.get(key)
		if (listeners) {
			listeners.forEach(listener => {
				try {
					listener(key, newValue, oldValue)
				} catch (error) {
					console.error(`配置变更监听器执行失败:`, error)
				}
			})
		}
	}

	/**
	 * 批量设置配置
	 */
	setMany(config: Record<string, any>): void {
		Object.entries(config).forEach(([key, value]) => {
			this.set(key, value)
		})
	}

	/**
	 * 获取所有配置
	 */
	getAll(): Record<string, any> {
		return Object.fromEntries(this.config)
	}

	/**
	 * 重置配置到默认值
	 */
	reset(key?: string): void {
		if (key) {
			const defaultValue = this.defaults[key as keyof typeof this.defaults]
			if (defaultValue !== undefined) {
				this.set(key, defaultValue)
			}
		} else {
			// 重置所有配置
			Object.entries(this.defaults).forEach(([key, value]) => {
				this.set(key, value)
			})
		}
	}

	/**
	 * 验证配置
	 */
	validate(key?: string): ValidationResult[] {
		const results: ValidationResult[] = []

		if (key) {
			const validator = this.validators.get(key)
			if (validator) {
				const value = this.get(key)
				results.push(validator(value))
			}
		} else {
			// 验证所有配置
			this.validators.forEach((validator, configKey) => {
				const value = this.get(configKey)
				results.push(validator(value))
			})
		}

		return results
	}

	/**
	 * 检查配置是否有效
	 */
	isValid(key?: string): boolean {
		const results = this.validate(key)
		return results.every(result => result.valid)
	}

	/**
	 * 导出配置
	 */
	export(): string {
		return JSON.stringify(this.getAll(), null, 2)
	}

	/**
	 * 导入配置
	 */
	import(configJson: string): void {
		try {
			const config = JSON.parse(configJson)
			this.setMany(config)
		} catch (error) {
			throw new Error('配置导入失败: 无效的 JSON 格式')
		}
	}

	/**
	 * 获取配置统计信息
	 */
	getStats(): {
		totalConfigs: number
		listeners: number
		validators: number
		validationResults: ValidationResult[]
	} {
		return {
			totalConfigs: this.config.size,
			listeners: Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0),
			validators: this.validators.size,
			validationResults: this.validate(),
		}
	}
}

// 导出单例实例
export const configManager = ConfigurationManager.getInstance()

// 便捷的配置访问函数
export function getConfig<T>(key: string, defaultValue?: T): T {
	return configManager.get(key, defaultValue)
}

export function setConfig<T>(key: string, value: T): void {
	configManager.set(key, value)
}

export function onConfigChange<T>(key: string, listener: ConfigChangeListener<T>): () => void {
	return configManager.onChange(key, listener)
}
