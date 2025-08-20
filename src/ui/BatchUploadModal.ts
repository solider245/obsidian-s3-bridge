/**
 * 批量上传模态框
 * 
 * 提供可视化的批量上传界面
 */

import { BatchUploader, UploadItem, BatchProgress } from '../upload/BatchUploader'
import { configManager } from '../config/ConfigurationManager'
import { enhancedProgressManager, EnhancedProgressUpdate } from '../utils/enhancedProgress'
import { smartNotificationManager } from '../utils/smartNotifications'
import { Notice } from 'obsidian'

export class BatchUploadModal extends Modal {
  private uploader: BatchUploader
  private contentEl: HTMLElement
  private progressEl: HTMLElement
  private itemsListEl: HTMLElement
  private controlsEl: HTMLElement
  private statsEl: HTMLElement
  private enhancedStatsEl: HTMLElement
  private speedChartEl: HTMLElement
  private progressListeners = new Map<string, () => void>()

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
    
    // 设置增强进度监听器
    this.setupEnhancedProgressListeners()
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
    
    // 创建增强统计区域
    this.createEnhancedStatsArea()
    
    // 创建速度图表区域
    this.createSpeedChartArea()

    // 初始化拖拽
    this.setupDragDrop()
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
    this.uploader.stop()
    this.cleanupEnhancedProgressListeners()
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
        const addedIds = this.uploader.addFiles(files)
        this.initializeEnhancedProgress(addedIds, Array.from(files))
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
      const itemEl = this.itemsListEl.createDiv({ 
        cls: 'batch-upload-item',
        attr: { 'data-upload-id': item.id }
      })
      
      // 文件信息
      const fileInfo = itemEl.createDiv({ cls: 'batch-upload-item-info' })
      fileInfo.createDiv({ cls: 'batch-upload-item-name', text: item.metadata.name })
      fileInfo.createDiv({ cls: 'batch-upload-item-size', text: this.formatSize(item.metadata.size) })
      
      // 增强的进度信息
      const enhancedInfo = itemEl.createDiv({ cls: 'batch-upload-item-enhanced-info' })
      enhancedInfo.createDiv({ cls: 'batch-upload-item-speed', text: '0 B/s' })
      enhancedInfo.createDiv({ cls: 'batch-upload-item-eta', text: '计算中...' })
      enhancedInfo.createDiv({ cls: 'batch-upload-item-warnings', text: '' })
      
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

  /**
   * 设置增强进度监听器
   */
  private setupEnhancedProgressListeners(): void {
    enhancedProgressManager.addListener((update: EnhancedProgressUpdate) => {
      this.updateEnhancedProgress(update)
    })
  }

  /**
   * 清理增强进度监听器
   */
  private cleanupEnhancedProgressListeners(): void {
    this.progressListeners.forEach(listener => listener())
    this.progressListeners.clear()
  }

  /**
   * 初始化增强进度
   */
  private initializeEnhancedProgress(ids: string[], files: File[]): void {
    ids.forEach((id, index) => {
      const file = files[index]
      enhancedProgressManager.startUpload(id, file.name, file.size)
    })
  }

  /**
   * 更新增强进度
   */
  private updateEnhancedProgress(update: EnhancedProgressUpdate): void {
    this.updateEnhancedStats(update)
    this.updateSpeedChart(update)
    this.updateItemsListEnhanced(update)
  }

  /**
   * 创建增强统计区域
   */
  private createEnhancedStatsArea(): void {
    this.enhancedStatsEl = this.contentEl.createDiv({ cls: 'batch-upload-enhanced-stats' })
    
    const statsGrid = this.enhancedStatsEl.createDiv({ cls: 'batch-upload-enhanced-stats-grid' })
    
    // 当前速度
    statsGrid.createDiv({ cls: 'batch-upload-enhanced-stat-item' })
      .createEl('div', { cls: 'batch-upload-enhanced-stat-label', text: '当前速度' })
      .parentElement?.createDiv({ 
        cls: 'batch-upload-enhanced-stat-value batch-upload-current-speed',
        text: '0 B/s'
      })
    
    // 平均速度
    statsGrid.createDiv({ cls: 'batch-upload-enhanced-stat-item' })
      .createEl('div', { cls: 'batch-upload-enhanced-stat-label', text: '平均速度' })
      .parentElement?.createDiv({ 
        cls: 'batch-upload-enhanced-stat-value batch-upload-average-speed',
        text: '0 B/s'
      })
    
    // 峰值速度
    statsGrid.createDiv({ cls: 'batch-upload-enhanced-stat-item' })
      .createEl('div', { cls: 'batch-upload-enhanced-stat-label', text: '峰值速度' })
      .parentElement?.createDiv({ 
        cls: 'batch-upload-enhanced-stat-value batch-upload-peak-speed',
        text: '0 B/s'
      })
    
    // 总耗时
    statsGrid.createDiv({ cls: 'batch-upload-enhanced-stat-item' })
      .createEl('div', { cls: 'batch-upload-enhanced-stat-label', text: '总耗时' })
      .parentElement?.createDiv({ 
        cls: 'batch-upload-enhanced-stat-value batch-upload-total-time',
        text: '0秒'
      })
  }

  /**
   * 创建速度图表区域
   */
  private createSpeedChartArea(): void {
    this.speedChartEl = this.contentEl.createDiv({ cls: 'batch-upload-speed-chart' })
    
    const chartTitle = this.speedChartEl.createEl('div', { 
      cls: 'batch-upload-speed-chart-title',
      text: '速度趋势'
    })
    
    const chartContainer = this.speedChartEl.createDiv({ cls: 'batch-upload-speed-chart-container' })
    const chartCanvas = chartContainer.createEl('canvas', { 
      cls: 'batch-upload-speed-chart-canvas',
      attr: { width: '400', height: '100' }
    })
    
    // 初始化图表
    this.initializeSpeedChart(chartCanvas as HTMLCanvasElement)
  }

  /**
   * 初始化速度图表
   */
  private initializeSpeedChart(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // 设置画布大小
    canvas.width = canvas.offsetWidth
    canvas.height = 100
    
    // 绘制网格
    this.drawSpeedChartGrid(ctx, canvas.width, canvas.height)
  }

  /**
   * 绘制速度图表网格
   */
  private drawSpeedChartGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = 'var(--text-muted)'
    ctx.lineWidth = 1
    
    // 绘制水平线
    for (let i = 0; i <= 4; i++) {
      const y = (height / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
  }

  /**
   * 更新增强统计
   */
  private updateEnhancedStats(update: EnhancedProgressUpdate): void {
    const currentSpeedEl = this.enhancedStatsEl.querySelector('.batch-upload-current-speed') as HTMLElement
    const averageSpeedEl = this.enhancedStatsEl.querySelector('.batch-upload-average-speed') as HTMLElement
    const peakSpeedEl = this.enhancedStatsEl.querySelector('.batch-upload-peak-speed') as HTMLElement
    const totalTimeEl = this.enhancedStatsEl.querySelector('.batch-upload-total-time') as HTMLElement

    if (currentSpeedEl) {
      currentSpeedEl.textContent = this.formatSpeed(update.speed)
    }
    
    if (averageSpeedEl) {
      averageSpeedEl.textContent = this.formatSpeed(update.averageSpeed)
    }
    
    if (peakSpeedEl) {
      peakSpeedEl.textContent = this.formatSpeed(update.peakSpeed)
    }
    
    if (totalTimeEl) {
      totalTimeEl.textContent = this.formatTime(update.timeElapsed)
    }
  }

  /**
   * 更新速度图表
   */
  private updateSpeedChart(update: EnhancedProgressUpdate): void {
    const canvas = this.speedChartEl.querySelector('.batch-upload-speed-chart-canvas') as HTMLCanvasElement
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // 简单的速度图表实现
    this.drawSpeedChartGrid(ctx, canvas.width, canvas.height)
    
    // 这里可以添加更复杂的速度图表绘制逻辑
    // 例如：绘制速度曲线、显示历史数据等
  }

  /**
   * 更新增强的文件列表
   */
  private updateItemsListEnhanced(update: EnhancedProgressUpdate): void {
    const itemEl = this.itemsListEl.querySelector(`[data-upload-id="${update.id}"]`)
    if (!itemEl) return
    
    // 更新速度信息
    const speedEl = itemEl.querySelector('.batch-upload-item-speed') as HTMLElement
    if (speedEl) {
      speedEl.textContent = this.formatSpeed(update.speed)
    }
    
    // 更新ETA信息
    const etaEl = itemEl.querySelector('.batch-upload-item-eta') as HTMLElement
    if (etaEl) {
      etaEl.textContent = this.formatTime(update.eta)
    }
    
    // 更新警告信息
    const warningEl = itemEl.querySelector('.batch-upload-item-warnings') as HTMLElement
    if (warningEl && update.warnings.length > 0) {
      warningEl.textContent = update.warnings.join(', ')
      warningEl.style.display = 'block'
    }
  }

  /**
   * 格式化速度
   */
  private formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond === 0) return '0 B/s'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i] + '/s'
  }

  /**
   * 格式化时间
   */
  private formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}秒`
    if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
    return `${Math.round(seconds / 3600)}小时`
  }
}