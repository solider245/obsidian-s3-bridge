import { App, Editor, MarkdownView, Notice, Plugin } from 'obsidian';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { MyPluginSettingTab, MyPluginSettings, DEFAULT_SETTINGS } from './settingsTab';
import { loadS3Config, S3Config } from './s3/s3Manager';

/**
 * 主插件类，处理S3上传的核心逻辑
 */
export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	s3Config: S3Config;
	private s3Client: S3Client | null;

	/**
	 * 插件加载时执行
	 */
	async onload() {
		await this.loadSettings();

		// 加载S3配置并初始化客户端
		this.reloadS3ConfigAndClient();

		// 注册粘贴事件处理
		this.registerEvent(this.app.workspace.on('editor-paste', this.handlePasteEvent.bind(this)));

		// 创建左侧功能区图标
		this.addRibbonIcon('dice', 'S3 Image Uploader', () => {
			new Notice('S3 Image Uploader is active!');
		});

		// 添加状态栏项
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('S3 Uploader Ready');

		// 添加上传命令
		this.addCommand({
			id: 'upload-image-to-s3',
			name: 'Upload Image to S3',
			editorCallback: (editor: Editor) => {
				this.selectAndUploadImage(editor);
			}
		});

		// 添加设置面板
		this.addSettingTab(new MyPluginSettingTab(this.app, this, this.settings));
	}

	/**
	 * 插件卸载时执行
	 */
	onunload() {
		this.s3Client = null;
	}

	/**
	 * 加载插件设置
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * 保存插件设置
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * 重新加载S3配置并初始化客户端
	 */
	public reloadS3ConfigAndClient() {
		this.s3Config = loadS3Config(this);
		this.initializeS3Client();
	}

	/**
	 * 初始化S3客户端
	 */
	private initializeS3Client() {
		if (!this.s3Config.endpoint || !this.s3Config.accessKeyId || !this.s3Config.secretAccessKey || !this.s3Config.bucketName) {
			this.s3Client = null;
			return;
		}

		try {
			this.s3Client = new S3Client({
				endpoint: this.s3Config.endpoint,
				region: this.s3Config.region || 'us-east-1',
				credentials: {
					accessKeyId: this.s3Config.accessKeyId,
					secretAccessKey: this.s3Config.secretAccessKey
				},
				forcePathStyle: true,
				tls: this.s3Config.useSSL
			});
		} catch (error) {
			this.s3Client = null;
			new Notice('S3 client initialization failed. Please check your settings.');
		}
	}

	/**
	 * 打开文件选择器并上传图片
	 * @param editor - 当前编辑器实例
	 */
	private selectAndUploadImage(editor: Editor) {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;

			try {
				new Notice('Uploading image...');
				const markdownLink = await this.uploadImage(file);
				editor.replaceSelection(markdownLink);
				new Notice('Image uploaded successfully!');
			} catch (error) {
				new Notice(`Upload failed: ${error.message}`);
			}
		};
		input.click();
	}

	/**
	 * 上传图片文件到S3并返回Markdown链接
	 * @param file - 要上传的文件
	 * @returns 格式化的Markdown图片链接
	 */
	async uploadImage(file: File): Promise<string> {
		if (!this.s3Client) {
			throw new Error('S3 client is not initialized. Please check your settings.');
		}

		try {
			const key = `images/${Date.now()}_${file.name}`;
			const command = new PutObjectCommand({
				Bucket: this.s3Config.bucketName,
				Key: key,
				Body: Buffer.from(await file.arrayBuffer()),
				ContentType: file.type
			});

			await this.s3Client.send(command);
			const imageUrl = `${this.s3Config.endpoint}/${this.s3Config.bucketName}/${key}`;
			return `![${file.name}](${imageUrl})`;
		} catch (error) {
			throw new Error(`Image upload failed: ${error.message}`);
		}
	}

	/**
	 * 处理编辑器的粘贴事件
	 * @param evt - 剪贴板事件
	 * @param editor - 当前编辑器实例
	 */
	private async handlePasteEvent(evt: ClipboardEvent, editor: Editor) {
		if (!evt.clipboardData || !evt.clipboardData.files.length) return;

		const imageFile = Array.from(evt.clipboardData.files).find(f => f.type.startsWith('image/'));
		if (!imageFile) return;

		evt.preventDefault();

		try {
			new Notice('Uploading image...');
			const markdownLink = await this.uploadImage(imageFile);
			editor.replaceSelection(markdownLink);
			new Notice('Image uploaded successfully!');
		} catch (error) {
			new Notice(`Upload failed: ${error.message}`);
			// Fallback to default paste behavior if upload fails
			const reader = new FileReader();
			reader.onload = (e) => {
				if (e.target?.result) {
					editor.replaceSelection(`![](${e.target.result})`);
				}
			};
			reader.readAsDataURL(imageFile);
		}
	}
}