/**
 * 项目信任降权全链快照（O21/O22，T-P1-74）——批次 8 权限语义的规格快照：
 * 读 Scenario 行即知被钉死的行为。全链 = 用户规则链 + 出口降权（C11）+
 * trustGated 会话批准（C34）+ 每次决策读当前信任，一个场景跑通。
 */
import { describe, expect, it } from "vitest";

import type { ChainNext } from "../kernel/chain.js";
import type { ToolCallPayload, ToolExecutionResult } from "../kernel/loop.js";
import type { JsonRecord } from "../kernel/events.js";
import { DenyPermissionBroker } from "./broker.js";
import { PendingApprovals } from "./pending.js";
import { createToolGateLayer } from "./gate.js";
import { assemblePolicyChain } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleMatch, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";
import {
  ApprovalScopeCache,
  createSessionApprovalModule,
} from "./review-decision.js";
import { ProjectTrustService } from "./project-trust.js";

const SCENARIO =
  "项目信任降权全链：未信任项目 → 用户 allow 规则可裁决读类，但写/执行类被出口降权 deny" +
  "（C11 出口级压过规则）且 trustGated 会话批准不生效（C34 过滤）；declareTrusted 后同链全放行；" +
  "revoke 后立刻再拦（每次决策读当前信任，无快照记账）";

function makeNext(
  fn: (e2: ToolCallPayload) => Promise<ToolExecutionResult>,
): ChainNext<ToolCallPayload, ToolExecutionResult> {
  return Object.assign(fn, {
    point: "toolCall" as const,
    trace: Object.freeze([]),
    budget: Object.freeze({}),
  });
}

describe("项目信任降权全链快照（O21/O22：批次 8 权限语义规格一条）", () => {
  it("Scenario 头 + 全链行为派生断言（出口压规则 / trustGated 过滤 / 活查询）", async () => {
    const trust = new ProjectTrustService();
    // 用户规则：bash(git *) allow——未信任时对写/执行类压不过出口
    const rules = loadRules([{ raw: "bash(git *)", action: "allow" }], builtinRuleMatchers);
    const approvalCache = new ApprovalScopeCache();
    // trustGated 会话批准（C34：仓库自带配置授予的形态）
    approvalCache.record("s1", "bash(npm test)", "session", { trustGated: true });
    const chain = assemblePolicyChain({
      user: [
        createRuleSetModule({
          name: "user-rules",
          rules,
          match: loadedRuleMatch(),
          ruleText: (rule) => rule.raw,
        }),
      ],
      core: [
        createSessionApprovalModule({
          cache: approvalCache,
          sessionId: "s1",
          matchers: builtinRuleMatchers,
          trustState: () => trust.isTrusted(),
        }),
      ],
    });
    const warnings: string[] = [];
    const broker = new DenyPermissionBroker();
    const pending = new PendingApprovals();
    const layer = createToolGateLayer({
      chain,
      broker,
      sessionId: "s1",
      onWarning: (w) => warnings.push(w),
      trustState: () => trust.isTrusted(),
    });
    const next = makeNext(async (e2) => ({ content: "executed", payload: e2 }));
    const call = (callId: string, name: string, args: JsonRecord): ToolCallPayload => ({
      turn: 1,
      step: 1,
      callId,
      name,
      arguments: JSON.stringify(args),
    });

    const observations: string[] = [];

    // ① 未信任：用户 allow 规则命中 bash，但出口降权 deny（规则压不过）+ warn
    const blocked = await layer(null as never, call("c1", "bash", { command: "git status" }), next);
    observations.push(
      `未信任 bash(用户 allow 规则) → isError=${String(blocked.isError === true)} 理由含C11=${String(blocked.content.includes("C11"))} warn=${String(warnings.some((w) => w.includes("trust-gate")))}`,
    );
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toContain("C11");

    // ② trustGated 批准未信任不生效：npm test（无用户规则命中）→ ask → broker 拒
    const gateDenied = await layer(null as never, call("c2", "bash", { command: "npm test" }), next);
    observations.push(`trustGated 批准未信任 → 不生效=${String(gateDenied.isError === true)}`);
    expect(gateDenied.isError).toBe(true);

    // ③ declareTrusted：同链立刻全放行（每次决策读当前信任）
    trust.declareTrusted();
    const allowed = await layer(null as never, call("c3", "bash", { command: "git status" }), next);
    observations.push(`信任后同链 bash → executed=${String(allowed.content === "executed")}`);
    expect(allowed.content).toBe("executed");

    // ④ 信任后 trustGated 批准恢复生效（记录保留、过滤解除——qwen 同款）
    const restored = await layer(null as never, call("c4", "bash", { command: "npm test" }), next);
    observations.push(`信任后 trustGated 批准恢复 → executed=${String(restored.content === "executed")}`);
    expect(restored.content).toBe("executed");

    // ⑤ revoke（可经 declareUntrusted）→ 下一次决策立刻再拦
    trust.declareUntrusted();
    const reblocked = await layer(null as never, call("c5", "bash", { command: "git status" }), next);
    observations.push(`撤销信任后同链 bash → 再拦=${String(reblocked.isError === true)}`);
    expect(reblocked.isError).toBe(true);

    const snapshot = [
      `Scenario: ${SCENARIO}`,
      ...observations.map((l) => `[emit] ${l}`),
    ].join("\n");
    expect(snapshot).toContain("Scenario: 项目信任降权全链");
    expect(snapshot).toContain("理由含C11=true warn=true");
    expect(snapshot).toContain("信任后同链 bash → executed=true");
    expect(snapshot).toContain("撤销信任后同链 bash → 再拦=true");
  });
});
