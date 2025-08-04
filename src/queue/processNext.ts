/**
 * processNext: 从队列取出首项并完成一次上传与占位替换、临时文件清理与出队
 * 设计目标：
 *  - 纯函数风格（除读写队列/文件/编辑器外无外部副作用），便于被命令与 Scheduler 复用
 *  - 幂等：读取来源优先内存缓存，其次本地文件；失败不出队
 *  - 健壮：剥离 path 上可能的查询串，兼容二进制/文本适配器
 */

import type { Editor, Plugin } from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';
import { t, tp } from '../l10n';
import { performUpload } from '../upload/performUpload';
import { loadS3Config } from '../../s3/s3Manager';

// 与 registerCommands 中的定义保持一致
export type QueueItem = {
  id: string;
  filename: string;
  mime: string;
  path: string;
  createdAt: number;
  size?: number;
  base64Length?: number;
};

async function loadQueue(plugin: Plugin): Promise<QueueItem[]> {
  const existing = (await (plugin as any).loadData()) ?? {};
  return Array.isArray(existing.uploadQueue) ? (existing.uploadQueue as QueueItem[]) : [];
}

/**
 * saveQueue 带轻量写入互斥，避免并发覆盖（同一渲染进程内）
 */
async function saveQueue(plugin: Plugin, list: QueueItem[]): Promise<void> {
  const g: any = window as any;
  if (!g.__obS3_savingQueue__) g.__obS3_savingQueue__ = Promise.resolve();
  // 串行化：将本次写入拼接到前一次之后
  g.__obS3_savingQueue__ = g.__obS3_savingQueue__.then(async () => {
    const existing = (await (plugin as any).loadData()) ?? {};
    (existing as any).uploadQueue = list;
    await (plugin as any).saveData(existing);
  }).catch(() => {/* 忽略前序错误，防止链条中断 */});
  await g.__obS3_savingQueue__;
}

function replaceInEditor(plugin: Plugin, uploadId: string, url: string, fileLabel: string) {
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return false;
  const editor: Editor = view.editor;
  // 复用 optimistic 的查找与替换能力
  const opt = require('../uploader/optimistic') as any;
  return opt.findAndReplaceByUploadId(editor, uploadId, (full: string, _line: string) => {
    if (/\!\[/.test(full)) return `![](${url})`;
    const safe = (fileLabel || 'file').replace(/\]/g, '');
    return `[${safe}](${url})`;
  });
}

/**
 * 尝试读取 base64：优先 optimistic 缓存，其次从 vault 文件读取（若 path 可用）
 */
async function readBase64For(plugin: Plugin, item: QueueItem): Promise<string | null> {
  // 优先缓存
  try {
    const cached = (require('../uploader/optimistic') as any).takeUploadPayload(item.id);
    if (cached?.base64) return cached.base64;
  } catch { /* ignore */ }

  // 再读本地
  const sanitizedPath = (item.path || '').split('?')[0];
  if (!sanitizedPath) return null;

  try {
    const adapter: any = (plugin.app.vault as any)?.adapter;
    if (adapter && typeof adapter.readBinary === 'function') {
      const bin: ArrayBuffer = await adapter.readBinary(sanitizedPath);
      return Buffer.from(bin).toString('base64');
    }
    const txt = await plugin.app.vault.adapter.read(sanitizedPath);
    return Buffer.from(txt, 'binary').toString('base64');
  } catch {
    return null;
  }
}

/**
 * 执行一次处理：
 * - 无队列或失败：返回 { processed:false }
 * - 成功：返回 { processed:true }
 */
/**
 * 进程级并发保护：命令与调度器共享
 */
export async function processNext(plugin: Plugin): Promise<{ processed: boolean }> {
  const g: any = window as any;
  if (g.__obS3_inflight_processNext__) {
    // 已有一次处理在进行中，直接跳过
    return { processed: false };
  }
  g.__obS3_inflight_processNext__ = true;
  try {
    const list = await loadQueue(plugin);
    if (!list.length) return { processed: false };

  const item = list[0];

  // 读取 base64
  const base64 = await readBase64For(plugin, item);
  if (!base64) {
    new Notice(tp('Upload failed: {error}', { error: 'Local temp missing and no cache' }));
    return { processed: false };
  }

  // 准备 key
  const cfgNow = await loadS3Config(plugin);
  const keyPrefix = (cfgNow.keyPrefix || '').replace(/^\/+|\/+$/g, '');
  const ext = (() => {
    // 简化：尽量少依赖，沿用现有 getExt 逻辑在命令处；这里兜底
    const m = (item.mime || '').toLowerCase();
    if (m.startsWith('image/')) return (m.split('/')[1] || 'png');
    if (m === 'text/plain') return 'txt';
    return 'bin';
  })();
  const makeObjectKey = (originalName: string | null, ext: string, prefix: string, uploadId?: string, dateFormat?: string) => {
    // 与现有签名保持兼容（调用侧传入同函数会覆盖本内置）
    const fn = (require('../core/objectKey') as any).makeObjectKey as Function;
    return typeof fn === 'function'
      ? fn(originalName, ext, prefix, uploadId, dateFormat)
      : `${prefix ? prefix + '/' : ''}${(uploadId || item.id)}.${ext}`;
  };
  const key = makeObjectKey(item.filename || null, ext, keyPrefix, item.id, (window as any).__obS3_keyPrefixFormat__);

  // 上传
  const url = await performUpload(plugin, {
    key,
    mime: item.mime || 'application/octet-stream',
    base64,
  });

  // 编辑器替换占位
  replaceInEditor(plugin, item.id, url, item.filename);

  // 删除临时文件（尽力而为）
  try {
    const path = (item.path || '').split('?')[0];
    if (path) {
      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (file) {
        await plugin.app.vault.delete(file);
      } else {
        await plugin.app.vault.adapter.remove(path);
      }
    }
  } catch { /* ignore */ }

  // 清缓存
  try { (require('../uploader/optimistic') as any).removeUploadPayload(item.id); } catch { /* ignore */ }

  // 出队
  await saveQueue(plugin, list.slice(1));

  new Notice(t('Upload successful!'));
  return { processed: true };
  } finally {
    try { (window as any).__obS3_inflight_processNext__ = false; } catch {}
  }
}

export default { processNext };