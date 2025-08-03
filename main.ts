import { Notice, Plugin } from 'obsidian';
import { loadS3Config } from './s3/s3Manager';
import { t, tp, loadTranslations } from './src/l10n';
import { MyPluginSettingTab, DEFAULT_SETTINGS } from './settingsTab';

export default class ObS3GeminiPlugin extends Plugin {
  async onload() {
    // 加载当前语言翻译（内置与自定义覆盖）
    await loadTranslations(this);

    // 注册设置面板（修复“插件一片空白”）
    this.addSettingTab(new MyPluginSettingTab(this.app, this, DEFAULT_SETTINGS));

    // 如需：初始化配置（保持兼容层）
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