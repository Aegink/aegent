/**
 * 审计报表测试（L6/T-P2-515）——三维度聚合 + 空窗零除防呆 + 时间窗过滤。
 */

import { describe, expect, it } from "vitest";

import { auditReport } from "./audit-report.js";

/** approval 审计记录的测试构造（形状与 audit-fields.ts 对齐）。 */
function approval(phase: "asked" | "settled" | "timed-out", tool: string, at: number, outcome?: "approved" | "denied") {
    return { kind: "approval", phase, requestId: `r-${tool}-${at}`, tool, surface: "cli", approver: "user", at, ...(outcome ? { outcome } : {}) };
}

/** judge 审计记录的测试构造（形状与 judge.ts 对齐）。 */
function judge(tool: string, at: number, outcome: "allow" | "deny" | "abstain") {
    return { kind: "judge", phase: "reviewed", tool, at, outcome };
}

describe("审计报表（L6）", () => {
  it("三维度聚合：危险操作按 tool 分组 + 审批率 + 判官介入率", () => {
    const report = auditReport([
      approval("asked", "bash", 100),
      approval("asked", "bash", 200),
      approval("asked", "edit", 300),
      approval("settled", "bash", 250, "approved"),
      approval("settled", "bash", 260, "denied"),
      approval("settled", "edit", 350, "approved"),
      approval("timed-out", "edit", 400),
      judge("bash", 150, "deny"),
    ]);
    // 维度①危险操作计数（asked 按 tool 分组，escalations 降序）
    expect(report.approvalRequests).toBe(3);
    expect(report.byTool).toEqual([
      { tool: "bash", escalations: 2, approved: 1, denied: 1, timedOut: 0 },
      { tool: "edit", escalations: 1, approved: 1, denied: 0, timedOut: 1 },
    ]);
    // 维度②审批率：settled 3 + timed-out 1 = 4 / asked 3（同一次审批多记录——
    // asked/settled 是同一 requestId 的两 phase）——完成率按请求数计
    expect(report.approvalRate).toBeCloseTo(4 / 3);
    expect(report.approved).toBe(2);
    expect(report.denied).toBe(1);
    expect(report.timedOut).toBe(1);
    // 维度③判官介入率：judge reviewed 1 / asked 3
    expect(report.judgeInvolvementRate).toBeCloseTo(1 / 3);
    expect(report.judgeRecords).toBe(1);
  });

  it("空窗零除防呆：零记录与无审批请求时比率为 null（不 NaN）", () => {
    const empty = auditReport([]);
    expect(empty.approvalRate).toBeNull();
    expect(empty.judgeInvolvementRate).toBeNull();
    expect(empty.byTool).toEqual([]);
    // 有记录但无审批请求（只有 judge）——介入率 null 而非 0/0
    const onlyJudge = auditReport([judge("bash", 100, "allow")]);
    expect(onlyJudge.approvalRate).toBeNull();
    expect(onlyJudge.judgeInvolvementRate).toBeNull();
    expect(onlyJudge.judgeRecords).toBe(1);
  });

  it("时间窗过滤：fromTs/toTs 含界——窗外记录不进聚合", () => {
    const report = auditReport(
      [
        approval("asked", "bash", 100),
        approval("asked", "bash", 200),
        approval("settled", "bash", 150, "approved"),
        approval("asked", "edit", 900),
      ],
      { fromTs: 150, toTs: 300 },
    );
    expect(report.approvalRequests).toBe(1); // at=200 的 bash
    expect(report.approved).toBe(1); // at=150 含界
    expect(report.byTool.map((r) => r.tool)).toEqual(["bash"]);
  });
});
