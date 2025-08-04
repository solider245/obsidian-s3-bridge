// 概述: 统一的大小阈值检查与二次确认逻辑，支持从 window 配置读取默认阈值与提示文案。
// 导出: ensureWithinLimitOrConfirm(bytes: number, limitBytes?: number): Promise<boolean>
// 依赖: 文案函数 t()；运行期可从 window.__obS3_maxUploadMB__ 读取默认阈值。
// 用法:
//   const ok = await ensureWithinLimitOrConfirm(file.size); if (!ok) { return; }
// 相关: [src/commands/registerCommands.ts()](src/commands/registerCommands.ts:1), [src/paste/installPasteHandler.ts()](src/paste/installPasteHandler.ts:1)

import { t } from '../l10n';

export async function ensureWithinLimitOrConfirm(bytes: number, limitBytes?: number): Promise<boolean> {
  const maxMB = (window as any).__obS3_maxUploadMB__ ?? 5;
  const limit = Math.max(1, Math.floor(Number(limitBytes ?? maxMB * 1024 * 1024)));
  if (!Number.isFinite(bytes) || bytes <= 0) return true;

  if (bytes > limit) {
    const overMB = (bytes / (1024 * 1024)).toFixed(2);
    const thresholdMB = Math.floor(limit / (1024 * 1024));
    const confirmed = window.confirm(
      t('File exceeds {mb}MB (current limit: {limit}MB). Continue upload?')
        .replace('{mb}', String(overMB))
        .replace('{limit}', String(thresholdMB))
    );
    return !!confirmed;
  }
  return true;
}

export default { ensureWithinLimitOrConfirm };