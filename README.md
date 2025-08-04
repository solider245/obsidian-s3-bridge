# Obsidian S3-Bridge

将粘贴的图片与文件自动上传到兼容 S3 的对象存储（AWS S3 / Cloudflare R2 / MinIO 等），并在笔记中插入可访问链接。提供上传占位、失败重试、尺寸阈值校验、自定义对象键等能力，专为 Obsidian 编辑体验优化。

## 功能特性
- 粘贴即上传：在编辑器中粘贴图片/文件，自动上传并插入链接
- 预签名直传：使用预签名 URL 通过 HTTPS PUT 上传，安全高效
- 乐观占位：上传中以占位 Markdown 展示，完成后自动替换为最终链接
- 一键重试：失败时在编辑区提供“重试”入口，无需重新粘贴
- 自定义对象键：支持前缀/命名格式定制，便于按日期或路径归档
- 尺寸阈值：粘贴前进行大小校验，可提示确认或阻止
- 多端兼容：支持 AWS S3 / Cloudflare R2 / MinIO 等 S3 兼容服务
- 本地化：内置 i18n，支持中文等语言

## 安装
1. 从 Releases 下载 `manifest.json`、`main.js`、`styles.css`
2. 将文件复制到你的库：`<Vault>/.obsidian/plugins/obsidian-s3-bridge/`
3. 在 Obsidian 设置 -> 社区插件中启用该插件

## 快速开始
1. 打开设置，进入 “Obsidian S3-Bridge”
2. 配置你的 S3 兼容存储参数（可参考 `config/s3Config.example.json`）
3. 在编辑器中粘贴图片或文件，等待链接自动插入

## 配置说明
核心配置涉及以下字段（不同后端可能略有差异）：
- Endpoint / Region：对象存储服务的访问端点与区域
- Bucket：目标存储桶
- Access Key / Secret Key：访问凭证（如使用预签名，仅需在生成端配置）
- Key Prefix：对象键前缀，可用于按日期/路径分组
- Public URL/Domain：公开访问域名，用于生成可访问的外链
- Size Limit：单次上传的大小阈值（超过将提示或阻止）

示例文件：`config/s3Config.example.json`

## 使用
- 粘贴上传：在编辑器中直接粘贴图片/文件
- 重试上传：当上传失败时，点击编辑区的重试提示
- 命令面板：可在命令面板搜索 S3 相关命令（如手动触发上传/粘贴处理）

## 常见问题
- 无法访问外链：请检查 Public URL/Domain 是否指向正确的桶与路径，并确保对象为公共可读
- 鉴权失败：确认预签名有效且时间未过期，或访问密钥正确
- 文件过大：按需调整 Size Limit，或在粘贴前压缩图片

## 版本与兼容性
- 插件版本：见 `manifest.json`
- 最低 Obsidian 版本：`0.15.0`

## 开发与构建
- Node.js >= 16
- 安装依赖：`npm i`
- 开发构建：`npm run dev`
- 生产构建：`npm run build`
- 单元测试：`npm run test`

## 许可证
MIT

## 致谢
基于 Obsidian 插件 API 与 AWS SDK 开发，感谢社区提供的示例与文档。
