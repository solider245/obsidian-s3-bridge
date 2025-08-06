import { App, Setting, Notice, TFolder, TFile } from 'obsidian';
import { t, tp } from '../l10n';
import { activityLog } from '../activityLog';
import { MyPluginSettings, DEFAULT_SETTINGS } from '../../settingsTab';

// Helper function from tempSettings.ts, now local to this module
function readTempSettings(): MyPluginSettings {
  const SETTINGS_KEY = 'obS3Uploader.tempSettings';
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
}

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

  // Clean temporary uploads button
  new Setting(details)
    .setName(t('Clean temporary uploads'))
    .setDesc(t('Scan the temporary directory and delete files starting with the configured prefix'))
    .addButton(btn => {
      btn.setButtonText(t('Scan and clean')).onClick(async () => {
        const { vault } = app;
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
            await activityLog.add(app, 'cleanup_manual', { deleted: ok, failed: fail, total: count });
          } else {
            new Notice(t('Operation canceled'));
          }
        } catch (e: any) {
          new Notice(tp('Cleanup failed: {error}', { error: e?.message ?? String(e) }));
        }
      });
    });

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
      const msg = entry.createEl('span', { text: JSON.stringify(log.details), cls: 'ob-s3-log-msg' });
    }
  });
}