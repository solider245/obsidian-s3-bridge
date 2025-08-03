import { moment, Plugin, TFile } from 'obsidian';

// 语言包类型：英文原文 -> 目标语言翻译
export type LangPack = Record<string, string>;

const BUILTIN_RESOURCES: Record<string, LangPack> = {};

/**
 * 注册内置语言包
 */
export function registerBuiltinLang(locale: string, pack: LangPack) {
  BUILTIN_RESOURCES[locale] = pack;
}

let translations: LangPack = {};

/**
 * 从内置与可选的自定义语言文件加载翻译
 * 自定义文件路径：<插件目录>/custom-lang.json
 */
export async function loadTranslations(plugin: Plugin) {
  const locale = moment.locale();
  let langPack: LangPack = BUILTIN_RESOURCES[locale] || {};

  // 允许用户在插件目录放置 custom-lang.json 进行覆盖
  try {
    // 通过 app.vault.adapter 需要以 vault 根为基准路径；插件目录一般不可直接通过 vault 读取
    // 因此优先尝试使用 require 动态导入失败则忽略；这里退化为不从磁盘读取，仅支持内置与未来可扩展机制
    // 若后续需要支持自定义文件，可通过 app.vault.getAbstractFileByPath 定位 .obsidian/plugins/<id>/custom-lang.json
    const customPath = `.obsidian/plugins/${plugin.manifest.id}/custom-lang.json`;
    const file = plugin.app.vault.getAbstractFileByPath(customPath);
    if (file && file instanceof TFile) {
      const data = await plugin.app.vault.read(file);
      const custom = JSON.parse(data) as LangPack;
      langPack = { ...langPack, ...custom };
    }
  } catch (e) {
    // 安静失败，不影响英文回退
    console.error('i18n: failed to load custom-lang.json', e);
  }

  translations = langPack;
}

/**
 * 文本即是键：查不到返回原文
 */
export function t(text: string): string {
  return translations[text] ?? text;
}

/**
 * 简单插值：t("Upload failed: {error}", { error: msg })
 */
export function tp(text: string, params?: Record<string, string | number>): string {
  const base = t(text);
  if (!params) return base;
  return Object.keys(params).reduce((acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k])), base);
}