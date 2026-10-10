/**
 * 启动期对账（Q5，T-8-04）——把上次崩溃遗留的"进行中"标记全部改为
 * interrupted 并细分错误码。行为形状取 pi-desktop·db/migrations.rs 的
 * boot_maintenance（`SET status = 'aborted' WHERE status = 'running'` +
 * PLAN_APPROVAL_INTERRUPTED / PLAN_EXECUTION_INTERRUPTED 细分码；🔴 只学
 * 行为，不摘 SQL——🔴 专有仓库纪律）。
 *
 * 与 pi-desktop 的落点差异（架构使然，非偏离）：事件源架构没有可 UPDATE 的
 * status 列——事件是唯一真相且 append-only（不变量 1）。对账 = **追加闭合
 * 事件**：未闭合的 step 落 step/end、未闭合的 turn 落 turn/end{interrupted}
 * （词汇表 §3.3 预留的崩溃孤儿闭合变体，loop 永不实时发出）。"崩溃说做了 /
 * 事件说没做"由此在启动期闭合：闭合后的投影干净，新 prompt 开新轮——
 * **绝不重放**旧进程的工作（M8 纪律的前身；队列在内存里随进程消亡，事件流
 * 里的孤儿 turn 一经闭合即成历史事实，没有任何路径会续跑它）。
 *
 * 细分错误码（对账报告的机器面；事件流上分类就是 turn/end 的 kind）：
 *   STEP_INTERRUPTED —— 未闭合的模型 step（崩溃在 step 中途）
 *   TURN_INTERRUPTED —— 未闭合的 turn（崩溃在轮收尾前后）
 *   job 级对账对象（PLAN_APPROVAL_INTERRUPTED / PLAN_EXECUTION_INTERRUPTED
 *   同款细分）随 M3（P1）的 job 概念扩展本清单——P0 尚无 job。
 *
 * 重启路径（本卡验收的另一半）：杀进程重启走 store.restore（seq 断层即抛，
 * 绝不带病重建），恢复后的流整体 fold 一遍，openTurn/openSteps 即崩溃残留
 * ——reconcileBootState 消费它们。调用次序：restore → reconcile → 服务。
 */

import type { NewSessionEvent } from "../core/index.js";
import { Projector } from "./project.js";
import type { SessionStore } from "./store.js";

/** 未闭合的模型 step（崩溃在 step 中途）。 */
export const STEP_INTERRUPTED_CODE = "STEP_INTERRUPTED";
/** 未闭合的 turn（崩溃在轮收尾前后）。 */
export const TURN_INTERRUPTED_CODE = "TURN_INTERRUPTED";

export interface BootReconciliation {
  sessionId: string;
  /** 对账追加的闭合事件里闭合的 step 数。 */
  closedSteps: number;
  /** 闭合的 turn 数（0 = 干净启动）。 */
  closedTurns: number;
  /** 细分错误码（按发现的对象类型；空数组 = 无崩溃残留）。 */
  codes: readonly string[];
}

/** 可续跑的崩溃轮：M3/T-P1-86 的 resume 目标定位。 */
export interface InterruptedTurnInfo {
  /** 崩溃轮号（resume 开的新轮号 = 本值 + 1 起算，由 loop 分配）。 */
  turn: number;
  /** 崩溃前该轮的原始输入（resume 以它重开新轮——codex interrupted_turn "捕获已记录输入" 的同构）。 */
  content: string;
  /** 原输入的 promptId（A12 关联键——回执面透出，消费者可对照新旧轮）。 */
  promptId?: string;
}

/**
 * 对一次会话做启动期对账：发现未闭合 step/turn → 追加闭合事件（append-only，
 * 绝不删改历史）→ 返回细分错误码报告。幂等：闭合后的流再跑一遍是 no-op
 * （投影无开合残留，零追加）。
 */
export function reconcileBootState(store: SessionStore, sessionId: string): BootReconciliation {
  const { projection } = Projector.fold(store.load(sessionId));
  const codes: string[] = [];
  const batch: NewSessionEvent[] = [];

  // 事件次序：step 闭合先于 turn 闭合（投影的配平要求）
  for (const step of projection.openSteps) {
    if (projection.openTurn === null) break; // 不可达（step 必在 turn 内），防御
    batch.push({ type: "step/end", turn: projection.openTurn.turn, step });
    codes.push(STEP_INTERRUPTED_CODE);
  }
  if (projection.openTurn !== null) {
    batch.push({
      type: "turn/end",
      turn: projection.openTurn.turn,
      reason: { kind: "interrupted" },
    });
    codes.push(TURN_INTERRUPTED_CODE);
  }
  if (batch.length > 0) {
    store.append(sessionId, batch);
  }
  return {
    sessionId,
    closedSteps: codes.filter((c) => c === STEP_INTERRUPTED_CODE).length,
    closedTurns: codes.filter((c) => c === TURN_INTERRUPTED_CODE).length,
    codes,
  };
}

/**
 * 定位可续跑的崩溃轮（M3/T-P1-86）：**最新轮以 interrupted 收束**时返回
 * 该轮的原始输入，否则 null。语义边界：
 * - interrupted 只由对账发出（loop 永不实时发出——头注释），所以命中即"崩溃轮"；
 * - 最新轮若已 completed/aborted/blocked/error，说明用户已继续对话——旧
 *   interrupted 轮就此过期（续跑一个用户早已绕开的轮是时间倒流），返回 null；
 * - 该轮的首条 user/message = 崩溃前的输入（runTurn 开轮落盘的那条；
 *   steer/injected 注入都在其后）。
 *
 * 前置：先 reconcileBootState（resume 是显式动作，其前置就是对账闭合——
 * 未闭合的流里没有 turn/end{interrupted} 可找，本函数自然返回 null）。
 */
export function findInterruptedTurn(store: SessionStore, sessionId: string): InterruptedTurnInfo | null {
  const events = store.load(sessionId);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type !== "turn/end") continue;
    if (event.reason.kind !== "interrupted") return null;
    const turn = event.turn;
    for (const e of events) {
      if (e.type === "user/message" && e.turn === turn) {
        return { turn, content: e.message.content, ...(e.promptId !== undefined ? { promptId: e.promptId } : {}) };
      }
    }
    return null; // interrupted 轮无输入（不可达防御）
  }
  return null;
}
