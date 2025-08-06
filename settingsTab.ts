import { App, Notice, PluginSettingTab, Setting, TFolder, TFile } from 'obsidian';
import MyPlugin from './main';
import { t, tp } from './src/l10n';
import { loadActiveProfile } from './s3/s3Manager';
import { runCheck } from './src/features/runCheck';
import { renderProfilesSection, renderProfileForm } from './src/settings/profileManager';

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

    renderProfilesSection(this.plugin, containerEl, () => this.display());
    renderProfileForm(this.plugin, containerEl, () => this.display());
    this.renderActions(containerEl);
    this.renderTempAttachSettings(containerEl);
    this.renderHistorySection(containerEl);
    this.renderLogsSection(containerEl);
    this.renderAdvancedSection(containerEl);
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
