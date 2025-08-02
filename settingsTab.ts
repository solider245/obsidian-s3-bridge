import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';
import { loadS3Config, saveS3Config } from './s3/s3Manager';

export interface MyPluginSettings {
  // 预留插件自有设置位
}

export const DEFAULT_SETTINGS: MyPluginSettings = {};

export class MyPluginSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin, _settings: MyPluginSettings) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'S3 Image Uploader Settings' });

    // 加载当前 S3 配置
    const s3 = loadS3Config(this.plugin);

    // Endpoint
    new Setting(containerEl)
      .setName('Endpoint')
      .setDesc('S3 compatible endpoint')
      .addText(text =>
        text
          .setPlaceholder('https://s3.example.com')
          .setValue(s3.endpoint)
          .onChange(async (value) => {
            s3.endpoint = value.trim();
          }),
      );

    // Access Key ID
    new Setting(containerEl)
      .setName('Access Key ID')
      .setDesc('S3 access key ID')
      .addText(text =>
        text
          .setPlaceholder('AKIA...')
          .setValue(s3.accessKeyId)
          .onChange(async (value) => {
            s3.accessKeyId = value.trim();
          }),
      );

    // Secret Access Key
    new Setting(containerEl)
      .setName('Secret Access Key')
      .setDesc('S3 secret access key')
      .addText(text =>
        text
          .setPlaceholder('********')
          .setValue(s3.secretAccessKey)
          .onChange(async (value) => {
            s3.secretAccessKey = value.trim();
          }),
      );

    // Bucket Name
    new Setting(containerEl)
      .setName('Bucket Name')
      .setDesc('S3 bucket name')
      .addText(text =>
        text
          .setPlaceholder('my-bucket')
          .setValue(s3.bucketName)
          .onChange(async (value) => {
            s3.bucketName = value.trim();
          }),
      );

    // Region
    new Setting(containerEl)
      .setName('Region')
      .setDesc('S3 region optional')
      .addText(text =>
        text
          .setPlaceholder('us-east-1')
          .setValue(s3.region ?? '')
          .onChange(async (value) => {
            s3.region = value.trim();
          }),
      );

    // Use SSL
    new Setting(containerEl)
      .setName('Use SSL')
      .setDesc('Use SSL for S3 connection')
      .addToggle(toggle =>
        toggle
          .setValue(!!s3.useSSL)
          .onChange(async (value) => {
            s3.useSSL = value;
          }),
      );

    // Key Prefix
    new Setting(containerEl)
      .setName('Key Prefix')
      .setDesc('Optional object key prefix such as yyyy/mm/dd/ or images/')
      .addText(text =>
        text
          .setPlaceholder('images/')
          .setValue(s3.keyPrefix ?? '')
          .onChange(async (value) => {
            s3.keyPrefix = value.trim();
          }),
      );

    // Actions
    new Setting(containerEl)
      .setName('Actions')
      .setDesc('Save settings and test connection')
      .addButton(btn =>
        btn
          .setButtonText('Save and Reload')
          .setCta()
          .onClick(async () => {
            s3.keyPrefix = s3.keyPrefix ?? '';
            saveS3Config(this.plugin, s3);
            this.plugin.reloadS3ConfigAndClient();
            new Notice('S3 settings saved');
          }),
      );
  }
}
