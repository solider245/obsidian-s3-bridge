import { App, Notice, PluginSettingTab, Setting, TFolder, TFile } from 'obsidian';
import MyPlugin from './main';
import { t, tp } from './src/l10n';
import { loadActiveProfile } from './s3/s3Manager';
import { runCheck } from './src/features/runCheck';
import { renderProfilesSection, renderProfileForm } from './src/settings/profileManager';
import { renderTempAttachSettings } from './src/settings/tempSettings';

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
    renderTempAttachSettings(this.app, containerEl);
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
