#!/bin/bash

# Obsidian S3-Bridge 构建和打包脚本

echo "🔧 开始构建 Obsidian S3-Bridge 插件..."

# 1. 安装依赖
echo "📦 安装依赖..."
npm install

# 2. 运行类型检查
echo "🔍 运行类型检查..."
npx tsc -noEmit -skipLibCheck
if [ $? -ne 0 ]; then
    echo "❌ 类型检查失败，请修复错误后重试"
    exit 1
fi

# 3. 构建生产版本
echo "🏗️ 构建生产版本..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 构建失败，请检查错误"
    exit 1
fi

# 4. 创建发布目录
echo "📂 创建发布目录..."
VERSION=$(node -p "require('./package.json').version")
mkdir -p "release-v${VERSION}"

# 5. 复制构建文件
echo "📋 复制构建文件..."
cp main.js manifest.json styles.css "release-v${VERSION}/"

# 6. 创建zip包
echo "📦 创建发布包..."
cd "release-v${VERSION}" && zip -r "../obsidian-s3-bridge-v${VERSION}.zip" .

# 7. 清理临时目录
echo "🧹 清理临时目录..."
cd .. && rm -rf "release-v${VERSION}"

echo "✅ 构建完成！"
echo "📁 生成的文件：obsidian-s3-bridge-v${VERSION}.zip"
echo "📏 文件大小：$(ls -lh "obsidian-s3-bridge-v${VERSION}.zip" | awk '{print $5}')"
