import { App, Notice, PluginSettingTab, Setting, TFolder, TFile } from 'obsidian';
import MyPlugin from './main';
import { t, tp } from './src/l10n';
import { listProfiles, setCurrentProfile, upsertProfile, removeProfile, S3Profile, ProviderType, loadActiveProfile } from './s3/s3Manager';
import { runCheck } from './src/features/runCheck';
import { PROVIDER_MANIFEST } from './src/settings/providerFields';

export interface MyPluginSettings {
  enableTempLocal?: boolean;
  tempPrefix?: string;
  tempDir?: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
  enableTempLocal: false,
  tempPrefix: 'temp_upload_',
  tempDir: '.assets',
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

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderProfilesSection(containerEl);
    this.renderProfileForm(containerEl);
    this.renderActions(containerEl);
    this.renderTempAttachSettings(containerEl);
    this.renderHistorySection(containerEl);
    this.renderLogsSection(containerEl);
    this.renderAdvancedSection(containerEl);
  }

  private renderProfilesSection(containerEl: HTMLElement) {
    containerEl.createEl('h2', { text: t('Uploader Service Configuration') });

    const profiles = listProfiles(this.plugin);
    const active = loadActiveProfile(this.plugin);

    const status = (() => {
      const miss: string[] = [];
      const must: Array<keyof S3Profile> = ['bucketName', 'accessKeyId', 'secretAccessKey'];
      if (active?.providerType === 'aws-s3') must.push('region');
      for (const k of must) if (!((active as any)?.[k])) miss.push(String(k));
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
    stateBar.addButton(btn => {
      btn.setButtonText(t('Check and Test')).onClick(async () => {
        await runCheck(this.plugin);
      });
    });

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
  }

  private renderProfileForm(containerEl: HTMLElement) {
    const active = loadActiveProfile(this.plugin);
    if (!active) return;

    const base = new Setting(containerEl).setName(t('Profile Base'));
    base.addText(ti => {
      ti.setPlaceholder(t('Profile Name *')).setValue(active?.name ?? '').onChange((v) => {
        if (!active) return;
        const merged = upsertProfile(this.plugin, { id: active.id, name: v.trim() });
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
        this.display();
      });
    });

    const fields = PROVIDER_MANIFEST[active.providerType] ?? PROVIDER_MANIFEST['custom'];
    containerEl.createEl('h3', { text: t('Profile Details') });

    for (const field of fields) {
      if (field.key === 'name') continue;
      const currentVal = (active as any)[field.key];
      const setting = new Setting(containerEl)
        .setName(t(field.label + (field.required ? ' *' : '')))
        .setDesc(field.note ? t(field.note) : '');

      if (field.type === 'toggle') {
        setting.addToggle(tg => {
          tg.setValue(Boolean(currentVal ?? field.defaultValue ?? false));
          tg.onChange((v) => {
            const patch: any = { id: active.id, [field.key]: v };
            upsertProfile(this.plugin, patch);
          });
        });
      } else {
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
            upsertProfile(this.plugin, patch);
          });
        });
      }
    }
  }

  private renderActions(containerEl: HTMLElement) {
    const keyFmtSetting = new Setting(containerEl)
      .setName(t('Object Key Prefix Format'))
      .setDesc(t('Use placeholders {yyyy}/{mm}/{dd}. Example: {yyyy}/{mm}. Leave empty to disable date folders.'));
    keyFmtSetting.addText(tx => {
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
            (window as any).__obS3_keyPrefixFormat__ = (v ?? '').trim();
          } catch { /* ignore */ }
        });
    });
  }

  private renderTempAttachSettings(containerEl: HTMLElement) {
    containerEl.createEl('h2', { text: t('Temporary Attachments') });
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
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
      } catch { /* ignore */ }
    };

    const tempSettings = readTempSettings();

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

    new Setting(containerEl)
      .setName(t('Clean temporary uploads'))
      .setDesc(t('Scan the temporary directory and delete files starting with the configured prefix'))
      .addButton(btn => {
        btn.setButtonText(t('Scan and clean')).onClick(async () => {
          const { vault } = this.app;
          const prefix = (readTempSettings().tempPrefix || DEFAULT_SETTINGS.tempPrefix!) as string;
          const dir = (readTempSettings().tempDir || DEFAULT_SETTINGS.tempDir!) as string;
          try {
            const targetPath = dir.replace(/^\/+/, '');
            const folderAbstract = vault.getAbstractFileByPath(targetPath);
            if (!folderAbstract || !(folderAbstract instanceof TFolder)) {
              new Notice(tp('Temporary directory not found: {dir}', { dir: targetPath }));
              return;
            }
            const collectFiles = (folder: TFolder): TFile[] => {
              const out: TFile[] = [];
              folder.children.forEach(ch => {
                if (ch instanceof TFile) out.push(ch);
                else if (ch instanceof TFolder) out.push(...collectFiles(ch));
              });
              return out;
            };
            const files = collectFiles(folderAbstract).filter(f => f.name.startsWith(prefix));
            const count = files.length;
            if (count <= 0) {
              new Notice(t('No temporary files to clean'));
              return;
            }
            if (window.confirm(tp('Are you sure you want to delete {count} files? This action cannot be undone.', { count }))) {
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
            } else {
              new Notice(t('Operation canceled'));
            }
          } catch (e: any) {
            new Notice(tp('Cleanup failed: {error}', { error: e?.message ?? String(e) }));
          }
        });
      });
  }

  private renderHistorySection(containerEl: HTMLElement) {
    const historyDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-history' });
    historyDetails.createEl('summary', { text: t('Upload History (click to expand)') });
    // ... (rest of the history rendering logic)
  }

  private renderLogsSection(containerEl: HTMLElement) {
    const logsDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-logs' });
    logsDetails.createEl('summary', { text: t('Logs') });
    // ... (rest of the logs rendering logic)
  }

  private renderAdvancedSection(containerEl: HTMLElement) {
    const advancedDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-advanced' });
    advancedDetails.createEl('summary', { text: t('Advanced') });
    advancedDetails.createEl('div', { text: t('Provider advanced options will appear here.') });
  }
}
