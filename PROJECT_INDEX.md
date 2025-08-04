# Obsidian S3 Uploader - 项目索引与导航（新人与AI友好版）

本文件是仓库的「单一信息入口」。你可以从这里快速找到所有关键能力、文件与变更点，并跳转到相应行号。

提示：所有链接都可点击跳转到对应文件或代码位置。

## 0. 快速导览（做什么去哪里改）
- 粘贴上传链路（含乐观 UI）：[main.ts:346](main.ts:346)
- 乐观 UI 协议与重试缓存：[`src/uploader/optimistic.ts`](src/uploader/optimistic.ts:1)
- 预签名上传（主进程、HTTPS PUT）：[`src/uploader/presignPut.ts`](src/uploader/presignPut.ts:1)
- 多账户配置与公开链接生成：[`s3/s3Manager.ts`](s3/s3Manager.ts:1)
- 设置页与临时附件清理：[`settingsTab.ts`](settingsTab.ts:1)
- 语言包与 i18n：[`src/l10n.ts`](src/l10n.ts:1), [`src/lang/zh-CN.json`](src/lang/zh-CN.json:1)
- 单一入口索引（引子）：[`src/index.ts`](src/index.ts:1)

## 1. 现有目录与角色（分层聚合）
- 入口与主流程
  - [`main.ts`](main.ts:1) 插件入口、命令注册接线、editor-paste 监听、乐观UI粘贴、对象键策略、失败重试接线
- 分层结构
  - core（纯函数与基础设施）
    - [`src/core/mime.ts`](src/core/mime.ts:1) 从 MIME 推断扩展名
    - [`src/core/objectKey.ts`](src/core/objectKey.ts:1) 对象键生成：prefix + date + uploadId.ext
    - [`src/core/readClipboard.ts`](src/core/readClipboard.ts:1) 读取剪贴板图片为 base64
    - 预留：sizeGuard、performUpload、optimistic 等（后续收敛）
  - features（业务动作装配）
    - [`src/features/installRetryHandler.ts`](src/features/installRetryHandler.ts:1) 失败占位点击重试拦截
    - 预留：registerCommands、installPasteHandler（迁移中）
  - uploader（上传基元）
    - [`src/uploader/presignPut.ts`](src/uploader/presignPut.ts:1) 预签名 + HTTPS PUT
- 元信息与文档
  - [`manifest.json`](manifest.json:1) 插件清单
  - [`gemini.md`](gemini.md:1) 新功能、问题复盘、后续计划
  - 本索引 [`PROJECT_INDEX.md`](PROJECT_INDEX.md:1)

## 2. 关键链路一图流
flowchart TD
    A[editor-paste 监听 main.ts:346] --> B[构造占位 optimistic.buildUploadingMarkdown]
    B --> C[缓存 base64/mime uploadId]
    C --> D[异步上传 presignAndPutObject]
    D --> E[成功: 替换为 publicUrl]
    D --> F[失败: 替换为失败占位 + 可重试]
    F --> G[点击重试 features.installRetryHandler]
    G --> D
    E --> H[释放 blob 或删除临时附件]
    subgraph 设置页
      S1[最大上传大小 __obS3_maxUploadMB__]
      S2[对象键日期前缀 __obS3_keyPrefixFormat__]
      S3[临时附件模式 开关/前缀/目录 + 清理按钮]
    end

## 3. 修改指引（增删查改）
A. 增加功能
- 新的对象键规则或日期占位：
  - 使用 [`src/core/objectKey.ts.makeObjectKey()`](src/core/objectKey.ts:1)
  - 如需更复杂格式，配合设置项在 [`settingsTab.ts`](settingsTab.ts:265) 读取并写入 `window.__obS3_keyPrefixFormat__`
- 新的错误提示或阈值：
  - 文案加到 [`src/lang/zh-CN.json`](src/lang/zh-CN.json:1)，通过 [`src/l10n.ts`](src/l10n.ts:1) 输出
- 扩展上传入口（例如从URL）：
  - 在 [`main.ts`](main.ts:205) 添加命令，复用 [`presignAndPutObject()`](src/uploader/presignPut.ts:174)

B. 删除或清理
- 移除历史遗留逻辑时，确保不破坏以下调用点：
  - 粘贴路径：[`main.ts:346`](main.ts:346)
  - 重试接线：[`main.ts:166`](main.ts:166) 与 [`src/uploader/optimistic.ts`](src/uploader/optimistic.ts:136)
  - 公共链接生成：[`s3/s3Manager.ts:269`](s3/s3Manager.ts:269)

C. 查询排障
- 公共 URL 规则与分支：[`s3/s3Manager.ts:269`](s3/s3Manager.ts:269)
- 预签名与 PUT 细节：[`src/uploader/presignPut.ts`](src/uploader/presignPut.ts:1)
- 占位正则与替换：[`src/uploader/optimistic.ts`](src/uploader/optimistic.ts:28)
- 设置项如何透传到运行期：[`settingsTab.ts:195`](settingsTab.ts:195), [`settingsTab.ts:265`](settingsTab.ts:265)

## 4. 文件到能力的反向索引（更新后）
- MIME → 扩展名：[`src/core/mime.ts.getFileExtensionFromMime`](src/core/mime.ts:1)
- 对象键生成：[`src/core/objectKey.ts.makeObjectKey`](src/core/objectKey.ts:1)
- 剪贴板读取：[`src/core/readClipboard.ts.readClipboardImageAsBase64`](src/core/readClipboard.ts:1)
- 失败占位点击重试：[`src/features/installRetryHandler.ts.installRetryHandler`](src/features/installRetryHandler.ts:1)
- 预签名上传与公开 URL：[`src/uploader/presignPut.ts`](src/uploader/presignPut.ts:1) + [`s3/s3Manager.ts`](s3/s3Manager.ts:1)

## 5. 单一入口索引用法
- 推荐所有上层装配只从 [`src/index.ts`](src/index.ts:1) 导入需要的 API：
  - 例如：`import { makeObjectKey, getFileExtensionFromMime, installRetryHandler } from './src/index';`
- 迁移注意：
  - commands 与 paste 模块仍在原路径，main 暂以 require 调用；后续迁移到 features 后，将在 index 统一导出并更新 main 的导入。

## 6. 常见问题与排查
- Cloudflare R2 无法生成可访问链接
  - 必须在 Profile 配置 `baseUrl`，例如 `https://<bucket>.r2.dev` 或自定义域
  - 代码参考：[`s3/s3Manager.ts:285`](s3/s3Manager.ts:285)
- 粘贴后提示“找不到临时文件”
  - 统一使用 Vault API 写入与删除；参考 [`main.ts:402`](main.ts:402), [`main.ts:498`](main.ts:498)
- 对象被覆盖
  - 使用 uploadId 作为唯一名 + 日期前缀；参考 [`src/core/objectKey.ts`](src/core/objectKey.ts:1)

## 7. 变更记录（本次重构相关）
- 引入分层结构：`src/core`, `src/features` 与单一入口 [`src/index.ts`](src/index.ts:1)
- 文件迁移与命名简化：
  - `src/mime/extension.ts` → [`src/core/mime.ts`](src/core/mime.ts:1)
  - `src/objectKey/makeKey.ts` → [`src/core/objectKey.ts`](src/core/objectKey.ts:1)
  - `src/clipboard/readClipboard.ts` → [`src/core/readClipboard.ts`](src/core/readClipboard.ts:1)
  - `src/retry/installRetryHandler.ts` → [`src/features/installRetryHandler.ts`](src/features/installRetryHandler.ts:1)
- main.ts 只保留装配；i18n 与 retry 从 `src/index.ts` 导入；commands/paste 暂保留原路径 require，等待后续迁移