// 概述: 提供从 MIME 类型推断常见文件扩展名的纯函数，供上传与键名构造使用。
// 导出: getFileExtensionFromMime(mime: string): string
// 依赖: 无（纯函数）
// 用法: const ext = getFileExtensionFromMime('image/png') // 'png'
// 相关: [src/core/objectKey.ts()](src/core/objectKey.ts:1), [src/features/registerCommands.ts()](src/features/registerCommands.ts:1), [src/features/installPasteHandler.ts()](src/features/installPasteHandler.ts:1)

export function getFileExtensionFromMime(mime: string): string {
	if (!mime) return 'bin'
	const m = mime.toLowerCase()
	if (m.includes('png')) return 'png'
	if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
	if (m.includes('gif')) return 'gif'
	if (m.includes('webp')) return 'webp'
	if (m.includes('svg')) return 'svg'
	if (m.includes('bmp')) return 'bmp'
	if (m.includes('tiff')) return 'tiff'
	// 常见音频
	if (m.includes('audio/')) {
		if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
		if (m.includes('wav')) return 'wav'
		if (m.includes('ogg')) return 'ogg'
	}
	// 常见视频
	if (m.includes('video/')) {
		if (m.includes('mp4')) return 'mp4'
		if (m.includes('webm')) return 'webm'
		if (m.includes('ogg')) return 'ogv'
		if (m.includes('quicktime') || m.includes('mov')) return 'mov'
	}
	// 文档类
	if (m.includes('pdf')) return 'pdf'
	if (m.includes('zip')) return 'zip'
	if (m.includes('rar')) return 'rar'
	if (m.includes('7z')) return '7z'
	return 'bin'
}

export default { getFileExtensionFromMime }
