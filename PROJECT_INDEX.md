# Obsidian S3 Uploader - 项目索引与导航

本文件是项目的单一信息入口，汇总关键文件、变更记录、常见问题与未来规划，便于快速定位与回顾。

## 1. 目录结构建议

- main.ts
  - 插件入口与核心上传逻辑
  - 处理编辑器粘贴、命令、S3客户端初始化、上传实现
- settingsTab.ts
  - 插件设置面板 UI
  - 支持编辑 S3 配置 + Upload History 历史面板
- s3/
  - s3Manager.ts
    - 读取与保存 s3Config.json
    - 默认值与向后兼容逻辑
- config/
  - s3Config.example.json
    - 示例配置模板，不含敏感信息
- tests/
  - 未来测试用例目录
- tests/mocks/
  - 未来测试 mock 目录
- .gitignore
  - 忽略 config/s3Config.json，避免凭据泄露
- gemini.md
  - 优化建议清单（来源文档）

若后续需要更细分结构，可考虑：
- src/
  - core/ 上传与S3交互
  - ui/ 设置与面板
  - utils/ 工具函数
- docs/ 文档与索引
- test/ 测试

当前保持兼容不移动文件，先以本索引做导航。

## 2. 关键能力与入口

- 上传图片逻辑: [main.ts:132](main.ts)
  - 使用 AWS SDK 的 PutObjectCommand
  - 生成 Key 时支持 keyPrefix 前缀
  - 成功/失败均记录到 localStorage 的 obS3Uploader.history
- 设置面板: [settingsTab.ts:1](settingsTab.ts)
  - 编辑 S3 参数：Endpoint, Access Key ID, Secret Access Key, Bucket Name, Region, Use SSL
  - Key Prefix 字段
  - Upload History 面板：列表、Copy、Copy All、Clear
- 配置加载保存: [s3/s3Manager.ts:33](s3/s3Manager.ts)
  - loadS3Config: 合并默认值，向后兼容 keyPrefix
  - saveS3Config: 规范化写入，确保 keyPrefix 存在
  - 配置文件路径：{vault}/.obsidian/plugins/{plugin-id}/config/s3Config.json
- 示例模板: [config/s3Config.example.json:1](config/s3Config.example.json)
  - 提示字段结构，含 keyPrefix
- 凭据保护: [.gitignore:1](.gitignore)
  - 忽略 config/s3Config.json

## 3. 最近变更记录 Changelog

- feat: 增加自定义路径 Key Prefix（配置层）
  - S3Config 新增 keyPrefix?: string
  - 默认值及向后兼容
  - 示例文件增加 keyPrefix 字段
- feat: 设置面板新增 Key Prefix 字段
- feat: 上传逻辑支持 keyPrefix 前缀拼接
- feat: 上传历史记录
  - 成功与失败记录本地 localStorage
  - 设置面板展示历史列表，支持 Copy、Copy All、Clear
- chore: .gitignore 忽略 config/s3Config.json

## 4. 常见问题与排查 Checklist

- 无法上传
  - 检查设置面板 Endpoint、Access Key、Secret、Bucket 是否正确
  - Region 未设置时默认 us-east-1
  - Use SSL 与实际 Endpoint 对应
- 链接不可访问
  - Endpoint 是否直接支持/{bucket}/{key} 访问
  - 是否需要自定义域名或 CDN
- keyPrefix 生效问题
  - 设置面板输入后需 Save and Reload
  - 前后斜杠自动清理：最终为 prefix/filename
- 历史记录缺失
  - 浏览器/Obsidian 是否禁用 localStorage
  - 失败也会记录一条 error 项，可在设置面板查看
- 凭据泄露风险
  - 确认 config/s3Config.json 未被提交
  - 所有凭据应仅存在于本地 s3Config.json

## 5. 未来规划与优先级

- 高优先级
  - 单元测试与集成测试（tests/，mock fs）
  - 网络错误分类与提示
- 中优先级
  - 多账户配置
  - 图片压缩/优化
  - 国际化
  - 其他文件类型支持
- 低优先级/长期
  - 同步本地附件到 S3
  - 自定义 URL 格式
  - 性能监控
  - 从 URL 上传
  - 与 Templater 集成
  - 自动重试
  - 测试连接成功后清理测试文件

## 6. 提交规范建议

- feat: 新功能
- fix: 修复缺陷
- docs: 文档和索引变更
- refactor: 重构
- test: 测试相关
- chore: 杂项、工具链、配置调整

提交示例：
- feat(settings): add Key Prefix input and Upload History panel
- feat(upload): respect keyPrefix and persist upload history
- chore(gitignore): ignore config/s3Config.json

## 7. 操作速查

- 打开设置面板并配置
  - 设置 Key Prefix 等参数，点击 Save and Reload
- 上传
  - 粘贴图片或执行命令 Upload Image to S3
- 查看历史
  - 设置中查看 Upload History
  - Copy/Copy All/ Clear 按需操作
- 修改配置文件
  - 用户实际配置：config/s3Config.json（被忽略）
  - 示例模板：config/s3Config.example.json