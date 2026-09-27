import { describe, expect, it } from "vitest";

import {
  JudgeBudgetTracker,
  JUDGE_INPUT_BUDGET_CHARS,
  JUDGE_REQUESTS_PER_SESSION,
  JUDGE_REVIEW_TIMEOUT_MS,
  JudgeUnavailableError,
  type JudgePort,
  type JudgeRequest,
  type JudgeVerdict,
} from "./judge-port.js";

/** 假判官：按剧本返回（判官本体 P2 C42 落位前的测试承载）。 */
function fakeJudge(script: JudgeVerdict[]): JudgePort & { calls: JudgeRequest[] } {
  const calls: JudgeRequest[] = [];
  let i = 0;
  return {
    name: "fake-judge",
    calls,
    async review(request) {
      calls.push(request);
      const verdict = script[Math.min(i, script.length - 1)]!;
      i += 1;
      return verdict;
    },
  };
}

describe("C56 · 判官四件套接口面（T-P1-80）", () => {
  it("常量导出可复用：预算双面 + 超时常量（codex REVIEW_TIMEOUT 同款纪律）", () => {
    expect(JUDGE_INPUT_BUDGET_CHARS).toBeGreaterThan(0);
    expect(JUDGE_REQUESTS_PER_SESSION).toBeGreaterThan(0);
    // 刻意宽松（90s）——注释写明理由，上层复用不自行发明
    expect(JUDGE_REVIEW_TIMEOUT_MS).toBe(90_000);
  });

  it("JudgeBudgetTracker：次数与字符双面记账；耗尽 hasBudget=false", () => {
    const tracker = new JudgeBudgetTracker();
    expect(tracker.hasBudget()).toBe(true);
    tracker.expend(1_000);
    expect(tracker.usage()).toEqual({ requests: 1, chars: 1_000 });
    expect(tracker.hasBudget()).toBe(true);
    // 字符耗尽（单次超上界）
    tracker.expend(JUDGE_INPUT_BUDGET_CHARS);
    expect(tracker.hasBudget()).toBe(false);
    // 次数耗尽面
    const t2 = new JudgeBudgetTracker();
    for (let i = 0; i < JUDGE_REQUESTS_PER_SESSION; i++) t2.expend(10);
    expect(t2.hasBudget()).toBe(false);
  });

  it("abstain 是显式闭集值（不是缺省吞没）——假判官三值均可回", async () => {
    const judge = fakeJudge([
      { outcome: "allow", reason: "读操作" },
      { outcome: "deny", reason: "rm 模式" },
      { outcome: "abstain", reason: "拿不准" },
    ]);
    await expect(judge.review({ tool: "bash", args: {}, sessionId: "s", askReason: "r" })).resolves.toMatchObject({ outcome: "allow" });
    await expect(judge.review({ tool: "bash", args: {}, sessionId: "s", askReason: "r" })).resolves.toMatchObject({ outcome: "deny" });
    await expect(judge.review({ tool: "bash", args: {}, sessionId: "s", askReason: "r" })).resolves.toMatchObject({ outcome: "abstain" });
  });

  it("JudgeUnavailableError 类型化 code 可路由（受管强制位的失败面）", () => {
    const err = new JudgeUnavailableError("bash");
    expect(err.code).toBe("JUDGE_UNAVAILABLE");
    expect(err.message).toContain("受管策略");
  });
});
