# Obsidian S3 Uploader 开发者指南

本指南面向开发与维护 ob-s3-gemini 插件的工程师，提供架构总览、关键流程、源码锚点、运行配置与排障建议。所有锚点均可点击跳转到对应文件或行号，便于快速定位。

## 1. 架构总览

```mermaid
flowchart TD
    subgraph 前端渲染
      EV[editor-paste 监听\n(main.ts:350)] --> P1[阈值检查/二次确认\n(main.ts:365)]
      P1 --> P2[构造占位符\n(blob 或本地临时文件)\n(main.ts:389)]
      P2 --> P3[写入占位到编辑器\n(main.ts:473)]
      P3 --> U1[异步上传\npresignAndPutObject]\n
    end

    subgraph 主进程上传
      U1 --> U2[生成预签名 URL\nsrc/uploader/presignPut.ts:64]
      U2 --> U3[HTTPS PUT 上传\nsrc/uploader/presignPut.ts:98]
      U3 --> U4[构建公开 URL\ns3/s3Manager.ts]
    end

    U4 --> R1{结果}
    R1 -->|成功| R2[替换占位为 publicUrl\nmain.ts:496]
    R1 -->|失败| R3[替换为失败占位 + 可重试\noptimistic.buildFailedMarkdown]\n

    R2 --> C1[资源清理:\n释放 blob 或删除临时文件\nmain.ts:498-519]
    R3 --> C2[保留缓存支持重试\noptimistic.cache/take]\n

    click EV "main.ts:350" "Open main.ts"
    click U2 "src/uploader/presignPut.ts:64" "Open presignPut.ts"
    click U3 "src/uploader/presignPut.ts:98" "Open presignPut.ts"
    click R2 "main.ts:496" "Open main.ts"
```

核心组件与职责：

- 入口与粘贴链路：[`main.ts`](main.ts:1)
- 乐观 UI 占位/重试：[`src/uploader/optimistic.ts`](src/uploader/optimistic.ts:1)
- 预签名与上传：[`src/uploader/presignPut.ts`](src/uploader/presignPut.ts:1)
- 配置与公开链接：[`s3/s3Manager.ts`](s3/s3Manager.ts:1)
- 设置与运行期参数注入：[`settingsTab.ts`](settingsTab.ts:1)、[`src/l10n.ts`](src/l10n.ts:1)

## 2. 关键源码锚点

- 粘贴上传链路起点：[editor-paste 监听](main.ts:350)
- 临时附件模式写入/删除：
  - 写入：优先 `vault.createBinary/modifyBinary` 回退 `create/modify`，[`main.ts:413-451`](main.ts:413)
  - 删除：`vault.delete`，兜底 `vault.adapter.remove`，[`main.ts:505-519`](main.ts:505)
- “野蛮创建目录（mkdir -p）”修复点：
  - 递归保证临时目录存在：优先 `vault.adapter.mkdir`，回退 `vault.createFolder`，[`main.ts:408-418`](main.ts:408)
- 占位协议与正则、重试拦截：[`src/uploader/optimistic.ts`](src/uploader/optimistic.ts:1)
- 预签名 PUT 与 HTTPS 上传：[`src/uploader/presignPut.ts`](src/uploader/presignPut.ts:64)
- 对象键生成（唯一命名）：[`makeObjectKey()`](main.ts:58)

## 3. 使用与行为

1. 粘贴图片

- 小于阈值：直接进入乐观 UI，插入占位（blob 或临时文件路径），后台上传成功替换为最终链接。
- 超出阈值：弹二次确认，取消则终止。
  - 相关逻辑：[粘贴链路](main.ts:350), [阈值计算](main.ts:365)

2. 本地文件上传命令

- 图片插入 `![]()`；非图片插入 `[filename]()`。
  - 命令入口：[本地文件上传](main.ts:220)

3. 剪贴板上传命令

- 仅图片类型，成功后插入 `![]()`。
  - 命令入口：[剪贴板上传](main.ts:292)

4. 失败与重试

- 失败占位格式：`![上传失败 ob-s3:id=XXXX status=failed](#) [重试](#)`。
- 点击重试：文本层拦截，复用内存缓存再次发起上传。
  - 重试接线：[安装拦截](main.ts:166), [事件处理](src/uploader/optimistic.ts:183)

## 4. 对象键策略

- 统一命名：`keyPrefix + 日期前缀 + uploadId.ext`
- 日期前缀可配置，默认 `{yyyy}/{mm}`，例如 `2025/08`。
- 所有入口均以 `uploadId` 作为文件名，彻底避免覆盖。
  - 生成函数：[makeObjectKey](main.ts:58)
  - 使用位置：[上传命令/粘贴/重试](main.ts:182, main.ts:264, main.ts:326, main.ts:486)

## 5. 配置与运行期参数

Profile 配置（示例）：[`config/s3Config.example.json`](config/s3Config.example.json:1)

- endpoint、accessKeyId、secretAccessKey、bucketName、region、useSSL、baseUrl、keyPrefix

运行期参数注入与读取：

- 最大上传大小 MB：`window.__obS3_maxUploadMB__`
  - 写入于设置页，读取于 [main.ts:243, main.ts:308, main.ts:366](main.ts:241)
- 对象键日期格式：`window.__obS3_keyPrefixFormat__`
  - 写入于设置页，使用于 [makeObjectKey 调用点](main.ts:182)
- 预签名/上传超时：`window.__obS3_presignTimeout__` / `window.__obS3_uploadTimeout__`
  - 使用于 [`presignAndPutObject`](src/uploader/presignPut.ts:174) 的调用参数
- 轻量日志开关：`window.__obS3_logLevel__`, `window.__obS3_logCap__`
  - 使用于 [`optimistic.ts` ring buffer](src/uploader/optimistic.ts:26)

透传表（示例）：

- 阈值与确认：[main.ts:361-379](main.ts:361)
- 日期前缀格式：[main.ts:185,267,329,486](main.ts:182)
- 超时参数：[main.ts:190-191, 333-335, 492-494](main.ts:186)

## 6. 错误处理与排障

常见问题：

1. Cloudflare R2 可达但访问 URL 404

- 需在 Profile 配置 `baseUrl`（如 `https://<bucket>.r2.dev` 或自定义域）。
- 参考公开 URL 构造规则：[s3/s3Manager.ts](s3/s3Manager.ts:269)

2. “找不到临时文件”

- 已修复：临时文件写入统一走 Vault API，被索引可预览；删除优先 `vault.delete`，兜底 `adapter.remove`。
- 若目录被用户手动删除，也能通过 “mkdir -p” 野蛮创建保证可用。
  - 参考：[main.ts 写入/删除与 mkdir](main.ts:402)

3. 上传对象被覆盖

- 统一使用 `uploadId` 唯一命名 + 可配置日期前缀，已彻底规避。
  - 参考：[makeObjectKey](main.ts:58)

网络/权限类错误分类与提示：

- 连接、DNS/TLS/超时、鉴权、NoSuchBucket 等诊断说明可参考备用直传实现：
  - [`src/uploader/s3Uploader.ts`](src/uploader/s3Uploader.ts:43)

## 7. 安全与兼容性

- 渲染端不直接持久化敏感密钥，主进程使用 SDK 与 HTTPS 进行上传。
- 预签名方式默认优先，避免渲染端触达跨域限制。
- Vault API 优先写入/删除，确保资源索引与可预览；适配器作为兜底。
- 递归目录创建：优先 adapter.mkdir，失败回退 createFolder，保证“每次写前先踹门”。

## 8. 测试建议

优先覆盖以下路径：

- makeObjectKey：不同前缀与日期格式、非法字符清洗、uploadId 覆盖策略。
- 占位协议与替换：uploading/failed 两类占位的查找与替换。
- 临时文件生命周期：写入 → 预览占位 → 上传成功删除/失败保留。
- buildPublicUrl：不同 provider/R2 场景下的 URL 生成分支。

参考目录：

- 单测样例：[`tests/unit`](tests/unit/)
- stubs/mocks：[`tests/stubs`](tests/stubs/), [`tests/mocks`](tests/mocks/)

## 9. 开发与维护流程建议

- 变更记录与决策沉淀：[`gemini.md`](gemini.md:1)
- 索引与导航入口：[`PROJECT_INDEX.md`](PROJECT_INDEX.md:1)
- 新功能前先在 PROJECT_INDEX 标注目标与锚点，再实施与补文档
- 提交前跑单测，优先保障关键链路与命名策略不回退

## 10. 附：占位协议速查

- 上传中占位（含 uploadId 和 blob/local 预览）：
  - 形如：`![上传中 ob-s3:id=XXXXXXXXXXXX status=uploading](blob:...)`
  - 正则参考：[RE_UPLOADING](src/uploader/optimistic.ts:44)
- 失败占位（附重试链接）：
  - 形如：`![上传失败 ob-s3:id=XXXXXXXXXXXX status=failed](#) [重试](#)`
  - 正则参考：[RE_FAILED](src/uploader/optimistic.ts:48)
- 文本替换辅助：
  - [`replaceByUploadIdInText`](src/uploader/optimistic.ts:144)

---

如需在 README 面向用户补充 “对象键格式”“临时附件模式与清理”“R2 baseUrl 必要性”等内容，可从本开发者指南摘取简化版本与动图示例。
