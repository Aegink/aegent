/**
 * 切点工具调用-结果配平（F17，T-7-05）——压缩改变表面位置，安全切点从
 * tool/call↔tool/result **内容**在当前顺序下现算，绝不依赖可能被重写/说谎的
 * step 标记（dsh·tool-pairing.ts:2-5 的纪律）。配平不保证的切点会把一个
 * assistant 工具调用与其结果劈开——模型历史出现孤儿 tool 消息，续话被拒。
 *
 * 增量状态机：`inProgress` 计数随流推进——tool/call +1、tool/result -1、
 * 其余 0；计数为 0 的位置（每条事件之后）是配平切点；计数变负 = 孤立
 * tool/result = 流损坏，抛 `ToolPairingError` 不猜（dsh:56/:60 的 corrupt
 * surface 同款）。`advancePairing` 是纯函数式增量（状态显式传，适配事件源
 * 的 append 流；dsh 的 WeakMap+generation cache 是其表面重写场景的等价物）。
 *
 * 消费方：`compaction.ts` 的切点选择（user/system 边界候选不配平时自动
 * 回退到最近配平点——悬挂 tool/call 崩溃残留的保守方向：保留更多原文，
 * 绝不劈开配对）。
 */

import type { SessionEvent } from "../kernel/events.js";

/** 增量配平状态：已扫描到 lastSeq（0 = 流起点之前），仍开着的 tool/call 数 inProgress。 */
export interface PairingState {
  lastSeq: number;
  inProgress: number;
}

export class ToolPairingError extends Error {
  constructor(seq: number, reason: string) {
    super(`tool-pairing：${reason}（seq=${seq}）——切点配平要求 tool/call↔tool/result 按内容成对`);
    this.name = "ToolPairingError";
  }
}

export function initialPairingState(): PairingState {
  return { lastSeq: 0, inProgress: 0 };
}

function eventDelta(e: SessionEvent): 1 | 0 | -1 {
  if (e.type === "tool/call") return 1;
  if (e.type === "tool/result") return -1;
  return 0;
}

/**
 * 增量推进（纯函数）：events 必须紧接 state.lastSeq 连续（事件源的 append
 * 顺序），断档即抛——防调用方跳过片段造成假配平。
 */
export function advancePairing(
  state: PairingState,
  events: readonly SessionEvent[],
): PairingState {
  let { lastSeq, inProgress } = state;
  for (const e of events) {
    if (e.seq !== lastSeq + 1) {
      throw new ToolPairingError(e.seq, `增量推进断档：期望 seq ${lastSeq + 1}，实际 ${e.seq}`);
    }
    lastSeq = e.seq;
    inProgress += eventDelta(e);
    if (inProgress < 0) {
      throw new ToolPairingError(e.seq, "tool/result 没有配对的前置 tool/call（corrupt surface）");
    }
  }
  return { lastSeq, inProgress };
}

/**
 * 全流扫描：返回与 events 等长的布尔数组，`cuts[i]` = 第 i 条事件**之后**
 * 的切点是否配平（到该位置为止所有 tool/call 已闭合）。
 */
export function balancedCutAfter(events: readonly SessionEvent[]): boolean[] {
  const cuts: boolean[] = [];
  let inProgress = 0;
  for (const e of events) {
    inProgress += eventDelta(e);
    if (inProgress < 0) {
      throw new ToolPairingError(e.seq, "tool/result 没有配对的前置 tool/call（corrupt surface）");
    }
    cuts.push(inProgress === 0);
  }
  return cuts;
}

/**
 * 从 `toSeq`（含）往回找最近的配平切点：返回值 P 表示"P 之后切"安全
 * （seq ≤ P 的一切可作为摘要覆盖区间，且不会劈开工具配对）。流起点（0）
 * 恒配平兜底。孤立 tool/result 的损坏流当场抛错。
 */
export function latestBalancedCutAtOrBefore(
  events: readonly SessionEvent[],
  toSeq: number,
): number {
  let best = 0;
  let inProgress = 0;
  for (const e of events) {
    if (e.seq > toSeq) break;
    inProgress += eventDelta(e);
    if (inProgress < 0) {
      throw new ToolPairingError(e.seq, "tool/result 没有配对的前置 tool/call（corrupt surface）");
    }
    if (inProgress === 0) best = e.seq;
  }
  return best;
}
