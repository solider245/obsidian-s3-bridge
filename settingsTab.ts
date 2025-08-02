import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';
import { loadS3Config, saveS3Config } from './s3/s3Manager';

export interface MyPluginSettings {
  // 预留插件自有设置位
}

export const DEFAULT_SETTINGS: MyPluginSettings = {};

function readHistory(): any[] {
  try {
    const raw = localStorage.getItem('obS3Uploader.history') ?? '[]';
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeHistory(arr: any[]) {
  try {
    localStorage.setItem('obS3Uploader.history', JSON.stringify(arr.slice(0, 50)));
  } catch {}
}

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
      )
      .addButton(btn =>
        btn
          .setButtonText('Test Connection')
          .onClick(async () => {
            // 连接测试：上传测试文件并在成功后删除
            const plugin = this.plugin;
            const cfg = loadS3Config(plugin);
            plugin.reloadS3ConfigAndClient();
            if (!plugin['s3Client']) {
              new Notice('S3 client is not initialized. Please check your settings.');
              return;
            }
            const { S3Client, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');

            // 组装测试对象 Key，复用 keyPrefix
            const safePrefix = (cfg.keyPrefix ?? '').replace(/^\/+/, '').replace(/\/+$/,'');
            const prefixWithSlash = safePrefix ? `${safePrefix}/` : '';
            const testKey = `${prefixWithSlash}obsidian-test-image.png`;

            // 构造极小体积的PNG文件字节流(1x1像素)
            const tinyPngBase64 =
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOQy5CwAAAAASUVORK5CYII=';
            const testBody = Buffer.from(tinyPngBase64, 'base64');

            try {
              // 上传
              const put = new PutObjectCommand({
                Bucket: cfg.bucketName,
                Key: testKey,
                Body: testBody,
                ContentType: 'image/png',
              });
              await plugin['s3Client'].send(put);

              // 删除
              const del = new DeleteObjectCommand({
                Bucket: cfg.bucketName,
                Key: testKey,
              });
              await plugin['s3Client'].send(del);

              new Notice('S3 connection test succeeded and test file was cleaned up');
            } catch (error) {
              new Notice('S3 connection test failed: ' + (error as Error).message);
            }
          }),
      );

    // Upload History
    containerEl.createEl('h3', { text: 'Upload History' });

    const historyContainer = containerEl.createDiv({ cls: 'ob-s3-history' });

    const renderHistory = () => {
      historyContainer.empty();
      const history = readHistory();

      if (!history.length) {
        historyContainer.createEl('div', { text: 'No upload history yet.' });
        return;
      }

      // 操作按钮行
      const ops = historyContainer.createDiv({ cls: 'ob-s3-history-ops' });
      const btnCopyAll = ops.createEl('button', { text: 'Copy All Links' });
      const btnClear = ops.createEl('button', { text: 'Clear History' });

      btnCopyAll.onclick = async () => {
        const links = history
          .filter((e: any) => e.url)
          .map((e: any) => e.url)
          .join('\n');
        if (!links) {
          new Notice('No successful uploads to copy.');
          return;
        }
        await navigator.clipboard.writeText(links);
        new Notice('All links copied to clipboard');
      };

      btnClear.onclick = () => {
        writeHistory([]);
        renderHistory();
        new Notice('Upload history cleared');
      };

      // 列表
      const list = historyContainer.createEl('div', { cls: 'ob-s3-history-list' });

      history.slice(0, 50).forEach((item: any) => {
        const row = list.createEl('div', { cls: 'ob-s3-history-row' });

        const meta = row.createEl('div', { cls: 'ob-s3-history-meta' });
        const time = new Date(item.time ?? Date.now()).toLocaleString();
        meta.createEl('div', { text: item.fileName ?? '(unknown file)' });
        meta.createEl('div', { text: item.key ? `Key: ${item.key}` : 'Key: -' });
        meta.createEl('div', { text: `Time: ${time}` });

        if (item.error) {
          // 失败条目
          const err = row.createEl('div', { cls: 'ob-s3-history-error' });
          err.createEl('span', { text: `Error: ${item.error}` });
        } else {
          // 成功条目
          const linkWrap = row.createEl('div', { cls: 'ob-s3-history-link' });
          const a = linkWrap.createEl('a', { text: item.url, href: item.url });
          a.target = '_blank';

          const btnCopy = linkWrap.createEl('button', { text: 'Copy' });
          btnCopy.onclick = async () => {
            await navigator.clipboard.writeText(item.url);
            new Notice('Link copied');
          };
        }
      });
    };

    renderHistory();
  }
}
