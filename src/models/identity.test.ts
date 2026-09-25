import { describe, expect, it } from "vitest";

import { identityKey, modelIdentity } from "./identity.js";

describe("modelIdentity —— J4 身份是二元组", () => {
  it("同名模型跨厂商是不同身份（对象不等 + 键不等）", () => {
    const a = modelIdentity("openai", "gpt-4o");
    const b = modelIdentity("other", "gpt-4o");
    expect(a).not.toBe(b);
    expect(a).not.toEqual(b);
    expect(identityKey(a)).not.toBe(identityKey(b));
  });

  it("同厂商同 modelId 的键相等", () => {
    expect(identityKey(modelIdentity("openai", "gpt-4o"))).toBe(
      identityKey(modelIdentity("openai", "gpt-4o")),
    );
    expect(identityKey(modelIdentity("openai", "gpt-4o"))).toBe("openai:gpt-4o");
  });

  it("空字符串 / 非字符串字段被拒", () => {
    expect(() => modelIdentity("", "gpt-4o")).toThrow(TypeError);
    expect(() => modelIdentity("openai", "")).toThrow(TypeError);
    expect(() => modelIdentity("openai", "   ")).toThrow(TypeError);
    expect(() => modelIdentity(undefined as unknown as string, "gpt-4o")).toThrow(TypeError);
  });
});
