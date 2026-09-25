import { describe, expect, it } from "vitest";

import {
  DECISION_ORDER,
  decisionSeverity,
  maxDecision,
} from "./aggregate.js";
import type { Decision } from "./decision.js";
import {
  PROTECTED_METADATA_PATH_NAMES,
  enforceProtectedPaths,
  findProtectedMetadataSegment,
  withProtectedPaths,
} from "./protected-paths.js";
import { assemblePolicyChain, type PolicyCall } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleMatch, loadedRuleText, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";

const bashCall = (command: string): PolicyCall => ({
  tool: "bash",
  args: { command },
});
const writeCall = (path: string): PolicyCall => ({
  tool: "write",
  args: { path, content: "x" },
});

describe("C43 · Decision 全序与 max() 聚合", () => {
  it("全序唯一定义处：abstain < allow < ask < deny（codex Allow<Prompt<Forbidden 同构）", () => {
    expect([...DECISION_ORDER]).toEqual(["abstain", "allow", "ask", "deny"]);
    const severities = DECISION_ORDER.map(decisionSeverity);
    expect([...severities].sort((a, b) => a - b)).toEqual(severities);
  });

  it("二元 max：方向无关、最严者胜", () => {
    expect(maxDecision(["allow", "deny"])).toBe("deny");
    expect(maxDecision(["deny", "allow"])).toBe("deny");
    expect(maxDecision(["allow", "ask"])).toBe("ask");
    expect(maxDecision(["ask", "ask"])).toBe("ask");
  });

  it("abstain 是单位元：max(任何集, abstain) 不变；空集聚合为 abstain", () => {
    expect(maxDecision([])).toBe("abstain");
    expect(maxDecision(["abstain"])).toBe("abstain");
    expect(maxDecision(["abstain", "allow"])).toBe("allow");
    expect(maxDecision(["deny", "abstain"])).toBe("deny");
  });

  it("验收①性质测试：穷举小决策空间，加一条意见结果绝不变宽松", () => {
    // 穷举 Decision 全集的所有子集（2^4 = 16）× 每种追加意见（4）：
    // severity(max(S ∪ {d})) >= severity(max(S)) 恒成立——
    // "加规则在数学上不可能放宽"（C43 结构上关掉 C35 的自我加白）。
    const space: Decision[] = ["abstain", "allow", "ask", "deny"];
    const subsets: Decision[][] = [];
    for (let mask = 0; mask < 1 << space.length; mask++) {
      const subset = space.filter((_, i) => mask & (1 << i));
      subsets.push(subset);
    }
    expect(subsets).toHaveLength(16);
    for (const subset of subsets) {
      const before = decisionSeverity(maxDecision(subset));
      for (const added of space) {
        expect(decisionSeverity(maxDecision([...subset, added]))).toBeGreaterThanOrEqual(
          before,
        );
      }
    }
  });
});

describe("C46 · 保留元数据路径", () => {
  it("清单与 codex 同款且只能追加（C36 纪律注释所在）", () => {
    expect([...PROTECTED_METADATA_PATH_NAMES]).toEqual([
      ".git",
      ".agents",
      ".codex",
    ]);
  });

  it("路径任一段命中返回命中段：POSIX 与 Windows 分隔符皆可", () => {
    expect(findProtectedMetadataSegment("/repo/.git/objects/ab")).toBe(".git");
    expect(findProtectedMetadataSegment("C:\\repo\\.agents\\skills\\x")).toBe(
      ".agents",
    );
    expect(findProtectedMetadataSegment("/repo/.codex/config.json")).toBe(
      ".codex",
    );
  });

  it("前缀相似不算命中：.gitignore 与 .github 不是保留目录", () => {
    expect(findProtectedMetadataSegment("/repo/.gitignore")).toBeUndefined();
    expect(findProtectedMetadataSegment("/repo/.github/workflows.yml")).toBeUndefined();
    expect(findProtectedMetadataSegment("/repo/src/main.ts")).toBeUndefined();
  });

  it("大小写不敏感比较（Windows 盘保守方向），命中段保留原文", () => {
    expect(findProtectedMetadataSegment("/repo/.GIT/config")).toBe(".GIT");
  });
});

describe("C46 · 硬拦出口（规则不得授权）", () => {
  it("验收②：链配了 allow 规则，.git/ 下写操作仍 deny", async () => {
    // 链上显式放行 write 工具（裸工具规则，免委托）——
    // 规则层面"想放"没问题，硬拦出口照样压成 deny。
    const rules = loadRules([{ raw: "write", action: "allow" }], builtinRuleMatchers);
    const chain = withProtectedPaths(
      assemblePolicyChain({
        managed: [
          createRuleSetModule({
            name: "managed-rules",
            rules,
            match: loadedRuleMatch(builtinRuleMatchers),
            ruleText: loadedRuleText,
          }),
        ],
      }),
    );
    const verdict = await chain.evaluate(writeCall("/repo/.git/config"));
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain(".git");
    expect(verdict.rule).toBeUndefined(); // 硬拦不是规则来源
  });

  it("ask 同样被压成 deny；正常路径透传链裁决", async () => {
    const verdict = enforceProtectedPaths(
      { action: "ask", reason: "默认询问" },
      writeCall("/repo/README.md"),
    );
    expect(verdict.action).toBe("ask");
    const blocked = enforceProtectedPaths(
      { action: "ask", reason: "默认询问" },
      { tool: "edit", args: { path: "a\\b\\.agents\\m", oldText: "x", newText: "y" } },
    );
    expect(blocked.action).toBe("deny");
  });

  it("只拦写：read 触及 .git 不拦（git 日常要读元数据），bash 不在本拦面（T-5-14 虚拟操作接入）", () => {
    const readVerdict = enforceProtectedPaths(
      { action: "allow", reason: "r" },
      { tool: "read", args: { path: "/repo/.git/HEAD" } },
    );
    expect(readVerdict.action).toBe("allow");
    const bashVerdict = enforceProtectedPaths(
      { action: "allow", reason: "r" },
      bashCall("rm -rf /repo/.git"),
    );
    expect(bashVerdict.action).toBe("allow"); // T-5-14 后由虚拟操作拦
  });
});
