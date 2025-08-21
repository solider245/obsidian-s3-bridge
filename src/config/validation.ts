/**
 * 配置验证工具
 *
 * 提供各种配置验证器和验证规则
 */

import { ValidationResult } from './ConfigurationManager'

/**
 * URL 验证器
 */
export function validateUrl(value: string): ValidationResult {
	if (!value) {
		return { valid: true } // 空值是允许的
	}

	try {
		const url = new URL(value)

		// 检查协议
		if (!['http:', 'https:'].includes(url.protocol)) {
			return { valid: false, error: 'URL 必须使用 HTTP 或 HTTPS 协议' }
		}

		// 检查是否包含用户信息
		if (url.username || url.password) {
			return { valid: false, error: 'URL 不应包含用户名和密码' }
		}

		return { valid: true, value }
	} catch (error) {
		return { valid: false, error: '无效的 URL 格式' }
	}
}

/**
 * 文件大小验证器
 */
export function validateFileSize(value: number, min = 1, max = 100): ValidationResult {
	if (typeof value !== 'number' || isNaN(value)) {
		return { valid: false, error: '文件大小必须是数字' }
	}

	if (value < min) {
		return { valid: false, error: `文件大小不能小于 ${min}MB` }
	}

	if (value > max) {
		return { valid: false, error: `文件大小不能大于 ${max}MB` }
	}

	return { valid: true, value }
}

/**
 * 超时时间验证器
 */
export function validateTimeout(value: number, min = 1000, max = 300000): ValidationResult {
	if (typeof value !== 'number' || isNaN(value)) {
		return { valid: false, error: '超时时间必须是数字' }
	}

	if (value < min) {
		return { valid: false, error: `超时时间不能小于 ${min}ms` }
	}

	if (value > max) {
		return { valid: false, error: `超时时间不能大于 ${max}ms` }
	}

	return { valid: true, value }
}

/**
 * AWS 访问密钥验证器
 */
export function validateAccessKey(value: string): ValidationResult {
	if (!value) {
		return { valid: false, error: '访问密钥不能为空' }
	}

	// AWS Access Key ID 格式验证
	if (!/^[A-Z0-9]{20}$/.test(value)) {
		return { valid: false, error: '访问密钥格式不正确（应为 20 位大写字母和数字）' }
	}

	return { valid: true, value }
}

/**
 * AWS 秘密密钥验证器
 */
export function validateSecretKey(value: string): ValidationResult {
	if (!value) {
		return { valid: false, error: '秘密密钥不能为空' }
	}

	// AWS Secret Access Key 格式验证
	if (!/^[A-Za-z0-9/+=]{40}$/.test(value)) {
		return { valid: false, error: '秘密密钥格式不正确' }
	}

	return { valid: true, value }
}

/**
 * 存储桶名称验证器
 */
export function validateBucketName(value: string): ValidationResult {
	if (!value) {
		return { valid: false, error: '存储桶名称不能为空' }
	}

	// S3 存储桶名称规则
	const bucketRegex = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

	if (!bucketRegex.test(value)) {
		return { valid: false, error: '存储桶名称格式不正确' }
	}

	// 检查是否包含 IP 地址格式
	if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) {
		return { valid: false, error: '存储桶名称不能是 IP 地址格式' }
	}

	return { valid: true, value }
}

/**
 * 区域验证器
 */
export function validateRegion(value: string): ValidationResult {
	if (!value) {
		return { valid: true } // 空值表示自动检测
	}

	// AWS 区域格式验证
	const regionRegex = /^[a-z]{2}-[a-z]+-\d{1}$/

	if (!regionRegex.test(value)) {
		return { valid: false, error: '区域格式不正确（例如：us-east-1）' }
	}

	return { valid: true, value }
}

/**
 * 路径格式验证器
 */
export function validatePathFormat(value: string): ValidationResult {
	if (!value) {
		return { valid: false, error: '路径格式不能为空' }
	}

	// 检查是否包含占位符
	const placeholders = value.match(/{[^}]+}/g)
	if (!placeholders) {
		return { valid: false, error: '路径格式应包含占位符（如 {filename}）' }
	}

	// 检查是否包含非法字符
	const illegalChars = ['\\', '?', '*', ':', '"', '<', '>', '|']
	if (illegalChars.some(char => value.includes(char))) {
		return { valid: false, error: '路径格式包含非法字符' }
	}

	return { valid: true, value }
}

/**
 * 布尔值验证器
 */
export function validateBoolean(value: any): ValidationResult {
	if (typeof value !== 'boolean') {
		return { valid: false, error: '值必须是布尔类型' }
	}

	return { valid: true, value }
}

/**
 * 数字范围验证器
 */
export function validateNumberRange(value: number, min: number, max: number): ValidationResult {
	if (typeof value !== 'number' || isNaN(value)) {
		return { valid: false, error: '值必须是数字' }
	}

	if (value < min) {
		return { valid: false, error: `值不能小于 ${min}` }
	}

	if (value > max) {
		return { valid: false, error: `值不能大于 ${max}` }
	}

	return { valid: true, value }
}

/**
 * 枚举值验证器
 */
export function validateEnum<T extends string>(value: any, validValues: T[]): ValidationResult {
	if (!validValues.includes(value)) {
		return {
			valid: false,
			error: `值必须是以下之一: ${validValues.join(', ')}`,
		}
	}

	return { valid: true, value }
}

/**
 * 正则表达式验证器
 */
export function validateRegex(
	value: string,
	pattern: RegExp,
	errorMessage: string
): ValidationResult {
	if (!pattern.test(value)) {
		return { valid: false, error: errorMessage }
	}

	return { valid: true, value }
}

/**
 * 自定义验证器
 */
export function createValidator(
	validator: (value: any) => ValidationResult
): (value: any) => ValidationResult {
	return validator
}

/**
 * 组合验证器
 */
export function combineValidators(
	validators: ((value: any) => ValidationResult)[]
): (value: any) => ValidationResult {
	return (value: any) => {
		for (const validator of validators) {
			const result = validator(value)
			if (!result.valid) {
				return result
			}
		}
		return { valid: true, value }
	}
}

/**
 * 必填字段验证器
 */
export function validateRequired(value: any, fieldName = '字段'): ValidationResult {
	if (value === null || value === undefined || value === '') {
		return { valid: false, error: `${fieldName}不能为空` }
	}

	return { valid: true, value }
}

/**
 * 邮箱验证器
 */
export function validateEmail(value: string): ValidationResult {
	if (!value) {
		return { valid: true } // 空值是允许的
	}

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	if (!emailRegex.test(value)) {
		return { valid: false, error: '邮箱格式不正确' }
	}

	return { valid: true, value }
}

/**
 * 预定义验证规则集合
 */
export const validationRules = {
	// S3 配置验证
	s3: {
		endpoint: validateUrl,
		accessKey: validateAccessKey,
		secretKey: validateSecretKey,
		bucket: validateBucketName,
		region: validateRegion,
	},

	// 上传配置验证
	upload: {
		maxUploadMB: (value: number) => validateFileSize(value, 1, 100),
		presignTimeout: (value: number) => validateTimeout(value, 1000, 60000),
		uploadTimeout: (value: number) => validateTimeout(value, 1000, 300000),
		pathFormat: validatePathFormat,
	},

	// 性能配置验证
	performance: {
		chunkSize: (value: number) => validateNumberRange(value, 1024 * 1024, 100 * 1024 * 1024),
		maxConcurrentChunks: (value: number) => validateNumberRange(value, 1, 10),
		multipartThreshold: (value: number) =>
			validateNumberRange(value, 5 * 1024 * 1024, 100 * 1024 * 1024),
	},

	// 布尔配置验证
	boolean: validateBoolean,

	// 枚举配置验证
	logLevel: (value: string) => validateEnum(value, ['debug', 'info', 'warn', 'error']),
}
