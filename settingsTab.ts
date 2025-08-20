import { App, PluginSettingTab, Setting } from 'obsidian'
import MyPlugin from './main'
import { renderProfilesSection, renderProfileForm } from './src/settings/profileManager'
import { renderActions, renderActivityLogSection } from './src/settings/uiComponents'
import { t } from './src/l10n'

export interface MyPluginSettings {
	// 原有设置
	enableTempLocal?: boolean
	tempPrefix?: string
	tempDir?: string
	
	// 新增的上传设置
	enableBatchUpload?: boolean
	maxConcurrentUploads?: number
	enableDragDrop?: boolean
	maxUploadSize?: number
	
	// 进度反馈设置
	showUploadNotifications?: boolean
	notificationThreshold?: number
	showSpeedUpdates?: boolean
	showCompletionAlerts?: boolean
	showErrorDetails?: boolean
	
	// 界面设置
	enableSpeedChart?: boolean
	enableEnhancedStats?: boolean
	autoStartUpload?: boolean
	
	// 重试设置
	retryFailedUploads?: boolean
	maxRetries?: number
	retryDelay?: number
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	enableTempLocal: false,
	tempPrefix: 'temp_upload_',
	tempDir: '.assets',
	
	// 新增上传设置
	enableBatchUpload: true,
	maxConcurrentUploads: 3,
	enableDragDrop: true,
	maxUploadSize: 50, // MB
	
	// 进度反馈设置
	showUploadNotifications: true,
	notificationThreshold: 10,
	showSpeedUpdates: false,
	showCompletionAlerts: true,
	showErrorDetails: true,
	
	// 界面设置
	enableSpeedChart: true,
	enableEnhancedStats: true,
	autoStartUpload: false,
	
	// 重试设置
	retryFailedUploads: true,
	maxRetries: 3,
	retryDelay: 1000,
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

		// 服务配置部分
		renderProfilesSection(this.plugin, containerEl, () => this.display())
		renderProfileForm(this.plugin, containerEl, () => this.display())
		
		// 新增：上传设置部分
		this.renderUploadSettings()
		
		// 新增：进度反馈设置部分
		this.renderProgressSettings()
		
		// 新增：界面设置部分
		this.renderInterfaceSettings()
		
		// 新增：重试设置部分
		this.renderRetrySettings()
		
		// 原有设置
		renderActions(containerEl)
		renderActivityLogSection(this.app, containerEl)
	}

	/**
	 * 渲染上传设置
	 */
	private renderUploadSettings(): void {
		const { containerEl } = this
		
		containerEl.createEl('h3', { text: '上传设置' })
		
		// 启用批量上传
		new Setting(containerEl)
			.setName('启用批量上传')
			.setDesc('允许同时上传多个文件')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableBatchUpload ?? DEFAULT_SETTINGS.enableBatchUpload!)
				.onChange(async (value) => {
					this.plugin.settings.enableBatchUpload = value
					await this.plugin.saveSettings()
				})
			)
		
		// 最大并发上传数
		new Setting(containerEl)
			.setName('最大并发上传数')
			.setDesc('同时上传的最大文件数量')
			.addSlider(slider => slider
				.setLimits(1, 10, 1)
				.setValue(this.plugin.settings.maxConcurrentUploads ?? DEFAULT_SETTINGS.maxConcurrentUploads!)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxConcurrentUploads = value
					await this.plugin.saveSettings()
				})
			)
		
		// 启用拖拽上传
		new Setting(containerEl)
			.setName('启用拖拽上传')
			.setDesc('允许通过拖拽文件到编辑器进行上传')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDragDrop ?? DEFAULT_SETTINGS.enableDragDrop!)
				.onChange(async (value) => {
					this.plugin.settings.enableDragDrop = value
					await this.plugin.saveSettings()
				})
			)
		
		// 最大上传文件大小
		new Setting(containerEl)
			.setName('最大上传文件大小')
			.setDesc('单个文件的最大大小（MB）')
			.addSlider(slider => slider
				.setLimits(1, 500, 1)
				.setValue(this.plugin.settings.maxUploadSize ?? DEFAULT_SETTINGS.maxUploadSize!)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxUploadSize = value
					await this.plugin.saveSettings()
				})
			)
	}

	/**
	 * 渲染进度反馈设置
	 */
	private renderProgressSettings(): void {
		const { containerEl } = this
		
		containerEl.createEl('h3', { text: '进度反馈设置' })
		
		// 显示上传通知
		new Setting(containerEl)
			.setName('显示上传通知')
			.setDesc('在上传过程中显示通知')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showUploadNotifications ?? DEFAULT_SETTINGS.showUploadNotifications!)
				.onChange(async (value) => {
					this.plugin.settings.showUploadNotifications = value
					await this.plugin.saveSettings()
				})
			)
		
		// 通知阈值
		new Setting(containerEl)
			.setName('通知阈值（秒）')
			.setDesc('进度通知的最小间隔时间')
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.settings.notificationThreshold ?? DEFAULT_SETTINGS.notificationThreshold!)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.notificationThreshold = value
					await this.plugin.saveSettings()
				})
			)
		
		// 显示速度更新
		new Setting(containerEl)
			.setName('显示速度更新')
			.setDesc('在通知中显示上传速度变化')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showSpeedUpdates ?? DEFAULT_SETTINGS.showSpeedUpdates!)
				.onChange(async (value) => {
					this.plugin.settings.showSpeedUpdates = value
					await this.plugin.saveSettings()
				})
			)
		
		// 显示完成提醒
		new Setting(containerEl)
			.setName('显示完成提醒')
			.setDesc('上传完成时显示提醒通知')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showCompletionAlerts ?? DEFAULT_SETTINGS.showCompletionAlerts!)
				.onChange(async (value) => {
					this.plugin.settings.showCompletionAlerts = value
					await this.plugin.saveSettings()
				})
			)
		
		// 显示错误详情
		new Setting(containerEl)
			.setName('显示错误详情')
			.setDesc('在错误通知中显示详细信息')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showErrorDetails ?? DEFAULT_SETTINGS.showErrorDetails!)
				.onChange(async (value) => {
					this.plugin.settings.showErrorDetails = value
					await this.plugin.saveSettings()
				})
			)
	}

	/**
	 * 渲染界面设置
	 */
	private renderInterfaceSettings(): void {
		const { containerEl } = this
		
		containerEl.createEl('h3', { text: '界面设置' })
		
		// 启用速度图表
		new Setting(containerEl)
			.setName('启用速度图表')
			.setDesc('在上传界面显示实时速度图表')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSpeedChart ?? DEFAULT_SETTINGS.enableSpeedChart!)
				.onChange(async (value) => {
					this.plugin.settings.enableSpeedChart = value
					await this.plugin.saveSettings()
				})
			)
		
		// 启用增强统计
		new Setting(containerEl)
			.setName('启用增强统计')
			.setDesc('显示详细的上传统计信息')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableEnhancedStats ?? DEFAULT_SETTINGS.enableEnhancedStats!)
				.onChange(async (value) => {
					this.plugin.settings.enableEnhancedStats = value
					await this.plugin.saveSettings()
				})
			)
		
		// 自动开始上传
		new Setting(containerEl)
			.setName('自动开始上传')
			.setDesc('添加文件后自动开始上传')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoStartUpload ?? DEFAULT_SETTINGS.autoStartUpload!)
				.onChange(async (value) => {
					this.plugin.settings.autoStartUpload = value
					await this.plugin.saveSettings()
				})
			)
	}

	/**
	 * 渲染重试设置
	 */
	private renderRetrySettings(): void {
		const { containerEl } = this
		
		containerEl.createEl('h3', { text: '重试设置' })
		
		// 重试失败上传
		new Setting(containerEl)
			.setName('重试失败上传')
			.setDesc('上传失败时自动重试')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.retryFailedUploads ?? DEFAULT_SETTINGS.retryFailedUploads!)
				.onChange(async (value) => {
					this.plugin.settings.retryFailedUploads = value
					await this.plugin.saveSettings()
				})
			)
		
		// 最大重试次数
		new Setting(containerEl)
			.setName('最大重试次数')
			.setDesc('失败上传的最大重试次数')
			.addSlider(slider => slider
				.setLimits(0, 10, 1)
				.setValue(this.plugin.settings.maxRetries ?? DEFAULT_SETTINGS.maxRetries!)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxRetries = value
					await this.plugin.saveSettings()
				})
			)
		
		// 重试延迟
		new Setting(containerEl)
			.setName('重试延迟（毫秒）')
			.setDesc('重试前的等待时间')
			.addSlider(slider => slider
				.setLimits(100, 10000, 100)
				.setValue(this.plugin.settings.retryDelay ?? DEFAULT_SETTINGS.retryDelay!)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.retryDelay = value
					await this.plugin.saveSettings()
				})
			)
	}
}
