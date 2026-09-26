/**
 * 事件流断言方法（O7–O11，T-3-07）——在**真实事件流**上断言不变量，不写
 * 事件列表（O7；codex·compact.rs assert_compaction_uses_turn_lifecycle_id
 * 的形态：沿流推进的追踪器断言"关系"，新增事件类型不用改测试）。
 *
 * 四件套与落点：
 * 1. 不变量断言（O7）：expectTurnScoped（同 turn 共享轮号、step 连续）、
 *    expectPaired（step 与 tool 两种配平）、expectSingleTerminal（终态恰一）。
 * 2. recv 超时 + 具名期望（O8）：recvWithTimeout / drainUntil——事件驱动测试
 *    最坏的失败是"挂住"，超时把它变成可读失败（超时原语复用 J22 的
 *    withTimeout：内层 promise 不被弃，无 unhandled rejection）。
 * 3. 人话失败（O9）：所有断言失败消息都是"违反了什么 + 现场定位（seq）"，
 *    不输出裸索引。
 * 4. 窗口头 + previous 差分（O10/O11）：落在快照工具（snapshots.ts）——
 *    GenerateInputSnapshot.header 记录"窗口为何在此结束"，previous 差分
 *    在序列化时现算（T-1-06 已定形，本卡在真实 loop 流上复证）。
 */

import type { SessionEvent } from "../kernel/events.js";
import { TimeoutError, withTimeout } from "../kernel/timeout.js";

// ---------------------------------------------------------------------------
// O7：不变量断言（输入 = 真实事件流；失败 = 一句人话 + 现场定位）
// ---------------------------------------------------------------------------

/**
 * turn 作用域不变量：turn 从 1 连续编号、不嵌套、不悬挂；turn 作用域事件
 * 归属当前开启的轮；轮内 step 从 1 连续递增。session/revert、model/switch
 * 与 todo/update 是会话级元事件，不参与本检查；compaction / checkpoint /
 * request/header 只声明 turn 归属、不要求轮开启（与投影器 applyValidation
 * 的判定一致——压缩合法地落在轮外，如 turn 收尾后的 PreTurn 压缩）。
 */
export function expectTurnScoped(events: readonly SessionEvent[]): void {
  let expectedTurn = 0;
  let openTurn: number | null = null;
  const stepCounters = new Map<number, number>();
  for (const e of events) {
    if (e.type === "session/revert" || e.type === "model/switch" || e.type === "todo/update") {
      continue;
    }
    if (e.type === "turn/start") {
      if (openTurn !== null) {
        throw new Error(
          `turn ${e.turn} 的 turn/start（seq=${e.seq}）落在未闭合的 turn ${openTurn} 内——用户轮不允许嵌套`,
        );
      }
      expectedTurn += 1;
      if (e.turn !== expectedTurn) {
        throw new Error(
          `turn/start 跳号：期望 turn ${expectedTurn}，实际 turn ${e.turn}（seq=${e.seq}）——轮号必须从 1 连续递增`,
        );
      }
      openTurn = e.turn;
      stepCounters.set(e.turn, 0);
      continue;
    }
    if (e.type === "turn/end") {
      if (openTurn !== e.turn) {
        throw new Error(
          `turn/end（seq=${e.seq}）要闭合 turn ${e.turn}，但当前开启的是 ${openTurn ?? "（无）"}——闭合必须针对开启中的轮`,
        );
      }
      openTurn = null;
      continue;
    }
    if (e.type === "step/start") {
      if (openTurn !== e.turn) {
        throw new Error(
          `事件 ${e.type}（seq=${e.seq}）声称属于 turn ${e.turn}，但当前开启的是 ${openTurn ?? "（无）"}——轮作用域事件必须归属已开启的轮`,
        );
      }
      const expectedStep = (stepCounters.get(e.turn) ?? 0) + 1;
      if (e.step !== expectedStep) {
        throw new Error(
          `turn ${e.turn} 的 step/start 跳号：期望 step ${expectedStep}，实际 ${e.step}（seq=${e.seq}）——轮内 step 必须从 1 连续递增`,
        );
      }
      stepCounters.set(e.turn, expectedStep);
      continue;
    }
    // step 作用域的其余事件（step/end / message / tool.*）要求轮开启；
    // compaction / checkpoint / request/header 只带 turn 归属、不要求轮开启。
    const requiresOpenTurn =
      e.type === "step/end" ||
      e.type === "user/message" ||
      e.type === "system/message" ||
      e.type === "assistant/message" ||
      e.type === "assistant/attempt" ||
      e.type === "tool/call" ||
      e.type === "tool/result";
    if (requiresOpenTurn && openTurn !== e.turn) {
      throw new Error(
        `事件 ${e.type}（seq=${e.seq}）声称属于 turn ${e.turn}，但当前开启的是 ${openTurn ?? "（无）"}——轮作用域事件必须归属已开启的轮`,
      );
    }
  }
  if (openTurn !== null) {
    throw new Error(
      `事件流结束时 turn ${openTurn} 仍开启（没有 turn/end）——悬挂轮；崩溃残留应由恢复路径以 interrupted 闭合`,
    );
  }
}

/**
 * 成对不变量。openType="step/start"：step/start ↔ step/end 按 turn+step 配平；
 * openType="tool/call"：tool/call ↔ tool/result 按 callId 配平。
 */
export function expectPaired(
  events: readonly SessionEvent[],
  openType: "step/start" | "tool/call",
): void {
  if (openType === "step/start") {
    const open = new Map<string, number>();
    for (const e of events) {
      if (e.type === "step/start") {
        const key = `${e.turn}:${e.step}`;
        if (open.has(key)) {
          throw new Error(
            `step ${e.step}（turn ${e.turn}）重复开启：seq=${open.get(key)} 与 seq=${e.seq}——同一 step 不能开两次`,
          );
        }
        open.set(key, e.seq);
      } else if (e.type === "step/end") {
        const key = `${e.turn}:${e.step}`;
        if (!open.has(key)) {
          throw new Error(
            `step/end（turn ${e.turn} step ${e.step}，seq=${e.seq}）没有对应的 step/start——step 事件必须成对出现`,
          );
        }
        open.delete(key);
      }
    }
    if (open.size > 0) {
      const detail = [...open.entries()]
        .map(([k, seq]) => `turn/step ${k}（开启于 seq=${seq}）`)
        .join("、");
      throw new Error(
        `${open.size} 个 step 未闭合：${detail}——step/start 与 step/end 必须成对`,
      );
    }
    return;
  }

  const open = new Map<string, { seq: number; name: string }>();
  for (const e of events) {
    if (e.type === "tool/call") {
      if (open.has(e.callId)) {
        throw new Error(
          `callId=${e.callId} 的 tool/call 重复（seq=${e.seq}）——同一调用只应记录一次`,
        );
      }
      open.set(e.callId, { seq: e.seq, name: e.name });
    } else if (e.type === "tool/result") {
      if (!open.has(e.callId)) {
        throw new Error(
          `tool/result 的 callId=${e.callId}（seq=${e.seq}）没有前置 tool/call——调用与结果必须按 callId 配平`,
        );
      }
      open.delete(e.callId);
    }
  }
  if (open.size > 0) {
    const detail = [...open.values()]
      .map((v) => `${v.name}（开启于 seq=${v.seq}）`)
      .join("、");
    throw new Error(
      `${open.size} 个工具调用没有收到结果：${detail}——tool/call 与 tool/result 必须按 callId 配平`,
    );
  }
}

/**
 * 终态恰一：指定轮（缺省全流）恰有一条 turn/end，且它是该轮最后一条事件。
 * 中断/错误只改终态的 reason，绝不追加第二条终态。
 */
export function expectSingleTerminal(
  events: readonly SessionEvent[],
  turn?: number,
): void {
  const terminals = events.filter(
    (e) => e.type === "turn/end" && (turn === undefined || e.turn === turn),
  );
  const scope = turn === undefined ? "事件流" : `turn ${turn}`;
  if (terminals.length === 0) {
    throw new Error(
      `${scope}没有 turn/end 终态记录——每个用户轮必须恰好一条终止事件`,
    );
  }
  if (terminals.length > 1) {
    const seqs = terminals.map((t) => `seq=${t.seq}`).join("、");
    throw new Error(
      `${scope}出现 ${terminals.length} 条 turn/end（${seqs}）——终止记录必须恰一条（中断/错误只改 reason，不追加终态）`,
    );
  }
  const terminal = terminals[0]!;
  const after = events.filter((e) => e.seq > terminal.seq && e.turn === terminal.turn);
  if (after.length > 0) {
    const detail = after
      .map((e) => `${e.type}@seq=${e.seq}`)
      .join("、");
    throw new Error(
      `turn ${terminal.turn} 的终态（seq=${terminal.seq}）之后仍有 ${after.length} 条同轮事件：${detail}——终态必须是该轮最后一条事件`,
    );
  }
}

// ---------------------------------------------------------------------------
// O8：recv 超时 + 具名期望（对 AsyncIterable 事件源；也适用于进程协议流）
// ---------------------------------------------------------------------------

/**
 * 等到第一个命中谓词的条目并返回。超时或流提前结束都变成**具名的可读失败**
 * （O8：最坏的失败是挂住）。不命中的条目被消费丢弃——要收集请用 drainUntil。
 */
export async function recvWithTimeout<T>(
  source: AsyncIterable<T>,
  predicate: (item: T) => boolean,
  name: string,
  ms = 5_000,
): Promise<T> {
  const iter = source[Symbol.asyncIterator]();
  const deadline = Date.now() + ms;
  for (;;) {
    let result: IteratorResult<T>;
    try {
      result = await withTimeout(
        `RECV:${name}`,
        Math.max(deadline - Date.now(), 1),
        iter.next(),
      );
    } catch (e) {
      if (e instanceof TimeoutError) {
        throw new Error(
          `等待「${name}」超时（>${ms}ms）——事件驱动测试最坏的失败是挂住，超时把它变成可读失败`,
        );
      }
      throw e;
    }
    if (result.done) {
      throw new Error(`事件流在等到「${name}」之前已结束——检查被测方是否提前退出`);
    }
    if (predicate(result.value)) return result.value;
  }
}

export interface DrainResult<T> {
  /** 终态之前（含终态）的全部条目，按到达顺序。 */
  items: T[];
  /** 命中终态的那一条。 */
  last: T;
}

/** 收集直到终态命中（"发一条 prompt 收全事件"的形态）；超时语义同 recvWithTimeout。 */
export async function drainUntil<T>(
  source: AsyncIterable<T>,
  isTerminal: (item: T) => boolean,
  name: string,
  ms = 5_000,
): Promise<DrainResult<T>> {
  const iter = source[Symbol.asyncIterator]();
  const deadline = Date.now() + ms;
  const items: T[] = [];
  for (;;) {
    let result: IteratorResult<T>;
    try {
      result = await withTimeout(
        `DRAIN:${name}`,
        Math.max(deadline - Date.now(), 1),
        iter.next(),
      );
    } catch (e) {
      if (e instanceof TimeoutError) {
        throw new Error(
          `等待「${name}」超时（>${ms}ms，已收集 ${items.length} 条）——事件驱动测试最坏的失败是挂住，超时把它变成可读失败`,
        );
      }
      throw e;
    }
    if (result.done) {
      throw new Error(
        `事件流在等到「${name}」之前已结束（已收集 ${items.length} 条）——检查被测方是否提前退出`,
      );
    }
    items.push(result.value);
    if (isTerminal(result.value)) return { items, last: result.value };
  }
}
