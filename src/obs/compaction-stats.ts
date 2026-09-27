/**
 * 压缩统计视图（L8，T-P1-92）——"压缩可统计、可归因"的读面。
 *
 * 纯函数聚合（从事件流；SQL 视图随 Q2 查询工具化需求——YAGNI 记档）：
 * 按 trigger/reason/phase/status 分列计数。status 缺省读作 "completed"
 * （旧流兼容口径，与词汇表注释一致）。
 */

import type { SessionEvent } from "../kernel/events.js";

export interface CompactionStats {
  total: number;
  byTrigger: Record<string, number>;
  byReason: Record<string, number>;
  byPhase: Record<string, number>;
  byStatus: Record<string, number>;
  /** failed 结算的列表（seq + reason——归因面）。 */
  failures: Array<{ seq: number; reason?: string }>;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function compactionStats(events: readonly SessionEvent[]): CompactionStats {
  const stats: CompactionStats = {
    total: 0,
    byTrigger: {},
    byReason: {},
    byPhase: {},
    byStatus: {},
    failures: [],
  };
  for (const event of events) {
    if (event.type !== "compaction") continue;
    stats.total += 1;
    bump(stats.byTrigger, event.trigger ?? "auto"); // 缺省读作 auto（唯一在位触发面）
    bump(stats.byReason, event.reason ?? "context_limit"); // 缺省读作 context_limit（词汇表注释）
    // 相位缺省无语义背书（旧流没记就是没记）——聚合到 unrecorded，不编造
    bump(stats.byPhase, event.phase ?? "unrecorded");
    const status = event.status ?? "completed"; // 旧流兼容（词汇表注释）
    bump(stats.byStatus, status);
    if (status === "failed") {
      stats.failures.push({ seq: event.seq, ...(event.reason !== undefined ? { reason: event.reason } : {}) });
    }
  }
  return stats;
}
