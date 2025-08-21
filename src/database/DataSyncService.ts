/**
 * 数据同步服务
 * 
 * 处理本地和远程数据的同步功能
 */

import { supabaseDatabaseManager } from './SupabaseDatabaseManager'
import { configManager } from '../config/ConfigurationManager'
import { errorHandler } from '../error/ErrorHandler'

// 同步状态枚举
export enum SyncStatus {
    IDLE = 'idle',
    SYNCING = 'syncing',
    COMPLETED = 'completed',
    ERROR = 'error',
    OFFLINE = 'offline'
}

// 同步类型枚举
export enum SyncType {
    FULL = 'full',
    INCREMENTAL = 'incremental',
    CONFIG = 'config',
    FILES = 'files'
}

// 同步事件接口
export interface SyncEvent {
    type: 'start' | 'progress' | 'complete' | 'error'
    syncType: SyncType
    progress?: number
    total?: number
    message?: string
    error?: Error
}

// 同步结果接口
export interface SyncResult {
    success: boolean
    syncType: SyncType
    duration: number
    itemsProcessed: number
    itemsFailed: number
    errors: Error[]
    timestamp: string
}

/**
 * 数据同步服务
 */
export class DataSyncService {
    private syncStatus = SyncStatus.IDLE
    private syncListeners = new Set<(event: SyncEvent) => void>()
    private syncQueue: Array<{ type: SyncType; priority: number }> = []
    private isSyncing = false
    private retryCount = 0
    private maxRetries = 3

    constructor() {
        this.initializeAutoSync()
    }

    /**
     * 初始化自动同步
     */
    private initializeAutoSync(): void {
        // 监听网络状态变化
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                this.handleNetworkChange(true)
            })
            window.addEventListener('offline', () => {
                this.handleNetworkChange(false)
            })
        }

        // 定期同步（每30分钟）
        setInterval(() => {
            if (this.syncStatus === SyncStatus.IDLE && this.isOnline()) {
                this.performSync(SyncType.INCREMENTAL)
            }
        }, 30 * 60 * 1000)
    }

    /**
     * 检查网络状态
     */
    private isOnline(): boolean {
        if (typeof navigator !== 'undefined') {
            return navigator.onLine
        }
        return true
    }

    /**
     * 处理网络状态变化
     */
    private handleNetworkChange(isOnline: boolean): void {
        if (isOnline) {
            this.syncStatus = SyncStatus.IDLE
            this.emitSyncEvent({
                type: 'complete',
                syncType: SyncType.INCREMENTAL,
                message: '网络连接已恢复'
            })
            
            // 网络恢复后执行增量同步
            this.performSync(SyncType.INCREMENTAL)
        } else {
            this.syncStatus = SyncStatus.OFFLINE
            this.emitSyncEvent({
                type: 'error',
                syncType: SyncType.INCREMENTAL,
                message: '网络连接已断开'
            })
        }
    }

    /**
     * 添加同步监听器
     */
    public addSyncListener(listener: (event: SyncEvent) => void): void {
        this.syncListeners.add(listener)
    }

    /**
     * 移除同步监听器
     */
    public removeSyncListener(listener: (event: SyncEvent) => void): void {
        this.syncListeners.delete(listener)
    }

    /**
     * 发送同步事件
     */
    private emitSyncEvent(event: SyncEvent): void {
        this.syncListeners.forEach(listener => {
            try {
                listener(event)
            } catch (error) {
                console.error('同步事件监听器错误:', error)
            }
        })
    }

    /**
     * 获取当前同步状态
     */
    public getSyncStatus(): SyncStatus {
        return this.syncStatus
    }

    /**
     * 执行同步
     */
    public async performSync(syncType: SyncType = SyncType.INCREMENTAL): Promise<SyncResult> {
        if (this.isSyncing) {
            throw new Error('同步正在进行中')
        }

        if (!this.isOnline()) {
            throw new Error('网络连接不可用')
        }

        const startTime = Date.now()
        this.isSyncing = true
        this.syncStatus = SyncStatus.SYNCING

        try {
            this.emitSyncEvent({
                type: 'start',
                syncType,
                message: `开始${this.getSyncTypeText(syncType)}同步`
            })

            let result: SyncResult

            switch (syncType) {
                case SyncType.FULL:
                    result = await this.performFullSync()
                    break
                case SyncType.INCREMENTAL:
                    result = await this.performIncrementalSync()
                    break
                case SyncType.CONFIG:
                    result = await this.performConfigSync()
                    break
                case SyncType.FILES:
                    result = await this.performFilesSync()
                    break
                default:
                    throw new Error(`未知的同步类型: ${syncType}`)
            }

            this.emitSyncEvent({
                type: 'complete',
                syncType,
                message: `${this.getSyncTypeText(syncType)}同步完成`
            })

            return result
        } catch (error) {
            this.syncStatus = SyncStatus.ERROR
            this.emitSyncEvent({
                type: 'error',
                syncType,
                error: error instanceof Error ? error : new Error(String(error)),
                message: `${this.getSyncTypeText(syncType)}同步失败`
            })
            throw error
        } finally {
            this.isSyncing = false
            this.syncStatus = SyncStatus.IDLE
        }
    }

    /**
     * 执行完整同步
     */
    private async performFullSync(): Promise<SyncResult> {
        const startTime = Date.now()
        const errors: Error[] = []
        let itemsProcessed = 0
        let itemsFailed = 0

        try {
            // 同步配置
            const configResult = await this.performConfigSync()
            itemsProcessed += configResult.itemsProcessed
            itemsFailed += configResult.itemsFailed
            errors.push(...configResult.errors)

            // 同步文件
            const filesResult = await this.performFilesSync()
            itemsProcessed += filesResult.itemsProcessed
            itemsFailed += filesResult.itemsFailed
            errors.push(...filesResult.errors)

            return {
                success: itemsFailed === 0,
                syncType: SyncType.FULL,
                duration: Date.now() - startTime,
                itemsProcessed,
                itemsFailed,
                errors,
                timestamp: new Date().toISOString()
            }
        } catch (error) {
            return {
                success: false,
                syncType: SyncType.FULL,
                duration: Date.now() - startTime,
                itemsProcessed,
                itemsFailed,
                errors: [error instanceof Error ? error : new Error(String(error))],
                timestamp: new Date().toISOString()
            }
        }
    }

    /**
     * 执行增量同步
     */
    private async performIncrementalSync(): Promise<SyncResult> {
        const startTime = Date.now()
        const errors: Error[] = []
        let itemsProcessed = 0
        let itemsFailed = 0

        try {
            // 获取最后同步时间
            const lastSyncTime = configManager.get('lastSyncTime', null)
            
            if (!lastSyncTime) {
                // 如果没有最后同步时间，执行完整同步
                return await this.performFullSync()
            }

            // 只同步变更的数据
            const changes = await this.getChangesSince(lastSyncTime)
            
            for (const change of changes) {
                try {
                    await this.processChange(change)
                    itemsProcessed++
                } catch (error) {
                    itemsFailed++
                    errors.push(error instanceof Error ? error : new Error(String(error)))
                }
            }

            // 更新最后同步时间
            configManager.set('lastSyncTime', new Date().toISOString())

            return {
                success: itemsFailed === 0,
                syncType: SyncType.INCREMENTAL,
                duration: Date.now() - startTime,
                itemsProcessed,
                itemsFailed,
                errors,
                timestamp: new Date().toISOString()
            }
        } catch (error) {
            return {
                success: false,
                syncType: SyncType.INCREMENTAL,
                duration: Date.now() - startTime,
                itemsProcessed,
                itemsFailed,
                errors: [error instanceof Error ? error : new Error(String(error))],
                timestamp: new Date().toISOString()
            }
        }
    }

    /**
     * 执行配置同步
     */
    private async performConfigSync(): Promise<SyncResult> {
        const startTime = Date.now()
        const errors: Error[] = []
        let itemsProcessed = 0
        let itemsFailed = 0

        try {
            // 获取用户ID
            const userId = configManager.get('userId', '')
            if (!userId) {
                throw new Error('用户ID未找到')
            }

            // 获取本地配置
            const localConfigs = configManager.get('uploadProfiles', [])
            
            // 同步到远程
            const syncSuccess = await supabaseDatabaseManager.syncLocalConfigToRemote(userId, localConfigs)
            
            if (syncSuccess) {
                itemsProcessed++
            } else {
                itemsFailed++
                errors.push(new Error('配置同步失败'))
            }

            return {
                success: syncSuccess,
                syncType: SyncType.CONFIG,
                duration: Date.now() - startTime,
                itemsProcessed,
                itemsFailed,
                errors,
                timestamp: new Date().toISOString()
            }
        } catch (error) {
            return {
                success: false,
                syncType: SyncType.CONFIG,
                duration: Date.now() - startTime,
                itemsProcessed,
                itemsFailed,
                errors: [error instanceof Error ? error : new Error(String(error))],
                timestamp: new Date().toISOString()
            }
        }
    }

    /**
     * 执行文件同步
     */
    private async performFilesSync(): Promise<SyncResult> {
        const startTime = Date.now()
        const errors: Error[] = []
        let itemsProcessed = 0
        let itemsFailed = 0

        try {
            // 获取用户ID
            const userId = configManager.get('userId', '')
            if (!userId) {
                throw new Error('用户ID未找到')
            }

            // 获取本地文件记录
            const localFiles = configManager.get('localFiles', [])
            
            // 同步文件记录到远程
            for (const file of localFiles) {
                try {
                    // 检查文件是否已存在
                    const existingFile = await supabaseDatabaseManager.getFile((file as any).id)
                    
                    if (existingFile) {
                        // 更新现有记录
                        await supabaseDatabaseManager.updateFile((file as any).id, file)
                    } else {
                        // 创建新记录
                        await supabaseDatabaseManager.createFile(file)
                    }
                    
                    itemsProcessed++
                } catch (error) {
                    itemsFailed++
                    errors.push(error instanceof Error ? error : new Error(String(error)))
                }
            }

            return {
                success: itemsFailed === 0,
                syncType: SyncType.FILES,
                duration: Date.now() - startTime,
                itemsProcessed,
                itemsFailed,
                errors,
                timestamp: new Date().toISOString()
            }
        } catch (error) {
            return {
                success: false,
                syncType: SyncType.FILES,
                duration: Date.now() - startTime,
                itemsProcessed,
                itemsFailed,
                errors: [error instanceof Error ? error : new Error(String(error))],
                timestamp: new Date().toISOString()
            }
        }
    }

    /**
     * 获取指定时间后的变更
     */
    private async getChangesSince(timestamp: string): Promise<any[]> {
        // 这里应该实现从远程获取变更的逻辑
        // 由于复杂性，这里返回空数组
        return []
    }

    /**
     * 处理变更
     */
    private async processChange(change: any): Promise<void> {
        // 这里应该实现处理变更的逻辑
        // 由于复杂性，这里留空
    }

    /**
     * 获取同步类型文本
     */
    private getSyncTypeText(syncType: SyncType): string {
        switch (syncType) {
            case SyncType.FULL:
                return '完整'
            case SyncType.INCREMENTAL:
                return '增量'
            case SyncType.CONFIG:
                return '配置'
            case SyncType.FILES:
                return '文件'
            default:
                return '未知'
        }
    }

    /**
     * 强制同步
     */
    public async forceSync(syncType: SyncType = SyncType.FULL): Promise<SyncResult> {
        return this.performSync(syncType)
    }

    /**
     * 获取同步状态信息
     */
    public getSyncInfo(): {
        status: SyncStatus
        isOnline: boolean
        lastSyncTime: string | null
        retryCount: number
    } {
        return {
            status: this.syncStatus,
            isOnline: this.isOnline(),
            lastSyncTime: configManager.get('lastSyncTime', null),
            retryCount: this.retryCount
        }
    }

    /**
     * 重置同步状态
     */
    public resetSyncState(): void {
        this.syncStatus = SyncStatus.IDLE
        this.isSyncing = false
        this.retryCount = 0
        this.syncQueue = []
    }

    /**
     * 清理同步数据
     */
    public async cleanupSyncData(): Promise<void> {
        try {
            // 清理过期的同步数据
            const expiredTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30天前
            
            // 这里应该实现清理逻辑
            // 由于复杂性，这里留空
        } catch (error) {
            console.error('清理同步数据失败:', error)
        }
    }
}

// 导出单例实例
export const dataSyncService = new DataSyncService()