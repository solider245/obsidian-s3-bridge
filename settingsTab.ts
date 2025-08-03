import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';
import { loadS3Config, saveS3Config, listProfiles, setCurrentProfile, upsertProfile, removeProfile, S3Profile, ProviderType, loadActiveProfile } from './s3/s3Manager';

export interface MyPluginSettings {
  // 预留插件自有设置位
}

export const DEFAULT_SETTINGS: MyPluginSettings = {};

// Manifest 表单字段定义
type FieldType = 'text' | 'password' | 'toggle';

interface FormField {
  key: keyof S3Profile;
  label: string;
  placeholder: string;
  note: string;
  required: boolean;
  defaultValue?: string | boolean;
  type?: FieldType;
}

// 提供商清单（可扩展）
const PROVIDER_MANIFEST: Record<ProviderType, FormField[]> = {
  'cloudflare-r2': [
    { key: 'name', label: '配置名称', placeholder: '例如：我的博客图床', note: '给你自己看的一个友好名称。', required: true },
    { key: 'endpoint', label: 'Endpoint', placeholder: '<ACCOUNT_ID>.r2.cloudflarestorage.com', note: '必需。来自 R2 仪表盘，不含 bucket 路径。', required: true },
    { key: 'bucketName', label: 'Bucket', placeholder: '例如：my-bucket', note: '必需。R2 存储桶名称。', required: true },
    { key: 'accessKeyId', label: 'Access Key ID', placeholder: '请输入 Access Key ID', note: '必需。R2 API 密钥。', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: '请输入 Secret Access Key', note: '必需。R2 API 密钥。', required: true, type: 'password' },
    { key: 'region', label: 'Region', placeholder: 'auto', note: 'R2 必须填 auto。', required: true, defaultValue: 'auto' },
    { key: 'useSSL', label: 'Use SSL', placeholder: '', note: '建议开启。', required: true, defaultValue: true, type: 'toggle' },
    { key: 'baseUrl', label: 'Public Base URL', placeholder: 'https://<bucket>.r2.dev 或你的自定义域', note: '用于拼接可访问链接，不用于 API。', required: false },
    { key: 'keyPrefix', label: 'Key Prefix', placeholder: 'images/ 或 yyyy/mm/dd/', note: '对象键前缀，可选。', required: false },
  ],
  'minio': [
    { key: 'name', label: '配置名称', placeholder: '例如：本地测试 MinIO', note: '给你自己看的一个友好名称。', required: true },
    { key: 'endpoint', label: 'Endpoint', placeholder: 'http://127.0.0.1:9000', note: '必需。注意包含 http:// 或 https://，且使用 path-style。', required: true },
    { key: 'bucketName', label: 'Bucket', placeholder: '例如：obsidian-vault', note: '必需。MinIO 存储桶名称。', required: true },
    { key: 'accessKeyId', label: 'Access Key', placeholder: '例如：minioadmin', note: '必需。你的 MinIO 用户名。', required: true },
    { key: 'secretAccessKey', label: 'Secret Key', placeholder: '例如：minioadmin', note: '必需。你的 MinIO 密码。', required: true, type: 'password' },
    { key: 'region', label: 'Region', placeholder: 'us-east-1', note: '可为任意合法字符串，默认 us-east-1。', required: true, defaultValue: 'us-east-1' },
    { key: 'useSSL', label: 'Use SSL', placeholder: '', note: '与 endpoint 协议保持一致。', required: true, defaultValue: false, type: 'toggle' },
    { key: 'baseUrl', label: 'Public Base URL', placeholder: '可为空', note: '用于拼接可访问链接，不用于 API。', required: false },
    { key: 'keyPrefix', label: 'Key Prefix', placeholder: 'images/ 或 yyyy/mm/dd/', note: '对象键前缀，可选。', required: false },
  ],
  'aws-s3': [
    { key: 'name', label: '配置名称', placeholder: '例如：AWS 正式环境', note: '给你自己看的一个友好名称。', required: true },
    { key: 'endpoint', label: 'Endpoint', placeholder: 'https://s3.amazonaws.com 或区域端点', note: '可选。通常无需填写，保持空值由 SDK 处理。', required: false },
    { key: 'bucketName', label: 'Bucket', placeholder: '例如：my-bucket', note: '必需。AWS S3 存储桶名称。', required: true },
    { key: 'accessKeyId', label: 'Access Key ID', placeholder: 'AKIA...', note: '必需。', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: '********', note: '必需。', required: true, type: 'password' },
    { key: 'region', label: 'Region', placeholder: 'us-east-1', note: '必填，必须为合法区域。', required: true },
    { key: 'useSSL', label: 'Use SSL', placeholder: '', note: '建议开启。', required: true, defaultValue: true, type: 'toggle' },
    { key: 'baseUrl', label: 'Public Base URL', placeholder: '可为空或自定义域', note: '用于拼接可访问链接，不用于 API。', required: false },
    { key: 'keyPrefix', label: 'Key Prefix', placeholder: 'images/ 或 yyyy/mm/dd/', note: '对象键前缀，可选。', required: false },
  ],
  'custom': [
    { key: 'name', label: '配置名称', placeholder: '例如：自定义兼容 S3', note: '给你自己看的一个友好名称。', required: true },
    { key: 'endpoint', label: 'Endpoint', placeholder: 'https://s3.example.com', note: '必需。兼容 S3 的端点，通常需要 http(s)://。', required: true },
    { key: 'bucketName', label: 'Bucket', placeholder: 'my-bucket', note: '必需。', required: true },
    { key: 'accessKeyId', label: 'Access Key ID', placeholder: 'AKIA... 或其他', note: '必需。', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: '********', note: '必需。', required: true, type: 'password' },
    { key: 'region', label: 'Region', placeholder: 'us-east-1', note: '可选，留空则默认 us-east-1。', required: false },
    { key: 'useSSL', label: 'Use SSL', placeholder: '', note: '与 endpoint 协议保持一致。', required: true, defaultValue: true, type: 'toggle' },
    { key: 'baseUrl', label: 'Public Base URL', placeholder: '可为空或自定义域', note: '用于拼接可访问链接，不用于 API。', required: false },
    { key: 'keyPrefix', label: 'Key Prefix', placeholder: 'images/ 或 yyyy/mm/dd/', note: '对象键前缀，可选。', required: false },
  ],
};

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

  private renderProfilesSection(containerEl: HTMLElement) {
    containerEl.createEl('h2', { text: 'S3 Profiles' });

    const profiles = listProfiles(this.plugin);
    const active = loadActiveProfile(this.plugin);

    // 顶部：当前 Profile 选择与基础操作
    const header = new Setting(containerEl)
      .setName('Active Profile')
      .setDesc('切换当前使用的账户配置');

    header.addDropdown(drop => {
      profiles.forEach(p => {
        drop.addOption(p.id, p.name || p.id);
      });
      if (profiles.length && active?.id) {
        drop.setValue(active.id);
      }
      drop.onChange((val) => {
        setCurrentProfile(this.plugin, val);
        this.display();
        new Notice('Switched active profile');
      });
    });

    header.addButton(btn => {
      btn.setButtonText('New Profile').onClick(() => {
        // 默认使用 custom 类型，填入常用默认值
        const created = upsertProfile(this.plugin, {
          name: 'New Profile',
          providerType: 'custom',
          region: 'us-east-1',
          useSSL: true,
        });
        setCurrentProfile(this.plugin, created.id);
        this.display();
        new Notice('New profile created');
      });
    });

    if (active?.id) {
      header.addButton(btn => {
        btn.setButtonText('Delete Current').onClick(() => {
          removeProfile(this.plugin, active.id);
          this.display();
          new Notice('Profile deleted');
        });
      });
    }

    // 当前 Profile 的基础信息编辑：名称与类型
    const base = new Setting(containerEl).setName('Profile Base');
    base.addText(t => {
      t.setPlaceholder('Profile name').setValue(active?.name ?? '').onChange((v) => {
        if (!active) return;
        // 仅提交差异补丁并带上 id，避免老快照覆盖
        const merged = upsertProfile(this.plugin, { id: active.id, name: v.trim() });
        // 确保当前激活的是刚更新的 profile
        setCurrentProfile(this.plugin, merged.id);
        this.display();
      });
    });
    base.addDropdown(dd => {
      const types: ProviderType[] = ['cloudflare-r2', 'minio', 'aws-s3', 'custom'];
      types.forEach(tp => dd.addOption(tp, tp));
      dd.setValue(active?.providerType ?? 'custom');
      dd.onChange((val: ProviderType) => {
        if (!active) return;
        const merged = upsertProfile(this.plugin, { id: active.id, providerType: val });
        setCurrentProfile(this.plugin, merged.id);
        // 重新渲染以切换表单
        this.display();
      });
    });
  }

  private renderProfileForm(containerEl: HTMLElement) {
    const active = loadActiveProfile(this.plugin);
    const fields = PROVIDER_MANIFEST[active.providerType] ?? PROVIDER_MANIFEST['custom'];

    // 逐项渲染
    for (const field of fields) {
      const currentVal = (active as any)[field.key];
      const setting = new Setting(containerEl)
        .setName(field.label + (field.required ? ' *' : ''))
        .setDesc(field.note);

      if (field.type === 'toggle') {
        setting.addToggle(tg => {
          tg.setValue(Boolean(currentVal ?? field.defaultValue ?? false));
          tg.onChange((v) => {
            const patch: any = { id: active.id, [field.key]: v };
            const merged = upsertProfile(this.plugin, patch);
            setCurrentProfile(this.plugin, merged.id);
            // toggle 改动无需整页重绘
          });
        });
        continue;
      }

      // 文本或密码
      setting.addText(tx => {
        tx.setPlaceholder(field.placeholder);
        tx.setValue((currentVal ?? field.defaultValue ?? '').toString());
        if (field.type === 'password') {
          try {
            (tx.inputEl as HTMLInputElement).type = 'password';
          } catch {}
        }
        tx.onChange((v) => {
          const patch: any = { id: active.id, [field.key]: v.trim() };
          const merged = upsertProfile(this.plugin, patch);
          setCurrentProfile(this.plugin, merged.id);
          // 对不影响表单结构的字段不必重绘
        });
      });
    }
  }

  private renderActions(containerEl: HTMLElement) {
    const actions = new Setting(containerEl)
      .setName('Actions')
      .setDesc('保存并重载客户端或进行连通性测试');

    actions.addButton(btn => {
      btn.setButtonText('Save and Reload').setCta().onClick(() => {
        // 向后兼容旧保存：保存当前 profile 字段并刷新
        const compat = loadS3Config(this.plugin);
        // 直接复用 saveS3Config 以更新当前 profile
        // 注意：loadS3Config/ saveS3Config 在 s3Manager 中已被改为当前 profile 视角
        // 因为我们在表单变更时已 upsertProfile 实时保存，此处仅触发客户端重载
        this.plugin.reloadS3ConfigAndClient();
        new Notice('S3 settings saved and client reloaded');
      });
    });

    actions.addButton(btn => {
      btn.setButtonText('Test Connection').onClick(async (evt) => {
        const plugin = this.plugin;
        const cfg = loadS3Config(plugin);

        // 按钮禁用，防止二次触发
        const buttonEl = (evt.currentTarget as HTMLElement) ?? null;
        const prevDisabled = (buttonEl as HTMLButtonElement)?.disabled ?? false;
        if (buttonEl && 'disabled' in buttonEl) {
          (buttonEl as HTMLButtonElement).disabled = true;
        }

        // 生成随机测试 Key
        const safePrefix = (cfg.keyPrefix ?? '').replace(/^\/+/, '').replace(/\/+$/,'');
        const prefixWithSlash = safePrefix ? `${safePrefix}/` : '';
        const testKey = `${prefixWithSlash}__ob_test__${Date.now()}_${Math.random().toString(36).slice(2)}.png`;

        // 极小 PNG base64（1x1）
        const tinyPngBase64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOQy5CwAAAAASUVORK5CYII=';

        // 强拦截渲染端 R2 直连
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
          const main = await import('./main');
          await main.testS3ConnectionViaPresign(plugin, {
            key: testKey,
            contentType: 'image/png',
            bodyBase64: tinyPngBase64,
          });
          new Notice('S3 connection test succeeded');
        } catch (error) {
          const msg = (error as Error)?.message || '';
          if (msg.includes('Blocked renderer fetch to R2 during Test Connection')) {
            console.warn('[ob-s3-gemini] Renderer fetch was blocked during Test Connection window; ignoring as non-fatal.');
            new Notice('已阻断渲染端直连 R2（测试期），该提示不影响主进程连通性结果');
          } else {
            console.error('[ob-s3-gemini] Test Connection failed (main path):', error);
            new Notice('S3 connection test failed: ' + (error as Error).message);
          }
        } finally {
          try { removeGuard && removeGuard(); } catch {}
          if (buttonEl && 'disabled' in buttonEl) {
            (buttonEl as HTMLButtonElement).disabled = prevDisabled;
          }
        }
      });
    });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderProfilesSection(containerEl);
    containerEl.createEl('h3', { text: 'Profile Details' });
    this.renderProfileForm(containerEl);

    // 历史记录区块
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
        try {
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
          const err = row.createEl('div', { cls: 'ob-s3-history-error' });
          err.createEl('span', { text: `Error: ${item.error}` });
        } else {
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

    this.renderActions(containerEl);
    renderHistory();
  }
}
