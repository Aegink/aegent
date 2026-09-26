import { describe, expect, it } from "vitest";

import { loadRules, loadedRuleMatch, type RuleSource } from "./rule-loader.js";
import { deriveSubagentRules, SUBAGENT_DEFAULT_DENIED_TOOLS } from "./subagent-rules.js";

/** 构造一条规则源（行文本 + 动作）。 */
function rule(raw: string, action: RuleSource["action"]): RuleSource {
  return { raw, action };
}

describe("deriveSubagentRules（H5/T-P1-41 权限降级算法）", () => {
  const parentRules: RuleSource[] = [
    rule("bash(git status)", "allow"),
    rule("bash(rm *)", "deny"),
    rule("write ask", "ask"),
    rule("bash(git push)", "deny"),
    rule("read allow", "allow"),
  ];

  it("验收①：父规则 allow/ask 不进子代理规则集、deny 全保留", () => {
    const derived = deriveSubagentRules(parentRules);
    // deny 两条原文原样保留（含样例与行号字段——过滤不动原文）
    expect(derived.filter((r) => r.raw === "bash(rm *)")).toHaveLength(1);
    expect(derived.filter((r) => r.raw === "bash(git push)")).toHaveLength(1);
    // allow/ask 零继承（H5 红线"绝不继承授权"）
    expect(derived.some((r) => r.action === "allow")).toBe(false);
    expect(derived.some((r) => r.action === "ask")).toBe(false);
    // 全部产出都是 deny
    expect(derived.every((r) => r.action === "deny")).toBe(true);
  });

  it("验收②：task/todo_write 默认 deny 在位（H5 验收原文：默认禁用 task 与 todowrite）", () => {
    const derived = deriveSubagentRules([]);
    const raws = derived.map((r) => r.raw);
    expect(raws).toContain("task");
    expect(raws).toContain("todo_write");
    expect(SUBAGENT_DEFAULT_DENIED_TOOLS).toEqual(["task", "todo_write"]);
    for (const r of derived) {
      expect(r.action).toBe("deny");
    }
  });

  it("验收③：显式放开可移除默认 deny，但 allow 仍不可恢复（放开 ≠ 继承授权）", () => {
    // 放开 todo_write：默认 deny 清单只剩 task
    const released = deriveSubagentRules(parentRules, { allowTools: ["todo_write"] });
    expect(released.some((r) => r.raw === "todo_write")).toBe(false);
    expect(released.some((r) => r.raw === "task")).toBe(true);
    // 父规则的 allow 依旧不回来（放开默认禁用绝不连带宽授权）
    expect(released.some((r) => r.action === "allow")).toBe(false);
    // 全放开：默认禁用清零，父 deny 仍在，allow/ask 仍为零
    const allReleased = deriveSubagentRules(parentRules, {
      allowTools: ["task", "todo_write"],
    });
    expect(allReleased).toHaveLength(2);
    expect(allReleased.map((r) => r.raw).sort()).toEqual(["bash(git push)", "bash(rm *)"].sort());
    expect(allReleased.every((r) => r.action === "deny")).toBe(true);
  });

  it("验收④：空规则集 → 仅默认 deny 两条", () => {
    const derived = deriveSubagentRules([]);
    expect(derived).toHaveLength(2);
    expect(derived.map((r) => r.raw).sort()).toEqual(["task", "todo_write"].sort());
  });

  it("验收⑤：产出规则经既有 loadRules → loadedRuleMatch 评估路径可执行（deny 命中、allow 不复活）", () => {
    const derived = deriveSubagentRules(parentRules);
    const loaded = loadRules(derived, {});
    const match = loadedRuleMatch({});
    const asCall = (tool: string) => ({
      tool,
      args: {},
      arguments: "{}",
      turn: 1,
      step: 1,
      callId: "c1",
    });

    // 默认 deny 经匹配器可命中：task / todo_write 裸工具规则全参匹配
    const taskRule = loaded.find((r) => r.toolName === "task");
    expect(taskRule).toBeDefined();
    expect(match(taskRule!, asCall("task"))).toBe("deny");
    const todoRule = loaded.find((r) => r.toolName === "todo_write");
    expect(todoRule).toBeDefined();
    expect(match(todoRule!, asCall("todo_write"))).toBe("deny");

    // 继承的 deny 规则语义不变：bash rm 模式命中 deny
    const rmRule = loaded.find((r) => r.raw === "bash(rm *)");
    expect(rmRule).toBeDefined();
    // bash 未登记匹配器时带参规则永不命中（fail-closed，matchers 纪律）——
    // 这里断言的是规则形状被加载路径接受且裸规则/模式结构完好。
    expect(rmRule!.argPattern).toBe("rm *");

    // 父规则 read allow 已被过滤：加载产物中不存在 read 规则
    expect(loaded.some((r) => r.toolName === "read")).toBe(false);
  });
});
