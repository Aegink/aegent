/**
 * abort 看门狗（T3-1/W7 自 loop.ts 拆出——G8"看门狗不弃在途 promise"的
 * 独立可测面）：abortTimeoutMs 配置在位时武装定时器，超时强制收轮
 * （补闭合未闭合 step + turn/end{aborted} 落盘 + turnEnd flush + runState
 * 归位）。**不弃在途工具 promise**：强制的只是事件流终态（迟到的工具结果
 * 经 loop 的 forcedClosed 闸门丢弃落盘——A14 迟到结果闸门）。
 */

import type { CancelCause, NewSessionEvent } from "../../../core/index.js";
import { Projector } from "../session/project.js";
import type { SessionStore } from "../../index.js";
import type { Logger } from "../../skeleton/logger.js";
import type { RunState } from "../../skeleton/run-state.js";

/** 看门狗宿主钩子（loop 侧状态的最小读取面——避免双向依赖）。 */
export interface TurnWatchdogHost {
  /** 取消事实（arm 时在途的取消 cause；null = 正常路径已收轮，迟到看门狗不触发）。 */
  getCancelCause(): CancelCause | null;
  /** 在途轮号（warn 归因用；null = 无在途轮）。 */
  getActiveTurn(): number | null;
  /** 强制收轮后清 loop 侧的 activeTurnNumber（steer 准入权威面归位）。 */
  clearActiveTurn(): void;
}

export interface TurnWatchdogDeps {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly logger?: Logger;
  readonly runState?: RunState;
  /** abortTimeoutMs（毫秒）——缺省 undefined = 看门狗不武装（零行为变化）。 */
  readonly abortTimeoutMs?: number;
}

/**
 * abort 看门狗（AgentLoop 组合持有；arm/disarm 生命周期由 loop 在 turn
 * 开始/收轮处调用）。
 */
export class TurnWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private forced = false;

  constructor(
    private readonly deps: TurnWatchdogDeps,
    private readonly host: TurnWatchdogHost,
  ) {}

  /** 看门狗已强制收轮（loop 的迟到结果闸门读这个——A14）。 */
  get forcedClosed(): boolean {
    return this.forced;
  }

  arm(): void {
    const ms = this.deps.abortTimeoutMs;
    if (ms === undefined || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // 正常路径已收轮（abortTurn 清槽）→ 迟到的看门狗不触发
      if (this.host.getCancelCause() === null) return;
      this.deps.logger?.warn("abortTimeoutMs 看门狗超时——强制收轮", {
        timeoutMs: ms,
        turn: this.host.getActiveTurn(),
      });
      this.forced = true;
      this.forceCloseTurn();
    }, ms);
    // 看门狗不阻止进程自然退出
    this.timer.unref?.();
  }

  disarm(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 新 turn 复位强制收轮标记（与 cancelCause 同步——loop 在 turn 开始处调用）。 */
  resetForNewTurn(): void {
    this.forced = false;
    this.disarm();
  }

  /**
   * 看门狗超时的强制闭合（G8）：补闭合未闭合 step + turn/end{aborted} 落盘 +
   * turnEnd flush + runState 归位（failTurn 骨架的最小版——不经 turnEnd
   * 链：压缩层对"工具还挂在途"的轮无合法消费面，大声语义由 warn 承担）。
   * turn 已闭合（正常收轮先到）则 no-op。
   */
  private forceCloseTurn(): void {
    const { store, sessionId } = this.deps;
    const cause = this.host.getCancelCause();
    if (!cause) return;
    const proj = Projector.fold(store.load(sessionId)).projection;
    if (!proj.openTurn) return; // 已闭合（竞态防御）
    settleAbandonedToolCalls(store, sessionId, proj);
    const turn = proj.openTurn.turn;
    const openStep = [...proj.openSteps][0];
    // E18/T-P1-94：强制收轮路径同口径自报 produced（abort 部分产出照报）
    const produced = store
      .load(sessionId)
      .filter((ev) => ev.type === "assistant/message" && ev.turn === turn)
      .map((ev) => ev.seq);
    const events: NewSessionEvent[] = [
      ...(openStep !== undefined
        ? [{ type: "step/end" as const, turn, step: openStep }]
        : []),
      {
        type: "turn/end" as const,
        turn,
        reason: { kind: "aborted" as const, cause: copyCause(cause) },
        ...(produced.length > 0 ? { produced } : {}),
      },
    ];
    store.append(sessionId, events);
    void store.runFlushPoint("turnEnd", sessionId).catch(() => undefined);
    this.deps.runState?.markIdle(sessionId);
    this.host.clearActiveTurn();
  }
}

/**
 * dsh 语义（T3-2）："Abort records synthetic error results for skipped calls so
 * replay stays valid"——对投影中已 call 未 result 的在途调用补合成 isError
 * 结果：模型可见（意图未丢失）+ 事件流 replay 配平（G8 不弃 promise 的
 * 结算面——迟到的真实结果被 loop 迟到闸门丢弃，合成结果承担终态事实）。
 * 正常收轮路径调用为 no-op（工具全部结算时 openToolCalls 为空）。
 */
export function settleAbandonedToolCalls(
  store: SessionStore,
  sessionId: string,
  proj: { openToolCalls: Set<string>; toolCalls: Map<string, { turn: number; step: number }> },
): void {
  const open = [...proj.openToolCalls];
  if (open.length === 0) return;
  store.append(
    sessionId,
    open.map((callId) => {
      const info = proj.toolCalls.get(callId)!;
      return {
        type: "tool/result" as const,
        turn: info.turn,
        step: info.step,
        callId,
        message: { content: "", isError: true as const },
        error: {
          name: "LoopError",
          code: "TOOL_ABORTED",
          reason: "工具在途被 turn 中止（G8：不弃 promise，终态由合成结果承担）",
        },
      };
    }),
  );
}

/** CancelCause 深拷贝（与 loop.ts copyCause 同形状——cause 无 Error 引用面，逐字段展开）。 */
function copyCause(cause: CancelCause): CancelCause {
  switch (cause.kind) {
    case "hook":
      return {
        kind: "hook",
        reason: cause.reason,
        ...(cause.message !== undefined ? { message: cause.message } : {}),
      };
    case "user":
    case "parent":
    case "disposed":
    case "legacy":
      return { kind: cause.kind };
  }
}
