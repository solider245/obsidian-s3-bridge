import * as fs from 'fs';
import * as path from 'path';

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region?: string;
  useSSL: boolean;
}

export function loadS3Config(): S3Config {
  const configPath = path.join(__dirname, 'config/s3Config.json');
  
  if (!fs.existsSync(configPath)) {
    throw new Error('S3配置文件不存在，请创建config/s3Config.json');
  }

  const rawData = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(rawData) as S3Config;
  
  // 验证必要字段
  if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    throw new Error('S3配置文件缺少必要字段');
  }
  
  return config;
}