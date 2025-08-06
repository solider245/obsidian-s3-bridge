/**
 * 概述: 插件主入口，仅负责装配与生命周期；功能逻辑在 src/* 子模块。
 * 导出: ObS3GeminiPlugin (默认导出)
 * 依赖入口:
 *   - [src/bootstrap/i18nBootstrap.ts.registerBuiltinPacksAndLoad()](src/bootstrap/i18nBootstrap.ts:1)
 *   - [settingsTab.ts.MyPluginSettingTab()](settingsTab.ts:1)
 *   - [src/commands/registerCommands.ts.registerCommands()](src/commands/registerCommands.ts:1)
 *   - [src/paste/installPasteHandler.ts.installPasteHandler()](src/paste/installPasteHandler.ts:1)
 *   - [src/retry/installRetryHandler.ts.installRetryHandler()](src/retry/installRetryHandler.ts:1)
 *   - [src/uploader/optimistic.ts.generateUploadId()](src/uploader/optimistic.ts:1)
 */

import { Notice, Plugin } from 'obsidian';
import { t, tp } from './src/l10n';
import { MyPluginSettingTab, DEFAULT_SETTINGS } from './settingsTab';

// 统一从单一索引导入（分层聚合）
import {
  registerBuiltinPacksAndLoad,
} from './src/index';

// 暂时仍直接从原路径显式导入，待后续迁移至 features 并由 index 再导出
import { registerCommands } from './src/commands/registerCommands';
import { installPasteHandler } from './src/paste/installPasteHandler';

export default class S3BridgePlugin extends Plugin {
  async onload() {
    await registerBuiltinPacksAndLoad(this);

    this.addSettingTab(new MyPluginSettingTab(this.app, this));

    try {
      const ribbon = this.addRibbonIcon('cloud', t('S3 Bridge'), async () => {
        try {
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
      ribbon?.setAttr('aria-label', t('S3 Bridge'));
    } catch (e) {
      console.warn('[ob-s3-gemini] addRibbonIcon failed:', e);
    }

    // 注册命令与粘贴处理（装配注入在其模块内部完成）
    // TODO: 待 registerCommands 收敛到 features 后改为从 ./src/index 导入
    (require('./src/commands/registerCommands') as any).registerCommands({
      plugin: this,
      // 其余依赖在模块内动态导入，主入口不再直接关心实现细节
      getExt: (mime: string) => (require('./src/core/mime') as any).getFileExtensionFromMime(mime),
      readClipboardImageAsBase64: () => (require('./src/core/readClipboard') as any).readClipboardImageAsBase64(),
    });

    (require('./src/paste/installPasteHandler') as any).installPasteHandler({
      plugin: this,
      getExt: (mime: string) => (require('./src/core/mime') as any).getFileExtensionFromMime(mime),
    });
  }
 
  async onunload() {
    try {
      // 仅记录生命周期事件，便于压力测试观察是否存在多次卸载或未清理的幽灵监听
      // 使用结构化日志，后续如发现非托管资源，可在此处补充显式卸载
    console.info('[obsidian-s3-bridge][lifecycle] onunload invoked');
    } catch { /* ignore logging errors */ }
  }
}
