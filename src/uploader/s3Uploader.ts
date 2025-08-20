import { Plugin, Notice } from 'obsidian'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { loadS3Config } from '../../s3/s3Manager'

// 掩码工具：对敏感信息做最小化脱敏
function maskAccessKey(id: string | undefined) {
	if (!id) return ''
	if (id.length <= 5) return id[0] + '***'
	return id.slice(0, 3) + '***' + id.slice(-2)
}

function sanitizeEndpoint(endpoint: string | undefined) {
	if (!endpoint) return ''
	try {
		const u = new URL(endpoint)
		return `${u.protocol}//${u.hostname}`
	} catch {
		// 非法 URL 时，尽量仅返回输入的主干
		return String(endpoint).replace(/\/+$/, '')
	}
}

// R2 API endpoint 校验：必须 cloudflarestorage.com，且不包含 bucket 段；禁止 r2.dev 作为 API
function validateR2ApiEndpoint(ep: string) {
	const trimmed = (ep || '').replace(/\/+$/, '')
	if (!/^https?:\/\//i.test(trimmed)) {
		throw new Error(
			'Invalid endpoint: must start with http(s):// and be a Cloudflare R2 API endpoint'
		)
	}
	const u = new URL(trimmed)
	const host = u.hostname.toLowerCase()
	if (!host.endsWith('.r2.cloudflarestorage.com')) {
		if (host.endsWith('.r2.dev')) {
			throw new Error(
				'Invalid endpoint: r2.dev is public access domain, not API endpoint. Use ACCOUNT_ID.r2.cloudflarestorage.com'
			)
		}
		// 其他 S3 兼容端点（如 MinIO）放行，不做强制
	}
	// 若路径中夹带 bucket，拒绝
	if (u.pathname && u.pathname !== '/') {
		throw new Error(
			'Invalid endpoint: do not include bucket in endpoint path, use path-style with separate bucket field'
		)
	}
}

function classifyError(e: Error): string {
	const msg = (e?.message ?? '').toString()
	const name = (e?.name ?? '').toString()
	const code = (e as any)?.code ?? ''

	// DNS/连接类
	if (/ENOTFOUND|EAI_AGAIN/i.test(code) || /ENOTFOUND|EAI_AGAIN/i.test(msg)) {
		return 'Network DNS error: unable to resolve endpoint host'
	}
	if (
		/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(code) ||
		/ECONNREFUSED|ECONNRESET/i.test(msg)
	) {
		return 'Network connection error: connection refused or reset'
	}

	// TLS/证书
	if (
		/SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_|SSL_/i.test(code) ||
		/certificate|SSL/i.test(msg)
	) {
		return 'TLS certificate error: verify SSL or set Use SSL accordingly'
	}

	// 超时
	if (/ETIMEDOUT|timeout/i.test(code) || /timed out|Timeout/i.test(msg)) {
		return 'Network timeout: check connectivity or proxy settings'
	}

	// S3 鉴权/权限
	if (
		/AccessDenied|SignatureDoesNotMatch|InvalidAccessKeyId|ExpiredToken/i.test(
			msg + ' ' + name + ' ' + code
		)
	) {
		return 'Authentication error: verify access key, secret, region and endpoint'
	}

	// 桶不存在
	if (/NoSuchBucket/i.test(msg + ' ' + name + ' ' + code)) {
		return 'NoSuchBucket: verify bucket name and account binding'
	}

	// 默认
	return msg || 'Unknown error'
}

/**
 * 使用主进程 Node S3Client 进行 PUT 然后 DELETE 的连通性测试
 * 要求：R2 endpoint 不包含 bucket，使用 path-style
 * 注意：此测试不访问任何公开 URL，以避免渲染端触发 CORS
 */
export async function testConnection(
	plugin: Plugin,
	opts: { key: string; contentType: string; bodyBase64: string }
): Promise<void> {
	const cfg = loadS3Config(plugin)
	if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
		throw new Error(
			'S3 settings incomplete: endpoint/accessKeyId/secretAccessKey/bucketName are required'
		)
	}

	const endpoint = (cfg.endpoint || '').replace(/\/+$/, '')
	const region = cfg.region && cfg.region.trim() ? cfg.region.trim() : 'us-east-1'

	// R2 API endpoint 规则校验
	try {
		validateR2ApiEndpoint(endpoint)
	} catch (e) {
		throw new Error((e as Error).message)
	}

	// 诊断日志（脱敏）
	try {
		const maskedAk = maskAccessKey(cfg.accessKeyId)
		const safeEp = sanitizeEndpoint(endpoint)
		// 打点：标记主进程通道
		// eslint-disable-next-line no-console
		console.info('[ob-s3-gemini] Using main channel for S3 test', {
			endpoint: safeEp,
			region,
			accessKeyId: maskedAk,
			tls: cfg.useSSL,
			electron: (process.versions as any)?.electron,
			node: process.version,
			hasHTTPProxy: !!process.env.HTTP_PROXY || !!process.env.http_proxy,
			hasHTTPSProxy: !!process.env.HTTPS_PROXY || !!process.env.https_proxy,
		})
	} catch {
		/* ignore logging errors */
	}

	const client = new S3Client({
		endpoint,
		region,
		forcePathStyle: true,
		credentials: {
			accessKeyId: cfg.accessKeyId,
			secretAccessKey: cfg.secretAccessKey,
		},
		tls: cfg.useSSL,
	})

	const body = Buffer.from(opts.bodyBase64, 'base64')

	try {
		// PUT
		await client.send(
			new PutObjectCommand({
				Bucket: cfg.bucketName,
				Key: opts.key,
				Body: body,
				ContentType: opts.contentType || 'application/octet-stream',
			})
		)

		// DELETE
		await client.send(
			new DeleteObjectCommand({
				Bucket: cfg.bucketName,
				Key: opts.key,
			})
		)

		// 仅用于提示，不返回任何 URL，避免上层去 fetch
		try {
			new Notice('S3 test completed in main process. No public URL requests were made.')
		} catch {
			/* ignore */
		}
	} catch (e) {
		const hint = classifyError(e)
		// 将原始错误输出到控制台，便于深入排查
		// eslint-disable-next-line no-console
		console.error('[ob-s3-gemini] S3 test failed raw error:', e)
		throw new Error(hint)
	}
}
