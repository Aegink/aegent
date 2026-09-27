import { describe, expect, it } from "vitest";

import {
  InvalidSessionIdError,
  createSessionId,
  isValidSessionId,
} from "./session-id.js";

describe("N1/T-P1-110 统一会话 ID", () => {
  it("生成唯一：多枚互不等且都是合法形状", () => {
    const ids = Array.from({ length: 64 }, () => createSessionId());
    expect(new Set(ids).size).toBe(64);
    for (const id of ids) {
      expect(isValidSessionId(id)).toBe(true);
    }
  });

  it("生成的是 UUID v4 形状", () => {
    expect(createSessionId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("校验闭面：垃圾串/空串/超长/空白/点开头拒绝", () => {
    expect(isValidSessionId("s0")).toBe(true);
    expect(isValidSessionId("s-replay")).toBe(true);
    expect(isValidSessionId("s1")).toBe(true);
    expect(isValidSessionId("")).toBe(false);
    expect(isValidSessionId("  ")).toBe(false);
    expect(isValidSessionId("a b")).toBe(false);
    expect(isValidSessionId("a\tb")).toBe(false);
    expect(isValidSessionId(".hidden")).toBe(false);
    expect(isValidSessionId("..")).toBe(false);
    expect(isValidSessionId("x".repeat(129))).toBe(false);
    expect(isValidSessionId(42)).toBe(false);
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });

  it("校验边界：恰好 128 字符合法", () => {
    expect(isValidSessionId("x".repeat(128))).toBe(true);
  });

  it("InvalidSessionIdError 带 code 与 received", () => {
    const err = new InvalidSessionIdError("bad id");
    expect(err.code).toBe("INVALID_SESSION_ID");
    expect(err.received).toBe("bad id");
    expect(err.message).toContain("bad id");
  });
});
