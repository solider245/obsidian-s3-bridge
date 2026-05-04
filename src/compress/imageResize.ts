// 概述: 使用 Canvas API 在客户端缩放图片大小
// 导出: resizeImage
// 依赖: 无

export async function resizeImage(
	base64: string,
	mime: string,
	maxDimension: number,
	quality: number
): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => {
			try {
				const { width, height } = img
				if (width <= maxDimension && height <= maxDimension) {
					resolve(base64)
					return
				}

				let newWidth = width
				let newHeight = height
				if (width > height) {
					newWidth = maxDimension
					newHeight = Math.round((height / width) * maxDimension)
				} else {
					newHeight = maxDimension
					newWidth = Math.round((width / height) * maxDimension)
				}

				const canvas = document.createElement('canvas')
				canvas.width = newWidth
				canvas.height = newHeight

				const ctx = canvas.getContext('2d')
				if (!ctx) {
					reject(new Error('Failed to get 2D context'))
					return
				}

				ctx.drawImage(img, 0, 0, newWidth, newHeight)

				canvas.toBlob(
					(blob) => {
						if (!blob) {
							reject(new Error('Failed to convert canvas to blob'))
							return
						}
						const reader = new FileReader()
						reader.onloadend = () => {
							const dataUrl = reader.result as string
							const base64Result = dataUrl.split(',')[1]
							resolve(base64Result)
						}
						reader.onerror = () => reject(reader.error)
						reader.readAsDataURL(blob)
					},
					mime,
					quality
				)
			} catch (e) {
				reject(e)
			}
		}
		img.onerror = () => reject(new Error('Failed to load image'))
		img.src = `data:${mime};base64,${base64}`
	})
}
