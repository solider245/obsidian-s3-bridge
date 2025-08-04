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
- 变更与经验记录：[`gemini.md`](gemini.md:1)

## 1. 现有目录与角色
- 入口与主流程
  - [`main.ts`](main.ts:1) 插件入口、命令注册、editor-paste 监听、乐观UI粘贴、对象键策略、失败重试接线
- 设置与UI
  - [`settingsTab.ts`](settingsTab.ts:1) 设置面板、Profiles 表单、最大上传大小、对象键日期前缀、临时附件模式与清理、历史面板
- 配置与公开 URL
  - [`s3/s3Manager.ts`](s3/s3Manager.ts:1) 多 Profile 存取、向后兼容层、`buildPublicUrl()` 规则
  - [`config/s3Config.example.json`](config/s3Config.example.json:1) 示例配置模板
- 上传实现
  - [`src/uploader/presignPut.ts`](src/uploader/presignPut.ts:1) 预签名 PUT、主进程 HTTPS PUT、连接测试
  - [`src/uploader/optimistic.ts`](src/uploader/optimistic.ts:1) 占位协议、正则、uploadId、重试拦截、缓存
  - [`src/uploader/s3Uploader.ts`](src/uploader/s3Uploader.ts:1) 备用主进程直传与诊断分类（当前以预签名为主）
- 国际化
  - [`src/l10n.ts`](src/l10n.ts:1) 加载与查字典
  - [`src/lang/zh-CN.json`](src/lang/zh-CN.json:1) 中文包
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
    F --> G[点击重试 optimistic.handleRetryClickInEditor]
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
  - 修改 [`main.ts`](main.ts:53) 的 [`makeObjectKey()`](typescript.function():58)
  - 如需更复杂格式，配合设置项在 [`settingsTab.ts`](settingsTab.ts:265) 读取并写入 `window.__obS3_keyPrefixFormat__`
- 新的错误提示或阈值：
  - 文案加到 [`src/lang/zh-CN.json`](src/lang/zh-CN.json:1)，通过 [`src/l10n.ts`](src/l10n.ts:1) 输出
- 扩展上传入口（例如从URL）：
  - 在 [`main.ts`](main.ts:205) 添加命令，复用 [`presignAndPutObject()`](src/uploader/presignPut.ts:131)

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

D. 修改现有行为
- 乐观 UI 改为仅本地 blob 或仅临时附件：
  - 切换读取自 [`settingsTab.ts`](settingsTab.ts:378) 存入的 localStorage；主流程在 [`main.ts`](main.ts:162) 读取
- 上传失败行为（例如增加重试次数）：
  - 编辑失败占位与重试逻辑：[`src/uploader/optimistic.ts`](src/uploader/optimistic.ts:60) 与 [`main.ts:166`](main.ts:166)

## 4. 文件到能力的反向索引
- 粘贴阈值与二次确认
  - 读取：[`settingsTab.ts:178`](settingsTab.ts:178) → 导出到 `window.__obS3_maxUploadMB__`
  - 使用：[`main.ts:361`](main.ts:361), [`main.ts:241`](main.ts:241)
- 对象键生成
  - 函数：[`main.ts:53`](main.ts:53)
  - 调用：[`main.ts:182`](main.ts:182), [`main.ts:264`](main.ts:264), [`main.ts:326`](main.ts:326), [`main.ts:482`](main.ts:482)
- 临时附件模式与清理
  - 设置：[`settingsTab.ts:378`](settingsTab.ts:378) 区块
  - 清理：[`settingsTab.ts:447`](settingsTab.ts:447)
  - 写入/删除：[`main.ts:402`](main.ts:402), [`main.ts:498`](main.ts:498)
- 预签名上传与公开 URL
  - 生成与 PUT：[`src/uploader/presignPut.ts:131`](src/uploader/presignPut.ts:131)
  - 公开链接：[`s3/s3Manager.ts:269`](s3/s3Manager.ts:269)

## 5. 常见问题与排查
- Cloudflare R2 无法生成可访问链接
  - 必须在 Profile 配置 `baseUrl`，例如 `https://<bucket>.r2.dev` 或自定义域
  - 代码参考：[`s3/s3Manager.ts:285`](s3/s3Manager.ts:285)
- 粘贴后提示“找不到临时文件”
  - 已修复：统一使用 Vault API 写入与删除；参考 [`main.ts:402`](main.ts:402), [`main.ts:498`](main.ts:498)
- 对象被覆盖
  - 使用 uploadId 作为唯一名 + 日期前缀；参考 [`main.ts:53`](main.ts:53)

## 6. 变更记录（概览）
- 乐观 UI 粘贴上传 + 重试：[`main.ts`](main.ts:346), [`src/uploader/optimistic.ts`](src/uploader/optimistic.ts:1)
- 临时附件模式与清理：[`settingsTab.ts`](settingsTab.ts:378), [`main.ts`](main.ts:389)
- 对象键唯一命名与日期前缀：[`main.ts`](main.ts:53), [`settingsTab.ts`](settingsTab.ts:265)
- 连接测试安全化：[`src/uploader/presignPut.ts`](src/uploader/presignPut.ts:150), [`settingsTab.ts`](settingsTab.ts:287)

## 7. 下一步建议（仅索引视角）
- 将对象键与占位协议抽离为独立模块（domain/app层），但暂不移动代码，仅在此索引标注单点
- 为 [`makeObjectKey()`](main.ts:58) 与占位正则添加单测（tests/unit 目录）
- 在 README 中补齐“对象键格式”“临时附件模式与清理”“R2 baseUrl 必要性”