import { loadS3Config, saveS3Config, S3Config } from './s3Manager';
import * as fs from 'fs';
import * as path from 'path';
import { Plugin, App, Vault } from 'obsidian';

// 模拟 fs 模块
jest.mock('fs');

// 创建一个模拟的 Plugin 实例
const mockPlugin = {
  app: {
    vault: {
      configDir: path.join('fake', 'path', 'to', '.obsidian')
    } as Vault
  } as App,
  manifest: {
    id: 'ob-s3-gemini'
  }
} as Plugin;

const configPath = path.join('fake', 'path', 'to', '.obsidian', 'plugins', 'ob-s3-gemini', 'config', 's3Config.json');
const configDir = path.dirname(configPath);

describe('s3Manager', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    // 在每个测试前重置所有模拟
    jest.clearAllMocks();
  });

  describe('loadS3Config', () => {
    it('当配置文件不存在时，应返回默认配置', () => {
      mockFs.existsSync.mockReturnValue(false);
      const config = loadS3Config(mockPlugin);
      expect(config).toEqual({
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: '',
        region: '',
        useSSL: true
      });
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });

    it('当配置文件存在且有效时，应返回解析后的配置', () => {
      const fakeConfig: S3Config = {
        endpoint: 'https://s3.example.com',
        accessKeyId: '123',
        secretAccessKey: '456',
        bucketName: 'test-bucket',
        region: 'us-west-1',
        useSSL: true
      };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fakeConfig));

      const config = loadS3Config(mockPlugin);
      expect(config).toEqual(fakeConfig);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(configPath, 'utf-8');
    });

    it('当配置文件损坏时，应返回默认配置', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      const config = loadS3Config(mockPlugin);
      expect(config).toEqual({
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: '',
        region: '',
        useSSL: true
      });
    });
  });

  describe('saveS3Config', () => {
    it('应确保存储目录存在并写入配置文件', () => {
      const configToSave: S3Config = {
        endpoint: 'https://s3.example.com',
        accessKeyId: '123',
        secretAccessKey: '456',
        bucketName: 'test-bucket',
        region: 'us-west-1',
        useSSL: false
      };

      // 模拟目录不存在，以便测试 mkdirSync 的调用
      mockFs.existsSync.mockReturnValue(false);

      saveS3Config(mockPlugin, configToSave);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(configDir, { recursive: true });
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
    });
  });
});