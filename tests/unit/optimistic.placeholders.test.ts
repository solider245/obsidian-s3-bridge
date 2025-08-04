/* eslint-disable @typescript-eslint/no-explicit-any */

// Node 环境注入最小 window 与日志缓冲，必须先于源码执行
(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.__obS3_logs__ = (globalThis as any).window.__obS3_logs__ ?? [];
(globalThis as any).window.__obS3_logLevel__ = (globalThis as any).window.__obS3_logLevel__ ?? "debug";

import { describe, it, expect, beforeAll } from "vitest";

let generateUploadId: any;
let buildUploadingMarkdown: any;
let buildFailedMarkdown: any;
// 引入源码导出的编辑器版本替换函数
let findAndReplaceByUploadId: any;
// 直接使用源码导出的纯文本替换函数
let replaceByUploadIdInText: (text: string, uploadId: string, replacement: string) => string;

beforeAll(async () => {
  const mod = await import("../../src/uploader/optimistic");
  generateUploadId = (mod as any).generateUploadId;
  buildUploadingMarkdown = (mod as any).buildUploadingMarkdown;
  buildFailedMarkdown = (mod as any).buildFailedMarkdown;
  findAndReplaceByUploadId = (mod as any).findAndReplaceByUploadId;
  // 使用源码新导出的函数
  replaceByUploadIdInText = (mod as any).replaceByUploadIdInText;
});

describe("optimistic placeholders", () => {
  it("导出存在", () => {
    expect(typeof generateUploadId).toBe("function");
    expect(typeof buildUploadingMarkdown).toBe("function");
    expect(typeof buildFailedMarkdown).toBe("function");
    expect(typeof findAndReplaceByUploadId).toBe("function");
    expect(typeof replaceByUploadIdInText).toBe("function");
  });

  it("buildUploadingMarkdown 含 ob-s3:id 与 status=uploading", () => {
    const id = "u1234567890abcdef";
    const md = buildUploadingMarkdown(id, "blob://x");
    expect(md).toContain("ob-s3:id=" + id);
    expect(md).toContain("status=uploading");
  });

  it("buildFailedMarkdown 含 status=failed 与重试链接", () => {
    const id = "uabcdef1234567890";
    const md = buildFailedMarkdown(id);
    expect(md).toContain("status=failed");
    expect(md).toMatch(/\[.*?(重试|retry).*?\]\(#\)/i);
  });

  it("replaceByUploadIdInText 可替换 uploading 占位（纯文本）", () => {
    const id = "u1111222233334444";
    // 使用源码构造上传中占位，确保与正则完全一致
    const uploading = buildUploadingMarkdown(id, "blob:mock-y");
    const original = `${uploading}\n其他文本`;
    const replaced = replaceByUploadIdInText(original, id, "![完成](https://example.com/done.png)");
    // 断言包含（而非强等），以对齐“只替换首个命中”的实现
    expect(replaced).toContain("![完成](https://example.com/done.png)");
    expect(replaced).toContain("其他文本");
  });

  it("replaceByUploadIdInText 可替换 failed 占位（纯文本）", () => {
    const id = "u5555666677778888";
    // 使用源码构造失败占位，确保与正则完全一致（包含 [重试](#)）
    const failed = buildFailedMarkdown(id);
    const original = `${failed}\n尾部`;
    const replaced = replaceByUploadIdInText(original, id, "![OK](https://example.com/ok.png)");
    expect(replaced).toContain("![OK](https://example.com/ok.png)");
    expect(replaced).toContain("尾部");
  });

  it("replaceByUploadIdInText 未命中时不变（纯文本）", () => {
    const id = "unotfound";
    const original = "纯文本，无占位";
    const replaced = replaceByUploadIdInText(original, id, "替换目标");
    expect(replaced).toBe(original);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
