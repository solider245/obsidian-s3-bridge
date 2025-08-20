import { App, Setting, Notice, TFolder, TFile } from 'obsidian'
import { MyPluginSettings, DEFAULT_SETTINGS } from '../../settingsTab'
import { t, tp } from '../l10n'

const SETTINGS_KEY = 'obS3Uploader.tempSettings'

function readTempSettings(): MyPluginSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY)
		if (!raw) return { ...DEFAULT_SETTINGS }
		const obj = JSON.parse(raw)
		return {
			enableTempLocal: !!obj.enableTempLocal,
			tempPrefix: obj.tempPrefix || DEFAULT_SETTINGS.tempPrefix,
			tempDir: obj.tempDir || DEFAULT_SETTINGS.tempDir,
		}
	} catch {
		return { ...DEFAULT_SETTINGS }
	}
}

function writeTempSettings(s: MyPluginSettings) {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
	} catch {
		/* ignore */
	}
}

export function renderTempAttachSettings(app: App, containerEl: HTMLElement) {
	containerEl.createEl('h2', { text: t('Temporary Attachments') })

	const tempSettings = readTempSettings()

	new Setting(containerEl)
		.setName(t('Enable temporary attachment mode'))
		.setDesc(t('Store pasted files as local temp attachments first, then upload in background'))
		.addToggle(tg => {
			tg.setValue(!!tempSettings.enableTempLocal)
			tg.onChange(v => {
				tempSettings.enableTempLocal = v
				writeTempSettings(tempSettings)
			})
		})

	new Setting(containerEl)
		.setName(t('Temporary file prefix'))
		.setDesc(tp('Default: {prefix}', { prefix: DEFAULT_SETTINGS.tempPrefix! }))
		.addText(tx => {
			tx.setPlaceholder(DEFAULT_SETTINGS.tempPrefix!)
			tx.setValue(tempSettings.tempPrefix || DEFAULT_SETTINGS.tempPrefix!)
			tx.onChange(v => {
				tempSettings.tempPrefix = (v || DEFAULT_SETTINGS.tempPrefix!) as string
				writeTempSettings(tempSettings)
			})
		})

	new Setting(containerEl)
		.setName(t('Temporary directory'))
		.setDesc(tp('Default: {dir}', { dir: DEFAULT_SETTINGS.tempDir! }))
		.addText(tx => {
			tx.setPlaceholder(DEFAULT_SETTINGS.tempDir!)
			tx.setValue(tempSettings.tempDir || DEFAULT_SETTINGS.tempDir!)
			tx.onChange(v => {
				tempSettings.tempDir = (v || DEFAULT_SETTINGS.tempDir!) as string
				writeTempSettings(tempSettings)
			})
		})

	new Setting(containerEl)
		.setName(t('Clean temporary uploads'))
		.setDesc(t('Scan the temporary directory and delete files starting with the configured prefix'))
		.addButton(btn => {
			btn.setButtonText(t('Scan and clean')).onClick(async () => {
				const { vault } = app
				const prefix = (readTempSettings().tempPrefix || DEFAULT_SETTINGS.tempPrefix!) as string
				const dir = (readTempSettings().tempDir || DEFAULT_SETTINGS.tempDir!) as string
				try {
					const targetPath = dir.replace(/^\/+/, '')
					const folderAbstract = vault.getAbstractFileByPath(targetPath)
					if (!folderAbstract || !(folderAbstract instanceof TFolder)) {
						new Notice(tp('Temporary directory not found: {dir}', { dir: targetPath }))
						return
					}
					const collectFiles = (folder: TFolder): TFile[] => {
						const out: TFile[] = []
						folder.children.forEach(ch => {
							if (ch instanceof TFile) out.push(ch)
							else if (ch instanceof TFolder) out.push(...collectFiles(ch))
						})
						return out
					}
					const files = collectFiles(folderAbstract).filter(f => f.name.startsWith(prefix))
					const count = files.length
					if (count <= 0) {
						new Notice(t('No temporary files to clean'))
						return
					}
					if (
						window.confirm(
							tp('Are you sure you want to delete {count} files? This action cannot be undone.', {
								count,
							})
						)
					) {
						let ok = 0,
							fail = 0
						for (const f of files) {
							try {
								await vault.delete(f, true)
								ok++
							} catch {
								fail++
							}
						}
						new Notice(tp('Cleanup complete. Deleted: {ok}, Failed: {fail}', { ok, fail }))
					} else {
						new Notice(t('Operation canceled'))
					}
				} catch (e: unknown) {
					new Notice(
						tp('Cleanup failed: {error}', { error: e instanceof Error ? e.message : String(e) })
					)
				}
			})
		})
}
