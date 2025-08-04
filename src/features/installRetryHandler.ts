// 概述: 安装“失败占位中的重试”点击拦截（统一入口）
// 说明: 为避免重复实现，底层统一复用 optimistic.handleRetryClickInEditor，并暴露 features 层封装。
// 导出: installRetryHandler(plugin, onRetry) -> { uninstall }
// 相关: [src/uploader/optimistic.ts.handleRetryClickInEditor()](src/uploader/optimistic.ts:1), [src/queue/processNext.ts.processNext()](src/queue/processNext.ts:1)

import type { Editor, Plugin } from 'obsidian';

export function installRetryHandler(
  plugin: Plugin,
  onRetry: (params: { editor: Editor; uploadId: string }) => Promise<void> | void
): { uninstall: () => void } {
  // 统一入口：直接委托给 optimistic 内部实现
  const opt = require('../uploader/optimistic') as any;
  return opt.handleRetryClickInEditor(plugin, onRetry);
}

export default { installRetryHandler };