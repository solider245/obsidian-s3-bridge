import { Setting } from 'obsidian';
import { t } from '../l10n';

export function renderActions(containerEl: HTMLElement) {
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

export function renderHistorySection(containerEl: HTMLElement) {
  const historyDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-history' });
  historyDetails.createEl('summary', { text: t('Upload History (click to expand)') });
  // ... (rest of the history rendering logic)
}

export function renderLogsSection(containerEl: HTMLElement) {
  const logsDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-logs' });
  logsDetails.createEl('summary', { text: t('Logs') });
  // ... (rest of the logs rendering logic)
}

export function renderAdvancedSection(containerEl: HTMLElement) {
  const advancedDetails = containerEl.createEl('details', { cls: 'ob-s3-fold ob-s3-fold-advanced' });
  advancedDetails.createEl('summary', { text: t('Advanced') });
  advancedDetails.createEl('div', { text: t('Provider advanced options will appear here.') });
}