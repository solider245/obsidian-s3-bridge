// 概述: 配置缓存管理器，提供配置缓存和失效机制
// 导出: ConfigCacheManager
// 依赖: 无（纯工具类）

export interface ConfigCacheEntry<T = any> {
	value: T
	timestamp: number
	ttl: number // Time to live in milliseconds
}

export class ConfigCacheManager {
	private cache = new Map<string, ConfigCacheEntry>()
	private defaultTTL = 5 * 60 * 1000 // 5 minutes default TTL

	/**
	 * 设置缓存项
	 */
	set<T>(key: string, value: T, ttl: number = this.defaultTTL): void {
		this.cache.set(key, {
			value,
			timestamp: Date.now(),
			ttl,
		})
	}

	/**
	 * 获取缓存项
	 */
	get<T>(key: string): T | undefined {
		const entry = this.cache.get(key)
		if (!entry) return undefined

		// 检查是否过期
		if (Date.now() - entry.timestamp > entry.ttl) {
			this.cache.delete(key)
			return undefined
		}

		return entry.value
	}

	/**
	 * 检查缓存项是否存在且未过期
	 */
	has(key: string): boolean {
		return this.get(key) !== undefined
	}

	/**
	 * 删除缓存项
	 */
	delete(key: string): boolean {
		return this.cache.delete(key)
	}

	/**
	 * 清空所有缓存
	 */
	clear(): void {
		this.cache.clear()
	}

	/**
	 * 获取缓存大小
	 */
	size(): number {
		return this.cache.size
	}

	/**
	 * 获取所有缓存键
	 */
	keys(): string[] {
		return Array.from(this.cache.keys())
	}

	/**
	 * 清理过期缓存项
	 */
	cleanup(): number {
		const now = Date.now()
		let cleanedCount = 0

		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > entry.ttl) {
				this.cache.delete(key)
				cleanedCount++
			}
		}

		return cleanedCount
	}

	/**
	 * 获取或设置缓存项（如果不存在则设置并返回）
	 */
	getOrSet<T>(key: string, factory: () => T, ttl?: number): T {
		const cached = this.get<T>(key)
		if (cached !== undefined) {
			return cached
		}

		const value = factory()
		this.set(key, value, ttl)
		return value
	}

	/**
	 * 设置默认TTL
	 */
	setDefaultTTL(ttl: number): void {
		this.defaultTTL = ttl
	}

	/**
	 * 获取缓存统计信息
	 */
	getStats() {
		const now = Date.now()
		let expiredCount = 0
		let validCount = 0

		for (const entry of this.cache.values()) {
			if (now - entry.timestamp > entry.ttl) {
				expiredCount++
			} else {
				validCount++
			}
		}

		return {
			total: this.cache.size,
			valid: validCount,
			expired: expiredCount,
			size: this.cache.size,
		}
	}
}

// 全局配置缓存实例
export const configCache = new ConfigCacheManager()
