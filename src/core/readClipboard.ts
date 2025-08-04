// 概述: 从系统剪贴板读取首个图片项为 base64 与 MIME，桌面端 Obsidian 可用，失败返回 null。
// 导出: readClipboardImageAsBase64(): Promise<{ base64: string; mime: string; size?: number } | null>
// 依赖: 无（运行期依赖 navigator.clipboard.read 能力）
// 用法: const img = await readClipboardImageAsBase64(); if (img) { /* 上传 */ }
// 相关: [src/features/registerCommands.ts()](src/features/registerCommands.ts:1), [src/features/installPasteHandler.ts()](src/features/installPasteHandler.ts:1)

export async function readClipboardImageAsBase64(): Promise<{ base64: string; mime: string; size?: number } | null> {
  try {
    const anyNav: any = navigator as any;
    if (!anyNav?.clipboard?.read) return null;
    const items: ClipboardItem[] = await anyNav.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t: string) => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        const blobSize = (blob as any)?.size ?? undefined;
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return { base64, mime: type, size: blobSize };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default { readClipboardImageAsBase64 };