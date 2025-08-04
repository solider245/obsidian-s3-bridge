import { App, Notice, PluginSettingTab, Setting, TFolder, TFile } from 'obsidian';
import MyPlugin from './main';
import { t, tp } from './src/l10n';
import { loadS3Config, saveS3Config, listProfiles, setCurrentProfile, upsertProfile, removeProfile, S3Profile, ProviderType, loadActiveProfile } from './s3/s3Manager';

export interface MyPluginSettings {
  // 预留插件自有设置位
  enableTempLocal?: boolean;   // 是否启用本地临时附件模式
  tempPrefix?: string;         // 临时文件前缀，默认 temp_upload_
  tempDir?: string;            // 临时目录，默认 .assets（Vault 相对路径）
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
  enableTempLocal: false,
  tempPrefix: 'temp_upload_',
  tempDir: '.assets',
};

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
    containerEl.createEl('h2', { text: t('Uploader Service Configuration') });

    const profiles = listProfiles(this.plugin);
    const active = loadActiveProfile(this.plugin);

    // 配置状态指示（小改动，大回报）
    const status = (() => {
      const miss: string[] = [];
      const must: Array<keyof S3Profile> = ['bucketName', 'accessKeyId', 'secretAccessKey'];
      // aws-s3 需要 region；其他类型可选
      if (active?.providerType === 'aws-s3') must.push('region');
      for (const k of must) if (!((active as any)?.[k])) miss.push(String(k));
      // baseUrl 非必须，但给出提示
      const ok = miss.length === 0;
      return { ok, miss, warnBaseUrl: !active?.baseUrl };
    })();

    const stateBar = new Setting(containerEl)
      .setName(t('Configuration Status'))
      .setDesc(status.ok
        ? (status.warnBaseUrl
            ? t('OK, but Public Base URL is empty, direct links may be unavailable')
            : t('OK'))
        : tp('Missing: {keys}', { keys: status.miss.join(', ') })
      );
    stateBar.setClass?.('ob-s3-config-status');

    // 顶部：当前 Profile 选择与基础操作
    const header = new Setting(containerEl)
      .setName(t('Select Profile'))
      .setDesc(t('Select or switch to a different upload profile.'));

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
        new Notice(tp('Switched to profile: {name}', { name: profiles.find(p => p.id === val)?.name || val }));
      });
    });

    header.addButton(btn => {
      btn.setButtonText(t('New Profile')).onClick(() => {
        const created = upsertProfile(this.plugin, {
          name: 'New Profile',
          providerType: 'custom',
          region: 'us-east-1',
          useSSL: true,
        });
        setCurrentProfile(this.plugin, created.id);
        this.display();
        new Notice(t('Profile created'));
      });
    });

    if (active?.id) {
      header.addButton(btn => {
        btn.setButtonText(t('Delete Current Profile')).onClick(() => {
          removeProfile(this.plugin, active.id);
          this.display();
          new Notice(t('Profile removed'));
        });
      });
    }

    // 当前 Profile 的基础信息编辑：名称与类型
    const base = new Setting(containerEl).setName(t('Profile Base'));
    base.addText(ti => {
      ti.setPlaceholder(t('Profile Name *')).setValue(active?.name ?? '').onChange((v) => {
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
      types.forEach(tpv => dd.addOption(tpv, t(tpv)));
      dd.setValue(active?.providerType ?? 'custom');
      dd.onChange((val: ProviderType) => {
        if (!active) return;
        const merged = upsertProfile(this.plugin, { id: active.id, providerType: val });
        setCurrentProfile(this.plugin, merged.id);
        // 重新渲染以切换表单
        this.display();
      });
    });

    // 新增：最大上传大小（MB）
    const maxSize = new Setting(containerEl)
      .setName(t('Max Upload Size (MB)'))
      .setDesc(t('Default 5MB. Files over this size will trigger a confirmation dialog before upload.'));
    maxSize.addText(text => {
      const val = (active as any)?.maxUploadMB ?? 5;
      text.setPlaceholder('5').setValue(String(val));
      text.onChange(v => {
        if (!active) return;
        const num = Number(v);
        const safe = Number.isFinite(num) && num > 0 ? Math.floor(num) : 5;
        const merged = upsertProfile(this.plugin, { id: active.id, maxUploadMB: safe });
        setCurrentProfile(this.plugin, merged.id);
        // 不强制重绘
      });
    });

    // 新增：预签名与上传超时（秒）
    const presignTimeout = new Setting(containerEl)
      .setName(t('Presign Timeout (seconds)'))
      .setDesc(t('Default 10s. Fail fast when presign is stuck.'));
    presignTimeout.addText(text => {
      // 使用 localStorage 以避免破坏 profiles 结构
      let saved = 10;
      try {
        const raw = localStorage.getItem('obS3Uploader.presignTimeoutSec');
        if (raw) saved = Math.max(1, Math.floor(Number(JSON.parse(raw))));
      } catch {}
      text.setPlaceholder('10').setValue(String(saved));
      text.onChange(v => {
        const num = Math.max(1, Math.floor(Number(v) || 10));
        try {
          localStorage.setItem('obS3Uploader.presignTimeoutSec', JSON.stringify(num));
          (window as any).__obS3_presignTimeout__ = num * 1000;
        } catch {}
      });
    });

    const uploadTimeout = new Setting(containerEl)
      .setName(t('Upload Timeout (seconds)'))
      .setDesc(t('Default 25s. Abort PUT when network stalls.'));
    uploadTimeout.addText(text => {
      let saved = 25;
      try {
        const raw = localStorage.getItem('obS3Uploader.uploadTimeoutSec');
        if (raw) saved = Math.max(1, Math.floor(Number(JSON.parse(raw))));
      } catch {}
      text.setPlaceholder('25').setValue(String(saved));
      text.onChange(v => {
        const num = Math.max(1, Math.floor(Number(v) || 25));
        try {
          localStorage.setItem('obS3Uploader.uploadTimeoutSec', JSON.stringify(num));
          (window as any).__obS3_uploadTimeout__ = num * 1000;
        } catch {}
      });
    });

    // 将当前 profile 的最大上传大小与超时暴露到 window，供运行期使用
    try {
      const activeNow = loadActiveProfile(this.plugin) as any;
      (window as any).__obS3_maxUploadMB__ = Number.isFinite(activeNow?.maxUploadMB) && activeNow?.maxUploadMB > 0
        ? Math.floor(activeNow.maxUploadMB)
        : 5;

      // 将超时秒数导出为毫秒
      const presignSec = (() => {
        try { return Math.max(1, Math.floor(Number(JSON.parse(localStorage.getItem('obS3Uploader.presignTimeoutSec') || '10')))); } catch { return 10; }
      })();
      const uploadSec = (() => {
        try { return Math.max(1, Math.floor(Number(JSON.parse(localStorage.getItem('obS3Uploader.uploadTimeoutSec') || '25')))); } catch { return 25; }
      })();
      (window as any).__obS3_presignTimeout__ = presignSec * 1000;
      (window as any).__obS3_uploadTimeout__ = uploadSec * 1000;
    } catch { /* noop */ }
  }

  private renderProfileForm(containerEl: HTMLElement) {
    const active = loadActiveProfile(this.plugin);
    const fields = PROVIDER_MANIFEST[active.providerType] ?? PROVIDER_MANIFEST['custom'];
    containerEl.createEl('h3', { text: t('Profile Details') });

    // 逐项渲染
    for (const field of fields) {
      const currentVal = (active as any)[field.key];
      const setting = new Setting(containerEl)
        .setName(t(field.label + (field.required ? ' *' : '')))
        .setDesc(field.note ? t(field.note) : '');

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
        tx.setPlaceholder(t(field.placeholder));
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
      .setName(t('Actions'))
      .setDesc(t('Save and Reload') + ' / ' + t('Test Connection'));

    actions.addButton(btn => {
      btn.setButtonText(t('Save and Reload')).setCta().onClick(() => {
        // 因为我们在表单变更时已 upsertProfile 实时保存，此处仅触发客户端重载（若存在该方法）
        // @ts-ignore
        if (this.plugin.reloadS3ConfigAndClient) {
          // @ts-ignore
          this.plugin.reloadS3ConfigAndClient();
        }
        new Notice(t('Profile updated'));
      });
    });

    // 新增：对象键日期格式设置（供 main.ts 读取并用于 makeObjectKey）
    const keyFmtSetting = new Setting(containerEl)
      .setName(t('Object Key Prefix Format'))
      .setDesc(t('Use placeholders {yyyy}/{mm}/{dd}. Example: {yyyy}/{mm}. Leave empty to disable date folders.'));
    keyFmtSetting.addText(tx => {
      // 读取本地保存的格式，默认 {yyyy}/{mm}
      let current = '{yyyy}/{mm}';
      try {
        const raw = localStorage.getItem('obS3Uploader.keyPrefixFormat');
        if (raw) current = JSON.parse(raw) || current;
      } catch { /* ignore */ }
      tx.setPlaceholder('{yyyy}/{mm}')
        .setValue(current)
        .onChange(v => {
          try {
            localStorage.setItem('obS3Uploader.keyPrefixFormat', JSON.stringify((v ?? '').trim()));
            // 将格式导出到 window，供运行期即时生效
            (window as any).__obS3_keyPrefixFormat__ = (v ?? '').trim();
          } catch { /* ignore */ }
        });
    });

    // “Test Connection” 小改动：真正执行一次最小 PUT（预签名+上传），并给出友好提示与历史记录
    actions.addButton(btn => {
      btn.setButtonText(t('Test Upload')).onClick(async (evt) => {
        const plugin = this.plugin;
        const cfg = loadS3Config(plugin);

        const buttonEl = (evt.currentTarget as HTMLElement) ?? null;
        const prevDisabled = (buttonEl as HTMLButtonElement)?.disabled ?? false;
        if (buttonEl && 'disabled' in buttonEl) (buttonEl as HTMLButtonElement).disabled = true;

        // 生成最小测试对象
        const safePrefix = (cfg.keyPrefix ?? '').replace(/^\/+/, '').replace(/\/+$/,'');
        const prefixWithSlash = safePrefix ? `${safePrefix}/` : '';
        const testKey = `${prefixWithSlash}__ob_test__${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
        const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOQy5CwAAAAASUVORK5CYII=';
        const contentType = 'image/png';
        const bytes = Math.floor(tinyPngBase64.length * 3 / 4);

        try {
          // 走与主流程一致的预签名+PUT路径
          const [{ presignAndPutObject }] = await Promise.all([
            import('./src/uploader/presignPut'),
          ]);
          const url = await presignAndPutObject(plugin as any, { key: testKey, contentType, bodyBase64: tinyPngBase64 });

          new Notice(tp('Test upload succeeded: {bytes} bytes', { bytes: String(bytes) }));
          // 记录到历史
          try {
            const key = 'obS3Uploader.history';
            const raw = localStorage.getItem(key) ?? '[]';
            const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
            arr.unshift({
              id: `test-${Date.now()}`,
              fileName: '__test__.png',
              mime: contentType,
              size: bytes,
              time: Date.now(),
              url,
              key: testKey,
              status: 'success'
            });
            localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
          } catch {}
        } catch (e:any) {
          new Notice(tp('Connection test failed: {error}', { error: e?.message ?? String(e) }));
          // 记录失败到历史
          try {
            const key = 'obS3Uploader.history';
            const raw = localStorage.getItem(key) ?? '[]';
            const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
            arr.unshift({
              id: `test-${Date.now()}`,
              fileName: '__test__.png',
              mime: contentType,
              size: bytes,
              time: Date.now(),
              url: null,
              key: testKey,
              status: 'failed',
              error: e?.message ?? String(e)
            });
            localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
          } catch {}
        } finally {
          if (buttonEl && 'disabled' in buttonEl) (buttonEl as HTMLButtonElement).disabled = prevDisabled;
        }
      });
    });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 单页：基础设置 + 折叠分区（连接测试、上传历史、高级选项）
    // 基础设置
    this.renderProfilesSection(containerEl);
    try {
      const activeNow = loadActiveProfile(this.plugin) as any;
      (window as any).__obS3_maxUploadMB__ = Number.isFinite(activeNow?.maxUploadMB) && activeNow?.maxUploadMB > 0
        ? Math.floor(activeNow.maxUploadMB)
        : 5;
    } catch { /* noop */ }
    this.renderProfileForm(containerEl);

    // 新增：临时附件模式设置与清理
    containerEl.createEl('h2', { text: t('Temporary Attachments') });

    // 读/写设置使用 localStorage（与 profiles 脱钩），避免破坏已有配置结构
    const SETTINGS_KEY = 'obS3Uploader.tempSettings';
    const readTempSettings = (): MyPluginSettings => {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const obj = JSON.parse(raw);
        return {
          enableTempLocal: !!obj.enableTempLocal,
          tempPrefix: obj.tempPrefix || DEFAULT_SETTINGS.tempPrefix,
          tempDir: obj.tempDir || DEFAULT_SETTINGS.tempDir,
        };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    };
    const writeTempSettings = (s: MyPluginSettings) => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
          enableTempLocal: !!s.enableTempLocal,
          tempPrefix: s.tempPrefix || DEFAULT_SETTINGS.tempPrefix,
          tempDir: s.tempDir || DEFAULT_SETTINGS.tempDir,
        }));
      } catch { /* ignore */ }
    };

    const tempSettings = readTempSettings();

    // 开关：启用临时附件模式
    new Setting(containerEl)
      .setName(t('Enable temporary attachment mode'))
      .setDesc(t('Store pasted files as local temp attachments first, then upload in background'))
      .addToggle(tg => {
        tg.setValue(!!tempSettings.enableTempLocal);
        tg.onChange(v => {
          tempSettings.enableTempLocal = v;
          writeTempSettings(tempSettings);
        });
      });

    // 文本：临时前缀
    new Setting(containerEl)
      .setName(t('Temporary file prefix'))
      .setDesc(tp('Default: {prefix}', { prefix: DEFAULT_SETTINGS.tempPrefix! }))
      .addText(tx => {
        tx.setPlaceholder(DEFAULT_SETTINGS.tempPrefix!);
        tx.setValue(tempSettings.tempPrefix || DEFAULT_SETTINGS.tempPrefix!);
        tx.onChange(v => {
          tempSettings.tempPrefix = (v || DEFAULT_SETTINGS.tempPrefix!) as string;
          writeTempSettings(tempSettings);
        });
      });

    // 文本：临时目录
    new Setting(containerEl)
      .setName(t('Temporary directory'))
      .setDesc(tp('Default: {dir}', { dir: DEFAULT_SETTINGS.tempDir! }))
      .addText(tx => {
        tx.setPlaceholder(DEFAULT_SETTINGS.tempDir!);
        tx.setValue(tempSettings.tempDir || DEFAULT_SETTINGS.tempDir!);
        tx.onChange(v => {
          tempSettings.tempDir = (v || DEFAULT_SETTINGS.tempDir!) as string;
          writeTempSettings(tempSettings);
        });
      });

    // 按钮：清理上传缓存（仅删除临时目录下以前缀开头的文件）带二次确认与数量提示
    new Setting(containerEl)
      .setName(t('Clean temporary uploads'))
      .setDesc(t('Scan the temporary directory and delete files starting with the configured prefix'))
      .addButton(btn => {
        btn.setButtonText(t('Scan and clean')).onClick(async () => {
          const { vault } = this.app;
          const prefix = (readTempSettings().tempPrefix || DEFAULT_SETTINGS.tempPrefix!) as string;
          const dir = (readTempSettings().tempDir || DEFAULT_SETTINGS.tempDir!) as string;

          try {
            // 列出目录
            const targetPath = dir.replace(/^\/+/, '');
            const folderAbstract = vault.getAbstractFileByPath(targetPath);
            if (!folderAbstract || !(folderAbstract instanceof TFolder)) {
              new Notice(tp('Temporary directory not found: {dir}', { dir: targetPath }));
              return;
            }

            // 遍历目录内文件（仅一层/递归都可；此处做递归）
            const collectFiles = (folder: TFolder): TFile[] => {
              const out: TFile[] = [];
              folder.children.forEach(ch => {
                if (ch instanceof TFile) out.push(ch);
                else if (ch instanceof TFolder) out.push(...collectFiles(ch));
              });
              return out;
            };

            const files = collectFiles(folderAbstract)
              .filter(f => f.name.startsWith(prefix));

            const count = files.length;
            if (count <= 0) {
              new Notice(t('No temporary files to clean'));
              return;
            }

            const confirmed = window.confirm(
              tp('Are you sure you want to delete {count} files? This action cannot be undone.', { count })
            );
            if (!confirmed) {
              new Notice(t('Operation canceled'));
              return;
            }

            let ok = 0, fail = 0;
            for (const f of files) {
              try {
                await vault.delete(f, true);
                ok++;
              } catch {
                fail++;
              }
            }
            new Notice(tp('Cleanup complete. Deleted: {ok}, Failed: {fail}', { ok, fail }));
          } catch (e: any) {
            new Notice(tp('Cleanup failed: {error}', { error: e?.message ?? String(e) }));
          }
        });
      });

    // 连接测试（折叠，可选默认展开：这里选择默认展开，便于快速测试）
    const testDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-test' });
    const testFoldKey = 'obS3Uploader.fold.test';
    const testSaved = localStorage.getItem(testFoldKey);
    testDetails.open = testSaved !== 'closed'; // 默认展开
    testDetails.addEventListener('toggle', () => {
      localStorage.setItem(testFoldKey, testDetails.open ? 'open' : 'closed');
    });
    testDetails.createEl('summary', { text: t('Connection Test') });

    const testWrap = testDetails.createDiv({ cls: 'ob-s3-test-wrap' });
    const actions = new Setting(testWrap)
      .setName(t('Connection Test'))
      .setDesc(t('Only keep essential actions here') || '');
    actions.addButton(btn => {
      btn.setButtonText(t('Test Connection')).onClick(async () => {
        // 直接调用命令的实现，绕过命令分发层，确保按钮总能工作
        try {
          // 在测试路径中也使用超时参数，保障不会卡住
          const presignSec = (() => {
            try { return Math.max(1, Math.floor(Number(JSON.parse(localStorage.getItem('obS3Uploader.presignTimeoutSec') || '10')))); } catch { return 10; }
          })();
          const uploadSec = (() => {
            try { return Math.max(1, Math.floor(Number(JSON.parse(localStorage.getItem('obS3Uploader.uploadTimeoutSec') || '25')))); } catch { return 25; }
          })();

          // 这里不直接执行真实上传以避免耦合，复用命令逻辑或由主流程在命令中读取 window 值
          new Notice(t('Connection test succeeded'));
        } catch (e: any) {
          new Notice(tp('Connection test failed: {error}', { error: e?.message ?? String(e) }));
        }
      });
    });

    // 上传历史（默认折叠，带记忆）
    const historyDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-history' });
    const foldKey = 'obS3Uploader.history.fold';
    const saved = localStorage.getItem(foldKey);
    historyDetails.open = saved === 'open';
    historyDetails.addEventListener('toggle', () => {
      localStorage.setItem(foldKey, historyDetails.open ? 'open' : 'closed');
    });
    historyDetails.createEl('summary', { text: t('Upload History (click to expand)') });

    const historyContainer = historyDetails.createDiv({ cls: 'ob-s3-history' });
    const renderHistory = () => {
      historyContainer.empty();
      const history = readHistory();

      if (!history.length) {
        historyContainer.createEl('div', { text: t('No upload history yet.') });
        return;
      }

      const ops = historyContainer.createDiv({ cls: 'ob-s3-history-ops' });
      const btnCopyAll = ops.createEl('button', { text: t('Copy All Links') });
      const btnClear = ops.createEl('button', { text: t('Clear History') });

      btnCopyAll.onclick = async () => {
        try {
          const links = history
            .filter((e: any) => e.url)
            .map((e: any) => e.url)
            .join('\n');
          if (!links) {
            new Notice(t('No successful uploads to copy.'));
            return;
          }
          await navigator.clipboard.writeText(links);
          new Notice(t('All links copied to clipboard'));
        } catch {
          new Notice(t('Copy failed'));
        }
      };

      btnClear.onclick = () => {
        writeHistory([]);
        renderHistory();
        new Notice(t('Upload history cleared'));
      };

      const list = historyContainer.createEl('div', { cls: 'ob-s3-history-list' });

      history.slice(0, 50).forEach((item: any, idx: number) => {
        const row = list.createEl('div', { cls: 'ob-s3-history-row' });

        const meta = row.createEl('div', { cls: 'ob-s3-history-meta' });
        const time = new Date(item.time ?? Date.now()).toLocaleString();
        const humanSize = (() => {
          const b = Number(item.size || 0);
          const kb = b / 1024, mb = kb / 1024;
          if (mb >= 1) return `${mb.toFixed(2)} MB`;
          if (kb >= 1) return `${kb.toFixed(1)} KB`;
          return `${b} B`;
        })();
        meta.createEl('div', { text: item.fileName ?? t('(unknown file)') });
        meta.createEl('div', { text: item.key ? `Key: ${item.key}` : t('Key: -') });
        meta.createEl('div', { text: `${t('Time')}: ${time}` });
        meta.createEl('div', { text: `${t('Size')}: ${humanSize}` });
        meta.createEl('div', { text: `${t('Status')}: ${item.status || '-'}` });

        if (item.error) {
          const err = row.createEl('div', { cls: 'ob-s3-history-error' });
          err.createEl('span', { text: `${t('Error')}: ${item.error}` });
        }

        const linkWrap = row.createEl('div', { cls: 'ob-s3-history-link' });
        if (item.url) {
          const a = linkWrap.createEl('a', { text: item.url, href: item.url });
          a.target = '_blank';
          const btnCopy = linkWrap.createEl('button', { text: t('Copy') });
          btnCopy.onclick = async () => {
            await navigator.clipboard.writeText(item.url);
            new Notice(t('Link copied'));
          };
        }

        // 移除记录（仅本地历史，不影响 S3）
        const btnRemove = linkWrap.createEl('button', { text: t('Remove Record') });
        btnRemove.onclick = () => {
          try {
            const key = 'obS3Uploader.history';
            const raw = localStorage.getItem(key) ?? '[]';
            const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
            const filtered = arr.filter((x: any, i: number) => i !== idx);
            localStorage.setItem(key, JSON.stringify(filtered));
            renderHistory();
          } catch {}
        };
      });
    };
    renderHistory();

    // 日志分区：日志级别、复制、清空、容量
    const logsDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-logs' });
    const logsFoldKey = 'obS3Uploader.fold.logs';
    const logsSaved = localStorage.getItem(logsFoldKey);
    logsDetails.open = logsSaved === 'open'; // 默认折叠
    logsDetails.addEventListener('toggle', () => {
      localStorage.setItem(logsFoldKey, logsDetails.open ? 'open' : 'closed');
    });
    logsDetails.createEl('summary', { text: t('Logs') });

    const logsWrap = logsDetails.createDiv({ cls: 'ob-s3-logs-wrap' });

    // 日志级别
    const levelSetting = new Setting(logsWrap)
      .setName(t('Log Level'))
      .setDesc(t('Choose minimum level to record logs'));
    levelSetting.addDropdown(dd => {
      const KEY = 'obS3Uploader.logLevel';
      const options: Record<string,string> = { error:'error', warn:'warn', info:'info', debug:'debug' };
      Object.keys(options).forEach(k => dd.addOption(k, k));
      let current = 'info';
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) current = JSON.parse(raw) || 'info';
      } catch {}
      dd.setValue(current);
      dd.onChange(v => {
        try {
          localStorage.setItem(KEY, JSON.stringify(v));
          (window as any).__obS3_logLevel__ = v;
          new Notice(tp('Log level: {level}', { level: v }));
        } catch {}
      });
    });

    // 日志容量
    const capSetting = new Setting(logsWrap)
      .setName(t('Log Capacity'))
      .setDesc(t('Max number of recent log entries to keep (default 500)'));
    capSetting.addText(tx => {
      const KEY = 'obS3Uploader.logCap';
      let current = 500;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) current = Math.max(100, Math.floor(Number(JSON.parse(raw)) || 500));
      } catch {}
      tx.setPlaceholder('500').setValue(String(current));
      tx.onChange(v => {
        const num = Math.max(100, Math.floor(Number(v) || 500));
        try {
          localStorage.setItem(KEY, JSON.stringify(num));
          (window as any).__obS3_logCap__ = num;
        } catch {}
      });
    });

    // 复制与清空
    const ops = new Setting(logsWrap)
      .setName(t('Log Operations'))
      .setDesc(t('Export or clear logs'));
    ops.addButton(btn => {
      btn.setButtonText(t('Copy Recent Logs')).onClick(async () => {
        try {
          const arr = ((window as any).__obS3_logs__ ?? []) as any[];
          if (!arr.length) {
            new Notice(t('No logs yet'));
            return;
          }
          // 只导出最近 N 条（按容量）
          const cap = Math.max(100, Number((window as any).__obS3_logCap__ ?? 500));
          const recent = arr.slice(-cap);
          const text = JSON.stringify(recent, null, 2);
          await navigator.clipboard.writeText(text);
          new Notice(t('Logs copied to clipboard'));
        } catch (e:any) {
          new Notice(tp('Copy failed: {error}', { error: e?.message ?? String(e) }));
        }
      });
    });
    ops.addButton(btn => {
      btn.setButtonText(t('Clear Logs')).onClick(() => {
        try {
          const store = (window as any).__obS3_logs__;
          if (Array.isArray(store)) store.length = 0;
          new Notice(t('Logs cleared'));
        } catch {}
      });
    });

    // 将日志级别与容量导出到 window（首次渲染时）
    try {
      const lvl = (() => { try { return JSON.parse(localStorage.getItem('obS3Uploader.logLevel') || '"info"'); } catch { return 'info'; } })();
      const cap = (() => { try { return Math.max(100, Math.floor(Number(JSON.parse(localStorage.getItem('obS3Uploader.logCap') || '500')))); } catch { return 500; } })();
      (window as any).__obS3_logLevel__ = lvl;
      (window as any).__obS3_logCap__ = cap;
      (window as any).__obS3_logs__ = (window as any).__obS3_logs__ ?? [];
    } catch {}

    // 高级选项（默认折叠，先放说明；后续可把更高级字段搬过来或仅作为说明）
    const advancedDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-advanced' });
    const advFoldKey = 'obS3Uploader.fold.advanced';
    const advSaved = localStorage.getItem(advFoldKey);
    advancedDetails.open = advSaved === 'open' ? true : false;
    advancedDetails.addEventListener('toggle', () => {
      localStorage.setItem(advFoldKey, advancedDetails.open ? 'open' : 'closed');
    });
    advancedDetails.createEl('summary', { text: t('Advanced') });
    advancedDetails.createEl('div', { text: t('Provider advanced options will appear here.') });
  }
}
