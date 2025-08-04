import { describe, it, expect } from "vitest";
import * as mod from "../../s3/s3Manager";

const buildPublicUrl = (mod as any).buildPublicUrl;

describe("buildPublicUrl", () => {
  it("导出存在", () => {
    expect(typeof buildPublicUrl).toBe("function");
  });
});
