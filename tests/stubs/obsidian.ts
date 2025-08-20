export class Notice {
	constructor(
		public message?: string,
		public timeout?: number
	) {}
	hide() {}
}

export class App {}
export class Plugin {}

// 最小可用的 Editor stub，支持按行读写，满足 optimistic.findAndReplaceByUploadId 的使用
export class Editor {
	private _lines: string[]
	private _cursor = { line: 0, ch: 0 }

	constructor(text = '') {
		this._lines = text.split(/\r?\n/)
	}

	// 供测试辅助：设置与获取全文
	setValue(text: string) {
		this._lines = text.split(/\r?\n/)
	}
	getValue(): string {
		return this._lines.join('\n')
	}

	// findAndReplaceByUploadId 需要的方法
	lineCount(): number {
		return this._lines.length
	}
	getLine(i: number): string {
		return this._lines[i] ?? ''
	}
	setLine(i: number, text: string) {
		// 简化处理：超出时填充空行
		while (i >= this._lines.length) this._lines.push('')
		this._lines[i] = text
	}

	// 其它常见方法占位
	getCursor() {
		return { ...this._cursor }
	}
	setCursor(line: number, ch = 0) {
		this._cursor = { line, ch }
	}

	replaceSelection(_text: string) {
		// 简化：不实现选择替换逻辑
	}
}

export const moment = (..._args: any[]) => ({}) as any
