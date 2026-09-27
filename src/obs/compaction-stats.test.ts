import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../kernel/events.js";
import { compactionStats } from "./compaction-stats.js";

let seq = 0;
const compaction = (fields: Partial<Extract<SessionEvent, { type: "compaction" }>> = {}): SessionEvent =>
  ({
    seq: ++seq,
    ts: 1_700_000_000_000 + seq,
    turn: 1,
    type: "compaction",
    summary: "摘要",
    retainedTail: 0,
    tokensBefore: 1000,
    ...fields,
  }) as SessionEvent;

describe("compactionStats（L8/T-P1-92 压缩可统计可归因）", () => {
  it("六维分列计数 + failures 归因列表", () => {
    const stats = compactionStats([
      compaction({ trigger: "auto", reason: "context_limit", phase: "pre_turn", status: "completed" }),
      compaction({ trigger: "auto", reason: "model_downshift", phase: "mid_turn", status: "completed" }),
      compaction({ trigger: "manual", reason: "context_limit", phase: "mid_turn", status: "failed" }),
    ]);
    expect(stats.total).toBe(3);
    expect(stats.byTrigger).toEqual({ auto: 2, manual: 1 });
    expect(stats.byReason).toEqual({ context_limit: 2, model_downshift: 1 });
    expect(stats.byPhase).toEqual({ pre_turn: 1, mid_turn: 2 });
    expect(stats.byStatus).toEqual({ completed: 2, failed: 1 });
    expect(stats.failures).toEqual([{ seq: 3, reason: "context_limit" }]);
  });

  it("旧流缺省兼容：无六维字段的事件按词汇表缺省口径聚合（phase 编入 unrecorded）", () => {
    const stats = compactionStats([compaction()]); // P0 形状：无 trigger/phase/status
    expect(stats.total).toBe(1);
    expect(stats.byTrigger).toEqual({ auto: 1 });
    expect(stats.byReason).toEqual({ context_limit: 1 });
    expect(stats.byPhase).toEqual({ unrecorded: 1 });
    expect(stats.byStatus).toEqual({ completed: 1 }); // 缺省读作 completed（词汇表注释）
    expect(stats.failures).toEqual([]);
  });
});
