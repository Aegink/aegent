/**
 * C55 · 拒绝面纪律测试（T-P2-202）——拒绝是结构化对象（原因 + 替代
 * 做法）而非裸字符串。覆盖：DenialShape 渲染 / 规则声明面加载归一 /
 * linter missing-alternatives 检出 / gate 渲染与既有拒绝零变化。
 */
import { describe, expect, it } from "vitest";

import type { ChainNext } from "../kernel/chain.js";
import type { ToolCallPayload, ToolExecutionResult } from "../kernel/loop.js";
import type { JsonRecord } from "../kernel/events.js";
import { assemblePolicyChain } from "./chain.js";
import { renderDenial, buildDenial } from "./denial.js";
import { createToolGateLayer } from "./gate.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleDenial, loadedRuleMatch, loadRules } from "./rule-loader.js";
import { lintRules } from "./linter.js";
import { createRuleSetModule } from "./rules.js";
import { DenyPermissionBroker } from "./broker.js";

describe("C55 · renderDenial / buildDenial（结构化拒绝形状）", () => {
  it("渲染：主因 + 规则理由 + 编号替代清单；无附加字段与既有文本同形", () => {
    expect(renderDenial({ reason: "rm 被禁" })).toBe("被权限策略拒绝：rm 被禁");
    expect(renderDenial({ reason: "rm 被禁", justification: "防误删工作区" })).toBe(
      "被权限策略拒绝：rm 被禁\n规则理由：防误删工作区",
    );
    expect(
      renderDenial({
        reason: "rm 被禁",
        alternatives: ["用 apply_patch 改文件", "移入 scratch/ 再删"],
      }),
    ).toBe(
      "被权限策略拒绝：rm 被禁\n替代做法：\n  1. 用 apply_patch 改文件\n  2. 移入 scratch/ 再删",
    );
    // 完整形状
    const full = renderDenial({
      reason: "rm 被禁",
      justification: "防误删",
      alternatives: ["用 trash-cli"],
    });
    expect(full).toContain("规则理由：防误删");
    expect(full).toContain("1. 用 trash-cli");
  });

  it("buildDenial：无声明数据返回 undefined（既有拒绝零变化的开关面）", () => {
    expect(buildDenial("r", undefined)).toBeUndefined();
    expect(buildDenial("r", {})).toBeUndefined();
    expect(buildDenial("r", { alternatives: [] })).toBeUndefined();
    const shape = buildDenial("主因", { justification: "为什么" });
    expect(shape).toEqual({ reason: "主因", justification: "为什么" });
  });
});

describe("C55 · 规则声明面（justification / alternatives 加载归一）", () => {
  it("加载保留非空白声明；空白 justification 归一 undefined；空白条目剔除", () => {
    const rules = loadRules(
      [
        {
          raw: "bash(rm *)",
          action: "deny",
          justification: "  防误删工作区  ",
          alternatives: ["用 apply_patch", "   ", ""],
        },
        { raw: "bash(git *)", action: "allow", justification: "   " },
        { raw: "bash(npm *)", action: "deny", alternatives: ["  ", ""] },
      ],
      builtinRuleMatchers,
    );
    expect(rules[0]).toMatchObject({
      justification: "防误删工作区",
      alternatives: ["用 apply_patch"],
    });
    // 空白 justification = 未声明（codex 注册期拒绝空串的对应面，归一记档）
    expect(rules[1]?.justification).toBeUndefined();
    // 全空白 alternatives 剔后为空 → undefined（linter 将报 missing-alternatives）
    expect(rules[2]?.alternatives).toBeUndefined();
  });

  it("linter：forbidden（deny）规则缺 alternatives 检出 missing-alternatives", () => {
    const rules = loadRules(
      [
        { raw: "bash(rm *)", action: "deny" },
        {
          raw: "bash(npm publish*)",
          action: "deny",
          alternatives: ["用 npm pack 出包人工分发"],
        },
        { raw: "bash(git *)", action: "allow" },
        { raw: "bash(curl *)", action: "ask" },
      ],
      builtinRuleMatchers,
    );
    const issues = lintRules(rules, { knownToolNames: ["bash"] });
    const missing = issues.filter((i) => i.kind === "missing-alternatives");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ raw: "bash(rm *)" });
    // allow/ask 与已声明 alternatives 的 deny 不报
    expect(issues.map((i) => i.kind)).toEqual(["missing-alternatives"]);
  });
});

// ---------------------------------------------------------------------------
// gate 渲染（deny 命中带声明规则 → 替代做法可见；无声明 → 既有文本）
// ---------------------------------------------------------------------------

const payload = (
  args: JsonRecord,
  callId = "c1",
): ToolCallPayload => ({
  turn: 1,
  step: 1,
  callId,
  name: "bash",
  arguments: JSON.stringify(args),
});

function makeNext(
  fn: (e2: ToolCallPayload) => Promise<ToolExecutionResult>,
): ChainNext<ToolCallPayload, ToolExecutionResult> {
  return Object.assign(fn, {
    point: "toolCall" as const,
    trace: Object.freeze([]),
    budget: Object.freeze({}),
  });
}

function makeGateLayer(sources: Parameters<typeof loadRules>[0]) {
  const rules = loadRules(sources, builtinRuleMatchers);
  return createToolGateLayer({
    chain: assemblePolicyChain({
      user: [
        createRuleSetModule({
          name: "user-rules",
          rules,
          match: loadedRuleMatch(),
          ruleText: (r) => r.raw,
          ruleDenial: loadedRuleDenial,
        }),
      ],
    }),
    broker: new DenyPermissionBroker(),
    sessionId: "s1",
  });
}

describe("C55 · gate 拒绝消息渲染（拒绝要能告诉用户怎么办）", () => {
  it("deny 规则带声明：content 含主因 + 规则理由 + 编号替代做法", async () => {
    const layer = makeGateLayer([
      {
        raw: "bash(rm *)",
        action: "deny",
        justification: "防误删工作区文件",
        alternatives: ["用 apply_patch 改文件", "移入 scratch/ 后处理"],
      },
    ]);
    const result = await layer(
      { sessionId: "s1" },
      payload({ command: "rm -rf build" }),
      makeNext(async () => ({ content: "executed" })),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("被权限策略拒绝");
    expect(result.content).toContain("规则理由：防误删工作区文件");
    expect(result.content).toContain("替代做法：");
    expect(result.content).toContain("1. 用 apply_patch 改文件");
    expect(result.content).toContain("2. 移入 scratch/ 后处理");
  });

  it("deny 规则无声明：既有单行拒绝文本零变化", async () => {
    const layer = makeGateLayer([{ raw: "bash(rm *)", action: "deny" }]);
    const result = await layer(
      { sessionId: "s1" },
      payload({ command: "rm -rf build" }),
      makeNext(async () => ({ content: "executed" })),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toBe(
      "被权限策略拒绝：策略模块 user-rules 裁决为 deny（依规则 bash(rm *)）",
    );
    expect(result.content).not.toContain("替代做法");
  });
});
