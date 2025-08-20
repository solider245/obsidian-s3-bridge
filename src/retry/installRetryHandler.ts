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
	String.raw`!\[[^\]]*?\b${PLACEHOLDER_NAMESPACE}:id=([A-Za-z0-9]{16})\s+status=failed[^\]]*?\]\((?:#|https?:\/\/[^\)]+|blob:[^\)]+|[^)]+)?\)\s*\[([^\]]*?)\]\(#\)`,
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

					const m = lineText.match(RE_FAILED)
					if (!m) return
					const uploadId = m[1]

					evt.preventDefault()
					evt.stopPropagation()
					onRetry({ editor, uploadId })
				} catch {
					// 静默处理重试过程中的错误
				}
			}, 0)
		} catch {
			// 静默处理鼠标事件处理错误
		}
	}

	const leaf = plugin.app.workspace.activeLeaf as any
	const containerEl: HTMLElement =
		(leaf?.view?.containerEl as HTMLElement) ??
		(plugin.app.workspace as any)?.containerEl ??
		document.body

	containerEl.addEventListener('mousedown', onMouseDown, true)

	return {
		uninstall: () => {
			containerEl.removeEventListener('mousedown', onMouseDown, true)
		},
	}
}

export default { installRetryHandler }
