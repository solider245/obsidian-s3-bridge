/**
 * Supabase 数据库集成模块
 *
 * 提供与Supabase数据库的集成功能
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { configManager } from '../config/ConfigurationManager'

// 数据库接口定义
export interface DatabaseFile {
	id: string
	user_id: string
	vault_id: string
	file_name: string
	original_name: string
	file_size: number
	mime_type: string
	file_hash: string
	storage_provider: string
	storage_bucket: string
	storage_key: string
	public_url: string
	thumbnail_url?: string
	width?: number
	height?: number
	duration?: number
	metadata?: Record<string, any>
	tags: string[]
	description?: string
	upload_status: 'pending' | 'uploading' | 'completed' | 'failed'
	upload_progress: number
	error_message?: string
	upload_started_at?: string
	upload_completed_at?: string
	last_accessed_at?: string
	access_count: number
	is_deleted: boolean
	deleted_at?: string
	created_at: string
	updated_at: string
}

export interface DatabaseVault {
	id: string
	user_id: string
	vault_name: string
	vault_path: string
	device_id?: string
	last_sync_at?: string
	sync_status: 'active' | 'inactive' | 'error'
	settings?: Record<string, any>
	created_at: string
	updated_at: string
}

export interface DatabaseUploadConfig {
	id: string
	user_id: string
	config_name: string
	storage_provider: string
	endpoint: string
	bucket: string
	region?: string
	access_key_id?: string
	public_url: string
	object_key_prefix: string
	size_limit: number
	cache_control: string
	is_default: boolean
	is_active: boolean
	settings?: Record<string, any>
	created_at: string
	updated_at: string
}

export interface DatabaseUsageStats {
	id: string
	user_id: string
	vault_id?: string
	date: string
	total_uploads: number
	total_size: number
	successful_uploads: number
	failed_uploads: number
	unique_files: number
	storage_costs: number
	bandwidth_used: number
	metadata?: Record<string, any>
	created_at: string
}

/**
 * Supabase 数据库管理器
 */
export class SupabaseDatabaseManager {
	private client: SupabaseClient | null = null
	private isConnected = false
	private retryCount = 0
	private maxRetries = 3

	constructor() {
		this.initializeClient()
	}

	/**
	 * 初始化Supabase客户端
	 */
	private initializeClient(): void {
		try {
			const supabaseUrl = configManager.get('supabaseUrl', '')
			const supabaseKey = configManager.get('supabaseKey', '')

			if (!supabaseUrl || !supabaseKey) {
				console.warn('Supabase配置未找到，数据库功能将不可用')
				return
			}

			this.client = createClient(supabaseUrl, supabaseKey, {
				auth: {
					persistSession: true,
					autoRefreshToken: true,
				},
			})

			this.isConnected = true
			console.log('Supabase客户端初始化成功')
		} catch (error) {
			console.error('Supabase客户端初始化失败:', error)
			this.isConnected = false
		}
	}

	/**
	 * 检查连接状态
	 */
	public isConnectedToDatabase(): boolean {
		return this.isConnected && this.client !== null
	}

	/**
	 * 获取Supabase客户端
	 */
	public getClient(): SupabaseClient | null {
		return this.client
	}

	/**
	 * 重试机制包装器
	 */
	private async withRetry<T>(operation: () => Promise<T>, errorMessage: string): Promise<T> {
		for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
			try {
				return await operation()
			} catch (error) {
				if (attempt === this.maxRetries) {
					throw new Error(`${errorMessage} (尝试 ${attempt}/${this.maxRetries}): ${error}`)
				}

				// 指数退避
				const delay = Math.pow(2, attempt) * 1000
				await new Promise(resolve => setTimeout(resolve, delay))
			}
		}
		throw new Error(errorMessage)
	}

	// === 文件管理功能 ===

	/**
	 * 创建文件记录
	 */
	public async createFile(
		fileData: Omit<DatabaseFile, 'id' | 'created_at' | 'updated_at'>
	): Promise<DatabaseFile | null> {
		if (!this.client) return null

		return this.withRetry(async () => {
			const { data, error } = await this.client!.from('files').insert([fileData]).select().single()

			if (error) throw error
			return data
		}, '创建文件记录失败')
	}

	/**
	 * 更新文件记录
	 */
	public async updateFile(
		fileId: string,
		updates: Partial<DatabaseFile>
	): Promise<DatabaseFile | null> {
		if (!this.client) return null

		return this.withRetry(async () => {
			const { data, error } = await this.client!.from('files')
				.update(updates)
				.eq('id', fileId)
				.select()
				.single()

			if (error) throw error
			return data
		}, '更新文件记录失败')
	}

	/**
	 * 获取文件记录
	 */
	public async getFile(fileId: string): Promise<DatabaseFile | null> {
		if (!this.client) return null

		return this.withRetry(async () => {
			const { data, error } = await this.client!.from('files').select('*').eq('id', fileId).single()

			if (error) throw error
			return data
		}, '获取文件记录失败')
	}

	/**
	 * 获取用户的所有文件
	 */
	public async getUserFiles(
		userId: string,
		options: {
			limit?: number
			offset?: number
			sortBy?: 'created_at' | 'file_size' | 'access_count'
			sortOrder?: 'asc' | 'desc'
			filter?: {
				upload_status?: string
				mime_type?: string
				tags?: string[]
				date_range?: { start: string; end: string }
			}
		} = {}
	): Promise<{ files: DatabaseFile[]; total: number }> {
		if (!this.client) return { files: [], total: 0 }

		return this.withRetry(async () => {
			let query = this.client!.from('files')
				.select('*', { count: 'exact' })
				.eq('user_id', userId)
				.eq('is_deleted', false)

			// 应用过滤条件
			if (options.filter) {
				if (options.filter.upload_status) {
					query = query.eq('upload_status', options.filter.upload_status)
				}
				if (options.filter.mime_type) {
					query = query.like('mime_type', `%${options.filter.mime_type}%`)
				}
				if (options.filter.tags && options.filter.tags.length > 0) {
					query = query.contains('tags', options.filter.tags)
				}
				if (options.filter.date_range) {
					query = query
						.gte('created_at', options.filter.date_range.start)
						.lte('created_at', options.filter.date_range.end)
				}
			}

			// 应用排序
			const sortBy = options.sortBy || 'created_at'
			const sortOrder = options.sortOrder || 'desc'
			query = query.order(sortBy, { ascending: sortOrder === 'asc' })

			// 应用分页
			if (options.limit) {
				query = query.limit(options.limit)
			}
			if (options.offset) {
				// @ts-ignore - Supabase客户端确实有offset方法
				query = query.offset(options.offset)
			}

			const { data, error, count } = await query

			if (error) throw error
			return { files: data || [], total: count || 0 }
		}, '获取用户文件列表失败')
	}

	/**
	 * 搜索文件
	 */
	public async searchFiles(
		userId: string,
		query: string,
		options: {
			limit?: number
			search_in?: 'file_name' | 'original_name' | 'tags' | 'description'
		} = {}
	): Promise<DatabaseFile[]> {
		if (!this.client) return []

		return this.withRetry(async () => {
			const searchIn = options.search_in || 'file_name'
			let dbQuery = this.client!.from('files')
				.select('*')
				.eq('user_id', userId)
				.eq('is_deleted', false)

			// 根据搜索字段构建查询
			switch (searchIn) {
				case 'file_name':
					dbQuery = dbQuery.ilike('file_name', `%${query}%`)
					break
				case 'original_name':
					dbQuery = dbQuery.ilike('original_name', `%${query}%`)
					break
				case 'tags':
					dbQuery = dbQuery.contains('tags', [query])
					break
				case 'description':
					dbQuery = dbQuery.ilike('description', `%${query}%`)
					break
			}

			if (options.limit) {
				dbQuery = dbQuery.limit(options.limit)
			}

			const { data, error } = await dbQuery

			if (error) throw error
			return data || []
		}, '搜索文件失败')
	}

	/**
	 * 软删除文件
	 */
	public async deleteFile(fileId: string): Promise<boolean> {
		if (!this.client) return false

		return this.withRetry(async () => {
			const { error } = await this.client!.from('files').delete().eq('id', fileId)

			if (error) throw error
			return true
		}, '删除文件失败')
	}

	/**
	 * 更新文件访问统计
	 */
	public async updateFileAccess(fileId: string): Promise<void> {
		if (!this.client) return

		return this.withRetry(async () => {
			const { error } = await this.client!.from('files')
				.update({
					last_accessed_at: new Date().toISOString(),
					access_count: (await this.getFile(fileId))?.access_count || 0 + 1,
				})
				.eq('id', fileId)

			if (error) throw error
		}, '更新文件访问统计失败')
	}

	// === 仓库管理功能 ===

	/**
	 * 创建仓库记录
	 */
	public async createVault(
		vaultData: Omit<DatabaseVault, 'id' | 'created_at' | 'updated_at'>
	): Promise<DatabaseVault | null> {
		if (!this.client) return null

		return this.withRetry(async () => {
			const { data, error } = await this.client!.from('vaults')
				.insert([vaultData])
				.select()
				.single()

			if (error) throw error
			return data
		}, '创建仓库记录失败')
	}

	/**
	 * 获取用户的仓库列表
	 */
	public async getUserVaults(userId: string): Promise<DatabaseVault[]> {
		if (!this.client) return []

		return this.withRetry(async () => {
			const { data, error } = await this.client!.from('vaults').select('*').eq('user_id', userId)

			if (error) throw error
			return data || []
		}, '获取用户仓库列表失败')
	}

	// === 上传配置管理功能 ===

	/**
	 * 创建上传配置
	 */
	public async createUploadConfig(
		configData: Omit<DatabaseUploadConfig, 'id' | 'created_at' | 'updated_at'>
	): Promise<DatabaseUploadConfig | null> {
		if (!this.client) return null

		return this.withRetry(async () => {
			const { data, error } = await this.client!.from('upload_configs')
				.insert([configData])
				.select()
				.single()

			if (error) throw error
			return data
		}, '创建上传配置失败')
	}

	/**
	 * 获取用户的上传配置列表
	 */
	public async getUserUploadConfigs(userId: string): Promise<DatabaseUploadConfig[]> {
		if (!this.client) return []

		return this.withRetry(async () => {
			const { data, error } = await this.client!.from('upload_configs')
				.select('*')
				.eq('user_id', userId)
				.eq('is_active', true)

			if (error) throw error
			return data || []
		}, '获取用户上传配置列表失败')
	}

	// === 统计功能 ===

	/**
	 * 获取用户使用统计
	 */
	public async getUserUsageStats(
		userId: string,
		dateRange?: { start: string; end: string }
	): Promise<DatabaseUsageStats[]> {
		if (!this.client) return []

		return this.withRetry(async () => {
			let query = this.client!.from('usage_stats').select('*').eq('user_id', userId)

			if (dateRange) {
				query = query.gte('date', dateRange.start).lte('date', dateRange.end)
			}

			const result = await query.order('date', { ascending: false })

			if (result.error) throw result.error
			return result.data || []
		}, '获取用户使用统计失败')
	}

	// === 实时同步功能 ===

	/**
	 * 订阅文件变更
	 */
	public subscribeToFileChanges(userId: string, callback: (payload: any) => void): () => void {
		if (!this.client) return () => {}

		const subscription = this.client
			.channel('file_changes')
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'files',
					filter: `user_id=eq.${userId}`,
				},
				callback
			)
			.subscribe()

		return () => {
			subscription.unsubscribe()
		}
	}

	/**
	 * 订阅仓库变更
	 */
	public subscribeToVaultChanges(userId: string, callback: (payload: any) => void): () => void {
		if (!this.client) return () => {}

		const subscription = this.client
			.channel('vault_changes')
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'vaults',
					filter: `user_id=eq.${userId}`,
				},
				callback
			)
			.subscribe()

		return () => {
			subscription.unsubscribe()
		}
	}

	// === 数据同步功能 ===

	/**
	 * 同步本地配置到远程
	 */
	public async syncLocalConfigToRemote(userId: string, configs: any[]): Promise<boolean> {
		if (!this.client) return false

		try {
			// 先删除远程配置
			await this.client.from('upload_configs').delete().eq('user_id', userId)

			// 插入新的配置
			const { error } = await this.client.from('upload_configs').insert(
				configs.map(config => ({
					...config,
					user_id: userId,
				}))
			)

			return !error
		} catch (error) {
			console.error('同步配置到远程失败:', error)
			return false
		}
	}

	/**
	 * 从远程同步配置到本地
	 */
	public async syncRemoteConfigToLocal(userId: string): Promise<any[]> {
		if (!this.client) return []

		try {
			const { data, error } = await this.client
				.from('upload_configs')
				.select('*')
				.eq('user_id', userId)

			if (error) throw error
			return data || []
		} catch (error) {
			console.error('从远程同步配置失败:', error)
			return []
		}
	}
}

// 导出单例实例
export const supabaseDatabaseManager = new SupabaseDatabaseManager()
