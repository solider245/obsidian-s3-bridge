import { App, Editor, MarkdownView, Modal, Notice, Plugin } from 'obsidian';
import { MyPluginSettingTab, MyPluginSettings, DEFAULT_SETTINGS, S3Config } from './settingsTab';
import * as fs from 'fs';
import * as path from 'path';

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	s3Config: S3Config;

	async onload() {
		await this.loadSettings();
		
		// 加载S3配置
		this.s3Config = this.loadS3Config();
		console.log('S3配置加载成功:', this.s3Config);
		new Notice('S3配置加载成功');
		
		// 注册粘贴事件处理
		this.registerEvent(this.app.workspace.on('editor-paste', this.handlePasteEvent.bind(this)));

		// 创建左侧功能区图标
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			new Notice('This is a notice!');
		});
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// 添加状态栏项
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// 示例编辑器命令
		this.addCommand({
			id: 'upload-image-to-s3',
			name: '上传图片到S3',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				// 保存当前编辑器引用
				const currentEditor = editor;
				
				// 创建文件选择输入框
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = 'image/*';
				
				input.onchange = async (e) => {
					const file = (e.target as HTMLInputElement).files?.[0];
					if (!file) return;
					
					try {
						new Notice('正在上传图片...');
						const markdownLink = await this.uploadImage(file);
						
						// 确保编辑器仍然活动
						if (this.app.workspace.activeEditor?.editor === currentEditor) {
							currentEditor.replaceSelection(markdownLink);
							new Notice('图片上传成功！');
						} else {
							new Notice('图片上传成功！请手动粘贴链接: ' + markdownLink);
							navigator.clipboard.writeText(markdownLink);
						}
					} catch (error) {
						console.error(error);
						new Notice(`上传失败: ${error.message}`);
					}
				};
				
				input.click();
			}
		});

		// 注册全局DOM事件
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// 注册定时器
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
		
		// 添加设置面板
		this.addSettingTab(new MyPluginSettingTab(this.app, this, this.settings));
	}

	onunload() {
		// 清理代码
	}

	async loadSettings() {
		const savedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	
	// 从文件加载S3配置
	private loadS3Config(): S3Config {
		// 获取插件安装目录
		const pluginFolder = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		console.log('插件安装目录:', pluginFolder);
		
		const configPath = path.join(pluginFolder, 'config/s3Config.json');
		console.log('加载S3配置文件:', configPath);
		
		try {
			if (!fs.existsSync(configPath)) {
				console.log('配置文件不存在，使用默认配置');
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
			const config = JSON.parse(rawData) as S3Config;
			console.log('成功加载S3配置:', config);
			return config;
		} catch (error) {
			console.error('加载S3配置失败:', error);
			new Notice('S3配置加载失败，请检查文件格式');
			return {
				endpoint: '',
				accessKeyId: '',
				secretAccessKey: '',
				bucketName: '',
				region: '',
				useSSL: true
			};
		}
	}
	
	// 上传图片并返回markdown链接
	async uploadImage(file: File): Promise<string> {
		try {
			const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
			
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
			
			const key = `images/${Date.now()}_${file.name}`;
			const command = new PutObjectCommand({
				Bucket: this.s3Config.bucketName,
				Key: key,
				Body: Buffer.from(await file.arrayBuffer()),
				ContentType: file.type
			});
			
			await client.send(command);
			const imageUrl = `${this.s3Config.endpoint}/${this.s3Config.bucketName}/${key}`;
			return `![${file.name}](${imageUrl})`;
		} catch (error) {
			console.error('图片上传失败:', error);
			throw new Error('图片上传失败: ' + error.message);
		}
	}
	
	// 处理粘贴事件
	private async handlePasteEvent(evt: ClipboardEvent, editor: Editor) {
		// 检查粘贴内容是否包含图片
		if (!evt.clipboardData || !evt.clipboardData.files.length) return;
		
		const imageFile = Array.from(evt.clipboardData.files).find(f => f.type.startsWith('image/'));
		if (!imageFile) return;
		
		// 阻止默认粘贴行为
		evt.preventDefault();
		
		try {
			new Notice('正在上传图片...');
			const markdownLink = await this.uploadImage(imageFile);
			
			// 替换粘贴内容为markdown链接
			editor.replaceSelection(markdownLink);
			new Notice('图片上传成功！');
		} catch (error) {
			console.error(error);
			new Notice(`上传失败: ${error.message}`);
			
			// 上传失败时回退到原始粘贴
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
