import { App, PluginSettingTab } from 'obsidian'
import MyPlugin from './main'
import { renderProfilesSection, renderProfileForm } from './src/settings/profileManager'
import { renderActions, renderActivityLogSection } from './src/settings/uiComponents'

export interface MyPluginSettings {
	enableTempLocal?: boolean
	tempPrefix?: string
	tempDir?: string
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	enableTempLocal: false,
	tempPrefix: 'temp_upload_',
	tempDir: '.assets',
}

export class MyPluginSettingTab extends PluginSettingTab {
	plugin: MyPlugin

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const { containerEl } = this
		containerEl.empty()

		renderProfilesSection(this.plugin, containerEl, () => this.display())
		renderProfileForm(this.plugin, containerEl, () => this.display())
		renderActions(containerEl)
		renderActivityLogSection(this.app, containerEl)
	}
}
