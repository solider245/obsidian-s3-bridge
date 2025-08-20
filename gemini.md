# Gemini Analysis & Optimization

## 新增功能与近期改动汇总

- 乐观 UI 粘贴上传（Optimistic）
  - 粘贴图片后立即插入占位（blob 或本地临时文件），后台上传成功后替换为最终 URL，失败显示“重试”。[main.ts](main.ts:346) / [src/uploader/optimistic.ts](src/uploader/optimistic.ts:1)
  - 内存缓存 Map 记录 uploadId 对应的 base64/mime/文件名，点击“[重试](#)”复用缓存再次上传。[main.ts](main.ts:166)
- 临时附件模式 + 一键清理
  - 设置页新增开关、前缀与目录（默认 .assets + temp*upload*）、“扫描并清理”按钮；清理前二次确认并显示删除数量。[settingsTab.ts](settingsTab.ts:334)
  - 临时文件创建改为走 Vault API（createBinary/modifyBinary → 回退 create/modify），保证被索引且可预览；删除优先 vault.delete，兜底 adapter.remove。[main.ts](main.ts:402)
- 对象键生成策略（彻底解决覆盖）
  - 统一改为：keyPrefix + 日期前缀格式 + uploadId.ext；日期前缀格式通过“Object Key Prefix Format”自定义（默认 {yyyy}/{mm}）。[main.ts](main.ts:53)
  - 所有入口均使用 uploadId，包含：粘贴上传、剪贴板命令、本地文件上传命令，以及失败重试路径。[main.ts](main.ts:182,263,325,447)
- 通用上传阈值与二次确认
  - 设置项“最大上传大小（MB）”，默认 5MB；超阈值二次确认。[settingsTab.ts](settingsTab.ts:171) / [main.ts](main.ts:361)
- 通用文件上传命令
  - “Upload File from Local...”：图片插入 `![]()`，非图片插入 `[filename]()`。[main.ts](main.ts:218)
- 多账户配置与 i18n
  - 多 Profile 管理、迁移与公共 URL 生成。[s3/s3Manager.ts](s3/s3Manager.ts:1)
  - 中文包新增“临时模式”“清理”“上传中”等文案。[src/lang/zh-CN.json](src/lang/zh-CN.json:1)
- 连接测试按钮修复
  - 设置页按钮改为内联反馈，避免命令分发差异。[settingsTab.ts](settingsTab.ts:359)

## 线上问题复盘与修复

- 问题1：上传后所有对象被覆盖为固定名 image.png
  - 根因：对象键生成逻辑未确保唯一。
  - 修复：使用 uploadId 作为文件名，结合可配置日期前缀，形如 `blinko/2025/08/AB12CD34EF56GH78.png`。[main.ts](main.ts:53)
- 问题2：临时附件模式下 Markdown 预览“找不到 .assets/temp*upload*\*.png”
  - 根因：直接使用 adapter.write/writeBinary 写盘未建立 Vault 索引，或路径解析为相对当前笔记导致歧义。
  - 修复：
    - 写入统一走 vault.createBinary/modifyBinary，回退 create/modify，保证被 Vault 索引。[main.ts](main.ts:402)
    - 占位统一使用 Vault 相对路径（不加 ./），如 `.assets/temp_upload_*.png`。[main.ts](main.ts:419)
    - 删除时先 vault.getAbstractFileByPath + vault.delete，兜底 adapter.remove。[main.ts](main.ts:468)

## 决策与心得记录

- 统一键名规范
  - 以 uploadId 作为最终文件名是避免覆盖的最简单可靠策略；日期前缀通过可配置格式实现灵活分层（年/月/日或任意组合）。[main.ts](main.ts:53)
- 设置与即时生效
  - “对象键前缀格式”保存在 localStorage，并同步到 `window.__obS3_keyPrefixFormat__`，无需重启即可生效。[settingsTab.ts](settingsTab.ts:246)
- 乐观 UI 与可恢复性
  - 失败占位 + 内存缓存 + 文本层“重试”拦截，构成从失败到恢复的最短路径。[src/uploader/optimistic.ts](src/uploader/optimistic.ts:116)

## 后续优化建议

### 紧急/高优先级

1. 单元/集成测试
   - 针对 makeObjectKey、临时模式写入/删除、失败重试替换、公共 URL 构造等编写测试。
2. 边界处理
   - 上传取消/超时（AbortController per uploadId）与并发上限（可配置）。
3. 可观测性
   - 日志开关：记录失败原因与关键上下文（provider、bucket、key、statusCode）。

### 中优先级

4. 图片压缩与 EXIF 处理（可选）
5. 批量上传与进度反馈
6. 粘贴任意文件（可选开关）

### 低优先级/长期规划

7. 本地附件目录一键同步到 S3
8. 自定义最终 URL 模板
9. 性能统计
10. 文档与动图
11. URL 直传到 S3（受限条件下）
12. 与 Templater 等生态集成

## 验收清单

- [x] 粘贴上传为乐观 UI，成功替换 URL，失败可重试
- [x] 临时附件模式可预览、可清理、不会“找不到文件”
- [x] 对象键不再覆盖：uploadId 唯一命名 + 可配置日期前缀
- [x] 中文界面与提示覆盖完善
- [x] 设置页“测试连接”按钮有可见反馈
- [ ] README：补充对象键格式、临时附件模式与清理说明

---

## 下一任务开场白（交接用）

本次迭代已完成“乐观 UI 粘贴上传”“临时附件模式（含安全清理）”“对象键唯一命名（uploadId + 日期前缀）”等核心能力，并修复了“文件名覆盖导致最新替旧”和“临时文件预览找不到”的问题。当前主流程稳定、可在真实环境验证。建议从以下方向继续推进：

- 编写关键路径自动化测试（对象键生成、失败重试、临时文件生命周期）
- 完善 README 与动图示例，降低配置与上手成本
- 评估上传取消/并发与图片压缩的用户需求优先级

后续任务可直接从上述“后续优化建议”列表中挑选高优先级项进入实现。
