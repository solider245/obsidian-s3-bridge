/**
 * 概述: 插件主入口，仅负责装配与生命周期；功能逻辑在 src/* 子模块。
 * 导出: ObS3GeminiPlugin (默认导出)
 * 依赖入口:
 *   - [src/bootstrap/i18nBootstrap.ts.registerBuiltinPacksAndLoad()](src/bootstrap/i18nBootstrap.ts:1)
 *   - [settingsTab.ts.MyPluginSettingTab()](settingsTab.ts:1)
 *   - [src/commands/registerCommands.ts.registerCommands()](src/commands/registerCommands.ts:1)
 *   - [src/paste/installPasteHandler.ts.installPasteHandler()](src/paste/installPasteHandler.ts:1)
 *   - [src/retry/installRetryHandler.ts.installRetryHandler()](src/retry/installRetryHandler.ts:1)
 *   - [src/uploader/optimistic.ts.generateUploadId()](src/uploader/optimistic.ts:1)
 */

import { Notice, Plugin } from 'obsidian'
import { t, tp } from './src/l10n'
import { MyPluginSettingTab, MyPluginSettings, DEFAULT_SETTINGS } from './settingsTab'
import { registerCommands } from './src/commands/registerCommands'
import { installPasteHandler } from './src/paste/installPasteHandler'
import { getFileExtensionFromMime } from './src/core/mime'
import { readClipboardImageAsBase64 } from './src/core/readClipboard'
import { ensureWithinLimitOrConfirm } from './src/threshold/sizeGuard'
import {
	initUploadNotifications,
	cleanupUploadNotifications,
} from './src/utils/uploadNotifications'

// 统一从单一索引导入（分层聚合）
import { registerBuiltinPacksAndLoad } from './src/index'

// 导入Supabase相关模块
import { supabaseDatabaseManager } from './src/database/SupabaseDatabaseManager'
import { dataSyncService } from './src/database/DataSyncService'

export default class S3BridgePlugin extends Plugin {
	settings: MyPluginSettings

	async onload() {
		// 加载设置
		await this.loadSettings()
		await registerBuiltinPacksAndLoad(this)

		// 初始化上传通知系统
		initUploadNotifications(this)

		// 初始化Supabase功能
		this.initializeSupabase()

		this.addSettingTab(new MyPluginSettingTab(this.app, this))

		try {
			const ribbon = this.addRibbonIcon('cloud', t('S3 Bridge'), async () => {
				try {
					// @ts-ignore
					if (this.app?.setting?.open) this.app.setting.open()
					// @ts-ignore
					if (this.app?.setting?.openTabById && this.manifest?.id) {
						// @ts-ignore
						this.app.setting.openTabById(this.manifest.id)
					}
					new Notice(t('Opening settings...'))
				} catch (e: unknown) {
					new Notice(
						tp('Operation failed: {error}', { error: e instanceof Error ? e.message : String(e) })
					)
				}
			})
			ribbon?.setAttr('aria-label', t('S3 Bridge'))
		} catch (e) {
			console.warn('[ob-s3-gemini] addRibbonIcon failed:', e)
		}

		// 注册命令与粘贴处理（装配注入在其模块内部完成）
		registerCommands({
			plugin: this,
			getExt: getFileExtensionFromMime,
			readClipboardImageAsBase64,
			ensureWithinLimitOrConfirm,
		})

		installPasteHandler({
			plugin: this,
			getExt: getFileExtensionFromMime,
		})
	}

	async onunload() {
		try {
			// 清理上传通知系统
			cleanupUploadNotifications()

			// 清理Supabase相关资源
			this.cleanupSupabase()

			// 仅记录生命周期事件，便于压力测试观察是否存在多次卸载或未清理的幽灵监听
			// 使用结构化日志，后续如发现非托管资源，可在此处补充显式卸载
			console.info('[obsidian-s3-bridge][lifecycle] onunload invoked')
		} catch {
			/* ignore logging errors */
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	/**
	 * 初始化Supabase功能
	 */
	private initializeSupabase(): void {
		if (!this.settings.enableSupabaseSync) {
			console.log('[obsidian-s3-bridge] Supabase同步已禁用')
			return
		}

		try {
			// 检查Supabase配置
			if (!this.settings.supabaseUrl || !this.settings.supabaseKey) {
				console.warn('[obsidian-s3-bridge] Supabase配置不完整，跳过初始化')
				return
			}

			// 生成或获取用户ID
			if (!this.settings.userId) {
				this.settings.userId = this.generateUserId()
				this.saveSettings()
			}

			// 检查Supabase连接状态
			if (supabaseDatabaseManager.isConnectedToDatabase()) {
				console.log('[obsidian-s3-bridge] Supabase连接成功')

				// 添加同步状态监听器
				dataSyncService.addSyncListener(event => {
					this.handleSyncEvent(event)
				})

				// 如果启用自动同步，启动同步服务
				if (this.settings.enableAutoSync) {
					this.startAutoSync()
				}

				new Notice('Supabase云同步已启用')
			} else {
				console.warn('[obsidian-s3-bridge] Supabase连接失败')
				new Notice('Supabase连接失败，请检查配置')
			}
		} catch (error) {
			console.error('[obsidian-s3-bridge] Supabase初始化失败:', error)
			new Notice('Supabase初始化失败')
		}
	}

	/**
	 * 生成用户ID
	 */
	private generateUserId(): string {
		// 生成一个简单的用户ID，基于时间戳和随机数
		return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	/**
	 * 启动自动同步
	 */
	private startAutoSync(): void {
		if (!this.settings.enableAutoSync || !this.settings.syncInterval) {
			return
		}

		const intervalMs = this.settings.syncInterval * 60 * 1000

		// 清理现有的定时器
		if (this.syncTimer) {
			clearInterval(this.syncTimer)
		}

		// 设置新的定时器
		this.syncTimer = setInterval(async () => {
			try {
				await dataSyncService.performSync()
				console.log('[obsidian-s3-bridge] 自动同步完成')
			} catch (error) {
				console.error('[obsidian-s3-bridge] 自动同步失败:', error)
			}
		}, intervalMs)

		console.log(`[obsidian-s3-bridge] 自动同步已启动，间隔: ${this.settings.syncInterval}分钟`)
	}

	/**
	 * 处理同步事件
	 */
	private handleSyncEvent(event: any): void {
		switch (event.type) {
			case 'start':
				console.log(`[obsidian-s3-bridge] 同步开始: ${event.message}`)
				break
			case 'complete':
				console.log(`[obsidian-s3-bridge] 同步完成: ${event.message}`)
				break
			case 'error':
				console.error(`[obsidian-s3-bridge] 同步错误: ${event.message}`, event.error)
				break
		}
	}

	// 同步定时器
	private syncTimer: NodeJS.Timeout | null = null

	/**
	 * 清理Supabase相关资源
	 */
	private cleanupSupabase(): void {
		try {
			// 清理同步定时器
			if (this.syncTimer) {
				clearInterval(this.syncTimer)
				this.syncTimer = null
				console.log('[obsidian-s3-bridge] 同步定时器已清理')
			}

			// 重置同步服务状态
			dataSyncService.resetSyncState()
			console.log('[obsidian-s3-bridge] 同步服务状态已重置')
		} catch (error) {
			console.error('[obsidian-s3-bridge] 清理Supabase资源失败:', error)
		}
	}
}
