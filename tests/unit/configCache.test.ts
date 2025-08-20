import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConfigCacheManager } from '../../src/utils/configCache'

describe('ConfigCacheManager', () => {
	let cacheManager: ConfigCacheManager

	beforeEach(() => {
		cacheManager = new ConfigCacheManager()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('基本操作', () => {
		it('应该正确设置和获取缓存项', () => {
			const key = 'test-key'
			const value = { test: 'data' }

			cacheManager.set(key, value)
			const result = cacheManager.get(key)

			expect(result).toEqual(value)
		})

		it('应该正确检查缓存项是否存在', () => {
			const key = 'test-key'
			const value = { test: 'data' }

			expect(cacheManager.has(key)).toBe(false)

			cacheManager.set(key, value)
			expect(cacheManager.has(key)).toBe(true)
		})

		it('应该正确删除缓存项', () => {
			const key = 'test-key'
			const value = { test: 'data' }

			cacheManager.set(key, value)
			expect(cacheManager.has(key)).toBe(true)

			cacheManager.delete(key)
			expect(cacheManager.has(key)).toBe(false)
		})

		it('应该正确清空所有缓存', () => {
			cacheManager.set('key1', 'value1')
			cacheManager.set('key2', 'value2')

			expect(cacheManager.size()).toBe(2)

			cacheManager.clear()
			expect(cacheManager.size()).toBe(0)
		})

		it('应该正确获取所有缓存键', () => {
			cacheManager.set('key1', 'value1')
			cacheManager.set('key2', 'value2')

			const keys = cacheManager.keys()
			expect(keys).toContain('key1')
			expect(keys).toContain('key2')
			expect(keys.length).toBe(2)
		})
	})

	describe('TTL (过期时间)', () => {
		it('应该正确处理过期的缓存项', () => {
			const key = 'test-key'
			const value = { test: 'data' }
			const ttl = 1000 // 1秒

			cacheManager.set(key, value, ttl)
			expect(cacheManager.has(key)).toBe(true)

			// 快进时间到过期后
			vi.advanceTimersByTime(1500)

			expect(cacheManager.has(key)).toBe(false)
			expect(cacheManager.get(key)).toBeUndefined()
		})

		it('应该正确清理过期缓存项', () => {
			const key1 = 'key1'
			const key2 = 'key2'
			const key3 = 'key3'

			cacheManager.set(key1, 'value1', 1000) // 1秒过期
			cacheManager.set(key2, 'value2', 3000) // 3秒过期
			cacheManager.set(key3, 'value3', 5000) // 5秒过期

			expect(cacheManager.size()).toBe(3)

			// 快进2秒
			vi.advanceTimersByTime(2000)

			const cleanedCount = cacheManager.cleanup()
			expect(cleanedCount).toBe(1) // 只有key1过期
			expect(cacheManager.size()).toBe(2)
			expect(cacheManager.has(key1)).toBe(false)
			expect(cacheManager.has(key2)).toBe(true)
			expect(cacheManager.has(key3)).toBe(true)
		})

		it('应该使用默认TTL', () => {
			const key = 'test-key'
			const value = { test: 'data' }

			cacheManager.setDefaultTTL(2000) // 2秒默认TTL
			cacheManager.set(key, value)

			expect(cacheManager.has(key)).toBe(true)

			// 快进1秒，应该还在缓存中
			vi.advanceTimersByTime(1000)
			expect(cacheManager.has(key)).toBe(true)

			// 快进到3秒，应该过期
			vi.advanceTimersByTime(2000)
			expect(cacheManager.has(key)).toBe(false)
		})
	})

	describe('getOrSet 方法', () => {
		it('应该正确实现getOrSet逻辑', () => {
			const key = 'test-key'
			const factory = vi.fn(() => ({ test: 'data' }))

			// 第一次调用，应该执行factory
			const result1 = cacheManager.getOrSet(key, factory)
			expect(factory).toHaveBeenCalledTimes(1)
			expect(result1).toEqual({ test: 'data' })

			// 第二次调用，应该从缓存获取，不执行factory
			const result2 = cacheManager.getOrSet(key, factory)
			expect(factory).toHaveBeenCalledTimes(1)
			expect(result2).toEqual({ test: 'data' })
		})

		it('应该支持自定义TTL', () => {
			const key = 'test-key'
			const factory = vi.fn(() => ({ test: 'data' }))

			cacheManager.getOrSet(key, factory, 1000)
			expect(cacheManager.has(key)).toBe(true)

			vi.advanceTimersByTime(1500)
			expect(cacheManager.has(key)).toBe(false)
		})
	})

	describe('统计信息', () => {
		it('应该正确获取缓存统计信息', () => {
			const key1 = 'key1'
			const key2 = 'key2'
			const key3 = 'key3'

			cacheManager.set(key1, 'value1', 1000) // 1秒过期
			cacheManager.set(key2, 'value2', 3000) // 3秒过期
			cacheManager.set(key3, 'value3', 5000) // 5秒过期

			let stats = cacheManager.getStats()
			expect(stats.total).toBe(3)
			expect(stats.valid).toBe(3)
			expect(stats.expired).toBe(0)

			// 快进2秒
			vi.advanceTimersByTime(2000)

			stats = cacheManager.getStats()
			expect(stats.total).toBe(3)
			expect(stats.valid).toBe(2)
			expect(stats.expired).toBe(1)
		})
	})

	describe('边界情况', () => {
		it('应该正确处理undefined和null值', () => {
			const key1 = 'key1'
			const key2 = 'key2'

			cacheManager.set(key1, undefined)
			cacheManager.set(key2, null)

			expect(cacheManager.get(key1)).toBeUndefined()
			expect(cacheManager.get(key2)).toBeNull()
		})

		it('应该正确处理空字符串键', () => {
			const key = ''
			const value = { test: 'data' }

			cacheManager.set(key, value)
			expect(cacheManager.get(key)).toEqual(value)
		})

		it('应该正确处理0 TTL', () => {
			const key = 'test-key'
			const value = { test: 'data' }

			cacheManager.set(key, value, 0)
			expect(cacheManager.has(key)).toBe(true)

			// 立即过期
			vi.advanceTimersByTime(1)
			expect(cacheManager.has(key)).toBe(false)
		})
	})
})
