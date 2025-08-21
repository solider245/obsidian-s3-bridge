/**
 * 文件管理界面
 * 
 * 提供文件浏览、搜索、管理功能
 */

import { supabaseDatabaseManager } from '../database/SupabaseDatabaseManager'
import { dataSyncService, SyncStatus, SyncType } from '../database/DataSyncService'
import { configManager } from '../config/ConfigurationManager'
import { Modal, App, Setting, TextComponent, ButtonComponent, DropdownComponent } from 'obsidian'

// 文件项接口
interface FileItem {
    id: string
    fileName: string
    originalName: string
    fileSize: number
    mimeType: string
    uploadStatus: string
    uploadProgress: number
    publicUrl: string
    thumbnailUrl?: string
    tags: string[]
    description?: string
    createdAt: string
    lastAccessedAt?: string
    accessCount: number
}

// 文件过滤器接口
interface FileFilter {
    status?: string
    mimeType?: string
    tags?: string[]
    dateRange?: { start: string; end: string }
    sizeRange?: { min: number; max: number }
}

/**
 * 文件管理模态框
 */
export class FileManagerModal extends Modal {
    private files: FileItem[] = []
    private filteredFiles: FileItem[] = []
    private currentPage = 1
    private itemsPerPage = 20
    private totalFiles = 0
    private isLoading = false
    private currentFilter: FileFilter = {}
    private searchQuery = ''
    private sortBy: 'createdAt' | 'fileSize' | 'accessCount' = 'createdAt'
    private sortOrder: 'asc' | 'desc' = 'desc'

    // UI 元素
    private searchInput: TextComponent | null = null
    private statusFilter: DropdownComponent | null = null
    private typeFilter: DropdownComponent | null = null
    private fileListEl: HTMLElement | null = null
    private paginationEl: HTMLElement | null = null
    private statsEl: HTMLElement | null = null

    constructor(app: App) {
        super(app)
    }

    onOpen() {
        const { contentEl } = this

        contentEl.createEl('h2', { text: '文件管理' })

        // 创建工具栏
        this.createToolbar(contentEl)

        // 创建过滤器
        this.createFilters(contentEl)

        // 创建统计信息
        this.createStats(contentEl)

        // 创建文件列表
        this.createFileList(contentEl)

        // 创建分页
        this.createPagination(contentEl)

        // 创建操作按钮
        this.createActions(contentEl)

        // 加载文件数据
        this.loadFiles()

        // 设置实时同步
        this.setupRealtimeSync()
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }

    /**
     * 创建工具栏
     */
    private createToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv({ cls: 'file-manager-toolbar' })

        // 搜索框
        const searchContainer = toolbar.createDiv({ cls: 'file-manager-search' })
        searchContainer.createEl('label', { text: '搜索:' })
        this.searchInput = new TextComponent(searchContainer)
            .setPlaceholder('输入文件名、标签或描述...')
            .onChange(value => {
                this.searchQuery = value
                this.applyFilters()
            })

        // 刷新按钮
        const refreshButton = toolbar.createEl('button', {
            cls: 'file-manager-refresh',
            text: '刷新'
        })
        refreshButton.addEventListener('click', () => {
            this.loadFiles()
        })

        // 同步按钮
        const syncButton = toolbar.createEl('button', {
            cls: 'file-manager-sync',
            text: '同步'
        })
        syncButton.addEventListener('click', () => {
            this.syncFiles()
        })
    }

    /**
     * 创建过滤器
     */
    private createFilters(container: HTMLElement): void {
        const filtersContainer = container.createDiv({ cls: 'file-manager-filters' })

        // 状态过滤器
        const statusFilterContainer = filtersContainer.createDiv({ cls: 'file-manager-filter' })
        statusFilterContainer.createEl('label', { text: '状态:' })
        this.statusFilter = new DropdownComponent(statusFilterContainer)
            .addOption('', '全部')
            .addOption('completed', '已完成')
            .addOption('uploading', '上传中')
            .addOption('failed', '失败')
            .addOption('pending', '等待中')
            .onChange(value => {
                this.currentFilter.status = value || undefined
                this.applyFilters()
            })

        // 类型过滤器
        const typeFilterContainer = filtersContainer.createDiv({ cls: 'file-manager-filter' })
        typeFilterContainer.createEl('label', { text: '类型:' })
        this.typeFilter = new DropdownComponent(typeFilterContainer)
            .addOption('', '全部')
            .addOption('image/', '图片')
            .addOption('video/', '视频')
            .addOption('audio/', '音频')
            .addOption('application/pdf', 'PDF')
            .addOption('text/', '文本')
            .onChange(value => {
                this.currentFilter.mimeType = value || undefined
                this.applyFilters()
            })

        // 排序选择
        const sortContainer = filtersContainer.createDiv({ cls: 'file-manager-filter' })
        sortContainer.createEl('label', { text: '排序:' })
        const sortSelect = sortContainer.createEl('select')
        sortSelect.innerHTML = `
            <option value="createdAt_desc">创建时间 ↓</option>
            <option value="createdAt_asc">创建时间 ↑</option>
            <option value="fileSize_desc">文件大小 ↓</option>
            <option value="fileSize_asc">文件大小 ↑</option>
            <option value="accessCount_desc">访问次数 ↓</option>
            <option value="accessCount_asc">访问次数 ↑</option>
        `
        sortSelect.addEventListener('change', (e) => {
            const value = (e.target as HTMLSelectElement).value
            const [field, order] = value.split('_')
            this.sortBy = field as any
            this.sortOrder = order as any
            this.applyFilters()
        })
    }

    /**
     * 创建统计信息
     */
    private createStats(container: HTMLElement): void {
        this.statsEl = container.createDiv({ cls: 'file-manager-stats' })
        this.updateStats()
    }

    /**
     * 创建文件列表
     */
    private createFileList(container: HTMLElement): void {
        this.fileListEl = container.createDiv({ cls: 'file-manager-list' })
        this.updateFileList()
    }

    /**
     * 创建分页
     */
    private createPagination(container: HTMLElement): void {
        this.paginationEl = container.createDiv({ cls: 'file-manager-pagination' })
        this.updatePagination()
    }

    /**
     * 创建操作按钮
     */
    private createActions(container: HTMLElement): void {
        const actionsContainer = container.createDiv({ cls: 'file-manager-actions' })

        // 批量操作
        const batchContainer = actionsContainer.createDiv({ cls: 'file-manager-batch-actions' })
        
        const selectAllButton = batchContainer.createEl('button', {
            cls: 'file-manager-select-all',
            text: '全选'
        })
        selectAllButton.addEventListener('click', () => {
            this.selectAllFiles()
        })

        const deleteSelectedButton = batchContainer.createEl('button', {
            cls: 'file-manager-delete-selected mod-warning',
            text: '删除选中'
        })
        deleteSelectedButton.addEventListener('click', () => {
            this.deleteSelectedFiles()
        })

        // 导出功能
        const exportContainer = actionsContainer.createDiv({ cls: 'file-manager-export' })
        
        const exportJsonButton = exportContainer.createEl('button', {
            cls: 'file-manager-export-json',
            text: '导出JSON'
        })
        exportJsonButton.addEventListener('click', () => {
            this.exportFiles('json')
        })

        const exportCsvButton = exportContainer.createEl('button', {
            cls: 'file-manager-export-csv',
            text: '导出CSV'
        })
        exportCsvButton.addEventListener('click', () => {
            this.exportFiles('csv')
        })
    }

    /**
     * 加载文件数据
     */
    private async loadFiles(): Promise<void> {
        if (this.isLoading) return

        this.isLoading = true
        this.showLoading()

        try {
            const userId = configManager.get('userId', '')
            if (!userId) {
                throw new Error('用户ID未找到')
            }

            const result = await supabaseDatabaseManager.getUserFiles(userId, {
                limit: this.itemsPerPage,
                offset: (this.currentPage - 1) * this.itemsPerPage,
                sortBy: this.sortBy as 'created_at' | 'file_size' | 'access_count',
                sortOrder: this.sortOrder,
                filter: this.currentFilter
            })

            this.files = result.files.map(file => ({
                id: file.id,
                fileName: file.file_name,
                originalName: file.original_name,
                fileSize: file.file_size,
                mimeType: file.mime_type,
                uploadStatus: file.upload_status,
                uploadProgress: file.upload_progress,
                publicUrl: file.public_url,
                thumbnailUrl: file.thumbnail_url,
                tags: file.tags,
                description: file.description,
                createdAt: file.created_at,
                lastAccessedAt: file.last_accessed_at,
                accessCount: file.access_count
            }))

            this.totalFiles = result.total
            this.filteredFiles = [...this.files]
            
            this.updateStats()
            this.updateFileList()
            this.updatePagination()
        } catch (error) {
            console.error('加载文件失败:', error)
            this.showError('加载文件失败: ' + error.message)
        } finally {
            this.isLoading = false
            this.hideLoading()
        }
    }

    /**
     * 应用过滤器
     */
    private applyFilters(): void {
        this.filteredFiles = this.files.filter(file => {
            // 搜索过滤
            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase()
                const matchesSearch = 
                    file.fileName.toLowerCase().includes(query) ||
                    file.originalName.toLowerCase().includes(query) ||
                    file.tags.some(tag => tag.toLowerCase().includes(query)) ||
                    (file.description && file.description.toLowerCase().includes(query))
                
                if (!matchesSearch) return false
            }

            // 状态过滤
            if (this.currentFilter.status && file.uploadStatus !== this.currentFilter.status) {
                return false
            }

            // 类型过滤
            if (this.currentFilter.mimeType && !file.mimeType.includes(this.currentFilter.mimeType)) {
                return false
            }

            return true
        })

        this.currentPage = 1
        this.updateFileList()
        this.updatePagination()
    }

    /**
     * 更新统计信息
     */
    private updateStats(): void {
        if (!this.statsEl) return

        const totalSize = this.files.reduce((sum, file) => sum + file.fileSize, 0)
        const completedCount = this.files.filter(file => file.uploadStatus === 'completed').length
        const failedCount = this.files.filter(file => file.uploadStatus === 'failed').length
        const uploadingCount = this.files.filter(file => file.uploadStatus === 'uploading').length

        this.statsEl.innerHTML = `
            <div class="file-manager-stat">
                <span class="file-manager-stat-label">总文件:</span>
                <span class="file-manager-stat-value">${this.totalFiles}</span>
            </div>
            <div class="file-manager-stat">
                <span class="file-manager-stat-label">总大小:</span>
                <span class="file-manager-stat-value">${this.formatFileSize(totalSize)}</span>
            </div>
            <div class="file-manager-stat">
                <span class="file-manager-stat-label">已完成:</span>
                <span class="file-manager-stat-value">${completedCount}</span>
            </div>
            <div class="file-manager-stat">
                <span class="file-manager-stat-label">失败:</span>
                <span class="file-manager-stat-value">${failedCount}</span>
            </div>
            <div class="file-manager-stat">
                <span class="file-manager-stat-label">上传中:</span>
                <span class="file-manager-stat-value">${uploadingCount}</span>
            </div>
        `
    }

    /**
     * 更新文件列表
     */
    private updateFileList(): void {
        if (!this.fileListEl) return

        this.fileListEl.empty()

        if (this.filteredFiles.length === 0) {
            this.fileListEl.createEl('div', {
                cls: 'file-manager-empty',
                text: '没有找到文件'
            })
            return
        }

        // 计算分页
        const startIndex = (this.currentPage - 1) * this.itemsPerPage
        const endIndex = startIndex + this.itemsPerPage
        const pageFiles = this.filteredFiles.slice(startIndex, endIndex)

        // 创建文件项
        pageFiles.forEach(file => {
            const fileItem = this.createFileItem(file)
            this.fileListEl?.appendChild(fileItem)
        })
    }

    /**
     * 创建文件项
     */
    private createFileItem(file: FileItem): HTMLElement {
        const fileItem = document.createElement('div')
        fileItem.className = 'file-manager-item'
        fileItem.setAttribute('data-file-id', file.id)

        // 文件信息
        const fileInfo = fileItem.createDiv({ cls: 'file-manager-item-info' })

        // 文件图标/缩略图
        const fileIcon = fileInfo.createDiv({ cls: 'file-manager-item-icon' })
        if (file.thumbnailUrl) {
            const img = fileIcon.createEl('img', {
                cls: 'file-manager-item-thumbnail',
                attr: { src: file.thumbnailUrl, alt: file.fileName }
            })
        } else {
            const icon = this.getFileIcon(file.mimeType)
            fileIcon.innerHTML = icon
        }

        // 文件详情
        const fileDetails = fileInfo.createDiv({ cls: 'file-manager-item-details' })
        
        const fileName = fileDetails.createEl('div', {
            cls: 'file-manager-item-name',
            text: file.originalName
        })

        const fileInfoMeta = fileDetails.createDiv({ cls: 'file-manager-item-meta' })
        fileInfoMeta.innerHTML = `
            <span class="file-manager-item-size">${this.formatFileSize(file.fileSize)}</span>
            <span class="file-manager-item-type">${this.getMimeTypeText(file.mimeType)}</span>
            <span class="file-manager-item-date">${this.formatDate(file.createdAt)}</span>
        `

        // 文件状态
        const fileStatus = fileItem.createDiv({ cls: 'file-manager-item-status' })
        const statusBadge = fileStatus.createDiv({
            cls: `file-manager-status-badge file-manager-status-${file.uploadStatus}`,
            text: this.getStatusText(file.uploadStatus)
        })

        // 进度条
        if (file.uploadStatus === 'uploading') {
            const progressBar = fileStatus.createDiv({ cls: 'file-manager-item-progress' })
            const progressFill = progressBar.createDiv({ cls: 'file-manager-item-progress-fill' })
            progressFill.style.width = `${file.uploadProgress}%`
        }

        // 文件操作
        const fileActions = fileItem.createDiv({ cls: 'file-manager-item-actions' })

        // 查看按钮
        const viewButton = fileActions.createEl('button', {
            cls: 'file-manager-item-view',
            text: '查看'
        })
        viewButton.addEventListener('click', () => {
            this.viewFile(file)
        })

        // 下载按钮
        const downloadButton = fileActions.createEl('button', {
            cls: 'file-manager-item-download',
            text: '下载'
        })
        downloadButton.addEventListener('click', () => {
            this.downloadFile(file)
        })

        // 删除按钮
        const deleteButton = fileActions.createEl('button', {
            cls: 'file-manager-item-delete mod-warning',
            text: '删除'
        })
        deleteButton.addEventListener('click', () => {
            this.deleteFile(file)
        })

        // 复制链接按钮
        const copyButton = fileActions.createEl('button', {
            cls: 'file-manager-item-copy',
            text: '复制链接'
        })
        copyButton.addEventListener('click', () => {
            this.copyFileUrl(file)
        })

        return fileItem
    }

    /**
     * 更新分页
     */
    private updatePagination(): void {
        if (!this.paginationEl) return

        this.paginationEl.empty()

        const totalPages = Math.ceil(this.filteredFiles.length / this.itemsPerPage)
        if (totalPages <= 1) return

        const pagination = this.paginationEl.createDiv({ cls: 'file-manager-pagination-controls' })

        // 上一页按钮
        const prevButton = pagination.createEl('button', {
            cls: 'file-manager-pagination-prev',
            text: '上一页'
        })
        prevButton.disabled = this.currentPage === 1
        prevButton.addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--
                this.updateFileList()
                this.updatePagination()
            }
        })

        // 页码
        const pageInfo = pagination.createDiv({ cls: 'file-manager-pagination-info' })
        pageInfo.textContent = `第 ${this.currentPage} 页，共 ${totalPages} 页`

        // 下一页按钮
        const nextButton = pagination.createEl('button', {
            cls: 'file-manager-pagination-next',
            text: '下一页'
        })
        nextButton.disabled = this.currentPage === totalPages
        nextButton.addEventListener('click', () => {
            if (this.currentPage < totalPages) {
                this.currentPage++
                this.updateFileList()
                this.updatePagination()
            }
        })
    }

    /**
     * 设置实时同步
     */
    private setupRealtimeSync(): void {
        const userId = configManager.get('userId', '')
        if (!userId) return

        // 监听文件变更
        supabaseDatabaseManager.subscribeToFileChanges(userId, (payload) => {
            console.log('文件变更:', payload)
            this.loadFiles()
        })

        // 监听同步状态
        dataSyncService.addSyncListener((event) => {
            console.log('同步事件:', event)
            if (event.type === 'complete') {
                this.loadFiles()
            }
        })
    }

    /**
     * 同步文件
     */
    private async syncFiles(): Promise<void> {
        try {
            await dataSyncService.performSync(SyncType.FILES)
            this.showSuccess('文件同步完成')
        } catch (error) {
            this.showError('文件同步失败: ' + error.message)
        }
    }

    /**
     * 查看文件
     */
    private viewFile(file: FileItem): void {
        window.open(file.publicUrl, '_blank')
        
        // 更新访问统计
        supabaseDatabaseManager.updateFileAccess(file.id)
    }

    /**
     * 下载文件
     */
    private downloadFile(file: FileItem): void {
        const link = document.createElement('a')
        link.href = file.publicUrl
        link.download = file.originalName
        link.click()
        
        // 更新访问统计
        supabaseDatabaseManager.updateFileAccess(file.id)
    }

    /**
     * 删除文件
     */
    private async deleteFile(file: FileItem): Promise<void> {
        if (!confirm(`确定要删除文件 "${file.originalName}" 吗？`)) {
            return
        }

        try {
            const success = await supabaseDatabaseManager.deleteFile(file.id)
            if (success) {
                this.showSuccess('文件删除成功')
                this.loadFiles()
            } else {
                this.showError('文件删除失败')
            }
        } catch (error) {
            this.showError('文件删除失败: ' + error.message)
        }
    }

    /**
     * 复制文件链接
     */
    private copyFileUrl(file: FileItem): void {
        navigator.clipboard.writeText(file.publicUrl).then(() => {
            this.showSuccess('链接已复制到剪贴板')
        }).catch(() => {
            this.showError('复制链接失败')
        })
    }

    /**
     * 全选文件
     */
    private selectAllFiles(): void {
        const checkboxes = this.fileListEl?.querySelectorAll('.file-manager-item-checkbox') as NodeListOf<HTMLInputElement>
        checkboxes?.forEach(checkbox => {
            checkbox.checked = true
        })
    }

    /**
     * 删除选中的文件
     */
    private async deleteSelectedFiles(): Promise<void> {
        const selectedItems = this.fileListEl?.querySelectorAll('.file-manager-item-checkbox:checked')
        if (!selectedItems || selectedItems.length === 0) {
            this.showError('请先选择要删除的文件')
            return
        }

        if (!confirm(`确定要删除选中的 ${selectedItems.length} 个文件吗？`)) {
            return
        }

        try {
            for (let i = 0; i < selectedItems.length; i++) {
                const item = selectedItems[i] as Element
                const fileItem = item.closest('.file-manager-item')
                const fileId = fileItem?.getAttribute('data-file-id')
                if (fileId) {
                    await supabaseDatabaseManager.deleteFile(fileId)
                }
            }
            
            this.showSuccess('选中的文件删除成功')
            this.loadFiles()
        } catch (error) {
            this.showError('删除文件失败: ' + error.message)
        }
    }

    /**
     * 导出文件
     */
    private exportFiles(format: 'json' | 'csv'): void {
        const exportData = this.filteredFiles.map(file => ({
            文件名: file.originalName,
            大小: file.fileSize,
            类型: file.mimeType,
            状态: file.uploadStatus,
            链接: file.publicUrl,
            标签: file.tags.join(', '),
            创建时间: file.createdAt,
            访问次数: file.accessCount
        }))

        let content: string
        let filename: string
        let mimeType: string

        if (format === 'json') {
            content = JSON.stringify(exportData, null, 2)
            filename = `files_${new Date().toISOString().split('T')[0]}.json`
            mimeType = 'application/json'
        } else {
            content = this.convertToCSV(exportData)
            filename = `files_${new Date().toISOString().split('T')[0]}.csv`
            mimeType = 'text/csv'
        }

        const blob = new Blob([content], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        URL.revokeObjectURL(url)
    }

    /**
     * 转换为CSV格式
     */
    private convertToCSV(data: any[]): string {
        if (data.length === 0) return ''

        const headers = Object.keys(data[0])
        const csvContent = [
            headers.join(','),
            ...data.map(row => headers.map(header => {
                const value = row[header]
                return typeof value === 'string' && value.includes(',') 
                    ? `"${value}"` 
                    : value
            }).join(','))
        ].join('\n')

        return csvContent
    }

    // 工具方法

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    private getMimeTypeText(mimeType: string): string {
        if (mimeType.startsWith('image/')) return '图片'
        if (mimeType.startsWith('video/')) return '视频'
        if (mimeType.startsWith('audio/')) return '音频'
        if (mimeType === 'application/pdf') return 'PDF'
        if (mimeType.startsWith('text/')) return '文本'
        return '文件'
    }

    private getFileIcon(mimeType: string): string {
        if (mimeType.startsWith('image/')) return '🖼️'
        if (mimeType.startsWith('video/')) return '🎥'
        if (mimeType.startsWith('audio/')) return '🎵'
        if (mimeType === 'application/pdf') return '📄'
        if (mimeType.startsWith('text/')) return '📝'
        return '📎'
    }

    private formatDate(dateString: string): string {
        const date = new Date(dateString)
        return date.toLocaleDateString('zh-CN')
    }

    private getStatusText(status: string): string {
        const statusMap = {
            'pending': '等待中',
            'uploading': '上传中',
            'completed': '已完成',
            'failed': '失败'
        }
        return statusMap[status as keyof typeof statusMap] || status
    }

    private showLoading(): void {
        // 显示加载状态
    }

    private hideLoading(): void {
        // 隐藏加载状态
    }

    private showSuccess(message: string): void {
        // 显示成功消息
        console.log('Success:', message)
    }

    private showError(message: string): void {
        // 显示错误消息
        console.error('Error:', message)
    }
}