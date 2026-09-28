/**
 * 测试事件泵（O29/T-P2-507）——fixture 流处理约定，三条：
 *   1. **错误类事实 fail-loud**（codex·compact.rs:468 `EventMsg::Error(e) =>
 *      panic!` 同构）：tool/result isError=true、turn/end reason.kind="error"
 *      一律 throw——测试在错误悄悄发生后继续跑只会得到更远的假象；
 *   2. **已知无关事件走显式忽略臂**（`ignore` 数组——写出来的决定，不是
 *      遗漏；codex 末尾显式 `_ => {}` 的同旨）；
 *   3. **未知事件类型 throw**（比 codex 的静默通配更严——记档理由：我方
 *      EVENT_TYPES 闭面（C14）已保证已知集，fixture 流里出现闭面外类型即
 *      异常，静默会掩盖词汇表漂移）。
 * 渐进接入：既有流式 fixture 按触碰顺序接线（全面切换随触碰记档——test-policy）。
 */

import { EVENT_TYPES, type SessionEvent, type SessionEventType } from "../kernel/events.js";

/** 泵抛出的失败（message 含事件类型与序号——fail-loud 且可定位）。 */
export class UnexpectedEventError extends Error {
  constructor(
    message: string,
    public readonly eventType: string,
  ) {
    super(message);
    this.name = "UnexpectedEventError";
  }
}

export interface StrictPumpOptions {
  /** 关注事件的处理臂（switch 主臂——只收非忽略事件）。 */
  onEvent?: (event: SessionEvent) => void;
  /** 显式忽略臂：已知且与本测试无关的事件类型（必须 ⊆ EVENT_TYPES 闭面）。 */
  ignore?: readonly SessionEventType[];
  /**
   * 放行错误类事实（默认 false = fail-loud）。测试**错误恢复路径**本身时
   * 显式打开——打开与否也是写出来的决定。
   */
  allowErrors?: boolean;
}

const isSessionEventType = (type: string): type is SessionEventType =>
  (EVENT_TYPES as readonly string[]).includes(type);

/** 错误类事实的词汇表内判定（事件类型闭面内没有独立 error 事件——错误是载荷级事实）。 */
export function isErrorFact(event: SessionEvent): boolean {
  if (event.type === "tool/result") return event.message.isError === true;
  if (event.type === "turn/end") return event.reason.kind === "error";
  return false;
}

export type StrictPump = (events: readonly SessionEvent[]) => number;

/**
 * 严格泵：对事件流按三条约定推进，返回处理（非忽略）的事件数。
 * 期望外错误 / 未知类型 / 忽略臂外的意外事件都由消费方 onEvent 自行取舍——
 * 泵只强制"错误 fail-loud + 忽略必须显式 + 未知必须拒绝"三条纪律。
 */
export function createStrictPump(options: StrictPumpOptions = {}): StrictPump {
  const ignore = new Set<string>(options.ignore ?? []);
  for (const type of ignore) {
    if (!isSessionEventType(type)) {
      throw new UnexpectedEventError(`忽略臂含词汇表闭面外的事件类型：${type}`, type);
    }
  }
  return (events) => {
    let handled = 0;
    for (const event of events) {
      if (!isSessionEventType(event.type)) {
        throw new UnexpectedEventError(
          `未知事件类型：${JSON.stringify(event.type)}（EVENT_TYPES 闭面外——词汇表漂移或坏 fixture）`,
          event.type,
        );
      }
      if (!options.allowErrors && isErrorFact(event)) {
        throw new UnexpectedEventError(
          `期望外的错误类事实：${event.type}（seq=${event.seq}）——O29 fail-loud；测试错误恢复路径请显式 allowErrors`,
          event.type,
        );
      }
      if (ignore.has(event.type)) continue;
      options.onEvent?.(event);
      handled += 1;
    }
    return handled;
  };
}
