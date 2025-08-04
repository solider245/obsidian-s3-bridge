// 概述: 项目单一入口索引（“引子”）。对外统一从本文件导入需要的 API，内部维持 core/features 分层。
// 角色: 仅做再导出与命名聚合，不承载业务实现。
// 使用: import { registerBuiltinPacksAndLoad, installRetryHandler, makeObjectKey } from './src/index';

// ---- core 层导出 ----
// i18nBootstrap（保持原路径，待后续收敛到 core/bootstrap 视需要迁移）
export * from './bootstrap/i18nBootstrap';

// MIME 推断
export { getFileExtensionFromMime } from './core/mime';

// 对象键生成
export { makeObjectKey } from './core/objectKey';

// 剪贴板读取
export { readClipboardImageAsBase64 } from './core/readClipboard';

// 上传基元与组合
export * from './uploader/presignPut'; // 保持现有相对路径，不做移动以降低风险
export * as presignPut from './uploader/presignPut';

// 其余 core 工具（占位、阈值、实际上传、等）暂保持原位，后续补充到本索引
// export { ensureWithinLimitOrConfirm } from './core/sizeGuard';
// export * as optimistic from './core/optimistic';
// export { performUpload } from './core/performUpload';

// ---- features 层导出 ----
export { installRetryHandler } from './features/installRetryHandler';
// 待迁移后补充：registerCommands, installPasteHandler
// export { registerCommands } from './features/registerCommands';
// export { installPasteHandler } from './features/installPasteHandler';

/**
 * 插件生命周期托管建议：
 * - 不在 onload 自动启动任何调度器
 * - 在 onunload 时，若命令模块内存在 scheduler 单例且正在运行，则进行幂等 stop
 *
 * 说明：
 *   由于命令模块（registerCommands.ts）内部维护了一个模块级 scheduler 单例，
 *   这里提供一个可选的帮助函数，供主入口在 onunload 时调用以确保清理。
 */
export async function __stopSchedulerIfRunning__(app: any) {
  try {
    // 延迟 require，避免循环依赖
    const mod = require('./commands/registerCommands') as any;
    if (!mod || !mod.getScheduler) {
      return;
    }
    const plugin: any = (app as any)?._plugins?.activePlugin ?? { app };
    const sch = mod.getScheduler?.(plugin);
    if (sch && typeof sch.isRunning === 'function' && sch.isRunning()) {
      sch.stop();
      try { console.info('[ob-s3-gemini][lifecycle] scheduler stopped on unload'); } catch {}
    }
  } catch (e) {
    try { console.warn('[ob-s3-gemini][lifecycle] stop scheduler failed', { err: (e as any)?.message }); } catch {}
  }
}