# 自动发布 Obsidian 插件 - 执行计划

## 任务概述
实现推送后自动安全检查、构建、打包和发布 Obsidian 插件的完整 CI/CD 流程

## 上下文
- **项目**: Obsidian S3-Bridge 插件
- **版本**: 1.1.1
- **技术栈**: TypeScript + Obsidian API + AWS SDK
- **当前状态**: 刚完成大文件分片上传功能开发

## 执行计划

### 阶段 1: GitHub Actions 工作流 ✅
**文件**: `.github/workflows/release.yml`

**功能**:
- 推送到 main 分支自动触发
- 包含三个阶段：安全检查、构建打包、创建发布
- 使用最新的 GitHub Actions 版本

### 阶段 2: 安全检查脚本 ✅
**文件**: `scripts/security-check.js`

**功能**:
- 版本一致性检查（package.json、manifest.json、versions.json）
- 必需文件检查
- 敏感信息扫描（API密钥、私钥等）
- 构建产物检查
- 依赖安全性检查
- 代码质量检查
- 测试覆盖率检查

### 阶段 3: 自动构建和打包 ✅
**功能**:
- 自动运行 `npm run build`
- 创建发布目录
- 复制必需文件（main.js、manifest.json、styles.css）
- 生成版本化的 ZIP 包
- 上传构建产物为 artifacts

### 阶段 4: 自动 Release 创建 ✅
**功能**:
- 自动从 CHANGELOG.md 生成发布说明
- 创建 GitHub Release
- 上传发布文件
- 自动生成版本标签

### 阶段 5: 测试和验证 ✅
**已完成**:
- 安全检查脚本测试通过
- 所有必需文件存在
- 版本一致性检查通过
- 敏感信息检查通过

## 技术细节

### 依赖更新
- 添加 `glob` 依赖用于文件查找
- 添加 `security-check` 脚本到 package.json
- 更新 `ci` 脚本包含安全检查

### 安全检查项目
1. **版本一致性**: 确保 package.json、manifest.json、versions.json 版本一致
2. **文件完整性**: 检查所有必需文件是否存在
3. **敏感信息**: 扫描 AWS 密钥、私钥、API 密钥等
4. **构建产物**: 检查 main.js 是否存在且大小合理
5. **依赖安全**: 检查是否有已知漏洞的依赖
6. **代码质量**: 检查未使用的依赖
7. **测试覆盖**: 检查测试覆盖率

### 发布流程
1. 推送到 main 分支
2. 触发 GitHub Actions
3. 执行安全检查
4. 构建和打包
5. 创建 GitHub Release
6. 自动发布完成

## 预期结果
- ✅ 推送到 main 分支后自动触发构建
- ✅ 所有安全检查通过
- ✅ 自动生成发布包
- ✅ 自动创建 GitHub Release
- ✅ 用户可从 Release 下载安装

## 当前状态
- **状态**: 所有核心功能已完成
- **测试**: 安全检查脚本测试通过
- **准备就绪**: 可以推送到 GitHub 测试完整流程

## 下一步
1. 提交所有更改到 Git
2. 推送到 GitHub 触发自动发布流程
3. 验证 GitHub Actions 工作流是否正常执行
4. 检查 Release 是否正确创建

## 注意事项
- 需要 GitHub Token 权限（contents 和 releases）
- 首次运行时需要手动授权
- 版本管理需要谨慎，确保 package.json 版本正确
- CHANGELOG.md 需要维护以生成发布说明