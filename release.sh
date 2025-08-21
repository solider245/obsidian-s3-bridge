#!/bin/bash

# Obsidian S3-Bridge 发布脚本
# 自动化构建、测试和发布流程

set -e  # 遇到错误时退出

echo "🚀 Obsidian S3-Bridge 发布脚本"
echo "================================="

# 获取版本信息
VERSION=$(node -p "require('./package.json').version")
echo "📦 版本: v${VERSION}"

# 1. 运行测试
echo "🧪 运行测试套件..."
npm test

# 2. 代码质量检查
echo "🔍 代码质量检查..."
npm run lint

# 3. 类型检查
echo "📝 类型检查..."
npx tsc -noEmit -skipLibCheck

# 4. 构建生产版本
echo "🏗️ 构建生产版本..."
npm run build

# 5. 创建发布目录
echo "📂 创建发布目录..."
RELEASE_DIR="release-v${VERSION}"
mkdir -p "${RELEASE_DIR}"

# 6. 复制必要文件
echo "📋 复制发布文件..."
cp main.js manifest.json styles.css "${RELEASE_DIR}/"

# 7. 创建zip包
echo "📦 创建发布包..."
cd "${RELEASE_DIR}" && zip -r "../obsidian-s3-bridge-v${VERSION}.zip" .

# 8. 清理临时目录
echo "🧹 清理临时目录..."
cd .. && rm -rf "${RELEASE_DIR}"

# 9. 验证发布包
echo "✅ 验证发布包..."
if [ -f "obsidian-s3-bridge-v${VERSION}.zip" ]; then
    echo "✅ 发布包创建成功!"
    echo "📁 文件: obsidian-s3-bridge-v${VERSION}.zip"
    echo "📏 大小: $(ls -lh "obsidian-s3-bridge-v${VERSION}.zip" | awk '{print $5}')"
    
    # 显示包内容
    echo "📦 包内容:"
    unzip -l "obsidian-s3-bridge-v${VERSION}.zip"
else
    echo "❌ 发布包创建失败!"
    exit 1
fi

# 10. Git状态检查
echo "🔍 检查Git状态..."
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  警告: 有未提交的更改"
    git status --porcelain
    read -p "是否继续发布? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ 发布取消"
        exit 1
    fi
fi

# 11. 创建Git标签 (可选)
read -p "是否创建Git标签 v${VERSION}? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🏷️  创建Git标签..."
    git tag -a "v${VERSION}" -m "Release v${VERSION}"
    echo "✅ Git标签创建完成"
    echo "💡 提示: 运行 'git push origin v${VERSION}' 推送标签"
fi

echo ""
echo "🎉 发布完成!"
echo "================================="
echo "📦 发布包: obsidian-s3-bridge-v${VERSION}.zip"
echo "📋 文件清单:"
echo "   - main.js ($(ls -lh main.js | awk '{print $5}'))"
echo "   - manifest.json ($(ls -lh manifest.json | awk '{print $5}'))"
echo "   - styles.css ($(ls -lh styles.css | awk '{print $5}'))"
echo ""
echo "🚀 下一步操作:"
echo "   1. 上传到GitHub Releases"
echo "   2. 提交到Obsidian社区插件市场"
echo "   3. 更新BRAT插件列表"
echo ""
echo "📝 发布检查清单:"
echo "   ✅ 测试通过"
echo "   ✅ 代码质量检查"
echo "   ✅ 类型检查"
echo "   ✅ 构建成功"
echo "   ✅ 发布包创建"
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "   ✅ Git标签创建"
fi