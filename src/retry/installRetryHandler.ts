// 概述: 安装“失败占位中的重试”点击拦截，结合乐观占位协议查找 uploadId 并回调调用方执行重试逻辑。
// 导出: installRetryHandler(plugin: Plugin, onRetry: (params: { editor: Editor; uploadId: string }) => Promise<void> | void): { uninstall: () => void }
// 依赖: Obsidian Editor/MarkdownView（运行期），占位正则与协议复用 optimistic 模块逻辑
// 用法:
//   const retry = installRetryHandler(plugin, async ({ editor, uploadId }) => { ... });
//   plugin.register(() => retry.uninstall());
// 相关: [src/uploader/optimistic.ts()](src/uploader/optimistic.ts:1), [src/paste/installPasteHandler.ts()](src/paste/installPasteHandler.ts:1)

import type { Editor, Plugin } from 'obsidian'
import { MarkdownView } from 'obsidian'

// 与 optimistic.ts 中保持一致的失败占位匹配
const PLACEHOLDER_NAMESPACE = 'ob-s3'
const RE_FAILED = new RegExp(
	String.raw`!\[[^\]]*?\b${PLACEHOLDER_NAMESPACE}:id=([A-Za-z0-9_-]+)\s+status=failed[^\]]*?\]\((?:#|https?:\/\/[^\)]+|blob:[^\)]+|[^)]+)?\)\s*\[([^\]]*?)\]\(#\)`,
	'm'
)

export function installRetryHandler(
	plugin: Plugin,
	onRetry: (params: { editor: Editor; uploadId: string }) => Promise<void> | void
): { uninstall: () => void } {
	const onMouseDown = (evt: MouseEvent) => {
		try {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)
			if (!view) return
			const editor: Editor = view.editor
			if (!editor) return


			setTimeout(() => {
				try {
					const pos = editor.getCursor()
					const lineText = editor.getLine(pos.line) ?? ''
					if (!lineText.includes('status=failed') || !lineText.includes('](#)')) return

					// matchAll 遍历所有匹配，按光标列定位点击的占位符
					const re = new RegExp(RE_FAILED.source, 'gm')
					let uploadId: string | null = null
					for (const m of lineText.matchAll(re)) {
						if (m.index !== undefined && pos.ch >= m.index && pos.ch <= m.index + m[0].length) {
							uploadId = m[1]
							break
						}
					}
					if (!uploadId) return

					evt.preventDefault()
					evt.stopPropagation()

					onRetry({ editor, uploadId })
				} catch (e) {
					console.warn('[ob-s3] retry handler error', e)
				}
			}, 0)
		} catch (e) {
			console.warn('[ob-s3] retry mousedown handler error', e)
		}
	}

		const leaf = plugin.app.workspace.getMostRecentLeaf?.()
	const containerEl: HTMLElement =
		(leaf?.view?.containerEl as HTMLElement) ??
		document.body

	containerEl.addEventListener('mousedown', onMouseDown, true)

	return {
		uninstall: () => {
			containerEl.removeEventListener('mousedown', onMouseDown, true)
		},
	}
}
