# TODO 索引：步骤到代码位置映射

用于把作战清单的每一步落到具体文件与函数，便于新同学快速定位与回归时核对。

## 1. 粘贴阶段（本地写入与占位、同名后缀重试、资源路径转换）
- 入口与安装：
  - [src/paste/installPasteHandler.ts.installPasteHandler()](src/paste/installPasteHandler.ts:1)
- 核心职责：
  - 读取剪贴板图片（base64）
  - 生成唯一名（时间戳+随机）并写入 .assets
  - 同名冲突 3 次后缀重试
  - 插入占位 markdown（携带 uploadId）
  - 入队：saveData.uploadQueue（字段 id/filename/mime/path/createdAt/size/base64Length）
  - 预览资源路径：
    - 临时模式：保留 vault 相对路径
    - 非临时模式：可转换为 app:// 资源 URL 仅用于预览显示（不用于队列 path）

## 2. 入队与持久化
- 队列模型与存取：
  - [src/types/index.ts.QueueItem](src/types/index.ts:1)
  - [src/commands/registerCommands.ts.loadQueue() / saveQueue()](src/commands/registerCommands.ts:1)
- 关键约束：
  - path 始终是 vault 相对路径（非 app://）
  - id 唯一并可用于兜底对象键

## 3. 手动处理（单条）
- 统一处理函数：
  - [src/queue/processNext.ts.processNext()](src/queue/processNext.ts:1)
- 逻辑要点：
  - 优先从 optimistic 内存缓存取 base64，否则读本地文件（剥离 ?query）
  - 生成 key（makeObjectKey 或用 id 兜底）
  - [src/upload/performUpload.ts.performUpload()](src/upload/performUpload.ts:1)
  - 成功：替换占位 → 删除临时文件（尽力）→ 清缓存 → 出队
  - 失败：替换为失败占位，队列项保留
- 命令入口：
  - [src/commands/registerCommands.ts.registerCommands() → obs3gemini-queue-process-next](src/commands/registerCommands.ts:1)

## 4. 调度器（最小实现，不自动启动）
- 工厂与实例：
  - [src/scheduler/queueScheduler.ts.createQueueScheduler()](src/scheduler/queueScheduler.ts:1)
- 运行规则：
  - 单实例；每 tick 2500ms、仅处理 1 条；inFlight 并发保护
  - start/stop/status 三方法，默认不自动启动
- 命令入口（单例持有在命令模块内）：
  - [src/commands/registerCommands.ts.registerCommands() → Scheduler: Start/Stop/Status](src/commands/registerCommands.ts:1)

## 5. 占位协议与重试入口（规划）
- 工具方法：
  - [src/uploader/optimistic.ts.buildUploadingMarkdown()](src/uploader/optimistic.ts:1)
  - [src/uploader/optimistic.ts.buildFailedMarkdown()](src/uploader/optimistic.ts:1)
  - [src/uploader/optimistic.ts.findAndReplaceByUploadId()](src/uploader/optimistic.ts:1)
  - [src/uploader/optimistic.ts.takeUploadPayload()/removeUploadPayload()](src/uploader/optimistic.ts:1)
- 统一重试入口（待收敛）：
  - [src/features/installRetryHandler.ts.installRetryHandler()](src/features/installRetryHandler.ts:1)

## 6. 生命周期（入口/清理）
- 插件入口：
  - [src/index.ts.onload() / src/index.ts.onunload()](src/index.ts:1)
- 要点：
  - onload：注册命令/监听；不自动启动 scheduler
  - onunload：若调度器存在且 running → stop（清 interval）；清理模块级句柄

## 7. 配置与上传
- S3 相关：
  - [src/uploader/presignPut.ts.presignPut()](src/uploader/presignPut.ts:1)
  - [src/uploader/s3Uploader.ts](src/uploader/s3Uploader.ts:1)
  - [src/upload/performUpload.ts.performUpload()](src/upload/performUpload.ts:1)
- 对象键生成：
  - [src/core/objectKey.ts.makeObjectKey()](src/core/objectKey.ts:1)

## 8. 验证与回归（参考文档）
- 压力测试：
  - [docs/TESTING_STRESS.md](docs/TESTING_STRESS.md:1)
- 监听审计：
  - [docs/LISTENERS_AUDIT.md](docs/LISTENERS_AUDIT.md:1)
- 队列一致性：
  - [docs/QUEUE_CONSISTENCY.md](docs/QUEUE_CONSISTENCY.md:1)
- 流程图：
  - [docs/FLOW.md](docs/FLOW.md:1)