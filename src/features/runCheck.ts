import { Notice, Plugin } from 'obsidian'
import { loadActiveProfile, S3Profile } from '../../s3/s3Manager'
import { t, tp } from '../l10n'
import { getErrorMessage } from '../utils/errorHandling'

/**
 * 执行本地配置的静态校验
 * @param profile 待校验的配置
 * @returns 如果校验失败，则抛出错误
 */
function localCheck(profile: S3Profile) {
	if (!profile) {
		throw new Error(t('No active profile found'))
	}
	const miss: string[] = []
	const must: Array<keyof S3Profile> = ['bucketName', 'accessKeyId', 'secretAccessKey']
	if (profile.providerType === 'aws-s3') {
		must.push('region')
	}
	for (const k of must) {
		if (!profile[k]) {
			miss.push(String(k))
		}
	}

	const urlWarn: string[] = []
	if (profile.baseUrl) {
		try {
			const u = new URL(profile.baseUrl)
			if (!/^https?:$/i.test(u.protocol)) {
				urlWarn.push('protocol not http/https')
			}
		} catch {
			urlWarn.push('invalid baseUrl URL')
		}
	}

	if (miss.length > 0 || urlWarn.length > 0) {
		const parts: string[] = []
		if (miss.length) parts.push(`Missing: ${miss.join(', ')}`)
		if (urlWarn.length) parts.push(`BaseURL: ${urlWarn.join('; ')}`)
		throw new Error(parts.join(' | '))
	}
}

/**
 * 执行真实的上传测试
 * @param plugin 插件实例
 * @returns 如果测试成功，返回 true
 */
async function onlineCheck(plugin: Plugin) {
	const cfg = loadActiveProfile(plugin)

	// 生成最小测试对象
	const safePrefix = (cfg.keyPrefix ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
	const prefixWithSlash = safePrefix ? `${safePrefix}/` : ''
	const testKey = `${prefixWithSlash}__ob_test__${Date.now()}_${Math.random().toString(36).slice(2)}.png`
	const tinyPngBase64 =
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOQy5CwAAAAASUVORK5CYII='
	const contentType = 'image/png'
	const bytes = Math.floor((tinyPngBase64.length * 3) / 4)

	// 走与主流程一致的预签名+PUT路径
	const [{ presignAndPutObject }] = await Promise.all([import('../uploader/presignPut')])
	await presignAndPutObject(plugin, { key: testKey, contentType, bodyBase64: tinyPngBase64 })
	new Notice(tp('Test upload succeeded: {bytes} bytes', { bytes: String(bytes) }))
	return true
}

/**
 * 运行一个完整的检查流程：先本地校验，再在线测试
 * @param plugin 插件实例
 */
export async function runCheck(plugin: Plugin) {
	try {
		// 1. 本地校验
		const profile = loadActiveProfile(plugin)
		localCheck(profile)
		new Notice(t('Local validation passed, starting online test...'))

		// 2. 在线测试
		await onlineCheck(plugin)
	} catch (e: unknown) {
		new Notice(tp('Check failed: {error}', { error: getErrorMessage(e) }))
	}
}
