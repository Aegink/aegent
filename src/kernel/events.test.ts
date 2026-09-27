import { describe, expect, expectTypeOf, it } from "vitest";

import {
  assertJsonSafe,
  assertNever,
  EVENT_TYPES,
  type AssistantMessageEvent,
  type CancelCause,
  type CompactionEvent,
  type NewSessionEvent,
  type SessionEvent,
  type SessionEventType,
  type ToolResultEvent,
  type TokenUsage,
  type TurnEndEvent,
  type TurnEndReason,
} from "./events.js";

/** 每个成员一个最小合法样本（NewSessionEvent：不带 seq/ts，由 store 分配）。 */
const SAMPLES: NewSessionEvent[] = [
  { type: "turn/start", turn: 1 },
  { type: "turn/end", turn: 1, reason: { kind: "completed" } },
  { type: "step/start", turn: 1, step: 1 },
  { type: "step/end", turn: 1, step: 1 },
  { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
  { type: "system/message", turn: 1, step: 1, message: { content: "sys" } },
  {
    type: "assistant/message",
    turn: 1,
    step: 1,
    message: { content: "hello" },
    stream: [{ time: 0, chunk: { type: "text-delta", text: "hello" } }],
    usage: { inputTokens: 3, outputTokens: 2 },
  },
  {
    type: "assistant/attempt",
    turn: 1,
    step: 2,
    stream: [{ time: 5, chunk: { type: "done" } }],
  },
  {
    type: "assistant/retrying",
    turn: 1,
    step: 2,
    attempt: 0,
    delayMs: 500,
    error: { name: "ProviderHttpError", message: "429 too many requests", status: 429 },
  },
  {
    type: "tool/call",
    turn: 1,
    step: 1,
    callId: "c1",
    name: "bash",
    arguments: '{"cmd":"ls"}',
  },
  {
    type: "tool/result",
    turn: 1,
    step: 1,
    callId: "c1",
    message: { content: "ok" },
  },
  // T-P1-16 的工具进度事件（词汇表 17→18，见 l0-events.md §8 落地记录 6）
  {
    type: "tool/progress",
    turn: 1,
    step: 1,
    callId: "c1",
    seqInCall: 1,
    message: "命令已启动",
  },
  {
    type: "compaction",
    turn: 1,
    summary: "digest",
    retainedTail: 42,
    tokensBefore: 190_000,
  },
  { type: "checkpoint", turn: 1, provider: "git", ref: { commit: "abc" } },
  {
    type: "request/header",
    turn: 1,
    config: { provider: "openai", modelId: "gpt-4o" },
    reason: "initial",
  },
  // E4 的会话级 revert 标记（词汇表 13→14，见 l0-events.md §8 落地记录）
  { type: "session/revert", turn: 1, targetSeq: 2, phase: "revert" },
  // T-P1-06 的换模事件（词汇表 14→15，见 l0-events.md §8 落地记录 3）
  {
    type: "model/switch",
    turn: 1,
    from: { provider: "openai", modelId: "gpt-4o" },
    to: { provider: "openai", modelId: "o4-mini" },
    reason: "user",
  },
  // T-P1-10 的 todo 清单事件（词汇表 15→16，见 l0-events.md §8 落地记录 4）
  {
    type: "todo/update",
    turn: 1,
    items: [{ content: "读 plan", status: "in_progress" }],
  },
  // T-P1-12 的 goal 事实事件（词汇表 16→17，见 l0-events.md §8 落地记录 5）
  {
    type: "goal/set",
    turn: 1,
    text: "完成批次 1",
    deadline: 1_800_000_000_000,
    status: "active",
  },
  // T-P1-40 的 fork lineage 标记（词汇表 18→19，见 l0-events.md §8 落地记录 8）
  {
    type: "session/fork",
    turn: 1,
    parentSessionId: "s0",
    position: "after",
    cutSeq: 12,
  },
  {
    type: "plugin",
    turn: 1,
    namespace: "my-plugin",
    payload: { key: "value", nested: [1, "two"] },
  },
  // T-P1-95 的命令生命周期对（词汇表 21→23，见 l0-events.md §8 落地记录 16）
  {
    type: "command/run",
    turn: 0,
    commandId: "c1",
    name: "approve",
    args: "call_1 allow 放行演示",
    source: "cli",
  },
  {
    type: "command/done",
    turn: 0,
    commandId: "c1",
    kind: "success",
  },
  // T-P1-114 的 surface roster 生命周期对（词汇表 23→25，见 l0-events.md §8 落地记录 19）
  {
    type: "surface/attach",
    turn: 0,
    surfaceId: "desktop-1",
    deliveryKind: "push",
  },
  {
    type: "surface/detach",
    turn: 0,
    surfaceId: "desktop-1",
    reason: "disconnected",
  },
  // P2/T-P1-125 的图片卸载决策（词汇表 25→26，见 l0-events.md §8 落地记录 21）
  {
    type: "image/offload",
    turn: 1,
    targets: [{ seq: 2, imageIndexes: [0] }],
  },
];

describe("事件词汇表（l0-events.md §3 定稿）", () => {
  it("联合成员恰 26 个（… + surface/attach + surface/detach + image/offload——P2/T-P1-125 #21），且与 EVENT_TYPES 严格一致（验收①：Exclude 遍历断言的运行时面）", () => {
    expect(EVENT_TYPES).toHaveLength(26);
    const declared = new Set<string>(EVENT_TYPES);
    // 每个联合成员都能按其必填载荷构造，且 type 互不相同、并集等于 EVENT_TYPES。
    const constructed = SAMPLES.map((e) => e.type);
    expect(new Set(constructed)).toHaveLength(26);
    expect(new Set(constructed)).toEqual(declared);
    // 编译期等价断言在 events.ts 的 _EVENT_TYPES_EXACT（tsc --noEmit 时生效）。
  });

  it("turn/end 的 aborted 变体携带 CancelCause；hook cause 判据在结构化 reason、展示在 message（Q10 (d)）", () => {
    const cause: CancelCause = {
      kind: "hook",
      reason: { hook: "security-check", code: "DENIED_BY_POLICY" },
      message: "demo",
    };
    const reason: TurnEndReason = { kind: "aborted", cause };
    const event: TurnEndEvent = { type: "turn/end", seq: 9, ts: 0, turn: 2, reason };
    expect(event.reason.kind).toBe("aborted");
    // 判据字段必须是 JSON record——若把 reason 写成自由文本字符串，类型即报错。
    expect(reason).toEqual({
      kind: "aborted",
      cause: { kind: "hook", reason: { hook: "security-check", code: "DENIED_BY_POLICY" }, message: "demo" },
    });
  });

  it("原始参数不解析：tool/call.arguments 就是模型产出的原始 JSON 串", () => {
    const call = SAMPLES.find((e): e is SessionEvent & { type: "tool/call" } => e.type === "tool/call");
    expect(call?.arguments).toBeTypeOf("string");
    expect(JSON.parse(call?.arguments ?? "{}")).toEqual({ cmd: "ls" });
  });
});

// ---------------------------------------------------------------------------
// 验收②：C16 的失效演示 —— 故意删一个 switch 分支时 assertNever 令 tsc 失败。
// 把下面的注释块取消注释，`npx tsc --noEmit` 必须报错（TS2367/TS2322 类），
// 错误指向 switch 的 default 分支参数未收窄为 never。演示完重新注释。
// ---------------------------------------------------------------------------
//
// function brokenSwitch(event: SessionEvent): string {
//   switch (event.type) {
//     case "turn/start":
//     case "turn/end":
//     case "step/start":
//     case "step/end":
//     case "user/message":
//     case "system/message":
//     case "assistant/message":
//     case "assistant/attempt":
//     case "tool/call":
//     case "tool/result":
//     case "compaction":
//     case "checkpoint":
//       // ← 故意漏掉 "request/header" 分支
//       return "handled";
//     default:
//       return assertNever(event); // 期望编译失败：event 未收窄为 never
//   }
// }

describe("assertJsonSafe（C14 的执行点）", () => {
  it("Error 实例必须 throw（验收③）", () => {
    const err = new Error("boom");
    expect(() => assertJsonSafe({ where: err })).toThrow(/C14/);
  });

  it("含 stack 属性的对象必须 throw（跨 realm Error 与手工运行时对象都命中）", () => {
    expect(() => assertJsonSafe({ stack: "Error: fake\n    at x" })).toThrow(/stack/);
  });

  it("函数 / undefined / bigint / symbol / 非有限数 / 循环引用必须 throw", () => {
    expect(() => assertJsonSafe({ fn: () => 1 })).toThrow(/function/);
    expect(() => assertJsonSafe({ u: undefined })).toThrow(/undefined/);
    expect(() => assertJsonSafe({ b: 1n })).toThrow(/bigint/);
    expect(() => assertJsonSafe({ s: Symbol("x") })).toThrow(/symbol/);
    expect(() => assertJsonSafe({ n: Number.NaN })).toThrow(/非有限/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertJsonSafe(cyclic)).toThrow(/循环/);
  });

  it("类实例（Date/Map/signal）按非 plain 对象拒绝；报错含路径便于定位", () => {
    expect(() => assertJsonSafe({ at: new Date(0) })).toThrow(/\$\.at/);
    expect(() => assertJsonSafe({ m: new Map() })).toThrow(/\$\.m/);
  });

  it("合法 JSON 值原样通过（嵌套 / 数组 / null）", () => {
    const value = { a: [1, "x", null, true], b: { c: "y" } };
    expect(assertJsonSafe(value)).toEqual(value);
  });

  it("同一对象出现两次（共享引用/菱形）合法，不判循环——T-3-02 踩中形状的本修用例", () => {
    // usage 同时挂 stream 记录与事件顶层字段：loop 把 provider 的 usage 对象
    // 原样放进两处（T-4-01 修掉了曾在此场景上绕道的克隆 workaround）。
    const usage: TokenUsage = { inputTokens: 3, outputTokens: 5 };
    const value = {
      stream: [{ time: 1, chunk: { type: "usage", usage } }],
      usage,
    };
    expect(assertJsonSafe(value)).toEqual(value);
    // 循环仍拒绝：环在祖先链内未回溯时再次命中
    const cyclic: Record<string, unknown> = { usage };
    cyclic.self = cyclic;
    expect(() => assertJsonSafe(cyclic)).toThrow(/循环/);
  });
});

describe("E12 整值事件", () => {
  it("状态载荷是完整值：类型层面无 delta 字段（验收④）", () => {
    // 若未来有人把 content 改成 contentDelta 或往载荷里塞 delta 字段，这里编译失败。
    expectTypeOf<keyof AssistantMessageEvent["message"]>().toEqualTypeOf<"content">();
    expectTypeOf<CompactionEvent["tokensBefore"]>().toEqualTypeOf<number>();
    expectTypeOf<ToolResultEvent["message"]["content"]>().toEqualTypeOf<string>();
  });

  it("状态载荷是完整值：运行时样本顶层的 delta 形状键为零（stream 流记录豁免，见 events.ts 注释）", () => {
    const stateEventTypes = new Set<SessionEventType>(["assistant/message", "tool/result", "compaction"]);
    for (const event of SAMPLES) {
      if (!stateEventTypes.has(event.type)) continue;
      const payloadKeys = Object.keys(event).filter((k) => k !== "type");
      expect(payloadKeys.filter((k) => /delta$/i.test(k))).toEqual([]);
    }
  });

  it("组装语义样本：分片到达后追加的事件载荷是拼接后的完整文本，不是最后一个分片", () => {
    // 契约记录：loop（阶段 3）append assistant/message 时，message.content 必须是
    // "wor" + "ld" 的完整值 "world"。词汇表类型保证字段是完整值；何时组装由 loop 负责。
    const chunks = ["wor", "ld"];
    const full = chunks.join("");
    const event: AssistantMessageEvent = {
      type: "assistant/message",
      seq: 1,
      ts: 0,
      turn: 1,
      step: 1,
      message: { content: full },
      stream: chunks.map((text, i) => ({ time: i, chunk: { type: "text-delta", text } satisfies { type: "text-delta"; text: string } })),
    };
    expect(event.message.content).toBe("world");
  });
});

describe("assertNever（C16 的运行时面）", () => {
  it("收到不可能的成员时 throw 而不是静默继续", () => {
    const impossible = "ghost/event" as SessionEventType;
    const event = { type: impossible } as unknown as SessionEvent;
    // 真实 switch 的 default 分支里，event 已被穷尽分支收窄为 never；
    // 测试里用 as never 模拟那个收窄后的入参。
    expect(() => assertNever(event as never)).toThrow();
  });
});
