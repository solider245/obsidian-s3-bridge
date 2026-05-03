// 概述: 高精度计时工具，自动降级到 Date.now()
// 导出: nowMs(): number
// 依赖: 无

export function nowMs(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
