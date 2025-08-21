#!/bin/bash

# Obsidian S3 Bridge 健康检查脚本
# 用途：快速检查项目状态和潜在问题

echo "🔍 Obsidian S3 Bridge 健康检查"
echo "================================"

# 检查必需文件
echo "1. 检查必需文件..."
required_files=("main.ts" "manifest.json" "styles.css" "package.json")
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file 存在"
    else
        echo "❌ $file 缺失"
    fi
done

# 检查依赖
echo ""
echo "2. 检查依赖..."
if [ -d "node_modules" ]; then
    echo "✅ node_modules 存在"
else
    echo "❌ node_modules 缺失，请运行 npm install"
fi

# 检查构建状态
echo ""
echo "3. 检查构建状态..."
if [ -f "main.js" ]; then
    echo "✅ main.js 已构建"
    echo "   文件大小: $(du -h main.js | cut -f1)"
else
    echo "❌ main.js 未构建，请运行 npm run build"
fi

# 检查TypeScript错误
echo ""
echo "4. 检查TypeScript..."
if command -v npx &> /dev/null; then
    if npx tsc --noEmit --skipLibCheck &> /dev/null; then
        echo "✅ TypeScript 检查通过"
    else
        echo "❌ TypeScript 检查失败"
        echo "   请运行: npx tsc --noEmit --skipLibCheck"
    fi
else
    echo "⚠️  无法检查TypeScript (npx不可用)"
fi

# 检查Git状态
echo ""
echo "5. 检查Git状态..."
if git status --porcelain | grep -q "^??"; then
    echo "⚠️  有未跟踪的文件"
else
    echo "✅ 没有未跟踪的文件"
fi

# 检查版本一致性
echo ""
echo "6. 检查版本一致性..."
if [ -f "package.json" ] && [ -f "manifest.json" ]; then
    pkg_version=$(grep -o '"version": "[^"]*' package.json | cut -d'"' -f4)
    manifest_version=$(grep -o '"version": "[^"]*' manifest.json | cut -d'"' -f4)
    
    if [ "$pkg_version" = "$manifest_version" ]; then
        echo "✅ 版本一致: $pkg_version"
    else
        echo "❌ 版本不一致:"
        echo "   package.json: $pkg_version"
        echo "   manifest.json: $manifest_version"
    fi
fi

# 检查测试状态
echo ""
echo "7. 检查测试状态..."
if command -v npm &> /dev/null; then
    if npm test &> /dev/null; then
        echo "✅ 测试通过"
    else
        echo "❌ 测试失败"
    fi
else
    echo "⚠️  无法运行测试 (npm不可用)"
fi

echo ""
echo "🎉 健康检查完成！"
echo ""
echo "💡 快速命令:"
echo "  npm install     # 安装依赖"
echo "  npm run build   # 构建项目"
echo "  npm test        # 运行测试"
echo "  npm run lint    # 代码检查"