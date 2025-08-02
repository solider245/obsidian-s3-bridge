import { App, Plugin, Notice } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

/**
 * S3 配置接口
 */
export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region?: string;
  useSSL: boolean;
}

/**
 * 获取插件的配置路径
 * @param plugin - 插件实例
 * @returns S3 配置文件的绝对路径
 */
function getConfigPath(plugin: Plugin): string {
  const pluginFolder = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
  return path.join(pluginFolder, 'config/s3Config.json');
}

/**
 * 从文件加载S3配置
 * @param plugin - 插件实例
 * @returns S3 配置对象
 */
export function loadS3Config(plugin: Plugin): S3Config {
  const configPath = getConfigPath(plugin);

  const defaultConfig: S3Config = {
    endpoint: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: '',
    region: '',
    useSSL: true
  };

  try {
    if (!fs.existsSync(configPath)) {
      return defaultConfig;
    }

    const rawData = fs.readFileSync(configPath, 'utf-8');
    if (!rawData) {
      return defaultConfig;
    }
    const config = JSON.parse(rawData) as S3Config;
    return { ...defaultConfig, ...config };
  } catch (error) {
    new Notice('S3配置文件已损坏，将使用默认配置。请修复或删除该文件。');
    return defaultConfig;
  }
}

/**
 * 保存S3配置到文件
 * @param plugin - 插件实例
 * @param config - 要保存的S3配置
 */
export function saveS3Config(plugin: Plugin, config: S3Config): void {
  const configPath = getConfigPath(plugin);
  const configDir = path.dirname(configPath);

  try {
    // 确保目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // 写入配置文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    new Notice('S3配置保存失败: ' + error.message);
  }
}