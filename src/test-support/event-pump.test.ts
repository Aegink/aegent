/**
 * 测试事件泵自测（O29/T-P2-507）——三条约定各一正一反。
 */

import { describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { UnexpectedEventError, createStrictPump, isErrorFact } from "./event-pump.js";

let seq = 0;
function mk(event: NewSessionEvent): SessionEvent {
  seq += 1;
  return { ...event, seq, ts: 1_700_000_000_000 } as SessionEvent;
}

describe("测试事件泵（O29）", () => {
  it("错误类事实 fail-loud：tool/result isError 与 turn/end error 都 throw", () => {
    const pump = createStrictPump({ ignore: ["step/start", "step/end"] });
    const events: SessionEvent[] = [
      mk({ type: "turn/start", turn: 1 }),
      mk({ type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "boom", isError: true } }),
    ];
    expect(() => pump(events)).toThrow(UnexpectedEventError);
    expect(() => pump(events)).toThrow(/O29 fail-loud/);

    const errEnd: SessionEvent[] = [
      mk({ type: "turn/end", turn: 1, reason: { kind: "error", error: { code: "X", message: "E" } } }),
    ];
    expect(() => pump(errEnd)).toThrow(/turn\/end/);
  });

  it("显式忽略臂：ignore 里的已知事件跳过不进 onEvent；忽略臂含未知类型即构造失败", () => {
    const seen: string[] = [];
    const pump = createStrictPump({
      onEvent: (e) => seen.push(e.type),
      ignore: ["step/start", "step/end", "tool/progress"],
    });
    const handled = pump([
      mk({ type: "step/start", turn: 1, step: 1 }),
      mk({ type: "user/message", turn: 1, message: { content: "q" }, source: "user" }),
      mk({ type: "tool/progress", turn: 1, step: 1, callId: "c1", seqInCall: 1, message: "进行中" }),
      mk({ type: "step/end", turn: 1, step: 1 }),
    ]);
    expect(seen).toEqual(["user/message"]);
    expect(handled).toBe(1);
    expect(() => createStrictPump({ ignore: ["nope/unknown" as never] })).toThrow(UnexpectedEventError);
  });

  it("未知事件类型 throw（比 codex 静默通配更严——C14 闭面外即异常）", () => {
    const pump = createStrictPump({});
    const rogue = { type: "alien/event", seq: 1, ts: 1, turn: 1 } as unknown as SessionEvent;
    expect(() => pump([rogue])).toThrow(/EVENT_TYPES 闭面外/);
  });

  it("allowErrors 显式放行错误事实（测试错误恢复路径的写出来的决定）；isErrorFact 判定面", () => {
    const pump = createStrictPump({ allowErrors: true });
    expect(
      pump([
        mk({ type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "boom", isError: true } }),
      ]),
    ).toBe(1);
    const okResult: SessionEvent = mk({
      type: "tool/result",
      turn: 1,
      step: 1,
      callId: "c2",
      message: { content: "ok" },
    });
    expect(isErrorFact(okResult)).toBe(false);
  });
});
