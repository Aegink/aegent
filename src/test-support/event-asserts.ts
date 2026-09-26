/**
 * 事件流断言方法（O7–O11，T-3-07）——在**真实事件流**上断言不变量，不写
 * 事件列表（O7；codex·compact.rs assert_compaction_uses_turn_lifecycle_id
 * 的形态：沿流推进的追踪器断言"关系"，新增事件类型不用改测试）。
 *
 * 四件套与落点：
 * 1. 不变量断言（O7）：expectTurnScoped / expectPaired / expectSingleTerminal
 *    ——实现自 T-P1-30 迁入 kernel 域（invariants.ts：不变量属于拥有流的域，
 *    服务注册表与测试断言共用同一实现），此处 re-export 保持既有 import 面。
 * 2. recv 超时 + 具名期望（O8）：recvWithTimeout / drainUntil——事件驱动测试
 *    最坏的失败是"挂住"，超时把它变成可读失败（超时原语复用 J22 的
 *    withTimeout：内层 promise 不被弃，无 unhandled rejection）。
 * 3. 人话失败（O9）：所有断言失败消息都是"违反了什么 + 现场定位（seq）"，
 *    不输出裸索引。
 * 4. 窗口头 + previous 差分（O10/O11）：落在快照工具（snapshots.ts）——
 *    GenerateInputSnapshot.header 记录"窗口为何在此结束"，previous 差分
 *    在序列化时现算（T-1-06 已定形，本卡在真实 loop 流上复证）。
 */

import { TimeoutError, withTimeout } from "../kernel/timeout.js";

export {
  expectPaired,
  expectSingleTerminal,
  expectTurnScoped,
} from "../kernel/invariants.js";

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
