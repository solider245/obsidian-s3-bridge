# Gemini Analysis & Optimization

## 新增功能与近期改动汇总

- 通用上传阈值与二次确认
  - 设置项“最大上传大小（MB）”，默认 5MB，可自定义。[settingsTab.ts](settingsTab.ts:171)
  - 超阈值弹二次确认，确认继续、取消放弃。[main.ts](main.ts:108)
- 通用文件上传命令
  - 新增命令“Upload File from Local...”，支持任意类型文件上传；图片插入为 `![](URL)`，非图片插入为 `[filename](URL)`。[main.ts](main.ts:106)
- 多账户配置能力
  - profiles 结构、迁移、增删改查、当前激活管理。[s3/s3Manager.ts](s3/s3Manager.ts:1)
  - 设置面板动态渲染 Provider 字段，实时保存。[settingsTab.ts](settingsTab.ts:1)
- i18n 完整化
  - 新增并修复中文键值，去除重复项。[src/lang/zh-CN.json](src/lang/zh-CN.json:1)

## 后续优化建议

### 紧急/高优先级

1.  单元与集成测试补齐
    - 使用 jest，为 s3Profiles 读写、迁移、构造公共 URL 等关键路径建测试。
    - Mock fs，隔离文件系统依赖。

2.  凭据安全存储
    - 评估用系统钥匙串或 Obsidian 安全 API 存储 secretAccessKey。
    - 引入数据迁移脚本，将明文迁移到安全存储。

3.  直链与 CORS/Range 兼容性
    - 针对音视频与 PDF 预览需求，完善服务端 CORS、Range 支持与 X-Frame-Options 检查指南，写入文档。

4.  错误分级与用户提示
    - 将上传与预签名相关错误分门别类（网络、鉴权、桶不存在、TLS），统一提示格式与排错建议。

### 中优先级

5.  图片压缩可选项
    - 本地压缩开关与质量参数，仅对 image/* 生效。

6.  批量上传
    - 选择文件夹批量上传，附带进度条与失败重试。

7.  粘贴任意文件（可选）
    - 在 editor-paste 中识别非图片文件，复用通用上传逻辑，默认关闭，设置项开启。

8.  UI/UX 分组优化
    - 设置面板分 Tab：基础配置、连接测试、上传历史、高级选项。
    - 交互细节（与用户确认版）：
      - 基础配置
        - 配置选择与增删改：选择配置、新增、删除、配置名称、服务类型
        - Provider 字段：endpoint、bucketName、accessKeyId、secretAccessKey、region、useSSL
        - 上传相关：最大上传大小（MB）
      - 连接测试
        - “测试连接”按钮与结果提示（仅保留此区功能，说明文案简洁）
      - 上传历史
        - 整块默认折叠，可展开查看；包含“复制全部链接”“清空历史”按钮与列表
      - 高级选项
        - keyPrefix、baseUrl、path-style 或等价开关（不同 Provider 的进阶选项放这里）
    - 技术实现要点：
      - 在 [`settingsTab.display()`](settingsTab.ts:334) 将单页渲染拆分为四个子容器，使用 Tab 栏或 Segment 控件切换
      - “上传历史”块使用 details/summary 或自定义折叠逻辑（默认折叠）
      - 现有函数拆分复用：[`renderProfilesSection`](settingsTab.ts:97) 归入“基础配置”，[`renderActions`](settingsTab.ts:241) 的“测试连接”移动到“连接测试”，历史区域移动到“上传历史”
      - 字段迁移时保留原事件与持久化逻辑，避免回归

### 低优先级/长期规划

9.  本地附件同步到 S3
10. 自定义最终 URL 模板
11. 性能统计与可视化
12. 文档完善与动图
13. 从 URL 直传至 S3（服务器侧代理或受限直传）
14. 与 Templater 等生态集成
15. 自动重试与退避策略
16. 测试对象清理策略

## 验收清单

- [x] 阈值设置与二次确认工作正常，默认 5MB 可覆盖
- [x] 本地文件上传命令可用；图片→图片语法，非图片→纯链接
- [x] 中文界面无英文残留与重复键
- [x] 多账户切换与持久化正常
- [ ] 文档：在 README 中补充通用上传命令与阈值说明