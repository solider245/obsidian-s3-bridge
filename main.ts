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
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
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
}
