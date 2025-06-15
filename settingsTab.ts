import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
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
		// 获取插件安装目录
		const pluginFolder = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		const configPath = path.join(pluginFolder, 'config/s3Config.json');
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
		// 获取插件安装目录
		const pluginFolder = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		const configPath = path.join(pluginFolder, 'config/s3Config.json');
		
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
		
		// 添加测试连接按钮
		new Setting(containerEl)
			.setName('测试连接')
			.setDesc('测试S3服务连接')
			.addButton(button => button
				.setButtonText('测试连接')
				.onClick(async () => {
					new Notice('正在测试S3连接...');
					try {
						// 使用S3配置创建客户端
						const { S3Client, ListBucketsCommand, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
						
						const client = new S3Client({
							endpoint: s3Config.endpoint,
							region: s3Config.region || 'us-east-1',
							credentials: {
								accessKeyId: s3Config.accessKeyId,
								secretAccessKey: s3Config.secretAccessKey
							},
							forcePathStyle: true, // 对于MinIO等S3兼容服务需要
							tls: s3Config.useSSL
						});
						
						// 1. 测试列出存储桶
						const listCommand = new ListBucketsCommand({});
						const listResponse = await client.send(listCommand);
						const bucketCount = listResponse.Buckets?.length || 0;
						
						// 2. 上传测试图片
						if (!s3Config.bucketName) {
							new Notice('未配置存储桶名称，跳过图片上传测试');
							return;
						}
						
						const testKey = 'obsidian-test-image.png';
						const testImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
						
						const putCommand = new PutObjectCommand({
							Bucket: s3Config.bucketName,
							Key: testKey,
							Body: testImage,
							ContentType: 'image/png'
						});
						
						await client.send(putCommand);
						
						// 3. 验证图片存在
						const getCommand = new GetObjectCommand({
							Bucket: s3Config.bucketName,
							Key: testKey
						});
						
						const getResponse = await client.send(getCommand);
						
						// 4. 生成图片访问URL和Markdown链接
						const imageUrl = `${s3Config.endpoint}/${s3Config.bucketName}/${testKey}`;
						const markdownLink = `![测试图片](${imageUrl})`;
						
						// 5. 复制到剪贴板
						navigator.clipboard.writeText(markdownLink).then(() => {
							new Notice(`S3连接测试成功！找到 ${bucketCount} 个存储桶\nMarkdown链接已复制到剪贴板: ${markdownLink}`);
						}).catch(err => {
							console.error('复制失败:', err);
							new Notice(`S3连接测试成功！找到 ${bucketCount} 个存储桶\nMarkdown链接: ${markdownLink}\n(请手动复制)`);
						});
					} catch (error) {
						console.error('S3连接测试失败:', error);
						new Notice('S3连接失败: ' + error.message);
					}
				}));
	}
}