/**
 * 从 main.ts 抽取/对齐的纯函数：生成唯一对象键，支持 keyPrefix、日期前缀与 uploadId 唯一化。
 * 注意：如需与项目现有实现完全一致，请据 main.ts 实际逻辑同步微调。
 */
export function makeObjectKey(
	originalName: string,
	ext: string,
	keyPrefix: string,
	uploadId?: string,
	dateFormat?: string
): string {
	// 规范前后斜杠
	const norm = (s: string) => (s || '').replace(/^\/*/, '').replace(/\/*$/, '')

	const prefix = norm(keyPrefix)

	// 日期前缀 {yyyy}/{mm}/{dd}
	let dateSeg = ''
	if (dateFormat && dateFormat.includes('{')) {
		const d = new Date()
		const yyyy = String(d.getFullYear())
		const mm = String(d.getMonth() + 1).padStart(2, '0')
		const dd = String(d.getDate()).padStart(2, '0')
		dateSeg = dateFormat.replace('{yyyy}', yyyy).replace('{mm}', mm).replace('{dd}', dd)
		dateSeg = norm(dateSeg)
	}

	// 名称：uploadId 优先，否则用 originalName（空白转-）
	const base =
		uploadId && uploadId.trim().length > 0
			? uploadId.trim()
			: (originalName || 'file').trim().replace(/\s+/g, '-')

	// 扩展名，确保以点开头；当 ext 为空时不加
	const dotExt = ext ? (ext.startsWith('.') ? ext : `.${ext}`) : ''

	// 拼接 path 片段
	const parts = [prefix, dateSeg, `${base}${dotExt}`].filter(Boolean)
	return parts.join('/')
}

export default { makeObjectKey }
