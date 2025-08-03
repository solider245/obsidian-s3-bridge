import { Plugin } from 'obsidian';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadS3Config } from '../../s3/s3Manager';

// 采用 node:https 作为 HTTP 客户端，避免打包器处理 node: 前缀内置模块的问题
import * as https from 'https';
import { URL } from 'url';

/**
 * 规范化与校验 R2 端点：
 * - 去尾部斜杠
 * - 允许通用 S3 端点；若为 R2，建议使用 ACCOUNT_ID.r2.cloudflarestorage.com
 * - 不允许带有路径段（bucket 不能出现在 endpoint 中）
 */
function normalizeAndValidateEndpoint(endpoint: string): string {
  const ep = (endpoint || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(ep)) {
    throw new Error('Invalid endpoint: must start with http(s)://');
  }
  const u = new URL(ep);
  if (u.pathname && u.pathname !== '/') {
    throw new Error('Invalid endpoint: do not include bucket path in endpoint');
  }
  return ep;
}

/**
 * 基于配置构建 Node 侧 S3Client
 * - forcePathStyle: true 以兼容 R2
 * - region 默认 us-east-1
 * - tls 由配置控制
 */
function buildS3Client(plugin: Plugin): { client: S3Client; bucket: string; endpoint: string; region: string } {
  const cfg = loadS3Config(plugin);
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
    throw new Error('S3 settings incomplete: endpoint/accessKeyId/secretAccessKey/bucketName are required');
  }
  const endpoint = normalizeAndValidateEndpoint(cfg.endpoint);
  const region = (cfg.region && cfg.region.trim()) ? cfg.region.trim() : 'us-east-1';

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    tls: cfg.useSSL,
  });

  return { client, bucket: cfg.bucketName, endpoint, region };
}

/**
 * 生成预签名 PUT URL
 * @param plugin Obsidian 插件实例
 * @param key 目标对象键
 * @param contentType Content-Type
 * @param expiresInSeconds 预签名有效期，默认 300 秒
 */
export async function getPresignedPutUrl(
  plugin: Plugin,
  key: string,
  contentType: string,
  expiresInSeconds = 300
): Promise<string> {
  const { client, bucket } = buildS3Client(plugin);

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });

  // 生成预签名 URL
  const url = await getSignedUrl(client, cmd, { expiresIn: expiresInSeconds });
  return url;
}

/**
 * 使用 undici 执行 PUT 到预签名 URL
 * @param presignedUrl 由 getPresignedPutUrl 生成的 URL
 * @param body 要上传的二进制数据
 * @param contentType Content-Type
 */
export async function putWithHttps(
  presignedUrl: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  const url = new URL(presignedUrl);

  const options: https.RequestOptions = {
    method: 'PUT',
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': String(body.byteLength),
    },
  };

  await new Promise<void>((resolve, reject) => {
    const req = https.request(options, (res: import('http').IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer | string) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          const msg = Buffer.concat(chunks).toString('utf-8');
          reject(new Error(`Presigned PUT failed: ${res.statusCode} ${res.statusMessage}${msg ? ' - ' + msg : ''}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 主进程组合动作：生成预签名 URL，然后执行 PUT
 * 调用方传入 base64 字符串以避免渲染端直接接触二进制
 */
export async function presignAndPutObject(
  plugin: Plugin,
  opts: { key: string; contentType: string; bodyBase64: string; expiresInSeconds?: number }
): Promise<void> {
  const { key, contentType, bodyBase64, expiresInSeconds = 300 } = opts;
  const url = await getPresignedPutUrl(plugin, key, contentType, expiresInSeconds);
  const body = Buffer.from(bodyBase64, 'base64');
  await putWithHttps(url, body, contentType);
}

/**
 * 主进程连通性测试：通过预签名 PUT 上传一个极小对象，然后再通过 SDK 直接 DELETE 清理
 * 仅在主进程执行，不做任何渲染端 URL 访问
 */
export async function testConnectionViaPresign(
  plugin: Plugin,
  opts: { key: string; contentType: string; bodyBase64: string; expiresInSeconds?: number }
): Promise<void> {
  const { key, contentType, bodyBase64, expiresInSeconds = 300 } = opts;

  // 预签名并上传
  await presignAndPutObject(plugin, { key, contentType, bodyBase64, expiresInSeconds });

  // 清理对象
  const { client, bucket } = buildS3Client(plugin);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}