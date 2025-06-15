import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
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

export interface MyPluginSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export class MyPluginSettingTab extends PluginSettingTab {
	plugin: Plugin;
	settings: MyPluginSettings;

	constructor(app: App, plugin: Plugin, settings: MyPluginSettings) {
		super(app, plugin);
		this.plugin = plugin;
		this.settings = settings;
	}

	// 保存S3配置到文件
	private saveS3Config(config: S3Config) {
		const configPath = path.join(this.plugin.app.vault.configDir, 'plugins/ob-s3-gemini/config/s3Config.json');
		const configDir = path.dirname(configPath);
		
		// 确保目录存在
		if (!fs.existsSync(configDir)) {
			fs.mkdirSync(configDir, { recursive: true });
		}
		
		// 写入配置文件
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
	}

	// 从文件加载S3配置
	private loadS3Config(): S3Config {
		const configPath = path.join(this.plugin.app.vault.configDir, 'plugins/ob-s3-gemini/config/s3Config.json');
		
		if (!fs.existsSync(configPath)) {
			// 文件不存在时返回默认配置
			return {
				endpoint: '',
				accessKeyId: '',
				secretAccessKey: '',
				bucketName: '',
				region: '',
				useSSL: true
			};
		}
		
		const rawData = fs.readFileSync(configPath, 'utf-8');
		return JSON.parse(rawData) as S3Config;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// 加载当前S3配置
		const s3Config = this.loadS3Config();

		// 原有设置项
		new Setting(containerEl)
			.setName('基础设置')
			.setDesc('插件基础配置')
			.addText(text => text
				.setPlaceholder('输入配置值')
				.setValue(this.settings.mySetting)
				.onChange(async (value) => {
					this.settings.mySetting = value;
					await this.plugin.saveData(this.settings);
				}));

		// S3 配置区域
		containerEl.createEl('h2', { text: 'S3 对象存储配置' });

		new Setting(containerEl)
			.setName('Endpoint')
			.setDesc('S3 兼容服务端点')
			.addText(text => text
				.setPlaceholder('https://your-s3-endpoint.com')
				.setValue(s3Config.endpoint)
				.onChange(async (value) => {
					s3Config.endpoint = value;
					this.saveS3Config(s3Config);
				}));

		new Setting(containerEl)
			.setName('Access Key ID')
			.setDesc('S3 访问密钥 ID')
			.addText(text => text
				.setPlaceholder('your-access-key-id')
				.setValue(s3Config.accessKeyId)
				.onChange(async (value) => {
					s3Config.accessKeyId = value;
					this.saveS3Config(s3Config);
				}));

		new Setting(containerEl)
			.setName('Secret Access Key')
			.setDesc('S3 秘密访问密钥')
			.addText(text => text
				.setPlaceholder('your-secret-access-key')
				.setValue(s3Config.secretAccessKey)
				.onChange(async (value) => {
					s3Config.secretAccessKey = value;
					this.saveS3Config(s3Config);
				}));

		new Setting(containerEl)
			.setName('Bucket Name')
			.setDesc('存储桶名称')
			.addText(text => text
				.setPlaceholder('your-bucket-name')
				.setValue(s3Config.bucketName)
				.onChange(async (value) => {
					s3Config.bucketName = value;
					this.saveS3Config(s3Config);
				}));

		new Setting(containerEl)
			.setName('Region')
			.setDesc('区域（可选）')
			.addText(text => text
				.setPlaceholder('optional-region')
				.setValue(s3Config.region || '')
				.onChange(async (value) => {
					s3Config.region = value;
					this.saveS3Config(s3Config);
				}));

		new Setting(containerEl)
			.setName('使用 SSL')
			.setDesc('是否启用 SSL 连接')
			.addToggle(toggle => toggle
				.setValue(s3Config.useSSL)
				.onChange(async (value) => {
					s3Config.useSSL = value;
					this.saveS3Config(s3Config);
				}));
	}
}