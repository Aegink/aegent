/**
 * contributes 形状校验测试（T-P3-148 A/B/D/E/F/G）——闭集/上限/路径/二选一
 * /订阅闭集/v2 名称形状/设置值合并的验收面。
 */

import { describe, expect, it } from "vitest";

import { validateManifest } from "./plugin-manifest.js";
import { coerceSettingValues, validateContributes } from "./plugin-manifest-contributes.js";

const CAPS = ["registerTool", "subscribe", "hooks"];

function v2Manifest(contributes: unknown): Record<string, unknown> {
  return {
    name: "demo",
    trust: "untrusted",
    capabilities: ["registerTool"],
    contributes,
  };
}

describe("validateContributes 闭集与形状", () => {
  it("闭集外子键拒绝", () => {
    const r = validateContributes({ agents: ["x"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("闭集外子键");
  });

  it("commands：file 与 template 二选一（都给/都不给都拒）", () => {
    const both = validateContributes({
      commands: [{ name: "a", file: "a.md", template: "x" }],
    });
    expect(both.ok).toBe(false);
    const neither = validateContributes({ commands: [{ name: "a" }] });
    expect(neither.ok).toBe(false);
    const ok = validateContributes({ commands: [{ name: "a", template: "正文" }] });
    expect(ok.ok).toBe(true);
  });

  it("commands：file 必须是相对 .md 名（绝对路径/.. 拒绝）", () => {
    for (const bad of ["C:\\x\\a.md", "/etc/a.md", "../a.md"]) {
      const r = validateContributes({ commands: [{ name: "a", file: bad }] });
      expect(r.ok).toBe(false);
    }
  });

  it("commands：数量上限 32", () => {
    const cmds = Array.from({ length: 33 }, (_, i) => ({ name: `c${String(i)}`, template: "x" }));
    const r = validateContributes({ commands: cmds });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("")).toContain("超上限");
  });

  it("skills：相对目录收、绝对与 .. 拒、非字符串拒", () => {
    expect(validateContributes({ skills: ["skills"] }).ok).toBe(true);
    expect(validateContributes({ skills: ["../outside"] }).ok).toBe(false);
    expect(validateContributes({ skills: ["C:\\x"] }).ok).toBe(false);
    expect(validateContributes({ skills: [42] }).ok).toBe(false);
  });

  it("views：entry 须为 .html 相对名，id 去重", () => {
    const r = validateContributes({
      views: [
        { id: "main", title: "主视图", entry: "views/index.html" },
        { id: "main", title: "重复", entry: "views/other.html" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("")).toContain("视图 id 重复");
    expect(validateContributes({ views: [{ id: "m", title: "t", entry: "v.js" }] }).ok).toBe(false);
  });

  it("mcpServers：env 值须为字符串或 {setting} 引用，serverName 去重", () => {
    const bad = validateContributes({
      mcpServers: [{ serverName: "s", command: "node", env: { KEY: 42 } }],
    });
    expect(bad.ok).toBe(false);
    const dup = validateContributes({
      mcpServers: [
        { serverName: "s", command: "node" },
        { serverName: "s", command: "node" },
      ],
    });
    expect(dup.ok).toBe(false);
    const ok = validateContributes({
      mcpServers: [{ serverName: "s", command: "node", env: { KEY: { setting: "apiKey" } } }],
    });
    expect(ok.ok).toBe(true);
  });

  it("settings：select 必须带 choices 且 default ∈ choices", () => {
    const noChoices = validateContributes({
      settings: [{ name: "mode", type: "select" }],
    });
    expect(noChoices.ok).toBe(false);
    const badDefault = validateContributes({
      settings: [{ name: "mode", type: "select", choices: ["a", "b"], default: "z" }],
    });
    expect(badDefault.ok).toBe(false);
    const ok = validateContributes({
      settings: [{ name: "mode", type: "select", choices: ["a", "b"], default: "a" }],
    });
    expect(ok.ok).toBe(true);
  });

  it("subscriptions：⊆ EVENT_TYPES 闭集 + 去重", () => {
    expect(validateContributes({ subscriptions: ["user/message", "tool/call"] }).ok).toBe(true);
    expect(validateContributes({ subscriptions: ["not/an/event"] }).ok).toBe(false);
    expect(validateContributes({ subscriptions: ["user/message", "user/message"] }).ok).toBe(false);
  });
});

describe("validateManifest v2 集成", () => {
  it("v2 清单 name 收紧 slug 形状（大写/空格/双下划线拒）", () => {
    for (const bad of ["My Plugin", "my__plugin", "大写"]) {
      const r = validateManifest({ ...v2Manifest({}), name: bad }, CAPS);
      expect(r.ok).toBe(false);
    }
  });

  it("旧清单（无 contributes）name 不做形状校验——向后兼容", () => {
    const r = validateManifest({ name: "My Old Plugin", trust: "untrusted", capabilities: [] }, CAPS);
    expect(r.ok).toBe(true);
  });

  it("contributes 形状错误全量收集进 manifest errors", () => {
    const r = validateManifest(v2Manifest({ commands: [{ name: "a" }] }), CAPS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("")).toContain("二选一");
  });

  it("version/description 收录且带字段上限", () => {
    const ok = validateManifest({ ...v2Manifest({}), version: "1.2.3", description: "演示插件" }, CAPS);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.manifest.version).toBe("1.2.3");
      expect(ok.manifest.description).toBe("演示插件");
    }
    expect(validateManifest({ ...v2Manifest({}), version: "x".repeat(33) }, CAPS).ok).toBe(false);
  });
});

describe("coerceSettingValues（F 装配面）", () => {
  const schema = [
    { name: "greeting", type: "string" as const, default: "hi" },
    { name: "limit", type: "number" as const },
    { name: "mode", type: "select" as const, choices: ["fast", "slow"], default: "fast" },
  ];

  it("缺省回退 default；类型不符回退并记 issue；未知键忽略并记 issue", () => {
    const r = coerceSettingValues(schema, { limit: "not-a-number", extra: 1 });
    expect(r.merged).toEqual({ greeting: "hi", mode: "fast" });
    expect(r.issues.some((i) => i.includes("limit"))).toBe(true);
    expect(r.issues.some((i) => i.includes("extra"))).toBe(true);
  });

  it("合法值透传；select 值不在 choices 回退", () => {
    const r = coerceSettingValues(schema, { greeting: "yo", limit: 5, mode: "warp" });
    expect(r.merged).toEqual({ greeting: "yo", limit: 5, mode: "fast" });
  });

  it("无 schema = 空合并", () => {
    expect(coerceSettingValues(undefined, { a: 1 }).merged).toEqual({});
  });
});
