/**
 * 批量上传器
 * 
 * 支持多文件同时上传，提供可视化的上传队列管理
 */

import { configManager } from '../config/ConfigurationManager'
import { errorHandler, withErrorHandling, AppError } from '../error/ErrorHandler'
import { UploadProgressManager } from '../utils/uploadProgress'
import { enhancedProgressManager } from '../utils/enhancedProgress'
import { performUpload } from '../upload/performUpload'

export interface UploadItem {
  id: string
  file: File
  status: UploadStatus
  progress: number
  speed: number
  eta: number
  error?: AppError
  url?: string
  startTime: number
  endTime?: number
  retryCount: number
  metadata: {
    name: string
    size: number
    type: string
    lastModified: number
  }
}

export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled'

export interface BatchUploadOptions {
  maxConcurrentUploads?: number
  retryFailed?: boolean
  maxRetries?: number
  retryDelay?: number
  onProgress?: (progress: BatchProgress) => void
  onComplete?: (results: UploadItem[]) => void
  onError?: (error: AppError, item: UploadItem) => void
  onItemComplete?: (item: UploadItem) => void
}

export interface BatchProgress {
  total: number
  completed: number
  failed: number
  uploading: number
  pending: number
  overallProgress: number
  totalSize: number
  uploadedSize: number
  speed: number
  eta: number
}

/**
 * 批量上传器类
 */
export class BatchUploader {
  private items: UploadItem[] = []
  private activeUploads: Map<string, Promise<void>> = new Map()
  private options: Required<BatchUploadOptions>
  private progressManager: UploadProgressManager
  private isRunning = false
  private isPaused = false

  constructor(options: BatchUploadOptions = {}) {
    this.options = {
      maxConcurrentUploads: 3,
      retryFailed: true,
      maxRetries: 3,
      retryDelay: 1000,
      onProgress: () => {},
      onComplete: () => {},
      onError: () => {},
      onItemComplete: () => {},
      ...options
    }

    this.progressManager = new UploadProgressManager()
  }

  /**
   * 添加文件到上传队列
   */
  addFiles(files: FileList | File[]): string[] {
    const fileArray = Array.from(files)
    const ids: string[] = []

    fileArray.forEach(file => {
      const id = this.generateId()
      const item: UploadItem = {
        id,
        file,
        status: 'pending',
        progress: 0,
        speed: 0,
        eta: 0,
        retryCount: 0,
        startTime: 0,
        metadata: {
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified
        }
      }

      this.items.push(item)
      ids.push(id)
      
      // 初始化增强进度跟踪
      enhancedProgressManager.startUpload(id, file.name, file.size)
    })

    this.notifyProgress()
    return ids
  }

  /**
   * 移除文件
   */
  removeItem(id: string): boolean {
    const index = this.items.findIndex(item => item.id === id)
    if (index === -1) return false

    const item = this.items[index]
    
    // 如果正在上传，先取消
    if (item.status === 'uploading') {
      this.cancelUpload(id)
    }

    this.items.splice(index, 1)
    this.notifyProgress()
    return true
  }

  /**
   * 开始批量上传
   */
  async start(): Promise<void> {
    if (this.isRunning) return

    this.isRunning = true
    this.isPaused = false

    try {
      await this.processQueue()
    } finally {
      this.isRunning = false
      this.options.onComplete(this.items)
    }
  }

  /**
   * 暂停上传
   */
  pause(): void {
    this.isPaused = true
  }

  /**
   * 恢复上传
   */
  resume(): void {
    this.isPaused = false
    if (!this.isRunning) {
      this.start()
    }
  }

  /**
   * 停止所有上传
   */
  stop(): void {
    this.isRunning = false
    this.isPaused = false
    
    // 取消所有活动上传
    for (const [id] of this.activeUploads) {
      this.cancelUpload(id)
    }
  }

  /**
   * 取消指定文件的上传
   */
  cancelUpload(id: string): void {
    const item = this.items.find(item => item.id === id)
    if (!item || item.status !== 'uploading') return

    item.status = 'cancelled'
    item.endTime = Date.now()
    
    // 从活动上传中移除
    this.activeUploads.delete(id)
    
    this.notifyProgress()
  }

  /**
   * 重试失败的上传
   */
  retryFailed(): void {
    const failedItems = this.items.filter(item => item.status === 'failed')
    
    failedItems.forEach(item => {
      item.status = 'pending'
      item.progress = 0
      item.error = undefined
      item.retryCount = 0
      item.startTime = 0
      item.endTime = undefined
    })

    this.notifyProgress()

    // 如果当前没有运行，重新开始
    if (!this.isRunning) {
      this.start()
    }
  }

  /**
   * 清理已完成的项目
   */
  clearCompleted(): void {
    this.items = this.items.filter(item => 
      item.status === 'pending' || item.status === 'uploading'
    )
    this.notifyProgress()
  }

  /**
   * 清理所有项目
   */
  clearAll(): void {
    this.stop()
    this.items = []
    this.notifyProgress()
  }

  /**
   * 获取上传进度
   */
  getProgress(): BatchProgress {
    const total = this.items.length
    const completed = this.items.filter(item => item.status === 'completed').length
    const failed = this.items.filter(item => item.status === 'failed').length
    const uploading = this.items.filter(item => item.status === 'uploading').length
    const pending = this.items.filter(item => item.status === 'pending').length

    const totalSize = this.items.reduce((sum, item) => sum + item.metadata.size, 0)
    const uploadedSize = this.items.reduce((sum, item) => {
      if (item.status === 'completed') {
        return sum + item.metadata.size
      }
      return sum + (item.metadata.size * item.progress / 100)
    }, 0)

    const overallProgress = totalSize > 0 ? (uploadedSize / totalSize) * 100 : 0
    
    // 计算速度和剩余时间
    const activeItems = this.items.filter(item => item.status === 'uploading')
    const totalSpeed = activeItems.reduce((sum, item) => sum + item.speed, 0)
    const remainingSize = totalSize - uploadedSize
    const eta = totalSpeed > 0 ? remainingSize / totalSpeed : 0

    return {
      total,
      completed,
      failed,
      uploading,
      pending,
      overallProgress,
      totalSize,
      uploadedSize,
      speed: totalSpeed,
      eta
    }
  }

  /**
   * 获取所有上传项目
   */
  getItems(): UploadItem[] {
    return [...this.items]
  }

  /**
   * 获取指定项目
   */
  getItem(id: string): UploadItem | undefined {
    return this.items.find(item => item.id === id)
  }

  /**
   * 处理上传队列
   */
  private async processQueue(): Promise<void> {
    while (this.isRunning && !this.isPaused) {
      const pendingItems = this.items.filter(item => item.status === 'pending')
      
      if (pendingItems.length === 0) {
        break
      }

      // 检查并发限制
      if (this.activeUploads.size >= this.options.maxConcurrentUploads) {
        await this.waitForUploadSlot()
        continue
      }

      // 开始下一个上传
      const item = pendingItems[0]
      this.startUpload(item)
    }
  }

  /**
   * 开始单个文件上传
   */
  private startUpload(item: UploadItem): void {
    item.status = 'uploading'
    item.startTime = Date.now()
    
    const uploadPromise = this.uploadFile(item)
      .then(() => {
        this.handleUploadComplete(item)
      })
      .catch(error => {
        this.handleUploadError(item, error)
      })
      .finally(() => {
        this.activeUploads.delete(item.id)
      })

    this.activeUploads.set(item.id, uploadPromise)
  }

  /**
   * 上传单个文件
   */
  private async uploadFile(item: UploadItem): Promise<void> {
    return new Promise((resolve, reject) => {
      // 使用现有的 performUpload 函数
      performUpload(item.file, {
        onProgress: (progress, speed, eta) => {
          item.progress = progress
          item.speed = speed
          item.eta = eta
          
          // 更新增强进度
          const uploadedBytes = (progress * item.metadata.size) / 100
          enhancedProgressManager.updateProgress(item.id, progress, uploadedBytes)
          
          this.notifyProgress()
        },
        onSuccess: (url) => {
          item.url = url
          enhancedProgressManager.completeUpload(item.id, url)
          resolve()
        },
        onError: (error) => {
          enhancedProgressManager.failUpload(item.id, error.message, item.retryCount)
          reject(error)
        }
      })
    })
  }

  /**
   * 处理上传完成
   */
  private handleUploadComplete(item: UploadItem): void {
    item.status = 'completed'
    item.progress = 100
    item.endTime = Date.now()
    
    this.notifyProgress()
    this.options.onItemComplete(item)
  }

  /**
   * 处理上传错误
   */
  private handleUploadError(item: UploadItem, error: any): void {
    const appError = errorHandler.handleError(error)
    
    item.error = appError
    item.retryCount++
    
    // 检查是否需要重试
    if (this.options.retryFailed && 
        item.retryCount < this.options.maxRetries && 
        appError.retryable) {
      
      // 延迟后重试
      setTimeout(() => {
        if (this.isRunning && !this.isPaused) {
          item.status = 'pending'
          item.progress = 0
          item.startTime = 0
          this.notifyProgress()
        }
      }, this.options.retryDelay * item.retryCount)
    } else {
      item.status = 'failed'
      item.endTime = Date.now()
      
      this.notifyProgress()
      this.options.onError(appError, item)
    }
  }

  /**
   * 等待上传槽位
   */
  private async waitForUploadSlot(): Promise<void> {
    return new Promise(resolve => {
      const checkSlot = () => {
        if (this.activeUploads.size < this.options.maxConcurrentUploads) {
          resolve()
        } else {
          setTimeout(checkSlot, 100)
        }
      }
      checkSlot()
    })
  }

  /**
   * 通知进度更新
   */
  private notifyProgress(): void {
    const progress = this.getProgress()
    this.options.onProgress(progress)
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalFiles: number
    totalSize: number
    uploadedFiles: number
    uploadedSize: number
    failedFiles: number
    averageSpeed: number
    totalTime: number
  } {
    const totalFiles = this.items.length
    const totalSize = this.items.reduce((sum, item) => sum + item.metadata.size, 0)
    const uploadedFiles = this.items.filter(item => item.status === 'completed').length
    const uploadedSize = this.items
      .filter(item => item.status === 'completed')
      .reduce((sum, item) => sum + item.metadata.size, 0)
    const failedFiles = this.items.filter(item => item.status === 'failed').length
    
    const completedItems = this.items.filter(item => item.status === 'completed')
    const totalTime = completedItems.length > 0 
      ? completedItems.reduce((sum, item) => sum + (item.endTime! - item.startTime), 0) / completedItems.length
      : 0
    
    const averageSpeed = totalTime > 0 ? uploadedSize / (totalTime / 1000) : 0

    return {
      totalFiles,
      totalSize,
      uploadedFiles,
      uploadedSize,
      failedFiles,
      averageSpeed,
      totalTime
    }
  }
}

// 导出便捷函数
export function createBatchUploader(options?: BatchUploadOptions): BatchUploader {
  return new BatchUploader(options)
}

// 全局批量上传器实例
let globalBatchUploader: BatchUploader | null = null

export function getGlobalBatchUploader(): BatchUploader {
  if (!globalBatchUploader) {
    globalBatchUploader = new BatchUploader()
  }
  return globalBatchUploader
}