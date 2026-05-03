// 概述: 声明式设置渲染器 — 根据 SettingFieldDef[] 自动生成设置 UI
// 导出: renderSettings(containerEl, title, fields, plugin, open?)
// 依赖: Obsidian Setting 组件, settingsSchema.ts

import { Setting } from 'obsidian'
import type MyPlugin from '../../main'
import type { SettingFieldDef } from './settingsSchema'

export function renderSettings(
	containerEl: HTMLElement,
	title: string,
	fields: SettingFieldDef[],
	plugin: MyPlugin,
	open = true
): void {
	const details = containerEl.createEl('details', { cls: 'ob-s3-settings-section' })
	if (open) details.setAttribute('open', '')

	details.createEl('summary', { text: title })

	const body = details.createDiv('ob-s3-settings-body')

	for (const field of fields) {
		const current = (plugin.settings as Record<string, unknown>)[field.key] ?? field.defaultValue

		const setting = new Setting(body).setName(field.label).setDesc(field.desc)

		switch (field.type) {
			case 'toggle':
				setting.addToggle(toggle =>
					toggle.setValue(Boolean(current)).onChange(async v => {
						;(plugin.settings as Record<string, unknown>)[field.key] = v
						await plugin.saveSettings()
					})
				)
				break
			case 'slider':
				setting.addSlider(slider =>
					slider
						.setLimits(field.min ?? 0, field.max ?? 100, field.step ?? 1)
						.setValue(current as number)
						.setDynamicTooltip()
						.onChange(async v => {
							;(plugin.settings as Record<string, unknown>)[field.key] = v
							await plugin.saveSettings()
						})
				)
				break
			case 'text':
				setting.addText(text =>
					text
						.setPlaceholder(field.placeholder ?? '')
						.setValue(String(current))
						.onChange(async v => {
							;(plugin.settings as Record<string, unknown>)[field.key] = v
							await plugin.saveSettings()
						})
				)
				break
		}
	}
}
