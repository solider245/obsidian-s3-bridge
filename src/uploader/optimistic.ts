/**
 * Optimistic upload helpers
 * 占位协议：
 *  - 上传中：
 *      ![上传中 ob-s3:id=XXXXXXXXXXXXXXXX status=uploading](blob:...)
 *    其中 X 为 16 位字母数字（UUID v4 去连字符后取前16）
 *  - 失败：
 *      ![上传失败 ob-s3:id=XXXXXXXXXXXXXXXX status=failed](#) [重试](#)
 *    点击 [重试](#) 由插件拦截，不做实际跳转
 *
 * 正则（JS 源码）：
 *  - 上传中：
 *      const RE_UPLOADING = /!\[[^\]]*?\bob-s3:id=([A-Za-z0-9]{16})\s+status=uploading[^\]]*?\]\((blob:[^)]+)\)/;
 *      捕获1: uploadId；捕获2: blobUrl
 *  - 失败：
 *      const RE_FAILED = /!\[[^\]]*?\bob-s3:id=([A-Za-z0-9]{16})\s+status=failed[^\]]*?\]\((?:#|https?:\/\/[^\)]+|blob:[^\)]+)?\)\s*\[([^\]]*?)\]\(#\)/;
 *      捕获1: uploadId；捕获2: 链接文字（通常为 重试）
 *  - 任意状态（可选）：
 *      const RE_ANY = /!\[[^\]]*?\bob-s3:id=([A-Za-z0-9]{16})\s+status=(uploading|failed|done)[^\]]*?\]\(([^)]+)?\)(?:\s*\[[^\]]*?\]\(#\))?/;
 */

import type { Editor, Plugin } from 'obsidian';
import { MarkdownView } from 'obsidian';
import { presignAndPutObject } from './presignPut';

const PLACEHOLDER_NAMESPACE = 'ob-s3';

const RE_UPLOADING = /!\[[^\]]*?\bob-s3:id=([A-Za-z0-9]{16})\s+status=uploading[^\]]*?\]\((blob:[^)]+)\)/;
const RE_FAILED = /!\[[^\]]*?\bob-s3:id=([A-Za-z0-9]{16})\s+status=failed[^\]]*?\]\((?:#|https?:\/\/[^\)]+|blob:[^\)]+)?\)\s*\[([^\]]*?)\]\(#\)/;

/**
 * 生成 16 位字母数字 ID：UUID v4 去连字符取前16
 */
export function generateUploadId(): string {
  try {
    const uuid = (crypto as any).randomUUID ? (crypto as any).randomUUID() : undefined;
    const raw = (uuid ?? fallbackUUIDv4()).replace(/-/g, '');
    return raw.slice(0, 16);
  } catch {
    const raw = fallbackUUIDv4().replace(/-/g, '');
    return raw.slice(0, 16);
  }
}

function fallbackUUIDv4(): string {
  // 简易 v4 实现
  const rnd = (len: number) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${rnd(8)}-${rnd(4)}-4${rnd(3)}-a${rnd(3)}-${rnd(12)}`;
}

/**
 * 构建“上传中”占位 Markdown
 */
export function buildUploadingMarkdown(uploadId: string, blobUrl: string): string {
  const alt = `上传中 ${PLACEHOLDER_NAMESPACE}:id=${uploadId} status=uploading`;
  return `![${alt}](${blobUrl})`;
}

/**
 * 构建“失败”占位 Markdown
 */
export function buildFailedMarkdown(uploadId: string): string {
  const alt = `上传失败 ${PLACEHOLDER_NAMESPACE}:id=${uploadId} status=failed`;
  // 链接部分占位为 #，随后追加 [重试](#)
  return `![${alt}](#) [重试](#)`;
}

/**
 * 在编辑器文本中查找包含指定 uploadId 的占位并替换
 * replacer 接受整段占位（整行内匹配到的完整 Markdown）和当前行文本，返回替换后的整段（或 null 跳过）
 * 返回：是否替换成功（至少一次）
 */
export function findAndReplaceByUploadId(
  editor: Editor,
  uploadId: string,
  replacer: (fullMatchedMarkdown: string, currentLine: string) => string | null
): boolean {
  if (!editor) return false;
  const lineCount = editor.lineCount();
  let changed = false;

  for (let i = 0; i < lineCount; i++) {
    const line = editor.getLine(i);
    // 先尝试匹配 uploading 占位
    let m = line.match(RE_UPLOADING);
    if (m && m[1] === uploadId) {
      const full = m[0];
      const replacement = replacer(full, line);
      if (typeof replacement === 'string') {
        const newLine = line.replace(full, replacement);
        if (newLine !== line) {
          editor.setLine(i, newLine);
          changed = true;
        }
      }
      continue;
    }
    // 再尝试匹配 failed 占位
    m = line.match(RE_FAILED);
    if (m && m[1] === uploadId) {
      const full = m[0];
      const replacement = replacer(full, line);
      if (typeof replacement === 'string') {
        const newLine = line.replace(full, replacement);
        if (newLine !== line) {
          editor.setLine(i, newLine);
          changed = true;
        }
      }
    }
  }
  return changed;
}

/**
 * 安装“重试”点击拦截（基于编辑器文本解析 + 光标/选区定位）
 * - 在活跃 Markdown 编辑器中，当点击位于形如 [重试](#) 的链接文本位置时，
 *   回查同一行是否包含 ob-s3:id=XXXXXXXXXXXXXX 的失败占位，若命中则触发 onRetry。
 * - 返回卸载函数以便在 onunload 中移除监听。
 */
export function handleRetryClickInEditor(
  plugin: Plugin,
  onRetry: (params: { editor: Editor; uploadId: string }) => Promise<void> | void
): { uninstall: () => void } {
  // 采用捕获编辑区域 mousedown + 检测光标行文本的策略
  const onMouseDown = (evt: MouseEvent) => {
    try {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return;
      const editor: Editor = view.editor;
      if (!editor) return;

      // 粗略判断：仅当点击近似链接区域时再进一步解析
      // 无法直接从 DOM 取 a 标签，按约定当用户点击后，Obsidian 会将光标定位至链接文本附近
      setTimeout(() => {
        try {
          const pos = editor.getCursor();
          const lineText = editor.getLine(pos.line) ?? '';
          // 只有同时包含 status=failed 与 [xxx](#) 的行才尝试匹配
          if (!lineText.includes('status=failed') || !lineText.includes('](#)')) return;

          const m = lineText.match(RE_FAILED);
          if (!m) return;
          const uploadId = m[1];

          // 进一步检查光标是否大致落在重试链接附近（提高精准度）
          // 简化：若行内存在 RE_FAILED 匹配且用户点击该行，则触发重试
          // 如需更精细，可解析链接起止列范围，这里先保持简洁
          evt.preventDefault();
          evt.stopPropagation();
          onRetry({ editor, uploadId });
        } catch { /* ignore */ }
      }, 0);
    } catch { /* ignore */ }
  };

  // 监听当前文档级别的鼠标事件（尽量限制在编辑区域）
  // 使用 activeLeaf 的 containerEl，以减少对全局的影响
  const leaf = plugin.app.workspace.activeLeaf as any;
  const containerEl: HTMLElement = (leaf?.view?.containerEl as HTMLElement)
    ?? (plugin.app.workspace as any)?.containerEl
    ?? document.body;

  containerEl.addEventListener('mousedown', onMouseDown, true);

  return {
    uninstall: () => {
      try {
        containerEl.removeEventListener('mousedown', onMouseDown, true);
      } catch { /* ignore */ }
    },
  };
}

/**
 * 封装上传：调用预签名上传并返回公开 URL
 */
export async function uploadBase64AndReturnUrl(
  plugin: Plugin,
  key: string,
  mime: string,
  base64: string
): Promise<string> {
  const url = await presignAndPutObject(plugin, {
    key,
    contentType: mime || 'application/octet-stream',
    bodyBase64: base64,
  });
  return url;
}