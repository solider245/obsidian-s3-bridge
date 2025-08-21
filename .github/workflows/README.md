# GitHub Actions 工作流说明

## 🚀 主要发布工作流

### 文件: `.github/workflows/release.yml`

这是主要的发布工作流，负责：

- 自动构建插件
- 创建发布包
- 生成 GitHub Release
- 上传构建产物

**触发条件:**

- 推送到 `main` 分支

**包含步骤:**

1. 安装依赖
2. 运行测试 (确保基本功能正常)
3. 构建插件 (确保编译成功)
4. 创建发布包
5. 生成 GitHub Release

## 🔍 质量检查工作流 (可选)

### 文件: `.github/workflows/quality-check.yml`

这是可选的质量检查工作流，不会影响发布流程：

**触发条件:**

- 手动触发 (`workflow_dispatch`)
- 创建 Pull Request
- 推送到 `main` 分支

**包含步骤:**

1. 代码格式检查 (`npm run format:check`)
2. 代码质量检查 (`npm run lint`)
3. 运行测试 (`npm run test`)
4. 构建检查 (`npm run build`)

**特点:**

- 不会阻止发布流程
- 提供质量报告和建议
- 失败时会显示修复建议

## 📝 修复代码质量问题

如果在质量检查中发现问题，可以运行以下命令修复：

```bash
# 自动修复格式和lint问题
npm run format:lint

# 或者分别运行
npm run format    # 修复格式问题
npm run lint:fix  # 修复lint问题
```

## 🎯 工作流设计理念

1. **发布优先**: 确保发布流程不会被质量检查阻塞
2. **质量保证**: 通过测试和构建确保基本功能正常
3. **可选检查**: 提供详细的质量检查但不强制要求
4. **快速迭代**: 支持快速发布和持续改进

## 📋 发布流程

1. 代码推送到 `main` 分支
2. 自动运行测试和构建
3. 创建发布包和 GitHub Release
4. 可选运行质量检查获取改进建议

这样的设计既保证了发布的稳定性，又提供了质量改进的灵活性。
