import { App, Setting } from 'obsidian';
import { t } from '../l10n';
import { activityLog } from '../activityLog';

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

export function renderActivityLogSection(app: App, containerEl: HTMLElement) {
  const details = containerEl.createEl('details', { cls: 'ob-s3-fold' });
  details.createEl('summary', { text: t('Activity Log (click to expand)') });

  const logContainer = details.createEl('div', { cls: 'ob-s3-log-container' });
  logContainer.createEl('p', { text: t('Loading logs...') });

  activityLog.get(app).then(logs => {
    logContainer.empty();
    if (logs.length === 0) {
      logContainer.createEl('p', { text: t('No activities recorded yet.') });
      return;
    }
    for (const log of logs) {
      const entry = logContainer.createEl('div', { cls: 'ob-s3-log-entry' });
      entry.createEl('span', { text: `[${new Date(log.timestamp).toLocaleString()}]`, cls: 'ob-s3-log-ts' });
      entry.createEl('span', { text: log.event.toUpperCase(), cls: `ob-s3-log-level ob-s3-log-${log.event}` });
      
      let message = '';
      if (log.event === 'upload_success' && log.details) {
        const sizeMB = log.details.size ? (log.details.size / 1024 / 1024).toFixed(2) : 'N/A';
        const duration = log.details.duration ? `${log.details.duration}ms` : 'N/A';
        message = `File: ${log.details.fileName}, Size: ${sizeMB}MB, Duration: ${duration}, URL: ${log.details.url}`;
      } else {
        message = JSON.stringify(log.details);
      }
      entry.createEl('span', { text: message, cls: 'ob-s3-log-msg' });
    }
  });
}