/**
 * 实时通知系统
 * 
 * 提供智能的通知管理，避免通知轰炸，支持不同类型的通知
 */

import { enhancedProgressManager, EnhancedProgressUpdate } from './enhancedProgress'
import { configManager } from '../config/ConfigurationManager'
import { Notice } from 'obsidian'

export interface NotificationConfig {
  enabled: boolean
  type: 'toast' | 'modal' | 'status-bar' | 'silent'
  priority: 'low' | 'medium' | 'high' | 'critical'
  duration: number
  sound?: boolean
  vibration?: boolean
  groupable: boolean
  maxConcurrent: number
}

export interface NotificationMessage {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  details?: string
  actions?: NotificationAction[]
  timestamp: number
  progress?: number
  dismissible: boolean
  config: NotificationConfig
}

export interface NotificationAction {
  label: string
  action: () => void
  style?: 'default' | 'primary' | 'warning' | 'destructive'
}

export interface NotificationGroup {
  id: string
  title: string
  messages: NotificationMessage[]
  config: NotificationConfig
  createdAt: number
  updatedAt: number
}

/**
 * 智能通知管理器
 */
export class SmartNotificationManager {
  private activeNotifications = new Map<string, NotificationMessage>()
  private notificationGroups = new Map<string, NotificationGroup>()
  private notificationHistory: NotificationMessage[] = []
  private maxHistorySize = 100
  private debouncedTimers = new Map<string, number>()

  constructor() {
    // 监听进度更新
    enhancedProgressManager.addListener(this.handleProgressUpdate.bind(this))
  }

  /**
   * 处理进度更新
   */
  private handleProgressUpdate(update: EnhancedProgressUpdate): void {
    const config = this.getNotificationConfig(update.stage)
    
    if (!config.enabled) return

    switch (update.stage) {
      case 'preparing':
        this.showUploadStartNotification(update, config)
        break
      case 'uploading':
        this.showUploadProgressNotification(update, config)
        break
      case 'completed':
        this.showUploadCompleteNotification(update, config)
        break
      case 'error':
        this.showUploadErrorNotification(update, config)
        break
      case 'paused':
        this.showUploadPausedNotification(update, config)
        break
    }
  }

  /**
   * 显示上传开始通知
   */
  private showUploadStartNotification(update: EnhancedProgressUpdate, config: NotificationConfig): void {
    const message: NotificationMessage = {
      id: `upload_start_${update.id}`,
      type: 'info',
      title: '开始上传',
      message: `正在上传: ${update.fileName}`,
      details: `文件大小: ${this.formatSize(update.fileSize)}`,
      timestamp: Date.now(),
      dismissible: true,
      config
    }

    this.showNotification(message)
  }

  /**
   * 显示上传进度通知
   */
  private showUploadProgressNotification(update: EnhancedProgressUpdate, config: NotificationConfig): void {
    // 防抖处理，避免频繁通知
    const debounceKey = `progress_${update.id}`
    const lastTime = this.debouncedTimers.get(debounceKey) || 0
    const now = Date.now()
    
    if (now - lastTime < 5000) return // 5秒内不重复显示进度通知
    this.debouncedTimers.set(debounceKey, now)

    // 只在特定进度点显示通知
    const progressPoints = [25, 50, 75, 90]
    if (!progressPoints.some(point => update.progress >= point && update.progress < point + 5)) {
      return
    }

    const message: NotificationMessage = {
      id: `upload_progress_${update.id}_${Math.floor(update.progress)}`,
      type: 'info',
      title: '上传进度',
      message: `${update.fileName}: ${update.progress.toFixed(1)}%`,
      details: `速度: ${this.formatSpeed(update.speed)} - 剩余: ${this.formatTime(update.eta)}`,
      timestamp: Date.now(),
      progress: update.progress,
      dismissible: true,
      config
    }

    this.showNotification(message)
  }

  /**
   * 显示上传完成通知
   */
  private showUploadCompleteNotification(update: EnhancedProgressUpdate, config: NotificationConfig): void {
    const message: NotificationMessage = {
      id: `upload_complete_${update.id}`,
      type: 'success',
      title: '上传完成',
      message: `${update.fileName} 上传完成`,
      details: `耗时: ${this.formatTime(update.timeElapsed)} - 平均速度: ${this.formatSpeed(update.averageSpeed)}`,
      timestamp: Date.now(),
      dismissible: true,
      config
    }

    this.showNotification(message)
  }

  /**
   * 显示上传错误通知
   */
  private showUploadErrorNotification(update: EnhancedProgressUpdate, config: NotificationConfig): void {
    const message: NotificationMessage = {
      id: `upload_error_${update.id}`,
      type: 'error',
      title: '上传失败',
      message: `${update.fileName} 上传失败`,
      details: update.error || '未知错误',
      timestamp: Date.now(),
      dismissible: true,
      config,
      actions: [
        {
          label: '重试',
          action: () => this.retryUpload(update.id),
          style: 'primary'
        },
        {
          label: '查看详情',
          action: () => this.showErrorDetails(update),
          style: 'default'
        }
      ]
    }

    this.showNotification(message)
  }

  /**
   * 显示上传暂停通知
   */
  private showUploadPausedNotification(update: EnhancedProgressUpdate, config: NotificationConfig): void {
    const message: NotificationMessage = {
      id: `upload_paused_${update.id}`,
      type: 'warning',
      title: '上传已暂停',
      message: `${update.fileName} 上传已暂停`,
      details: `进度: ${update.progress.toFixed(1)}% - 已上传: ${this.formatSize(update.uploadedBytes)}`,
      timestamp: Date.now(),
      dismissible: true,
      config,
      actions: [
        {
          label: '继续',
          action: () => this.resumeUpload(update.id),
          style: 'primary'
        },
        {
          label: '取消',
          action: () => this.cancelUpload(update.id),
          style: 'destructive'
        }
      ]
    }

    this.showNotification(message)
  }

  /**
   * 显示通知
   */
  private showNotification(message: NotificationMessage): void {
    // 检查是否超过最大并发通知数
    if (this.activeNotifications.size >= message.config.maxConcurrent) {
      this.dismissOldestNotification()
    }

    // 根据配置显示不同类型的通知
    switch (message.config.type) {
      case 'toast':
        this.showToast(message)
        break
      case 'modal':
        this.showModal(message)
        break
      case 'status-bar':
        this.showStatusBarNotification(message)
        break
      case 'silent':
        this.addToHistory(message)
        break
    }

    this.activeNotifications.set(message.id, message)
    
    // 自动消失
    if (message.config.duration > 0) {
      setTimeout(() => {
        this.dismissNotification(message.id)
      }, message.config.duration)
    }
  }

  /**
   * 显示 Toast 通知
   */
  private showToast(message: NotificationMessage): void {
    const notice = new Notice(message.message, message.config.duration)
    
    if (message.details) {
      notice.setMessage(`${message.message}\n${message.details}`)
    }
  }

  /**
   * 显示模态通知
   */
  private showModal(message: NotificationMessage): void {
    // 这里可以实现更复杂的模态框通知
    this.showToast(message)
  }

  /**
   * 显示状态栏通知
   */
  private showStatusBarNotification(message: NotificationMessage): void {
    // 这里可以实现状态栏通知
    this.showToast(message)
  }

  /**
   * 获取通知配置
   */
  private getNotificationConfig(stage: EnhancedProgressUpdate['stage']): NotificationConfig {
    const baseConfig: NotificationConfig = {
      enabled: configManager.get('showUploadNotifications', true),
      type: 'toast',
      priority: 'medium',
      duration: 3000,
      sound: false,
      vibration: false,
      groupable: true,
      maxConcurrent: 3
    }

    switch (stage) {
      case 'preparing':
        return {
          ...baseConfig,
          priority: 'low',
          duration: 2000
        }
      case 'uploading':
        return {
          ...baseConfig,
          priority: 'medium',
          duration: 3000
        }
      case 'completed':
        return {
          ...baseConfig,
          priority: 'high',
          duration: 5000
        }
      case 'error':
        return {
          ...baseConfig,
          priority: 'critical',
          duration: 8000
        }
      case 'paused':
        return {
          ...baseConfig,
          priority: 'medium',
          duration: 0 // 不自动消失
        }
      default:
        return baseConfig
    }
  }

  /**
   * 关闭通知
   */
  dismissNotification(id: string): void {
    const notification = this.activeNotifications.get(id)
    if (notification) {
      this.activeNotifications.delete(id)
      this.addToHistory(notification)
    }
  }

  /**
   * 关闭最旧的通知
   */
  private dismissOldestNotification(): void {
    const oldestNotification = Array.from(this.activeNotifications.values())
      .sort((a, b) => a.timestamp - b.timestamp)[0]
    
    if (oldestNotification) {
      this.dismissNotification(oldestNotification.id)
    }
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(message: NotificationMessage): void {
    this.notificationHistory.push(message)
    
    // 限制历史记录大小
    if (this.notificationHistory.length > this.maxHistorySize) {
      this.notificationHistory.shift()
    }
  }

  /**
   * 重试上传
   */
  private retryUpload(uploadId: string): void {
    // 这里需要与上传系统集成
    console.log(`重试上传: ${uploadId}`)
  }

  /**
   * 恢复上传
   */
  private resumeUpload(uploadId: string): void {
    // 这里需要与上传系统集成
    console.log(`恢复上传: ${uploadId}`)
  }

  /**
   * 取消上传
   */
  private cancelUpload(uploadId: string): void {
    // 这里需要与上传系统集成
    console.log(`取消上传: ${uploadId}`)
  }

  /**
   * 显示错误详情
   */
  private showErrorDetails(update: EnhancedProgressUpdate): void {
    const details = `
文件: ${update.fileName}
错误: ${update.error}
重试次数: ${update.retryCount}
上传进度: ${update.progress.toFixed(1)}%
已上传: ${this.formatSize(update.uploadedBytes)}
总大小: ${this.formatSize(update.fileSize)}
    `.trim()
    
    new Notice(details, 10000)
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * 格式化时间
   */
  private formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}秒`
    if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
    return `${Math.round(seconds / 3600)}小时`
  }

  /**
   * 格式化速度
   */
  private formatSpeed(bytesPerSecond: number): string {
    return `${this.formatSize(bytesPerSecond)}/s`
  }

  /**
   * 获取活跃通知
   */
  getActiveNotifications(): NotificationMessage[] {
    return Array.from(this.activeNotifications.values())
  }

  /**
   * 获取通知历史
   */
  getNotificationHistory(): NotificationMessage[] {
    return [...this.notificationHistory]
  }

  /**
   * 清空通知历史
   */
  clearNotificationHistory(): void {
    this.notificationHistory = []
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<NotificationConfig>): void {
    // 更新配置逻辑
  }
}

// 全局实例
export const smartNotificationManager = new SmartNotificationManager()

// 导出便捷函数
export function showInfoNotification(message: string, details?: string): void {
  smartNotificationManager.showNotification({
    id: `info_${Date.now()}`,
    type: 'info',
    title: '信息',
    message,
    details,
    timestamp: Date.now(),
    dismissible: true,
    config: {
      enabled: true,
      type: 'toast',
      priority: 'medium',
      duration: 3000,
      groupable: true,
      maxConcurrent: 3
    }
  })
}

export function showSuccessNotification(message: string, details?: string): void {
  smartNotificationManager.showNotification({
    id: `success_${Date.now()}`,
    type: 'success',
    title: '成功',
    message,
    details,
    timestamp: Date.now(),
    dismissible: true,
    config: {
      enabled: true,
      type: 'toast',
      priority: 'high',
      duration: 5000,
      groupable: true,
      maxConcurrent: 3
    }
  })
}

export function showWarningNotification(message: string, details?: string): void {
  smartNotificationManager.showNotification({
    id: `warning_${Date.now()}`,
    type: 'warning',
    title: '警告',
    message,
    details,
    timestamp: Date.now(),
    dismissible: true,
    config: {
      enabled: true,
      type: 'toast',
      priority: 'medium',
      duration: 4000,
      groupable: true,
      maxConcurrent: 3
    }
  })
}

export function showErrorNotification(message: string, details?: string): void {
  smartNotificationManager.showNotification({
    id: `error_${Date.now()}`,
    type: 'error',
    title: '错误',
    message,
    details,
    timestamp: Date.now(),
    dismissible: true,
    config: {
      enabled: true,
      type: 'toast',
      priority: 'critical',
      duration: 8000,
      groupable: true,
      maxConcurrent: 3
    }
  })
}