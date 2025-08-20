#!/usr/bin/env node

/**
 * Obsidian S3-Bridge 安全检查脚本
 * 
 * 此脚本用于在 CI/CD 流程中进行全面的安全检查
 * 包括：代码质量、版本一致性、敏感信息扫描等
 */

const fs = require('fs');
const path = require('path');

class SecurityChecker {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.rootDir = process.cwd();
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅';
        console.log(`[${timestamp}] ${prefix} ${message}`);
    }

    error(message) {
        this.errors.push(message);
        this.log(message, 'error');
    }

    warning(message) {
        this.warnings.push(message);
        this.log(message, 'warning');
    }

    success(message) {
        this.log(message, 'success');
    }

    // 检查版本一致性
    checkVersionConsistency() {
        this.log('检查版本一致性...');
        
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf8'));
            const manifestJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'manifest.json'), 'utf8'));
            const versionsJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'versions.json'), 'utf8'));
            
            const packageVersion = packageJson.version;
            const manifestVersion = manifestJson.version;
            
            if (packageVersion !== manifestVersion) {
                this.error(`版本不一致: package.json (${packageVersion}) != manifest.json (${manifestVersion})`);
                return false;
            }
            
            if (!versionsJson[packageVersion]) {
                this.error(`versions.json 中缺少版本 ${packageVersion} 的记录`);
                return false;
            }
            
            this.success(`版本一致性检查通过: ${packageVersion}`);
            return true;
        } catch (error) {
            this.error(`版本检查失败: ${error.message}`);
            return false;
        }
    }

    // 检查必需文件
    checkRequiredFiles() {
        this.log('检查必需文件...');
        
        const requiredFiles = [
            'package.json',
            'manifest.json',
            'main.ts',
            'styles.css',
            'CHANGELOG.md'
        ];
        
        let allFilesExist = true;
        
        for (const file of requiredFiles) {
            const filePath = path.join(this.rootDir, file);
            if (!fs.existsSync(filePath)) {
                this.error(`缺少必需文件: ${file}`);
                allFilesExist = false;
            } else {
                this.success(`文件存在: ${file}`);
            }
        }
        
        return allFilesExist;
    }

    // 检查敏感信息
    checkSensitiveInformation() {
        this.log('检查敏感信息...');
        
        const sensitivePatterns = [
            // AWS 密钥
            /AKIA[0-9A-Z]{16}/gi,
            /aws[_-]?secret[_-]?access[_-]?key['\"]?\s*[:=]\s*['\"]?[A-Za-z0-9/+=]{40}['\"]?/gi,
            // 私钥
            /-----BEGIN.*PRIVATE KEY-----/gi,
            // API 密钥
            /api[_-]?key['\"]?\s*[:=]\s*['\"]?[A-Za-z0-9]{32,}['\"]?/gi,
            // 数据库连接字符串
            /mongodb:\/\/[^:\s]+:[^@\s]+@[^\/\s]+/gi,
            /postgresql:\/\/[^:\s]+:[^@\s]+@[^\/\s]+/gi,
            // GitHub Token
            /ghp_[A-Za-z0-9]{36}/gi,
            /gho_[A-Za-z0-9]{36}/gi,
            // 其他敏感信息
            /password['\"]?\s*[:=]\s*['\"]?[^'\"]{8,}['\"]?/gi
        ];
        
        const filesToCheck = [
            'package.json',
            'manifest.json',
            'main.ts',
            'settingsTab.ts',
            'src/**/*.ts',
            'tests/**/*.ts'
        ];
        
        let hasSensitiveInfo = false;
        
        for (const pattern of sensitivePatterns) {
            for (const filePattern of filesToCheck) {
                const files = this.findFiles(filePattern);
                for (const file of files) {
                    const content = fs.readFileSync(file, 'utf8');
                    const matches = content.match(pattern);
                    if (matches) {
                        this.error(`在文件 ${file} 中发现敏感信息: ${pattern}`);
                        hasSensitiveInfo = true;
                    }
                }
            }
        }
        
        if (!hasSensitiveInfo) {
            this.success('敏感信息检查通过');
        }
        
        return !hasSensitiveInfo;
    }

    // 查找文件
    findFiles(pattern) {
        const glob = require('glob');
        return glob.sync(pattern, { cwd: this.rootDir, absolute: true });
    }

    // 检查构建产物
    checkBuildArtifacts() {
        this.log('检查构建产物...');
        
        const mainJsPath = path.join(this.rootDir, 'main.js');
        if (!fs.existsSync(mainJsPath)) {
            this.error('构建产物 main.js 不存在');
            return false;
        }
        
        const stats = fs.statSync(mainJsPath);
        const sizeInMB = stats.size / (1024 * 1024);
        
        if (sizeInMB > 10) {
            this.warning(`构建产物较大: ${sizeInMB.toFixed(2)}MB`);
        }
        
        this.success(`构建产物检查通过: ${(sizeInMB * 1024).toFixed(0)}KB`);
        return true;
    }

    // 检查依赖安全性
    checkDependencies() {
        this.log('检查依赖安全性...');
        
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf8'));
            const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
            
            // 检查已知的有漏洞依赖
            const vulnerablePackages = [
                'lodash', // 历史上有漏洞
                'moment', // 建议用 date-fns 替代
                'request', // 已废弃
                'node-fetch', // 历史版本有漏洞
            ];
            
            let hasVulnerableDeps = false;
            
            for (const dep of vulnerablePackages) {
                if (dependencies[dep]) {
                    this.warning(`检测到可能有漏洞的依赖: ${dep}@${dependencies[dep]}`);
                    hasVulnerableDeps = true;
                }
            }
            
            if (!hasVulnerableDeps) {
                this.success('依赖安全性检查通过');
            }
            
            return !hasVulnerableDeps;
        } catch (error) {
            this.error(`依赖检查失败: ${error.message}`);
            return false;
        }
    }

    // 检查代码质量
    checkCodeQuality() {
        this.log('检查代码质量...');
        
        try {
            // 检查是否有未使用的依赖
            const packageJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf8'));
            const dependencies = Object.keys(packageJson.dependencies || {});
            const devDependencies = Object.keys(packageJson.devDependencies || {});
            
            // 检查 main.ts 中的导入
            const mainTsPath = path.join(this.rootDir, 'main.ts');
            if (fs.existsSync(mainTsPath)) {
                const mainTsContent = fs.readFileSync(mainTsPath, 'utf8');
                const importMatches = mainTsContent.match(/import.*from\s+['"]([^'"]+)['"]/g) || [];
                const usedImports = importMatches.map(match => {
                    const importPath = match.match(/from\s+['"]([^'"]+)['"]/)[1];
                    return importPath.split('/')[0];
                });
                
                for (const dep of dependencies) {
                    if (!usedImports.includes(dep) && dep !== '@aws-sdk/client-s3' && dep !== '@aws-sdk/s3-request-presigner') {
                        this.warning(`可能未使用的依赖: ${dep}`);
                    }
                }
            }
            
            this.success('代码质量检查通过');
            return true;
        } catch (error) {
            this.error(`代码质量检查失败: ${error.message}`);
            return false;
        }
    }

    // 检查测试覆盖率
    checkTestCoverage() {
        this.log('检查测试覆盖率...');
        
        const testFiles = this.findFiles('tests/**/*.test.ts');
        const sourceFiles = this.findFiles('src/**/*.ts');
        
        if (testFiles.length === 0) {
            this.error('没有找到测试文件');
            return false;
        }
        
        const coverage = testFiles.length / (testFiles.length + sourceFiles.length) * 100;
        
        if (coverage < 30) {
            this.warning(`测试覆盖率较低: ${coverage.toFixed(1)}%`);
        } else {
            this.success(`测试覆盖率检查通过: ${coverage.toFixed(1)}%`);
        }
        
        return true;
    }

    // 运行所有检查
    async runAllChecks() {
        this.log('开始安全检查...');
        
        const checks = [
            this.checkVersionConsistency(),
            this.checkRequiredFiles(),
            this.checkSensitiveInformation(),
            this.checkBuildArtifacts(),
            this.checkDependencies(),
            this.checkCodeQuality(),
            this.checkTestCoverage()
        ];
        
        const results = await Promise.all(checks);
        const passedChecks = results.filter(result => result).length;
        const totalChecks = results.length;
        
        this.log(`\n=== 安全检查总结 ===`);
        this.log(`通过检查: ${passedChecks}/${totalChecks}`);
        this.log(`错误数量: ${this.errors.length}`);
        this.log(`警告数量: ${this.warnings.length}`);
        
        if (this.errors.length > 0) {
            this.log('\n错误列表:');
            this.errors.forEach((error, index) => {
                this.log(`${index + 1}. ${error}`, 'error');
            });
        }
        
        if (this.warnings.length > 0) {
            this.log('\n警告列表:');
            this.warnings.forEach((warning, index) => {
                this.log(`${index + 1}. ${warning}`, 'warning');
            });
        }
        
        if (this.errors.length > 0) {
            this.log('\n❌ 安全检查失败，请修复错误后重试');
            process.exit(1);
        } else {
            this.log('\n✅ 安全检查通过');
            process.exit(0);
        }
    }
}

// 运行检查
if (require.main === module) {
    const checker = new SecurityChecker();
    checker.runAllChecks().catch(error => {
        console.error('安全检查失败:', error);
        process.exit(1);
    });
}

module.exports = SecurityChecker;