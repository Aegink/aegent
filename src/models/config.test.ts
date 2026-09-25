import { describe, expect, it } from "vitest";

import { ProviderConfigError, parseProviderConfig } from "./config.js";

describe("parseProviderConfig —— J3 不透明配置，只校验语法", () => {
  it("合法配置原样通过，settingsConfig 不被展开或改写", () => {
    const settings = '{"baseUrl":"https://api.example.com/v1","apiKey":"sk-test"}';
    const cfg = parseProviderConfig({ name: "example", settingsConfig: settings });
    expect(cfg).toEqual({ name: "example", settingsConfig: settings });
  });

  it("非法 JSON 被拒且报错含位置（对象内错误，如尾逗号）", () => {
    const fn = () => parseProviderConfig({ name: "x", settingsConfig: '{"a": 1, }' });
    expect(fn).toThrow(ProviderConfigError);
    try {
      fn();
    } catch (e) {
      const err = e as ProviderConfigError;
      expect(err.message).toMatch(/第 1 行，第 \d+ 列/);
      expect(err.line).toBe(1);
      expect(err.column).toBeGreaterThan(1);
      expect(typeof err.offset).toBe("number");
    }
  });

  it("顶层 token 错误也含位置——V8 消息不给位置，靠自定位器兜底", () => {
    const fn = () => parseProviderConfig({ name: "x", settingsConfig: "not json" });
    expect(fn).toThrow(ProviderConfigError);
    try {
      fn();
    } catch (e) {
      const err = e as ProviderConfigError;
      expect(err.message).toMatch(/第 1 行，第 1 列/);
    }
  });

  it("多行配置的行号正确（错误落在第 3 行）", () => {
    const fn = () =>
      parseProviderConfig({
        name: "x",
        settingsConfig: '{\n  "a": 1,\n  "b": trux\n}',
      });
    try {
      fn();
    } catch (e) {
      const err = e as ProviderConfigError;
      expect(err.line).toBe(3);
    }
  });

  it("字符串未闭合 / 非法转义被定位拒绝", () => {
    expect(() => parseProviderConfig({ name: "x", settingsConfig: '"abc' })).toThrow(
      ProviderConfigError,
    );
    try {
      parseProviderConfig({ name: "x", settingsConfig: '"a\\qb"' });
    } catch (e) {
      expect((e as ProviderConfigError).message).toMatch(/非法转义/);
    }
  });

  it("name / settingsConfig 缺失或为空被拒", () => {
    expect(() => parseProviderConfig(null)).toThrow(ProviderConfigError);
    expect(() => parseProviderConfig([1, 2])).toThrow(ProviderConfigError);
    expect(() => parseProviderConfig({ settingsConfig: "{}" })).toThrow(/name/);
    expect(() => parseProviderConfig({ name: "x", settingsConfig: "" })).toThrow(
      /settingsConfig/,
    );
    expect(() => parseProviderConfig({ name: "x", settingsConfig: "   " })).toThrow(
      /settingsConfig/,
    );
  });

  it("settingsConfig 是标量 JSON 也放行（J3：内容语义归适配层）", () => {
    expect(() => parseProviderConfig({ name: "x", settingsConfig: "123" })).not.toThrow();
  });
});
