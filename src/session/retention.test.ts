import { describe, expect, it } from "vitest";

import {
  MS_PER_DAY,
  RETENTION_POLICY,
  resolveRetentionPolicy,
  retentionCutoff,
  type RetentionCutoff,
  type RetentionPolicy,
} from "./retention.js";

describe("保留策略常量（Q6/T-P2-101）", () => {
  it("缺省策略形状：审计 90 天 / 任务运行记录 100 条（pi-desktop 同值）", () => {
    expect(RETENTION_POLICY).toEqual({ auditDays: 90, taskRunRecords: 100 });
    // 冻结面：消费方不得就地改写（覆盖走 resolveRetentionPolicy 显式参数）
    expect(Object.isFrozen(RETENTION_POLICY)).toBe(true);
  });

  it("cutoff 计算：auditBefore = now − 90 天（毫秒口径），keep 条数直通", () => {
    const now = 1_800_000_000_000;
    const cutoff = retentionCutoff(now);
    expect(cutoff.auditBefore).toBe(now - 90 * MS_PER_DAY);
    expect(cutoff.keepLatestTaskRuns).toBe(100);
    // 常量与计算的一致面：cutoff 不复制数值，取自同一策略来源
    expect(cutoff.auditBefore).toBe(now - RETENTION_POLICY.auditDays * MS_PER_DAY);
    expect(cutoff.keepLatestTaskRuns).toBe(RETENTION_POLICY.taskRunRecords);
  });

  it("显式覆盖：部分覆盖面（未覆盖字段取缺省），cutoff 随覆盖值", () => {
    const policy = resolveRetentionPolicy({ auditDays: 7 });
    expect(policy).toEqual({ auditDays: 7, taskRunRecords: 100 });
    const now = 1_000_000_000_000;
    expect(retentionCutoff(now, policy)).toEqual({
      auditBefore: now - 7 * MS_PER_DAY,
      keepLatestTaskRuns: 100,
    });
    expect(resolveRetentionPolicy({ taskRunRecords: 5 })).toEqual({
      auditDays: 90,
      taskRunRecords: 5,
    });
  });

  it("坏策略 fail-closed：负数/非整数/NaN 拒绝（不按 0 清理）", () => {
    expect(() => resolveRetentionPolicy({ auditDays: -1 })).toThrow(TypeError);
    expect(() => resolveRetentionPolicy({ taskRunRecords: 1.5 })).toThrow(TypeError);
    expect(() => resolveRetentionPolicy({ auditDays: Number.NaN })).toThrow(TypeError);
    expect(() => retentionCutoff(0, { auditDays: 90, taskRunRecords: -5 })).toThrow(TypeError);
  });

  it("消费契约（Q4 清理器消费面；类型面钉死）", () => {
    // 清理器消费的就是这两个形状：策略（取 keep 条数）+ cutoff（取审计下界）
    const policy: RetentionPolicy = resolveRetentionPolicy();
    const cutoff: RetentionCutoff = retentionCutoff(123, policy);
    expect(typeof cutoff.auditBefore).toBe("number");
    expect(typeof cutoff.keepLatestTaskRuns).toBe("number");
    // 消费方界面保持最小：字段名即语义（auditBefore 是时间下界、keep 是条数）
    expect(Object.keys(cutoff).sort()).toEqual(["auditBefore", "keepLatestTaskRuns"]);
  });
});
