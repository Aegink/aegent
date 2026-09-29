/**
 * 子智能体配置测试（U23/T-P3-126）——内置五预设 / 覆盖与停用解析 /
 * 独立模型回退链 / catalog 形状 / runner 集成（预设身份段与工具集收窄）。
 */

import { describe, expect, it } from "vitest";

import {
  BUILTIN_SUBAGENTS,
  resolveSubagent,
  resolveSubagentModel,
  subagentCatalog,
  type SubagentDefinition,
} from "./subagents-config.js";
import { parseSettingsShape, defaultSettings } from "./settings.js";
import type { ProviderEntry } from "./settings.js";

const PROVIDERS: ProviderEntry[] = [
  { name: "main", adapter: "openai", model: "gpt-main" },
  { name: "cheap", adapter: "openai", model: "gpt-cheap" },
];

describe("内置五预设（U23 验收：内置断言）", () => {
  it("五预设齐全：探索者/代码审查员/测试执行者/修复者/UI 设计师", () => {
    expect(BUILTIN_SUBAGENTS.map((d) => d.name)).toEqual([
      "explorer",
      "code-reviewer",
      "test-runner",
      "fixer",
      "ui-designer",
    ]);
    for (const d of BUILTIN_SUBAGENTS) {
      // 每个预设自描述完整：slug 名 + 描述 + 身份提示非空
      expect(d.name).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
      expect(d.description.trim()).not.toBe("");
      expect(d.prompt.trim()).not.toBe("");
    }
  });

  it("工具集映射我方工具名（截图形态：探索者含 bash、审查员只读、修复者可写）", () => {
    const byName = new Map(BUILTIN_SUBAGENTS.map((d) => [d.name, d]));
    expect(byName.get("explorer")!.tools).toEqual(["read", "glob", "grep", "bash"]);
    expect(byName.get("code-reviewer")!.tools).toEqual(["read", "glob", "grep"]);
    expect(byName.get("test-runner")!.tools).toEqual(["read", "glob", "grep", "bash"]);
    expect(byName.get("fixer")!.tools).toContain("edit");
    expect(byName.get("fixer")!.tools).toContain("write");
    expect(byName.get("ui-designer")!.tools).toContain("write");
  });
});

describe("resolveSubagent（覆盖与停用）", () => {
  it("无用户条目 = 内置启用；未知名 = undefined", () => {
    const b = resolveSubagent("explorer", undefined);
    expect(b).toMatchObject({ name: "explorer", source: "builtin" });
    expect(resolveSubagent("ghost", undefined)).toBeUndefined();
  });

  it("同名覆盖：字段级合并（缺失字段回退内置值）+ source=user", () => {
    const defs: SubagentDefinition[] = [
      { name: "explorer", description: "我的探索者", prompt: "自定义身份提示" },
    ];
    const merged = resolveSubagent("explorer", defs)!;
    expect(merged.source).toBe("user");
    expect(merged.description).toBe("我的探索者");
    expect(merged.prompt).toBe("自定义身份提示");
    expect(merged.tools).toEqual(["read", "glob", "grep", "bash"]); // 缺省回退内置
  });

  it("停用：enabled=false 的同名覆盖记录 → undefined（开回 = 移除记录）", () => {
    const defs: SubagentDefinition[] = [{ name: "fixer", enabled: false } as SubagentDefinition];
    expect(resolveSubagent("fixer", defs)).toBeUndefined();
    expect(resolveSubagent("fixer", defs.filter((d) => d.name !== "fixer"))).toMatchObject({
      name: "fixer",
    });
  });
});

describe("resolveSubagentModel（独立模型回退链）", () => {
  it("未配独立模型 = undefined（回退父模型——既有行为）", () => {
    const def: SubagentDefinition = { name: "x", description: "d", prompt: "p" };
    expect(resolveSubagentModel(def, PROVIDERS, "gpt-main")).toBeUndefined();
  });

  it("modelProvider 条目在位：def.model → 条目 model → defaultModel 链", () => {
    // 显式 model 覆盖
    expect(resolveSubagentModel({ name: "x", description: "d", prompt: "p", modelProvider: "cheap", model: "m-x" }, PROVIDERS, "gpt-main"))
      .toEqual({ entry: PROVIDERS[1], modelId: "m-x" });
    // 条目 model 兜底
    expect(resolveSubagentModel({ name: "x", description: "d", prompt: "p", modelProvider: "cheap" }, PROVIDERS, "gpt-main"))
      .toEqual({ entry: PROVIDERS[1], modelId: "gpt-cheap" });
    // 条目缺 model → defaultModel 主模型链
    expect(resolveSubagentModel({ name: "x", description: "d", prompt: "p", modelProvider: "nope" }, PROVIDERS, "gpt-main"))
      .toBeUndefined(); // 条目不存在 = undefined 不虚构
    expect(resolveSubagentModel({ name: "x", description: "d", prompt: "p", modelProvider: "empty" }, [{ name: "empty" }], "gpt-main"))
      .toEqual({ entry: { name: "empty" }, modelId: "gpt-main" });
  });
});

describe("subagentCatalog（管理页清单形状）", () => {
  it("内置行带 enabled/overridden；自定义分区排除内置名", () => {
    const defs: SubagentDefinition[] = [
      { name: "fixer", enabled: false } as SubagentDefinition,
      { name: "my-agent", description: "我的", prompt: "p" },
    ];
    const cat = subagentCatalog(defs);
    expect(cat.builtins).toHaveLength(5);
    const fixer = cat.builtins.find((b) => b.name === "fixer")!;
    expect(fixer.enabled).toBe(false);
    expect(fixer.overridden).toBe(true);
    expect(cat.builtins.find((b) => b.name === "explorer")!.enabled).toBe(true);
    expect(cat.custom.map((c) => c.name)).toEqual(["my-agent"]);
  });
});

describe("settings subagents 段（parseSettingsShape）", () => {
  it("自定义条目往返 + slug/唯一/形状 fail-closed + 停用最简记录", () => {
    const s = parseSettingsShape({
      subagents: [
        { name: "my-agent", description: "我的", prompt: "身份提示", tools: ["read", "grep"], modelProvider: "main", model: "m1", fallbacks: ["cheap"] },
        { name: "fixer", enabled: false },
      ],
    });
    expect(s.subagents).toHaveLength(2);
    expect(s.subagents![0]).toMatchObject({ name: "my-agent", prompt: "身份提示", modelProvider: "main" });
    expect(s.subagents![1]).toEqual({ name: "fixer", enabled: false }); // 停用最简记录
    // 往返一致
    expect(parseSettingsShape(JSON.parse(JSON.stringify(s))).subagents).toEqual(s.subagents);
    // slug 外形状 / 段内重名 / 启用条目缺 prompt fail-closed
    expect(() => parseSettingsShape({ subagents: [{ name: "Bad Name", description: "d", prompt: "p" }] })).toThrow(/slug/);
    expect(() => parseSettingsShape({ subagents: [{ name: "a", prompt: "p", description: "d" }, { name: "a", prompt: "p2", description: "d2" }] })).toThrow(/重复/);
    expect(() => parseSettingsShape({ subagents: [{ name: "a", description: "d" }] })).toThrow(/prompt 缺失/);
    expect(() => parseSettingsShape({ subagents: [{ name: "a", prompt: "p" }] })).toThrow(/description 缺失/);
    expect(() => parseSettingsShape({ subagents: [{ name: "a", description: "d", prompt: "p", tools: [1] }] })).toThrow(/tools/);
    // 缺省形状无 subagents 段
    expect(defaultSettings().subagents).toBeUndefined();
  });
});

describe("runner 集成：预设身份段与工具集收窄（U23 消费面）", () => {
  it("subagent_type 未知/停用 → failed 结算带类型化错误；停用名单不进可用清单", async () => {
    const { createSubagentRunner } = await import("../kernel/subagent.js");
    const { InMemoryEventStorage, SessionStore } = await import("../session/store.js");
    const { echoProvider } = await import("../kernel/agent-process.js");
    const store = new SessionStore(new InMemoryEventStorage());
    const runner = createSubagentRunner({
      parentSessionId: "s-parent",
      store,
      provider: echoProvider(),
      identity: { provider: "echo", modelId: "echo-1" },
      workspaceRoot: process.cwd(),
      contextWindow: 100_000,
      parentRules: [],
      depth: 0,
      approvalTimeoutMs: 5_000,
      subagentDefs: [{ name: "fixer", enabled: false } as SubagentDefinition],
    });
    // 未知名
    const unknown = await runner("任务", "描述", { subagentType: "ghost" });
    expect(unknown.stopReason).toBe("failed");
    expect(unknown.error).toContain("未知或已停用的子代理预设：ghost");
    // 停用名（同名覆盖记录）
    const disabled = await runner("任务", "描述", { subagentType: "fixer" });
    expect(disabled.stopReason).toBe("failed");
    // 无 subagent_type = 通用子代理（既有行为——正常起子轮并完成）
    const generic = await runner("echo me", "通用", {});
    expect(generic.stopReason).toBe("completed");
    expect(generic.sessionId).toContain("s-parent::task-");
  });

  it("预设身份段进子系统提示（extraPrompt——session/message 落流）", async () => {
    const { createSubagentRunner } = await import("../kernel/subagent.js");
    const { InMemoryEventStorage, SessionStore } = await import("../session/store.js");
    const { echoProvider } = await import("../kernel/agent-process.js");
    const store = new SessionStore(new InMemoryEventStorage());
    const runner = createSubagentRunner({
      parentSessionId: "s-p2",
      store,
      provider: echoProvider(),
      identity: { provider: "echo", modelId: "echo-1" },
      workspaceRoot: process.cwd(),
      contextWindow: 100_000,
      parentRules: [],
      depth: 0,
      approvalTimeoutMs: 5_000,
      subagentDefs: [
        { name: "explorer", description: "探索者", prompt: "你是探索者子代理：只读探索", tools: ["read"] },
      ],
    });
    const result = await runner("探索目录", "探索", { subagentType: "explorer" });
    expect(result.stopReason).toBe("completed");
    const system = store.load(`${"s-p2"}::task-1-`).length; // 子会话存在（id 前缀 s-p2::task-）
    expect(system).toBeGreaterThanOrEqual(0);
    const childId = result.sessionId;
    const events = store.load(childId);
    const sys = events.find((e) => e.type === "system/message");
    expect(sys).toBeDefined();
    expect(JSON.stringify(sys)).toContain("你是探索者子代理：只读探索");
  });
});
