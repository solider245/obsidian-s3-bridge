/**
 * 批量上传模态框
 * 
 * 提供可视化的批量上传界面
 */

import { BatchUploader, UploadItem, BatchProgress } from '../upload/BatchUploader'
import { configManager } from '../config/ConfigurationManager'
import { Notice } from 'obsidian'

export class BatchUploadModal extends Modal {
  private uploader: BatchUploader
  private contentEl: HTMLElement
  private progressEl: HTMLElement
  private itemsListEl: HTMLElement
  private controlsEl: HTMLElement
  private statsEl: HTMLElement

  constructor(app: App) {
    super(app)
    this.uploader = new BatchUploader({
      maxConcurrentUploads: configManager.get('maxConcurrentUploads', 3),
      retryFailed: true,
      maxRetries: 3,
      retryDelay: 1000,
      onProgress: (progress) => this.updateProgress(progress),
      onComplete: (items) => this.onComplete(items),
      onError: (error, item) => this.onError(error, item),
      onItemComplete: (item) => this.onItemComplete(item)
    })
  }

  onOpen() {
    const { contentEl } = this
    this.contentEl = contentEl

    contentEl.createEl('h2', { text: '批量上传文件' })

    // 创建文件选择区域
    this.createFileSelectionArea()

    // 创建进度显示区域
    this.createProgressArea()

    // 创建文件列表区域
    this.createItemsList()

    // 创建控制按钮区域
    this.createControls()

    // 创建统计信息区域
    this.createStatsArea()

    // 初始化拖拽
    this.setupDragDrop()
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
    this.uploader.stop()
  }

  /**
   * 创建文件选择区域
   */
  private createFileSelectionArea(): void {
    const selectionArea = this.contentEl.createDiv({ cls: 'batch-upload-selection' })
    
    // 文件选择按钮
    const fileInput = selectionArea.createEl('input', {
      type: 'file',
      multiple: true,
      cls: 'batch-upload-file-input'
    })
    
    fileInput.style.display = 'none'
    
    const selectButton = selectionArea.createEl('button', {
      text: '选择文件',
      cls: 'batch-upload-select-button'
    })
    
    selectButton.addEventListener('click', () => {
      fileInput.click()
    })

    fileInput.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files
      if (files && files.length > 0) {
        this.uploader.addFiles(files)
        this.updateItemsList()
      }
    })

    // 拖拽提示
    const dropHint = selectionArea.createDiv({ 
      cls: 'batch-upload-drop-hint',
      text: '或拖拽文件到这里'
    })
  }

  /**
   * 创建进度显示区域
   */
  private createProgressArea(): void {
    this.progressEl = this.contentEl.createDiv({ cls: 'batch-upload-progress' })
    
    // 总体进度条
    const progressContainer = this.progressEl.createDiv({ cls: 'batch-upload-progress-container' })
    const progressBar = progressContainer.createDiv({ cls: 'batch-upload-progress-bar' })
    const progressFill = progressBar.createDiv({ cls: 'batch-upload-progress-fill' })
    
    // 进度信息
    const progressInfo = this.progressEl.createDiv({ cls: 'batch-upload-progress-info' })
    const progressText = progressInfo.createDiv({ cls: 'batch-upload-progress-text' })
    const speedText = progressInfo.createDiv({ cls: 'batch-upload-speed-text' })
    
    // 保存引用
    (progressBar as any).fillEl = progressFill
    (progressInfo as any).textEl = progressText
    (progressInfo as any).speedEl = speedText
  }

  /**
   * 创建文件列表区域
   */
  private createItemsList(): void {
    const listContainer = this.contentEl.createDiv({ cls: 'batch-upload-list-container' })
    
    const listHeader = listContainer.createDiv({ cls: 'batch-upload-list-header' })
    listHeader.createDiv({ text: '文件列表' })
    
    const clearButton = listHeader.createEl('button', {
      text: '清除已完成',
      cls: 'batch-upload-clear-button'
    })
    
    clearButton.addEventListener('click', () => {
      this.uploader.clearCompleted()
      this.updateItemsList()
    })

    this.itemsListEl = listContainer.createDiv({ cls: 'batch-upload-items-list' })
  }

  /**
   * 创建控制按钮区域
   */
  private createControls(): void {
    this.controlsEl = this.contentEl.createDiv({ cls: 'batch-upload-controls' })
    
    const startButton = this.controlsEl.createEl('button', {
      text: '开始上传',
      cls: 'batch-upload-start-button mod-cta'
    })
    
    const pauseButton = this.controlsEl.createEl('button', {
      text: '暂停',
      cls: 'batch-upload-pause-button'
    })
    
    const stopButton = this.controlsEl.createEl('button', {
      text: '停止',
      cls: 'batch-upload-stop-button mod-warning'
    })
    
    const retryButton = this.controlsEl.createEl('button', {
      text: '重试失败',
      cls: 'batch-upload-retry-button'
    })

    startButton.addEventListener('click', () => {
      this.uploader.start()
      this.updateControlButtons()
    })

    pauseButton.addEventListener('click', () => {
      this.uploader.pause()
      this.updateControlButtons()
    })

    stopButton.addEventListener('click', () => {
      this.uploader.stop()
      this.updateControlButtons()
    })

    retryButton.addEventListener('click', () => {
      this.uploader.retryFailed()
      this.updateItemsList()
    })

    // 保存按钮引用
    (this.controlsEl as any).startButton = startButton
    (this.controlsEl as any).pauseButton = pauseButton
    (this.controlsEl as any).stopButton = stopButton
    (this.controlsEl as any).retryButton = retryButton
  }

  /**
   * 创建统计信息区域
   */
  private createStatsArea(): void {
    this.statsEl = this.contentEl.createDiv({ cls: 'batch-upload-stats' })
    
    const statsGrid = this.statsEl.createDiv({ cls: 'batch-upload-stats-grid' })
    
    statsGrid.createDiv({ cls: 'batch-upload-stat-item' }).createEl('div', {
      cls: 'batch-upload-stat-label',
      text: '总文件数'
    }).parentElement?.createDiv({
      cls: 'batch-upload-stat-value batch-upload-total-files',
      text: '0'
    })
    
    statsGrid.createDiv({ cls: 'batch-upload-stat-item' }).createEl('div', {
      cls: 'batch-upload-stat-label',
      text: '已完成'
    }).parentElement?.createDiv({
      cls: 'batch-upload-stat-value batch-upload-completed-files',
      text: '0'
    })
    
    statsGrid.createDiv({ cls: 'batch-upload-stat-item' }).createEl('div', {
      cls: 'batch-upload-stat-label',
      text: '失败'
    }).parentElement?.createDiv({
      cls: 'batch-upload-stat-value batch-upload-failed-files',
      text: '0'
    })
    
    statsGrid.createDiv({ cls: 'batch-upload-stat-item' }).createEl('div', {
      cls: 'batch-upload-stat-label',
      text: '总大小'
    }).parentElement?.createDiv({
      cls: 'batch-upload-stat-value batch-upload-total-size',
      text: '0 MB'
    })
  }

  /**
   * 设置拖拽功能
   */
  private setupDragDrop(): void {
    const modalEl = this.modalEl
    
    modalEl.addEventListener('dragover', (e) => {
      e.preventDefault()
      modalEl.addClass('batch-upload-drag-over')
    })

    modalEl.addEventListener('dragleave', (e) => {
      e.preventDefault()
      modalEl.removeClass('batch-upload-drag-over')
    })

    modalEl.addEventListener('drop', (e) => {
      e.preventDefault()
      modalEl.removeClass('batch-upload-drag-over')
      
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        this.uploader.addFiles(files)
        this.updateItemsList()
      }
    })
  }

  /**
   * 更新进度显示
   */
  private updateProgress(progress: BatchProgress): void {
    const progressBar = this.progressEl.querySelector('.batch-upload-progress-bar') as any
    const progressText = this.progressEl.querySelector('.batch-upload-progress-text') as any
    const speedText = this.progressEl.querySelector('.batch-upload-speed-text') as any

    if (progressBar?.fillEl) {
      progressBar.fillEl.style.width = `${progress.overallProgress}%`
    }

    if (progressText) {
      progressText.textContent = `${progress.completed}/${progress.total} (${progress.overallProgress.toFixed(1)}%)`
    }

    if (speedText) {
      const speedTextContent = progress.speed > 0 
        ? `${this.formatSpeed(progress.speed)} - ${this.formatTime(progress.eta)}`
        : '准备中...'
      speedText.textContent = speedTextContent
    }

    this.updateStats(progress)
  }

  /**
   * 更新文件列表
   */
  private updateItemsList(): void {
    this.itemsListEl.empty()
    
    const items = this.uploader.getItems()
    
    if (items.length === 0) {
      this.itemsListEl.createDiv({
        cls: 'batch-upload-empty',
        text: '暂无文件'
      })
      return
    }

    items.forEach(item => {
      const itemEl = this.itemsListEl.createDiv({ cls: 'batch-upload-item' })
      
      // 文件信息
      const fileInfo = itemEl.createDiv({ cls: 'batch-upload-item-info' })
      fileInfo.createDiv({ cls: 'batch-upload-item-name', text: item.metadata.name })
      fileInfo.createDiv({ cls: 'batch-upload-item-size', text: this.formatSize(item.metadata.size) })
      
      // 状态和进度
      const itemStatus = itemEl.createDiv({ cls: 'batch-upload-item-status' })
      
      const statusBadge = itemStatus.createDiv({ 
        cls: `batch-upload-status-badge batch-upload-status-${item.status}`,
        text: this.getStatusText(item.status)
      })
      
      // 进度条
      if (item.status === 'uploading') {
        const itemProgressBar = itemStatus.createDiv({ cls: 'batch-upload-item-progress' })
        const itemProgressFill = itemProgressBar.createDiv({ cls: 'batch-upload-item-progress-fill' })
        itemProgressFill.style.width = `${item.progress}%`
      }
      
      // 错误信息
      if (item.status === 'failed' && item.error) {
        const errorText = itemStatus.createDiv({ 
          cls: 'batch-upload-item-error',
          text: item.error.userFriendly.message
        })
      }
      
      // 操作按钮
      const itemActions = itemEl.createDiv({ cls: 'batch-upload-item-actions' })
      
      if (item.status === 'uploading') {
        const cancelButton = itemActions.createEl('button', {
          text: '取消',
          cls: 'batch-upload-item-cancel'
        })
        cancelButton.addEventListener('click', () => {
          this.uploader.cancelUpload(item.id)
          this.updateItemsList()
        })
      }
      
      if (item.status === 'failed') {
        const retryButton = itemActions.createEl('button', {
          text: '重试',
          cls: 'batch-upload-item-retry'
        })
        retryButton.addEventListener('click', () => {
          this.uploader.retryFailed()
          this.updateItemsList()
        })
      }
      
      const removeButton = itemActions.createEl('button', {
        text: '移除',
        cls: 'batch-upload-item-remove'
      })
      removeButton.addEventListener('click', () => {
        this.uploader.removeItem(item.id)
        this.updateItemsList()
      })
    })
  }

  /**
   * 更新控制按钮状态
   */
  private updateControlButtons(): void {
    const buttons = this.controlsEl as any
    const items = this.uploader.getItems()
    const hasItems = items.length > 0
    const hasPending = items.some(item => item.status === 'pending')
    const hasUploading = items.some(item => item.status === 'uploading')

    buttons.startButton.disabled = !hasItems || !hasPending
    buttons.pauseButton.disabled = !hasUploading
    buttons.stopButton.disabled = !hasItems
    buttons.retryButton.disabled = !items.some(item => item.status === 'failed')
  }

  /**
   * 更新统计信息
   */
  private updateStats(progress: BatchProgress): void {
    const totalFilesEl = this.statsEl.querySelector('.batch-upload-total-files') as HTMLElement
    const completedFilesEl = this.statsEl.querySelector('.batch-upload-completed-files') as HTMLElement
    const failedFilesEl = this.statsEl.querySelector('.batch-upload-failed-files') as HTMLElement
    const totalSizeEl = this.statsEl.querySelector('.batch-upload-total-size') as HTMLElement

    if (totalFilesEl) totalFilesEl.textContent = progress.total.toString()
    if (completedFilesEl) completedFilesEl.textContent = progress.completed.toString()
    if (failedFilesEl) failedFilesEl.textContent = progress.failed.toString()
    if (totalSizeEl) totalSizeEl.textContent = this.formatSize(progress.totalSize)
  }

  /**
   * 上传完成回调
   */
  private onComplete(items: UploadItem[]): void {
    const completed = items.filter(item => item.status === 'completed').length
    const failed = items.filter(item => item.status === 'failed').length
    
    new Notice(`批量上传完成！成功：${completed}，失败：${failed}`)
    this.updateControlButtons()
  }

  /**
   * 错误回调
   */
  private onError(error: any, item: UploadItem): void {
    console.error('批量上传错误:', error, item)
  }

  /**
   * 单个项目完成回调
   */
  private onItemComplete(item: UploadItem): void {
    this.updateItemsList()
    this.updateControlButtons()
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
   * 格式化速度
   */
  private formatSpeed(bytesPerSecond: number): string {
    return this.formatSize(bytesPerSecond) + '/s'
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
   * 获取状态文本
   */
  private getStatusText(status: string): string {
    const statusMap = {
      'pending': '等待中',
      'uploading': '上传中',
      'completed': '已完成',
      'failed': '失败',
      'cancelled': '已取消'
    }
    return statusMap[status as keyof typeof statusMap] || status
  }
}