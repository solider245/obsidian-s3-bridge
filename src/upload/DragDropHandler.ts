/**
 * 拖拽上传处理器
 * 
 * 处理编辑器中的拖拽上传功能，提供拖拽视觉反馈
 */

import { configManager } from '../config/ConfigurationManager'
import { errorHandler, withErrorHandling } from '../error/ErrorHandler'
import { getGlobalBatchUploader } from '../upload/BatchUploader'
import { Notice } from 'obsidian'

export interface DragDropOptions {
  /** 是否启用拖拽上传 */
  enabled?: boolean
  /** 支持的文件类型 */
  acceptedTypes?: string[]
  /** 最大文件大小（MB） */
  maxFileSize?: number
  /** 是否显示拖拽提示 */
  showHint?: boolean
  /** 拖拽时的透明度 */
  dragOpacity?: number
  /** 是否自动开始上传 */
  autoStart?: boolean
  /** 拖拽进入时的回调 */
  onDragEnter?: (event: DragEvent) => void
  /** 拖拽离开时的回调 */
  onDragLeave?: (event: DragEvent) => void
  /** 拖拽放下时的回调 */
  onDrop?: (event: DragEvent, files: File[]) => void
  /** 文件处理完成后的回调 */
  onFilesProcessed?: (files: File[]) => void
}

export interface DragDropHandler {
  /** 启用拖拽上传 */
  enable(): void
  /** 禁用拖拽上传 */
  disable(): void
  /** 销毁处理器 */
  destroy(): void
  /** 是否已启用 */
  isEnabled(): boolean
  /** 设置选项 */
  setOptions(options: Partial<DragDropOptions>): void
}

/**
 * 拖拽状态管理器
 */
class DragDropStateManager {
  private activeElements = new Set<HTMLElement>()
  private dropZones = new Set<HTMLElement>()
  private dragCounter = 0

  addActiveElement(element: HTMLElement): void {
    this.activeElements.add(element)
    this.updateDragState()
  }

  removeActiveElement(element: HTMLElement): void {
    this.activeElements.delete(element)
    this.updateDragState()
  }

  addDropZone(element: HTMLElement): void {
    this.dropZones.add(element)
  }

  removeDropZone(element: HTMLElement): void {
    this.dropZones.delete(element)
  }

  incrementDragCounter(): void {
    this.dragCounter++
    this.updateDragState()
  }

  decrementDragCounter(): void {
    this.dragCounter--
    this.updateDragState()
  }

  private updateDragState(): void {
    const hasActiveDrag = this.dragCounter > 0
    
    this.activeElements.forEach(element => {
      if (hasActiveDrag) {
        element.addClass('s3-bridge-drag-active')
      } else {
        element.removeClass('s3-bridge-drag-active')
      }
    })

    this.dropZones.forEach(element => {
      if (hasActiveDrag) {
        element.addClass('s3-bridge-drop-zone-active')
      } else {
        element.removeClass('s3-bridge-drop-zone-active')
      }
    })
  }

  hasActiveDrag(): boolean {
    return this.dragCounter > 0
  }
}

// 全局拖拽状态管理器
const dragDropStateManager = new DragDropStateManager()

/**
 * 编辑器拖拽处理器
 */
export class EditorDragDropHandler implements DragDropHandler {
  private editor: Editor
  private options: Required<DragDropOptions>
  private enabled = false
  private eventListeners: Array<{ element: HTMLElement; event: string; handler: Function }> = []

  constructor(editor: Editor, options: DragDropOptions = {}) {
    this.editor = editor
    this.options = {
      enabled: true,
      acceptedTypes: ['image/*', 'application/pdf', 'text/*', '*'],
      maxFileSize: configManager.get('maxUploadMB', 5),
      showHint: true,
      dragOpacity: 0.7,
      autoStart: false,
      onDragEnter: () => {},
      onDragLeave: () => {},
      onDrop: () => {},
      onFilesProcessed: () => {},
      ...options
    }
  }

  /**
   * 启用拖拽上传
   */
  enable(): void {
    if (this.enabled) return

    this.setupEventListeners()
    this.createDropZone()
    this.enabled = true
  }

  /**
   * 禁用拖拽上传
   */
  disable(): void {
    if (!this.enabled) return

    this.removeEventListeners()
    this.removeDropZone()
    this.enabled = false
  }

  /**
   * 销毁处理器
   */
  destroy(): void {
    this.disable()
    this.eventListeners = []
  }

  /**
   * 是否已启用
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 设置选项
   */
  setOptions(options: Partial<DragDropOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    const editorEl = this.editor.containerEl

    // 全局拖拽事件监听
    this.addEventListener(document, 'dragenter', this.handleDocumentDragEnter.bind(this))
    this.addEventListener(document, 'dragover', this.handleDocumentDragOver.bind(this))
    this.addEventListener(document, 'dragleave', this.handleDocumentDragLeave.bind(this))
    this.addEventListener(document, 'drop', this.handleDocumentDrop.bind(this))

    // 编辑器拖拽事件监听
    this.addEventListener(editorEl, 'dragenter', this.handleEditorDragEnter.bind(this))
    this.addEventListener(editorEl, 'dragover', this.handleEditorDragOver.bind(this))
    this.addEventListener(editorEl, 'dragleave', this.handleEditorDragLeave.bind(this))
    this.addEventListener(editorEl, 'drop', this.handleEditorDrop.bind(this))
  }

  /**
   * 移除事件监听器
   */
  private removeEventListeners(): void {
    this.eventListeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler as EventListener)
    })
    this.eventListeners = []
  }

  /**
   * 添加事件监听器
   */
  private addEventListener(element: HTMLElement, event: string, handler: Function): void {
    element.addEventListener(event, handler as EventListener)
    this.eventListeners.push({ element, event, handler })
  }

  /**
   * 创建拖拽区域
   */
  private createDropZone(): void {
    const editorEl = this.editor.containerEl
    
    // 添加拖拽区域样式
    editorEl.addClass('s3-bridge-drop-zone')
    dragDropStateManager.addDropZone(editorEl)
    dragDropStateManager.addActiveElement(editorEl)

    // 创建拖拽提示
    if (this.options.showHint) {
      this.createDragHint()
    }
  }

  /**
   * 移除拖拽区域
   */
  private removeDropZone(): void {
    const editorEl = this.editor.containerEl
    
    editorEl.removeClass('s3-bridge-drop-zone')
    editorEl.removeClass('s3-bridge-drag-active')
    dragDropStateManager.removeDropZone(editorEl)
    dragDropStateManager.removeActiveElement(editorEl)

    // 移除拖拽提示
    this.removeDragHint()
  }

  /**
   * 创建拖拽提示
   */
  private createDragHint(): void {
    const editorEl = this.editor.containerEl
    
    // 检查是否已存在提示
    if (editorEl.querySelector('.s3-bridge-drag-hint')) {
      return
    }

    const hint = editorEl.createDiv({
      cls: 's3-bridge-drag-hint',
      text: '拖拽文件到此处上传'
    })

    hint.style.position = 'absolute'
    hint.style.top = '50%'
    hint.style.left = '50%'
    hint.style.transform = 'translate(-50%, -50%)'
    hint.style.pointerEvents = 'none'
    hint.style.opacity = '0'
    hint.style.transition = 'opacity 0.3s ease'
    hint.style.zIndex = '100'
    hint.style.backgroundColor = 'var(--background-primary)'
    hint.style.color = 'var(--text-normal)'
    hint.style.padding = '20px'
    hint.style.borderRadius = '8px'
    hint.style.border = '2px dashed var(--text-muted)'
    hint.style.fontSize = '14px'
    hint.style.fontWeight = '500'
  }

  /**
   * 移除拖拽提示
   */
  private removeDragHint(): void {
    const editorEl = this.editor.containerEl
    const hint = editorEl.querySelector('.s3-bridge-drag-hint')
    if (hint) {
      hint.remove()
    }
  }

  /**
   * 显示/隐藏拖拽提示
   */
  private toggleDragHint(show: boolean): void {
    const editorEl = this.editor.containerEl
    const hint = editorEl.querySelector('.s3-bridge-drag-hint') as HTMLElement
    if (hint) {
      hint.style.opacity = show ? '0.9' : '0'
    }
  }

  /**
   * 处理文档拖拽进入
   */
  private handleDocumentDragEnter(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    
    dragDropStateManager.incrementDragCounter()
    this.options.onDragEnter(event)
  }

  /**
   * 处理文档拖拽悬停
   */
  private handleDocumentDragOver(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    
    // 设置拖拽效果
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  /**
   * 处理文档拖拽离开
   */
  private handleDocumentDragLeave(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    
    dragDropStateManager.decrementDragCounter()
    this.options.onDragLeave(event)
  }

  /**
   * 处理文档拖拽放下
   */
  private handleDocumentDrop(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    
    dragDropStateManager.decrementDragCounter()
    
    // 只在编辑器外处理
    if (!this.editor.containerEl.contains(event.target as Node)) {
      this.handleDrop(event)
    }
  }

  /**
   * 处理编辑器拖拽进入
   */
  private handleEditorDragEnter(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    
    const editorEl = this.editor.containerEl
    editorEl.addClass('s3-bridge-drag-over')
    
    this.toggleDragHint(true)
    this.options.onDragEnter(event)
  }

  /**
   * 处理编辑器拖拽悬停
   */
  private handleEditorDragOver(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    
    const editorEl = this.editor.containerEl
    editorEl.addClass('s3-bridge-drag-over')
    
    // 设置拖拽效果
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    
    this.toggleDragHint(true)
  }

  /**
   * 处理编辑器拖拽离开
   */
  private handleEditorDragLeave(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    
    const editorEl = this.editor.containerEl
    
    // 只有当真正离开编辑器时才移除样式
    if (!editorEl.contains(event.relatedTarget as Node)) {
      editorEl.removeClass('s3-bridge-drag-over')
      this.toggleDragHint(false)
      this.options.onDragLeave(event)
    }
  }

  /**
   * 处理编辑器拖拽放下
   */
  private handleEditorDrop(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    
    const editorEl = this.editor.containerEl
    editorEl.removeClass('s3-bridge-drag-over')
    this.toggleDragHint(false)
    
    this.handleDrop(event)
  }

  /**
   * 处理拖拽放下
   */
  @withErrorHandling({
    operation: 'Drag and Drop Upload',
    component: 'EditorDragDropHandler',
    userMessage: '拖拽上传处理失败',
    retryable: false
  })
  private handleDrop(event: DragEvent): void {
    const files = this.extractFilesFromEvent(event)
    
    if (files.length === 0) {
      return
    }

    // 过滤和处理文件
    const processedFiles = this.processFiles(files)
    
    if (processedFiles.length === 0) {
      new Notice('没有找到支持的文件类型')
      return
    }

    // 调用回调
    this.options.onDrop(event, processedFiles)
    
    // 处理文件
    this.processDroppedFiles(processedFiles)
  }

  /**
   * 从事件中提取文件
   */
  private extractFilesFromEvent(event: DragEvent): File[] {
    const files: File[] = []
    
    // 从 dataTransfer 中获取文件
    if (event.dataTransfer?.files) {
      files.push(...Array.from(event.dataTransfer.files))
    }
    
    // 从 dataTransfer 中获取项目（可能包含文件）
    if (event.dataTransfer?.items) {
      for (let i = 0; i < event.dataTransfer.items.length; i++) {
        const item = event.dataTransfer.items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file && !files.includes(file)) {
            files.push(file)
          }
        }
      }
    }
    
    return files
  }

  /**
   * 处理文件
   */
  private processFiles(files: File[]): File[] {
    return files.filter(file => {
      // 检查文件类型
      if (!this.isFileTypeAccepted(file)) {
        console.warn(`不支持的文件类型: ${file.type} (${file.name})`)
        return false
      }
      
      // 检查文件大小
      if (!this.isFileSizeValid(file)) {
        new Notice(`文件 ${file.name} 超过大小限制 (${this.options.maxFileSize}MB)`)
        return false
      }
      
      return true
    })
  }

  /**
   * 检查文件类型是否被接受
   */
  private isFileTypeAccepted(file: File): boolean {
    const acceptedTypes = this.options.acceptedTypes
    
    // 检查每个接受类型
    for (const acceptedType of acceptedTypes) {
      if (acceptedType === '*/*' || acceptedType === '*') {
        return true
      }
      
      if (acceptedType.endsWith('/*')) {
        const mimeType = acceptedType.slice(0, -1)
        if (file.type.startsWith(mimeType)) {
          return true
        }
      }
      
      if (file.type === acceptedType) {
        return true
      }
      
      // 检查文件扩展名
      const extension = '.' + file.name.split('.').pop()?.toLowerCase()
      if (acceptedType.includes(extension)) {
        return true
      }
    }
    
    return false
  }

  /**
   * 检查文件大小是否有效
   */
  private isFileSizeValid(file: File): boolean {
    const maxSizeBytes = this.options.maxFileSize * 1024 * 1024
    return file.size <= maxSizeBytes
  }

  /**
   * 处理拖拽的文件
   */
  private processDroppedFiles(files: File[]): void {
    try {
      // 获取全局批量上传器
      const batchUploader = getGlobalBatchUploader()
      
      // 添加文件到上传队列
      const addedIds = batchUploader.addFiles(files)
      
      if (addedIds.length > 0) {
        new Notice(`已添加 ${addedIds.length} 个文件到上传队列`)
        
        // 如果启用了自动开始上传
        if (this.options.autoStart) {
          batchUploader.start()
        }
      }
      
      // 调用处理完成回调
      this.options.onFilesProcessed(files)
    } catch (error) {
      errorHandler.handleError(error, {
        operation: 'Process Dropped Files',
        component: 'EditorDragDropHandler'
      })
    }
  }
}

/**
 * 拖拽上传管理器
 */
export class DragDropUploadManager {
  private handlers: Map<string, EditorDragDropHandler> = new Map()
  private globalOptions: DragDropOptions = {}

  /**
   * 为编辑器创建拖拽处理器
   */
  createHandler(editor: Editor, options?: DragDropOptions): string {
    const handlerId = `editor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const mergedOptions = { ...this.globalOptions, ...options }
    
    const handler = new EditorDragDropHandler(editor, mergedOptions)
    handler.enable()
    
    this.handlers.set(handlerId, handler)
    
    return handlerId
  }

  /**
   * 获取处理器
   */
  getHandler(id: string): EditorDragDropHandler | undefined {
    return this.handlers.get(id)
  }

  /**
   * 移除处理器
   */
  removeHandler(id: string): void {
    const handler = this.handlers.get(id)
    if (handler) {
      handler.destroy()
      this.handlers.delete(id)
    }
  }

  /**
   * 设置全局选项
   */
  setGlobalOptions(options: Partial<DragDropOptions>): void {
    this.globalOptions = { ...this.globalOptions, ...options }
    
    // 更新所有现有处理器
    this.handlers.forEach(handler => {
      handler.setOptions(this.globalOptions)
    })
  }

  /**
   * 启用所有处理器
   */
  enableAll(): void {
    this.handlers.forEach(handler => {
      handler.enable()
    })
  }

  /**
   * 禁用所有处理器
   */
  disableAll(): void {
    this.handlers.forEach(handler => {
      handler.disable()
    })
  }

  /**
   * 销毁所有处理器
   */
  destroyAll(): void {
    this.handlers.forEach(handler => {
      handler.destroy()
    })
    this.handlers.clear()
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalHandlers: number
    enabledHandlers: number
    globalOptions: DragDropOptions
  } {
    const enabledHandlers = Array.from(this.handlers.values()).filter(handler => handler.isEnabled()).length
    
    return {
      totalHandlers: this.handlers.size,
      enabledHandlers,
      globalOptions: this.globalOptions
    }
  }
}

// 全局拖拽上传管理器
const globalDragDropManager = new DragDropUploadManager()

// 导出便捷函数
export function createDragDropHandler(editor: Editor, options?: DragDropOptions): string {
  return globalDragDropManager.createHandler(editor, options)
}

export function getDragDropHandler(id: string): EditorDragDropHandler | undefined {
  return globalDragDropManager.getHandler(id)
}

export function removeDragDropHandler(id: string): void {
  globalDragDropManager.removeHandler(id)
}

export function setDragDropOptions(options: Partial<DragDropOptions>): void {
  globalDragDropManager.setGlobalOptions(options)
}

export function getDragDropStats() {
  return globalDragDropManager.getStats()
}