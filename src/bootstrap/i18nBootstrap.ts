// 概述: 负责注册内置语言资源并加载翻译（含 zh-cn/zh-CN 兼容），供主入口在 onload 早期调用。
// 导出: registerBuiltinPacksAndLoad(plugin: Plugin): Promise<void>
// 依赖: [src/l10n.ts()](src/l10n.ts:1)
// 用法:
//   await registerBuiltinPacksAndLoad(this);
// 相关: [main.ts()](main.ts:1)

import type { Plugin } from 'obsidian'
import { loadTranslations, registerBuiltinLang } from '../l10n'

// 采用 require 避免 TS 对 json import 的报错；运行时若未打包则静默回退英文
function safeLoadZhCN(): any {
	let pack: any = {}
	try {
		// @ts-ignore
		pack = require('../lang/zh-CN.json')
	} catch {
		// ignore if zh-CN not bundled
	}
	return pack
}

/**
 * 注册内置语言并加载当前语言翻译。
 * - 兼容 zh-cn 与 zh-CN 两种标识
 * - 允许后续通过 settingsTab 的 custom-lang.json 覆盖
 */
export async function registerBuiltinPacksAndLoad(plugin: Plugin): Promise<void> {
	const zh = safeLoadZhCN()
	registerBuiltinLang('zh-cn', zh)
	registerBuiltinLang('zh-CN', zh)
	await loadTranslations(plugin)
}

export default { registerBuiltinPacksAndLoad }
