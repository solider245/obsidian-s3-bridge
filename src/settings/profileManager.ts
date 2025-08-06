import { App, Setting, Notice } from 'obsidian';
import MyPlugin from '../../main';
import { listProfiles, setCurrentProfile, upsertProfile, removeProfile, S3Profile, ProviderType, loadActiveProfile } from '../../s3/s3Manager';
import { t, tp } from '../l10n';
import { runCheck } from '../features/runCheck';
import { PROVIDER_MANIFEST } from './providerFields';

export function renderProfilesSection(plugin: MyPlugin, containerEl: HTMLElement, display: () => void) {
  containerEl.createEl('h2', { text: t('Uploader Service Configuration') });

  const profiles = listProfiles(plugin);
  const active = loadActiveProfile(plugin);

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
      await runCheck(plugin);
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
      setCurrentProfile(plugin, val);
      display();
      new Notice(tp('Switched to profile: {name}', { name: profiles.find(p => p.id === val)?.name || val }));
    });
  });

  header.addButton(btn => {
    btn.setButtonText(t('New Profile')).onClick(() => {
      const created = upsertProfile(plugin, {
        name: 'New Profile',
        providerType: 'custom',
        region: 'us-east-1',
        useSSL: true,
      });
      setCurrentProfile(plugin, created.id);
      display();
      new Notice(t('Profile created'));
    });
  });

  if (active?.id) {
    header.addButton(btn => {
      btn.setButtonText(t('Delete Current Profile')).onClick(() => {
        removeProfile(plugin, active.id);
        display();
        new Notice(t('Profile removed'));
      });
    });
  }
}

export function renderProfileForm(plugin: MyPlugin, containerEl: HTMLElement, display: () => void) {
  const active = loadActiveProfile(plugin);
  if (!active) return;

  const base = new Setting(containerEl).setName(t('Profile Base'));
  base.addText(ti => {
    ti.setPlaceholder(t('Profile Name *')).setValue(active?.name ?? '').onChange((v) => {
      if (!active) return;
      const merged = upsertProfile(plugin, { id: active.id, name: v.trim() });
      setCurrentProfile(plugin, merged.id);
      display();
    });
  });
  base.addDropdown(dd => {
    const types: ProviderType[] = ['cloudflare-r2', 'minio', 'aws-s3', 'custom'];
    types.forEach(tpv => dd.addOption(tpv, t(tpv)));
    dd.setValue(active?.providerType ?? 'custom');
    dd.onChange((val: ProviderType) => {
      if (!active) return;
      const merged = upsertProfile(plugin, { id: active.id, providerType: val });
      setCurrentProfile(plugin, merged.id);
      display();
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
          upsertProfile(plugin, patch);
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
          upsertProfile(plugin, patch);
        });
      });
    }
  }
}