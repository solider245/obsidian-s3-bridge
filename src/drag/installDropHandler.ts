// 概述: 安装 editor-drop 监听，拖拽图片到编辑器时上传并替换为 Markdown 链接。
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

export interface DropCtx {
	plugin: Plugin
	getExt: (mime: string) => string
}

export function installDropHandler(ctx: DropCtx): void {
	const { plugin, getExt } = ctx

	plugin.registerEvent(
		plugin.app.workspace.on('editor-drop', async (evt: DragEvent, editor: Editor) => {
			try {
				const files = evt.dataTransfer?.files
				if (!files || files.length === 0) return

				const allFiles = Array.from(files)
				const imageFiles = allFiles.filter(f => f.type.startsWith('image/'))
				if (imageFiles.length === 0) return

				// 检查拖拽上传开关
				if (!(window.__obS3_enableDragDrop__ ?? true)) return

				// 阻止默认拖拽行为
				evt.preventDefault()

				// 混合拖拽：提示跳过的非图片文件
				if (imageFiles.length < allFiles.length) {
					const skipped = allFiles.filter(f => !f.type.startsWith('image/'))
					const names = skipped.map(f => f.name).join(', ')
					new Notice('Skipped non-image files: ' + names)
				}

				const config = loadS3Config(plugin)
				const maxMB = window.__obS3_maxUploadMB__ ?? 5
				const limitBytes = Math.max(1, Number(maxMB)) * 1024 * 1024

				for (const file of imageFiles) {
					const placeholder = `![Uploading ${file.name}...]()`
					const startPos = editor.getCursor()
					editor.replaceSelection(placeholder)
					const endPos = editor.getCursor()

					const arrayBuffer = await file.arrayBuffer()
					const base64 = Buffer.from(arrayBuffer).toString('base64')
					const mime = file.type || 'application/octet-stream'

					// Compression
					const shouldCompress = window.__obS3_enableImageCompression__ ?? true
					let uploadBase64 = base64
					let uploadMime = mime
					if (shouldCompress && mime.startsWith('image/') && !mime.includes('svg')) {
						const maxDim = window.__obS3_maxImageDimension__ ?? 1920
						const quality = (window.__obS3_imageQuality__ ?? 85) / 100
						try {
							uploadBase64 = await resizeImage(base64, mime, maxDim, quality)
						} catch {
							// Use original if compression fails
						}
					}

					const ext = getExt(mime)
					const uploadId = generateUploadId()
					const key = makeObjectKey(file.name, ext, config.keyPrefix || '', uploadId)

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
							source: 'drop',
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
						source: 'drop',
						size: file.size,
						duration: parseFloat(durationInSeconds),
					})
				}
			} catch (e: unknown) {
				const errorMsg = getErrorMessage(e)
				const errorType = getErrorType(e)
				new Notice(tp('Upload failed: {error}', { error: errorMsg }))
				await activityLog.add(plugin.app, 'upload_error', {
					error: errorMsg,
					source: 'drop_unexpected',
					errorType,
				})
			}
		})
	)
}
