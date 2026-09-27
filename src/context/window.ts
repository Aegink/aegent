/**
 * 上下文窗口编号化（F25/T-P1-99）——窗口身份从事件流推导的 first-class 概念：
 * 编号（window_number，已结算压缩数单调递增）+ 身份三元组（first/previous/
 * current——codex·state/auto_compact_window.rs `AutoCompactWindowIds` 的推导
 * 版）。codex 用 UUID now_v7 + 显式 state 机 + restore() 恢复；我方事件源单
 * 一事实源：**压缩事件本体就是持久化的窗口元数据**——事件 seq 即窗 id、
 * retainedTail 即窗界，恢复恒等不需要显式恢复调用（同一条流两次推导逐字段
 * 相等，流即状态）。
 *
 * 切换权威口径与 new-window.ts 同源：只认 status 缺省/completed 的**已结算**
 * 压缩（started 崩溃残留与 failed 不开新窗——以其换窗会让预算提醒/时间注入
 * 绑定到"没有摘要的窗口"）；session/revert 生效时窗口身份随有效视窗回退
 * （effectiveEvents 口径——revert 掉压缩即回到无压缩状态）。
 *
 * 消费方：M10 预算提醒的 windowId（T-7-08 的"压缩后即换窗"派生串归一到本
 * 模块）、F7 时间注入的新窗判定（T-P1-103）。窗口号/身份不进事件载荷
 * （F25 零词汇表扩展——展卡核对结论 ①）。
 */

import type { SessionEvent } from "../kernel/events.js";
import { effectiveEvents } from "../session/messages.js";

/** 窗口身份：编号 + 三元组（无压缩时 currentId = 0 表示初始窗）。 */
export interface WindowIdentity {
  /** 窗口号 = 已结算压缩数（0 = 初始窗）；每次已结算压缩单调 +1。 */
  number: number;
  /** 当前窗 id = 最新已结算 compaction 的事件 seq；初始窗 = 0。 */
  currentId: number;
  /** 前一窗 id（已结算压缩 ≥2 时存在）。 */
  previousId?: number;
  /** 首窗 id = 首个已结算 compaction 的 seq（无压缩时缺席）。 */
  firstId?: number;
}

function isSettledCompaction(e: SessionEvent): boolean {
  return (
    e.type === "compaction" && (e.status === undefined || e.status === "completed")
  );
}

/** 从事件流推导当前窗口身份（纯函数——恢复恒等：同流两次调用逐字段相等）。 */
export function currentWindow(events: readonly SessionEvent[]): WindowIdentity {
  const seqs: number[] = [];
  for (const e of effectiveEvents(events)) {
    if (isSettledCompaction(e)) seqs.push(e.seq);
  }
  const n = seqs.length;
  if (n === 0) return { number: 0, currentId: 0 };
  return {
    number: n,
    currentId: seqs[n - 1]!,
    ...(n >= 2 ? { previousId: seqs[n - 2] } : {}),
    firstId: seqs[0],
  };
}
