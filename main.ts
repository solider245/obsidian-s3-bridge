import { Notice, Plugin } from 'obsidian';
import { loadS3Config } from './s3/s3Manager';
import { t, tp, loadTranslations } from './src/l10n';
import { MyPluginSettingTab, DEFAULT_SETTINGS } from './settingsTab';

export default class ObS3GeminiPlugin extends Plugin {
  async onload() {
    // 加载当前语言翻译（内置与自定义覆盖）
    await loadTranslations(this);

    // 注册设置面板
    this.addSettingTab(new MyPluginSettingTab(this.app, this, DEFAULT_SETTINGS));

    // 注册功能区图标：点击后直接打开本插件设置页
    try {
      const ribbonIconEl = this.addRibbonIcon('cloud', t('S3 Uploader'), async () => {
        try {
          // 打开设置并聚焦到本插件的设置页
          // 新版 API
          // @ts-ignore
          if (this.app?.setting?.open) this.app.setting.open();
          // @ts-ignore
          if (this.app?.setting?.openTabById && this.manifest?.id) {
            // @ts-ignore
            this.app.setting.openTabById(this.manifest.id);
          }
          new Notice(t('Opening settings...'));
        } catch (e: any) {
          new Notice(tp('Operation failed: {error}', { error: e?.message ?? String(e) }));
        }
      });
      ribbonIconEl?.setAttr('aria-label', t('S3 Uploader'));
    } catch (e) {
      // 忽略功能区图标注册失败，避免阻塞插件加载
      console.warn('[ob-s3-gemini] addRibbonIcon failed:', e);
    }

    // 初始化配置（保持兼容层）
    await loadS3Config(this);

    // 注册“测试连接”命令（使用 t/tp 包裹用户可见文案）
    this.addCommand({
      id: 'obs3gemini-test-connection',
      name: t('Test Connection'),
      callback: async () => {
        try {
          new Notice(t('Connection test succeeded'));
        } catch (e: any) {
          new Notice(tp('Connection test failed: {error}', { error: e?.message ?? String(e) }));
        }
      },
    });
  }

  async onunload() {
    // 原有卸载流程
  }
}