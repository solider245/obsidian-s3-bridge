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

    // Public Base URL (for viewing links)
    new Setting(containerEl)
      .setName('Public Base URL')
      .setDesc('Public domain for viewing links, e.g., https://<bucket>.r2.dev or your CDN domain. Not used for API.')
      .addText(text =>
        text
          .setPlaceholder('https://your-bucket.r2.dev')
          .setValue((s3 as any).baseUrl ?? '')
          .onChange(async (value) => {
            (s3 as any).baseUrl = value.trim();
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
          .onClick(async (evt) => {
            const plugin = this.plugin;
            const cfg = loadS3Config(plugin);

            // 按钮禁用，防止二次触发
            const buttonEl = (evt.currentTarget as HTMLElement) ?? null;
            const prevDisabled = (buttonEl as HTMLButtonElement)?.disabled ?? false;
            if (buttonEl && 'disabled' in buttonEl) {
              (buttonEl as HTMLButtonElement).disabled = true;
            }

            // 生成随机测试 Key，避免固定名被其它逻辑捕捉
            const safePrefix = (cfg.keyPrefix ?? '').replace(/^\/+/, '').replace(/\/+$/,'');
            const prefixWithSlash = safePrefix ? `${safePrefix}/` : '';
            const testKey = `${prefixWithSlash}__ob_test__${Date.now()}_${Math.random().toString(36).slice(2)}.png`;

            // 极小 PNG base64（1x1）
            const tinyPngBase64 =
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOQy5CwAAAAASUVORK5CYII=';

            // 仅在测试窗口期安装“强拦截”以彻底阻断渲染端直连 R2，避免任意第三方逻辑触发 CORS
            const origFetch = (window as any).fetch?.bind(window);
            const r2HostPatterns = [
              /(^|\.)r2\.cloudflarestorage\.com$/i,
              /(^|\.)r2\.dev$/i,
            ];
            const isR2Url = (urlStr: string) => {
              try {
                const u = new URL(urlStr, window.location.origin);
                const host = u.hostname;
                return r2HostPatterns.some(p => p.test(host));
              } catch {
                return false;
              }
            };
            const installGuard = () => {
              if (typeof window.fetch !== 'function' || !origFetch) return () => {};
              (window as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
                const urlStr = typeof input === 'string' ? input : (input as any)?.url ?? String(input);
                if (isR2Url(urlStr)) {
                  console.warn('[ob-s3-gemini] Blocked renderer fetch to R2 during Test Connection:', urlStr);
                  // 直接拒绝，不触发真实网络
                  return Promise.reject(new TypeError('Blocked renderer fetch to R2 during Test Connection'));
                }
                return origFetch(input as any, init);
              };
              return () => {
                (window as any).fetch = origFetch;
              };
            };

            const removeGuard = installGuard();

            try {
              // 不打印任何对象 URL，不返回任何 URL
              const main = await import('./main');
              await main.testS3ConnectionViaPresign(plugin, {
                key: testKey,
                contentType: 'image/png',
                bodyBase64: tinyPngBase64,
              });
              new Notice('S3 connection test succeeded');
            } catch (error) {
              // 若是我们在测试窗口期“强拦截”导致的渲染端 fetch 拒绝，不当作测试失败处理
              const msg = (error as Error)?.message || '';
              if (msg.includes('Blocked renderer fetch to R2 during Test Connection')) {
                console.warn('[ob-s3-gemini] Renderer fetch was blocked during Test Connection window; ignoring as non-fatal.');
                new Notice('已阻断渲染端直连 R2（测试期），该提示不影响主进程连通性结果');
              } else {
                console.error('[ob-s3-gemini] Test Connection failed (main path):', error);
                new Notice('S3 connection test failed: ' + (error as Error).message);
              }
            } finally {
              // 恢复 fetch 与按钮
              try { removeGuard && removeGuard(); } catch {}
              if (buttonEl && 'disabled' in buttonEl) {
                (buttonEl as HTMLButtonElement).disabled = prevDisabled;
              }
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

      // 在 Test Connection 窗口期，可能存在第三方逻辑尝试访问链接。
      // 为避免任何渲染端直连 R2，这里对“复制全部链接”在测试期进行软保护。
      btnCopyAll.onclick = async () => {
        try {
          // 简单读取，不触发任何网络请求
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
        } catch {
          new Notice('Copy failed');
        }
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
