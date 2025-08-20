// 概述: 生成 S3 对象键，支持可配置日期前缀与 uploadId 优先命名，保持与现实现逻辑一致。
// 导出: makeObjectKey(originalName: string | null, ext: string, prefix: string, uploadId?: string, dateFormat?: string): string
// 依赖: 无（纯函数）
// 用法: const key = makeObjectKey('a.png', 'png', 'prefix', 'u123', '{yyyy}/{mm}')
// 相关: [src/core/mime.ts()](src/core/mime.ts:1), [src/features/registerCommands.ts()](src/features/registerCommands.ts:1), [src/features/installPasteHandler.ts()](src/features/installPasteHandler.ts:1)

export function makeObjectKey(
	originalName: string | null,
	ext: string,
	prefix: string,
	uploadId?: string,
	dateFormat?: string
): string {
	const safePrefixFromConfig = (prefix || '').replace(/^\/+|\/+$/g, '')

	// 计算日期格式前缀（例如 "{yyyy}/{mm}" -> "2025/08"）
	const fmt = (dateFormat || '').trim()
	let datePart = ''
	if (fmt) {
		const now = new Date()
		const yyyy = String(now.getFullYear())
		const mm = String(now.getMonth() + 1).padStart(2, '0')
		const dd = String(now.getDate()).padStart(2, '0')
		datePart = fmt
			.replace(/\{yyyy\}/g, yyyy)
			.replace(/\{mm\}/g, mm)
			.replace(/\{dd\}/g, dd)
		// 去掉多余斜杠与前后空格
		datePart = datePart.replace(/^\/+|\/+$/g, '').trim()
	}

	const pieces: string[] = []
	if (safePrefixFromConfig) pieces.push(safePrefixFromConfig)
	if (datePart) pieces.push(datePart)

	// 文件名：若有 uploadId，则严格使用 uploadId.ext 确保唯一；否则回退到旧策略
	let fileName: string
	if (uploadId) {
		fileName = `${uploadId}.${ext}`
	} else {
		const ts = Date.now()
		const rand = Math.random().toString(36).slice(2)
		const base = originalName
			? originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\s+/g, '_')
			: `${ts}_${rand}.${ext}`
		fileName = base.endsWith(`.${ext}`) ? base : `${base}.${ext}`
	}

	pieces.push(fileName)
	return pieces.join('/')
}

export default { makeObjectKey }
