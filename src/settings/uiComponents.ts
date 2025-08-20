import { App, Setting } from 'obsidian';
import { t } from '../l10n';
import { activityLog, Activity } from '../activityLog';

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

function exportLogsToMarkdown(logs: Activity[]) {
  const headers = [t('Timestamp'), t('Event'), t('Details')];
  const body = logs.map(log => {
    const timestamp = new Date(log.timestamp).toLocaleString();
    const event = log.event;
    const details = JSON.stringify(log.details);
    return `| ${timestamp} | ${event} | \`${details}\` |`;
  }).join('\n');

  const markdown = `| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n${body}`;

  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `obsidian-s3-activity-log-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

const LARGE_FILE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB

function renderLogEntries(app: App, logContainer: HTMLElement, logs: Activity[], refreshCallback: () => void) {
  logContainer.empty();
  if (logs.length === 0) {
    logContainer.createEl('p', { text: t('No activities recorded yet.') });
    return;
  }
  for (const log of logs) {
    const entry = logContainer.createEl('div', { cls: 'ob-s3-log-entry' });
    entry.createEl('span', { text: `[${new Date(log.timestamp).toLocaleString()}]`, cls: 'ob-s3-log-ts' });
    entry.createEl('span', { text: log.event.toUpperCase(), cls: `ob-s3-log-level ob-s3-log-${log.event}` });
    
    if (log.event === 'upload_success' && log.details) {
      if (log.details.size && log.details.size > LARGE_FILE_THRESHOLD_BYTES) {
        entry.addClass('ob-s3-log-entry-large-file');
      }
      const sizeMB = log.details.size ? (log.details.size / 1024 / 1024).toFixed(2) : 'N/A';
      const duration = log.details.duration ? `${log.details.duration}s` : 'N/A';
      
      const messageSpan = entry.createEl('span', { cls: 'ob-s3-log-msg' });
      messageSpan.appendText(`File: ${log.details.fileName}, Size: ${sizeMB}MB, Duration: ${duration}, URL: `);
      const link = messageSpan.createEl('a', {
        text: log.details.url,
        href: log.details.url,
        cls: 'ob-s3-log-url'
      });
      link.setAttribute('target', '_blank');
    } else {
      entry.createEl('span', { text: JSON.stringify(log.details), cls: 'ob-s3-log-msg' });
    }

    const copyButton = entry.createEl('button', { text: t('Copy'), cls: 'ob-s3-log-copy' });
    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      copyButton.setText(t('Copied!'));
      setTimeout(() => copyButton.setText(t('Copy')), 1500);
    });

    const deleteButton = entry.createEl('button', { text: t('Delete'), cls: 'ob-s3-log-delete' });
    deleteButton.addEventListener('click', async () => {
      if (confirm(t('Are you sure you want to delete this log entry?'))) {
        await activityLog.delete(app, log.timestamp);
        refreshCallback();
      }
    });
  }
}

export function renderActivityLogSection(app: App, containerEl: HTMLElement) {
  const sectionContainer = containerEl.createDiv('ob-s3-activity-log-section');

  const render = () => {
    sectionContainer.empty();
    const details = sectionContainer.createEl('details', { cls: 'ob-s3-fold' });
    details.createEl('summary', { text: t('Activity Log (click to expand)') });
    const toolbar = details.createEl('div', { cls: 'ob-s3-log-toolbar' });
    const summaryContainer = toolbar.createEl('div', { cls: 'ob-s3-log-summary' });
    const logContainer = details.createEl('div', { cls: 'ob-s3-log-container' });
    
    let allLogs: Activity[] = [];
    let displayedLogs: Activity[] = [];

    const updateDisplayedLogs = (filter: string) => {
      displayedLogs = filter === 'all'
        ? allLogs
        : allLogs.filter(log => log.event === filter);
      renderLogEntries(app, logContainer, displayedLogs, render);
    };

    new Setting(toolbar)
      .setName(t('Filter by event type'))
      .addDropdown(dropdown => {
        const options: Record<string, string> = {
          all: t('All Events'),
          upload_success: t('Upload Success'),
          upload_error: t('Upload Error'),
          cleanup_manual: t('Manual Cleanup'),
          info: t('Info'),
          warn: t('Warning')
        };
        dropdown.addOptions(options)
          .setValue('all')
          .onChange(value => {
            updateDisplayedLogs(value);
          });
      });
    
    new Setting(toolbar)
    .setName(t('Export Logs'))
    .setDesc(t('Export the currently filtered logs to a Markdown file.'))
    .addButton(button => {
      button.setButtonText(t('Export to Markdown'))
        .onClick(() => {
          exportLogsToMarkdown(displayedLogs);
        });
    });

    new Setting(toolbar)
      .setName(t('Clear All Logs'))
      .setDesc(t('This will permanently delete all log entries. This action cannot be undone.'))
      .addButton(button => {
        button.setButtonText(t('Clear All'))
          .setWarning()
          .onClick(async () => {
            if (confirm(t('Are you sure you want to clear all activity logs?'))) {
              await activityLog.clear(app);
              render();
            }
          });
      });

    logContainer.createEl('p', { text: t('Loading logs...') });
    activityLog.get(app).then(logs => {
      allLogs = logs;

      const successCount = allLogs.filter(log => log.event === 'upload_success').length;
      const errorCount = allLogs.filter(log => log.event === 'upload_error').length;
      const totalUploads = successCount + errorCount;
      const totalSize = allLogs
        .filter(log => log.event === 'upload_success' && log.details && log.details.size)
        .reduce((sum, log) => sum + (log.details.size || 0), 0);
      const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

      summaryContainer.setText(
        `${t('Total Uploads')}: ${totalUploads}, ${t('Success')}: ${successCount}, ${t('Failed')}: ${errorCount}, ${t('Total Space Saved')}: ${totalSizeMB}MB`
      );

      updateDisplayedLogs('all');
    });
  };

  render();
}