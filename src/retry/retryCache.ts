// 概述: 失败上传数据缓存 — 为 retry 机制保存 base64/元数据，按 uploadId 存取
// 导出: stashFailed(uploadId, data), getFailed(uploadId), removeFailed(uploadId)
// 依赖: 无

import type { RetryData } from './types'

const cache = new Map<string, RetryData>()

export function stashFailed(uploadId: string, data: RetryData): void {
	cache.set(uploadId, data)
}

export function getFailed(uploadId: string): RetryData | undefined {
	return cache.get(uploadId)
}

export function removeFailed(uploadId: string): void {
	cache.delete(uploadId)
}
