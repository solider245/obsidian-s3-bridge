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

				const fileItem = Array.from(items).find(
					it => it.kind === 'file' && it.type.startsWith('image/')
				)
				if (!fileItem) return

				const file = fileItem.getAsFile()
				if (!file) return

				// 阻止默认粘贴行为
				evt.preventDefault()

				const placeholder = `![Uploading ${file.name}...]()`
				const startPos = editor.getCursor()
				editor.replaceSelection(placeholder)
				const endPos = editor.getCursor()

				const arrayBuffer = await file.arrayBuffer()
				const base64 = Buffer.from(arrayBuffer).toString('base64')
				const mime = file.type || 'application/octet-stream'
				const ext = getExt(mime)

				const config = loadS3Config(plugin)
				const uploadId = generateUploadId()
				const key = makeObjectKey(file.name, ext, config.keyPrefix || '', uploadId)

				let finalUrl = ''
				const startTime = Date.now()
				try {
					finalUrl = await performUpload(plugin, {
						key,
						mime,
						base64,
						fileName: file.name,
						uploadId,
					})
				} catch (e: unknown) {
					const errorMsg = getErrorMessage(e)
					const errorType = getErrorType(e)
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
					return
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
