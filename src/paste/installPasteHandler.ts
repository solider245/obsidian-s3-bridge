// 概述: 安装 editor-paste 监听，直接上传图片并替换为 Markdown 链接。
import type { Editor, Plugin } from 'obsidian'
import { Notice } from 'obsidian'
import { performUpload } from '../upload/performUpload'
import { tp } from '../l10n'
import { makeObjectKey } from '../core/objectKey'
import { loadS3Config } from '../../s3/s3Manager'
import { activityLog } from '../activityLog'
import { generateUploadId } from '../utils/generateUploadId'
import { getErrorMessage, getErrorType } from '../utils/errorHandling'
import { stashFailed } from '../retry/retryCache'
import { resizeImage } from '../compress/imageResize'

export interface PasteCtx {
	plugin: Plugin
	getExt: (mime: string) => string
}

export function installPasteHandler(ctx: PasteCtx): void {
	const { plugin, getExt } = ctx

	plugin.registerEvent(
		plugin.app.workspace.on('editor-paste', async (evt, editor: Editor) => {
			try {
				const items = evt.clipboardData?.items
				if (!items || items.length === 0) return

				const imageItems = Array.from(items).filter(
					it => it.kind === 'file' && it.type.startsWith('image/')
				)
				if (imageItems.length > 0) {
					// 阻止默认粘贴行为（批量）
					evt.preventDefault()

					for (const fileItem of imageItems) {
						const file = fileItem.getAsFile()
						if (!file) continue

						const placeholder = `![Uploading ${file.name}...]()`
						const startPos = editor.getCursor()
						editor.replaceSelection(placeholder)
						const endPos = editor.getCursor()

						const arrayBuffer = await file.arrayBuffer()
						const base64 = Buffer.from(arrayBuffer).toString('base64')
						const mime = file.type || 'application/octet-stream'

						// Check if compression is enabled
						const shouldCompress = window.__obS3_enableImageCompression__ ?? true
						let uploadBase64 = base64
						let uploadMime = mime
						if (shouldCompress && mime.startsWith('image/') && !mime.includes('svg')) {
							const maxDim = window.__obS3_maxImageDimension__ ?? 1920
							const quality = (window.__obS3_imageQuality__ ?? 85) / 100
							try {
								const resized = await resizeImage(base64, mime, maxDim, quality)
								uploadBase64 = resized
							} catch {
								// If compression fails, use original
							}
						}

						const ext = getExt(mime)

						const config = loadS3Config(plugin)
						const uploadId = generateUploadId()
						const key = makeObjectKey(file.name, ext, config.keyPrefix || '', uploadId)

						const maxMB = window.__obS3_maxUploadMB__ ?? 5
						const limitBytes = Math.max(1, Number(maxMB)) * 1024 * 1024
						if (file.size > limitBytes) {
							const ok = confirm(
								`File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds limit (${maxMB}MB). Continue upload?`
							)
							if (!ok) {
								editor.replaceRange('', startPos, endPos)
								new Notice('Upload canceled: file too large')
								continue
							}
						}

						let finalUrl = ''
						const startTime = Date.now()
						try {
							finalUrl = await performUpload(plugin, {
								key,
								mime: uploadMime,
								base64: uploadBase64,
								fileName: file.name,
								uploadId,
							})
						} catch (e: unknown) {
							const errorMsg = getErrorMessage(e)
							const errorType = getErrorType(e)
							stashFailed(uploadId, { key, mime: uploadMime, base64: uploadBase64, fileName: file.name })
							editor.replaceRange(
								`![${file.name} ob-s3:id=${uploadId} status=failed](#) [Retry](#)`,
								startPos,
								endPos
							)
							new Notice(tp('Upload failed: {error}', { error: errorMsg }))
							await activityLog.add(plugin.app, 'upload_error', {
								error: errorMsg,
								fileName: file.name,
								source: 'paste',
								errorType,
							})
							continue
						}

						const markdownLink = `![${file.name}](${finalUrl})`
						const currentText = editor.getRange(startPos, endPos)
						if (currentText === placeholder) {
							editor.replaceRange(markdownLink, startPos, endPos)
						} else {
							editor.replaceSelection(markdownLink)
						}

						const durationInSeconds = ((Date.now() - startTime) / 1000).toFixed(2)
						const sizeMB = (file.size / 1024 / 1024).toFixed(2)
						new Notice(
							tp('Upload successful! Time: {duration}s, Size: {size}MB', {
								duration: durationInSeconds,
								size: sizeMB,
							})
						)
						await activityLog.add(plugin.app, 'upload_success', {
							url: finalUrl,
							fileName: file.name,
							source: 'paste',
							size: file.size,
							duration: parseFloat(durationInSeconds),
						})
					}
					return
				}

				// Check for image URL in text/plain
				const textItem = Array.from(items).find(
					it => it.kind === 'string' && it.type === 'text/plain'
				)
				if (textItem) {
					const pastedText = await new Promise<string>((resolve) => {
						textItem.getAsString(resolve)
					})
					const trimmed = pastedText.trim()

					// Check if the pasted text is an image URL or data URL
					const imageUrlRegex = /^(https?:\/\/\S+\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?\S*)?)$/i
					const dataUrlRegex = /^data:image\//i
					const match = trimmed.match(imageUrlRegex)
					const isDataUrl = dataUrlRegex.test(trimmed)

					if (!match && !isDataUrl) return

					evt.preventDefault()

					const url = trimmed
					const ext = match ? match[2].toLowerCase() : 'png'
					const fileName = url.split('/').pop()?.split('?')[0] || `image-${Date.now()}.${ext}`

					const placeholder = `![Uploading ${fileName}...]()`
					const startPos = editor.getCursor()
					editor.replaceSelection(placeholder)
					const endPos = editor.getCursor()

					try {
						const controller = new AbortController()
						const timer = setTimeout(() => controller.abort(), 10000)
						const response = await fetch(url, { signal: controller.signal })
						clearTimeout(timer)

						if (!response.ok) throw new Error(`HTTP ${response.status}`)

						const contentType = response.headers.get('Content-Type') || 'application/octet-stream'
						const arrayBuffer = await response.arrayBuffer()
						const base64 = Buffer.from(arrayBuffer).toString('base64')
						const mime = contentType.startsWith('image/') ? contentType : `image/${ext}`

						const config = loadS3Config(plugin)
						const uploadId = generateUploadId()
						const fileExt = getExt(mime)
						const key = makeObjectKey(fileName, fileExt, config.keyPrefix || '', uploadId)

						let uploadBase64 = base64
						let uploadMime = mime
						const shouldCompress = window.__obS3_enableImageCompression__ ?? true
						if (shouldCompress && mime.startsWith('image/') && !mime.includes('svg') && !mime.includes('gif')) {
							const maxDim = window.__obS3_maxImageDimension__ ?? 1920
							const quality = (window.__obS3_imageQuality__ ?? 85) / 100
							try {
								uploadBase64 = await resizeImage(base64, mime, maxDim, quality)
							} catch {
								// If compression fails, use original
							}
						}

						const finalUrl = await performUpload(plugin, {
							key,
							mime: uploadMime,
							base64: uploadBase64,
							fileName,
							uploadId,
						})

						const markdownLink = `![${fileName}](${finalUrl})`
						const currentText = editor.getRange(startPos, endPos)
						if (currentText === placeholder) {
							editor.replaceRange(markdownLink, startPos, endPos)
						} else {
							editor.replaceSelection(markdownLink)
						}

						new Notice(`URL image uploaded: ${fileName}`)
						await activityLog.add(plugin.app, 'upload_success', {
							url: finalUrl,
							fileName,
							source: 'paste',
						})
					} catch (e: unknown) {
						const errorMsg = getErrorMessage(e)
						new Notice(tp('URL upload failed: {error}', { error: errorMsg }))
						editor.replaceRange('', startPos, endPos)
						await activityLog.add(plugin.app, 'upload_error', {
							error: errorMsg,
							fileName,
							source: 'paste',
							errorType: getErrorType(e),
						})
					}
				}
			} catch (e: unknown) {
				const errorMsg = getErrorMessage(e)
				const errorType = getErrorType(e)
				new Notice(tp('Upload failed: {error}', { error: errorMsg }))
				await activityLog.add(plugin.app, 'upload_error', {
					error: errorMsg,
					source: 'paste_unexpected',
					errorType,
				})
			}
		})
	)
}
