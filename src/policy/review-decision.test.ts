import { describe, expect, it } from "vitest";

import type { JsonRecord } from "../kernel/events.js";
import { assemblePolicyChain, type PolicyCall } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleMatch, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";
import {
  ApprovalScopeCache,
  REVIEW_SCOPES,
  createSessionApprovalModule,
  proposeAmendment,
  stripProposedAmendments,
} from "./review-decision.js";

const bashCall = (command: string): PolicyCall => ({
  tool: "bash",
  args: { command } satisfies JsonRecord,
});

describe("C47 · 作用域枚举（五档，P0 持久化只做前两档）", () => {
  it("REVIEW_SCOPES 导出顺序：一次性/会话/项目/用户/受管", () => {
    expect([...REVIEW_SCOPES]).toEqual([
      "once",
      "session",
      "project",
      "user",
      "managed",
    ]);
  });
});

describe("C48 · 提案由引擎计算", () => {
  it("bash 调用经匹配器 patternOf 提取，提案原文 = 工具(命令原文)", () => {
    expect(proposeAmendment(bashCall("git status"), builtinRuleMatchers)).toEqual({
      raw: "bash(git status)",
      permission: "bash",
      pattern: "git status",
    });
  });

  it("未登记匹配器 / 命令缺失的工具调用无法生成提案（批准只能一次性）", () => {
    // T-P1-68 分型路由后 write（path）有 patternOf 可生成提案——
    // 不可提案面换 literal 工具（grep 未注册、patternOf 缺省 undefined）
    expect(
      proposeAmendment({ tool: "grep", args: { pattern: "x" } }, builtinRuleMatchers),
    ).toBeUndefined();
    expect(
      proposeAmendment({ tool: "bash", args: {} }, builtinRuleMatchers),
    ).toBeUndefined();
    // write 调用的批准可升级为 path 规则提案（C48 语义扩展至 path 分型）
    expect(
      proposeAmendment({ tool: "write", args: { path: "/a" } }, builtinRuleMatchers),
    ).toEqual({ raw: "write(/a)", permission: "write", pattern: "/a" });
  });
});

describe("验收① · 模型消息捎带规则提案被剥除并记警告", () => {
  it("顶层保留键剥除，警告含 C48 纪律原文", () => {
    const result = stripProposedAmendments({
      command: "ls",
      ruleProposal: "bash(*)",
    });
    expect(result.args).toEqual({ command: "ls" });
    expect(result.strippedKeys).toEqual(["ruleProposal"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("规则提案由引擎计算");
    expect(result.warnings[0]).toContain("C48");
  });

  it("键名大小写变体同样剥除；无保留键时原样返回且零警告", () => {
    const smuggled = stripProposedAmendments({
      ProposedRule: "bash(*)",
      command: "ls",
    });
    expect(smuggled.strippedKeys).toEqual(["ProposedRule"]);
    expect(smuggled.args).toEqual({ command: "ls" });

    const clean = stripProposedAmendments({ command: "ls" });
    expect(clean.strippedKeys).toEqual([]);
    expect(clean.warnings).toEqual([]);
  });

  it("只扫顶层键不深挖值：命令原文提及提案字样不受影响", () => {
    const result = stripProposedAmendments({
      command: "echo 规则提案 ruleProposal 之类",
    });
    expect(result.args).toEqual({
      command: "echo 规则提案 ruleProposal 之类",
    });
    expect(result.strippedKeys).toEqual([]);
  });
});

describe("验收② · 会话作用域批准：同会话免再问，新会话重新问", () => {
  // 装配：批准历史在 ask 规则之前（kimi SessionApprovalHistory 同位）。
  // deny 规则须排在批准历史之前——该层序约束由 T-5-12 的 gate 装配落实。
  const matchers = builtinRuleMatchers;
  const askRules = createRuleSetModule({
    name: "user-rules",
    rules: loadRules([{ raw: "bash(git *)", action: "ask" }], matchers),
    match: loadedRuleMatch(),
    ruleText: (rule) => rule.raw,
  });
  const cache = new ApprovalScopeCache();
  const chainFor = (sessionId: string) =>
    assemblePolicyChain({
      core: [
        createSessionApprovalModule({ cache, sessionId, matchers }),
        askRules,
      ],
    });

  it("首次询问 → 批准会话作用域 → 二次调用免问（verdict 带规则原文）", async () => {
    const first = await chainFor("s1").evaluate(bashCall("git status"));
    expect(first.action).toBe("ask");

    const proposal = proposeAmendment(bashCall("git status"), matchers);
    expect(proposal).toBeDefined();
    cache.record("s1", proposal!.raw, "session");

    const second = await chainFor("s1").evaluate(bashCall("git status"));
    expect(second.action).toBe("allow");
    expect(second.rule).toBe("bash(git status)");
    expect(second.reason).toContain("scope=session");
  });

  it("新会话重新询问（缓存按会话隔离）", async () => {
    expect((await chainFor("s2").evaluate(bashCall("git status"))).action).toBe(
      "ask",
    );
  });

  it("once 与 project/user/managed 在 P0 都不缓存（宁可多问不可多放）", async () => {
    for (const scope of ["once", "project", "user", "managed"] as const) {
      cache.record("s3", "bash(nope)", scope);
      expect(cache.isApproved("s3", "bash(nope)")).toBe(false);
    }
  });
});
