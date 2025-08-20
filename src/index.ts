// 概述: 项目单一入口索引（“引子”）。对外统一从本文件导入需要的 API，内部维持 core/features 分层。
// 角色: 仅做再导出与命名聚合，不承载业务实现。
// 使用: import { registerBuiltinPacksAndLoad, installRetryHandler, makeObjectKey } from './src/index';

// ---- core 层导出 ----
// i18nBootstrap（保持原路径，待后续收敛到 core/bootstrap 视需要迁移）
export * from './bootstrap/i18nBootstrap'

// MIME 推断
export { getFileExtensionFromMime } from './core/mime'

// 对象键生成
export { makeObjectKey } from './core/objectKey'

// 剪贴板读取
export { readClipboardImageAsBase64 } from './core/readClipboard'

// 上传基元与组合
export * from './uploader/presignPut' // 保持现有相对路径，不做移动以降低风险
export * as presignPut from './uploader/presignPut'

// 其余 core 工具（占位、阈值、实际上传、等）暂保持原位，后续补充到本索引
// export { ensureWithinLimitOrConfirm } from './core/sizeGuard';
// export * as optimistic from './core/optimistic';
// export { performUpload } from './core/performUpload';

// ---- features 层导出 ----
// 待迁移后补充：registerCommands, installPasteHandler
// export { registerCommands } from './features/registerCommands';
// export { installPasteHandler } from './features/installPasteHandler';
