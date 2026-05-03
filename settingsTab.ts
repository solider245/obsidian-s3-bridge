import { App, PluginSettingTab } from 'obsidian'
import MyPlugin from './main'
import { renderProfilesSection, renderProfileForm } from './src/settings/profileManager'
import { renderActivityLogSection } from './src/settings/uiComponents'
import { renderSettings } from './src/settings/settingsRenderer'
import {
	UPLOAD_SETTINGS,
	PROGRESS_SETTINGS,
	INTERFACE_SETTINGS,
	RETRY_SETTINGS,
	SUPABASE_SETTINGS,
} from './src/settings/settingsSchema'

export interface MyPluginSettings {
	enableTempLocal?: boolean
	tempPrefix?: string
	tempDir?: string

	enableBatchUpload?: boolean
	maxConcurrentUploads?: number
	enableDragDrop?: boolean
	maxUploadSize?: number

	showUploadNotifications?: boolean
	notificationThreshold?: number
	showSpeedUpdates?: boolean
	showCompletionAlerts?: boolean
	showErrorDetails?: boolean

	enableSpeedChart?: boolean
	enableEnhancedStats?: boolean
	autoStartUpload?: boolean

	retryFailedUploads?: boolean
	maxRetries?: number
	retryDelay?: number

	enableSupabaseSync?: boolean
	supabaseUrl?: string
	supabaseKey?: string
	enableAutoSync?: boolean
	syncInterval?: number
	userId?: string
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	enableTempLocal: false,
	tempPrefix: 'temp_upload_',
	tempDir: '.assets',

	enableBatchUpload: true,
	maxConcurrentUploads: 2,
	enableDragDrop: true,
	maxUploadSize: 50,

	showUploadNotifications: true,
	notificationThreshold: 10,
	showSpeedUpdates: false,
	showCompletionAlerts: true,
	showErrorDetails: true,

	enableSpeedChart: true,
	enableEnhancedStats: true,
	autoStartUpload: false,

	retryFailedUploads: true,
	maxRetries: 3,
	retryDelay: 1000,

	enableSupabaseSync: false,
	supabaseUrl: '',
	supabaseKey: '',
	enableAutoSync: true,
	syncInterval: 30,
	userId: '',
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

		renderSettings(containerEl, '上传设置', UPLOAD_SETTINGS, this.plugin)
		renderSettings(containerEl, '进度反馈', PROGRESS_SETTINGS, this.plugin)
		renderSettings(containerEl, '界面设置', INTERFACE_SETTINGS, this.plugin)
		renderSettings(containerEl, '重试设置', RETRY_SETTINGS, this.plugin)
		renderSettings(containerEl, 'Supabase 云同步', SUPABASE_SETTINGS, this.plugin)

		renderActivityLogSection(this.app, containerEl)
	}
}
