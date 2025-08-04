import { describe, it, expect } from "vitest";
// 从 utils 导入纯函数，避免加载插件入口与 obsidian 依赖
import * as mod from "../../src/utils/objectKey";

const makeObjectKey =
  (mod as any).makeObjectKey ?? (mod as any).default?.makeObjectKey;

describe("makeObjectKey", () => {
  it("导出存在", () => {
    expect(typeof makeObjectKey).toBe("function");
  });
});
