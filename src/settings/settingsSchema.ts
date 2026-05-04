// 概述: 设置项 Schema 定义 — 声明式描述每个设置字段，由 renderSettings 消费
// 导出: SettingFieldDef, UPLOAD_SETTINGS, COMPRESSION_SETTINGS, PROGRESS_SETTINGS, INTERFACE_SETTINGS, RETRY_SETTINGS, SUPABASE_SETTINGS, KEY_PREFIX_SETTINGS
// 依赖: 无

export interface SettingFieldDef {
	key: string
	type: 'toggle' | 'slider' | 'text'
	label: string
	desc: string
	defaultValue: unknown
	min?: number
	max?: number
	step?: number
	placeholder?: string
}

export const UPLOAD_SETTINGS: SettingFieldDef[] = [
	{
		key: 'enableBatchUpload',
		type: 'toggle',
		label: '启用批量上传',
		desc: '允许同时上传多个文件',
		defaultValue: true,
	},
	{
		key: 'maxConcurrentUploads',
		type: 'slider',
		label: '最大并发上传数',
		desc: '同时上传的最大文件数量',
		defaultValue: 2,
		min: 1,
		max: 10,
		step: 1,
	},
	{
		key: 'enableDragDrop',
		type: 'toggle',
		label: '启用拖拽上传',
		desc: '允许通过拖拽文件到编辑器进行上传',
		defaultValue: true,
	},
	{
		key: 'maxUploadSize',
		type: 'slider',
		label: '最大上传文件大小',
		desc: '单个文件的最大大小（MB）',
		defaultValue: 50,
		min: 1,
		max: 500,
		step: 1,
	},
]

export const COMPRESSION_SETTINGS: SettingFieldDef[] = [
	{
		key: 'enableImageCompression',
		type: 'toggle',
		label: 'Enable image compression',
		desc: 'Automatically resize large images before upload to save bandwidth',
		defaultValue: true,
	},
	{
		key: 'maxImageDimension',
		type: 'slider',
		label: 'Max image dimension (px)',
		desc: 'Images larger than this will be scaled down proportionally',
		defaultValue: 1920,
		min: 800,
		max: 4096,
		step: 100,
	},
	{
		key: 'imageQuality',
		type: 'slider',
		label: 'Image quality (%)',
		desc: 'JPEG/WEBP compression quality',
		defaultValue: 85,
		min: 50,
		max: 100,
		step: 5,
	},
]

export const PROGRESS_SETTINGS: SettingFieldDef[] = [
	{
		key: 'showUploadNotifications',
		type: 'toggle',
		label: '显示上传通知',
		desc: '在上传过程中显示通知',
		defaultValue: true,
	},
	{
		key: 'notificationThreshold',
		type: 'slider',
		label: '通知阈值（秒）',
		desc: '进度通知的最小间隔时间',
		defaultValue: 10,
		min: 1,
		max: 60,
		step: 1,
	},
	{
		key: 'showSpeedUpdates',
		type: 'toggle',
		label: '显示速度更新',
		desc: '在通知中显示上传速度变化',
		defaultValue: false,
	},
	{
		key: 'showCompletionAlerts',
		type: 'toggle',
		label: '显示完成提醒',
		desc: '上传完成时显示提醒通知',
		defaultValue: true,
	},
	{
		key: 'showErrorDetails',
		type: 'toggle',
		label: '显示错误详情',
		desc: '在错误通知中显示详细信息',
		defaultValue: true,
	},
]

export const INTERFACE_SETTINGS: SettingFieldDef[] = [
	{
		key: 'enableSpeedChart',
		type: 'toggle',
		label: '启用速度图表',
		desc: '在上传界面显示实时速度图表',
		defaultValue: true,
	},
	{
		key: 'enableEnhancedStats',
		type: 'toggle',
		label: '启用增强统计',
		desc: '显示详细的上传统计信息',
		defaultValue: true,
	},
	{
		key: 'autoStartUpload',
		type: 'toggle',
		label: '自动开始上传',
		desc: '添加文件后自动开始上传',
		defaultValue: false,
	},
]

export const RETRY_SETTINGS: SettingFieldDef[] = [
	{
		key: 'retryFailedUploads',
		type: 'toggle',
		label: '重试失败上传',
		desc: '上传失败时自动重试',
		defaultValue: true,
	},
	{
		key: 'maxRetries',
		type: 'slider',
		label: '最大重试次数',
		desc: '失败上传的最大重试次数',
		defaultValue: 3,
		min: 0,
		max: 10,
		step: 1,
	},
	{
		key: 'retryDelay',
		type: 'slider',
		label: '重试延迟（毫秒）',
		desc: '重试前的等待时间',
		defaultValue: 1000,
		min: 100,
		max: 10000,
		step: 100,
	},
]

export const SUPABASE_SETTINGS: SettingFieldDef[] = [
	{
		key: 'enableSupabaseSync',
		type: 'toggle',
		label: '启用Supabase同步',
		desc: '启用与Supabase数据库的同步功能',
		defaultValue: false,
	},
	{
		key: 'supabaseUrl',
		type: 'text',
		label: 'Supabase URL',
		desc: 'Supabase项目的URL',
		defaultValue: '',
		placeholder: 'https://your-project.supabase.co',
	},
	{
		key: 'supabaseKey',
		type: 'text',
		label: 'Supabase Key',
		desc: 'Supabase项目的匿名密钥',
		defaultValue: '',
		placeholder: 'your-anon-key',
	},
	{
		key: 'enableAutoSync',
		type: 'toggle',
		label: '启用自动同步',
		desc: '自动同步数据到云端',
		defaultValue: true,
	},
	{
		key: 'syncInterval',
		type: 'slider',
		label: '同步间隔（分钟）',
		desc: '自动同步的时间间隔',
		defaultValue: 30,
		min: 5,
		max: 120,
		step: 5,
	},
]
