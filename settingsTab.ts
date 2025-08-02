import MyPlugin from './main';
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { S3Config, loadS3Config, saveS3Config } from './s3/s3Manager';

/**
 * 插件的基础设置接口
 */
export interface MyPluginSettings {
	mySetting: string;
}

/**
 * 默认的基础设置
 */
export const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

/**
 * 插件的设置面板
 */
export class MyPluginSettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	private s3Config: S3Config;

	constructor(app: App, plugin: MyPlugin, settings: MyPluginSettings) {
		super(app, plugin);
		this.plugin = plugin;
		this.s3Config = loadS3Config(this.plugin);
	}

	/**
	 * 显示设置面板
	 */
	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'S3 Image Uploader Settings' });

		// S3 配置区域
		new Setting(containerEl)
			.setName('Endpoint')
			.setDesc('S3 compatible endpoint')
			.addText(text => text
				.setPlaceholder('https://your-s3-endpoint.com')
				.setValue(this.s3Config.endpoint)
				.onChange((value) => {
					this.s3Config.endpoint = value;
				}));

		new Setting(containerEl)
			.setName('Access Key ID')
			.setDesc('S3 access key ID')
			.addText(text => text
				.setPlaceholder('your-access-key-id')
				.setValue(this.s3Config.accessKeyId)
				.onChange((value) => {
					this.s3Config.accessKeyId = value;
				}));

		new Setting(containerEl)
			.setName('Secret Access Key')
			.setDesc('S3 secret access key')
			.addText(text => text
				.setPlaceholder('your-secret-access-key')
				.setValue(this.s3Config.secretAccessKey)
				.onChange((value) => {
					this.s3Config.secretAccessKey = value;
				}));

		new Setting(containerEl)
			.setName('Bucket Name')
			.setDesc('S3 bucket name')
			.addText(text => text
				.setPlaceholder('your-bucket-name')
				.setValue(this.s3Config.bucketName)
				.onChange((value) => {
					this.s3Config.bucketName = value;
				}));

		new Setting(containerEl)
			.setName('Region')
			.setDesc('S3 region (optional)')
			.addText(text => text
				.setPlaceholder('optional-region')
				.setValue(this.s3Config.region || '')
				.onChange((value) => {
					this.s3Config.region = value;
				}));

		new Setting(containerEl)
			.setName('Use SSL')
			.setDesc('Use SSL for S3 connection')
			.addToggle(toggle => toggle
				.setValue(this.s3Config.useSSL)
				.onChange((value) => {
					this.s3Config.useSSL = value;
				}));

		// 操作按钮
		new Setting(containerEl)
			.setName('Actions')
			.setDesc('Save settings and test connection')
			.addButton(button => button
				.setButtonText('Save and Reload')
				.setCta()
				.onClick(() => {
					saveS3Config(this.plugin, this.s3Config);
					this.plugin.reloadS3ConfigAndClient();
					new Notice('Settings saved and reloaded.');
				}))
			.addButton(button => button
				.setButtonText('Test Connection')
				.onClick(async () => {
					this.testS3Connection();
				}));
	}

	/**
	 * 测试S3连接
	 */
	private async testS3Connection() {
		new Notice('Testing S3 connection...');
		try {
			const { S3Client, ListBucketsCommand, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');

			const client = new S3Client({
				endpoint: this.s3Config.endpoint,
				region: this.s3Config.region || 'us-east-1',
				credentials: {
					accessKeyId: this.s3Config.accessKeyId,
					secretAccessKey: this.s3Config.secretAccessKey
				},
				forcePathStyle: true,
				tls: this.s3Config.useSSL
			});

			const listCommand = new ListBucketsCommand({});
			const listResponse = await client.send(listCommand);
			const bucketCount = listResponse.Buckets?.length || 0;

			if (!this.s3Config.bucketName) {
				new Notice(`Found ${bucketCount} buckets. Bucket name is not configured, skipping upload test.`);
				return;
			}

			const testKey = 'obsidian-test-image.png';
			const testImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

			const putCommand = new PutObjectCommand({
				Bucket: this.s3Config.bucketName,
				Key: testKey,
				Body: testImage,
				ContentType: 'image/png'
			});

			await client.send(putCommand);

			const getCommand = new GetObjectCommand({
				Bucket: this.s3Config.bucketName,
				Key: testKey
			});

			await client.send(getCommand);

			const imageUrl = `${this.s3Config.endpoint}/${this.s3Config.bucketName}/${testKey}`;
			const markdownLink = `![Test Image](${imageUrl})`;

			navigator.clipboard.writeText(markdownLink).then(() => {
				new Notice(`S3 connection successful! Found ${bucketCount} buckets. Test image link copied to clipboard.`);
			}).catch(() => {
				new Notice(`S3 connection successful! Markdown link: ${markdownLink}`);
			});
		} catch (error) {
			new Notice(`S3 connection failed: ${error.message}`);
		}
	}
}
