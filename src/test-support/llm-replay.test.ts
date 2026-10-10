import { describe, expect, it } from "vitest";

import type { SessionEvent, StreamChunk } from "../kernel/events.js";
import { AgentLoop } from "../kernel/loop.js";
import { ScriptedProvider } from "../kernel/loop.test-utils.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import { stableStringify } from "./normalize.js";
import type { ChatRequest, ModelProvider } from "../models/provider.js";
import {
  RecordingProvider,
  ReplayProvider,
  parseCalls,
  serializeCalls,
  type RecordedCall,
} from "./llm-replay.js";

/** 带工具调用的完整一轮剧本（loop 消费两次调用：工具轮 + 收尾轮）。 */
const SCRIPT_A: StreamChunk[] = [
  { type: "text-delta", text: "让我查一下" },
  { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{\"command\":\"ls\"}" },
  { type: "tool-call-delta", id: "c1", argsDelta: "" },
  { type: "done" },
];
const SCRIPT_B: StreamChunk[] = [
  { type: "text-delta", text: "查完了，共 3 个文件" },
  { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
  { type: "done" },
];

function chatReq(content: string): ChatRequest {
  return {
    identity: { provider: "test", modelId: "m-1" },
    messages: [{ role: "user", content }],
  };
}

describe("RecordingProvider（O15：录制面无行为变化 + fixture roundtrip）", () => {
  it("流逐 chunk 透传且逐调用记录（含请求）", async () => {
    const inner: ModelProvider = {
      async *streamChat() {
        yield { type: "text-delta", text: "he" };
        yield { type: "done" };
      },
    };
    const recorder = new RecordingProvider(inner);
    const out: string[] = [];
    for await (const chunk of recorder.streamChat(chatReq("hi"))) {
      if (chunk.type === "text-delta") out.push(chunk.text);
    }
    expect(out).toEqual(["he"]); // 透传不丢
    expect(recorder.recordedCalls()).toHaveLength(1);
    const [call] = recorder.recordedCalls();
    expect(call!.request.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(call!.chunks).toEqual([
      { type: "text-delta", text: "he" },
      { type: "done" },
    ]);
  });

  it("fixture 序列化 roundtrip：parse(serialize(x)) 深等（JSONL 逐调用一行）", () => {
    const calls: RecordedCall[] = [
      { request: chatReq("一"), chunks: [{ type: "done" }] },
      { request: chatReq("二"), chunks: [{ type: "text-delta", text: "好" }, { type: "done" }] },
    ];
    const fixture = serializeCalls(calls);
    expect(fixture.split("\n").filter((l) => l.length > 0)).toHaveLength(2); // JSONL
    const parsed = parseCalls(fixture);
    expect(stableStringify(parsed)).toBe(stableStringify(calls));
  });
});

describe("ReplayProvider（O15：first-call 序回放 + 序漂移可读失败 + override 注入）", () => {
  const fixtureCalls: RecordedCall[] = [
    { request: chatReq("q1"), chunks: SCRIPT_A },
    { request: chatReq("q2"), chunks: SCRIPT_B },
  ];

  it("按 first-call 序回放，请求多于剧本给可读失败（序漂移 = 测试该失败）", async () => {
    const replay = new ReplayProvider(fixtureCalls);
    const first: string[] = [];
    for await (const chunk of replay.streamChat(chatReq("q1"))) {
      if (chunk.type === "text-delta") first.push(chunk.text);
    }
    expect(first).toEqual(["让我查一下"]);
    const second: string[] = [];
    for await (const chunk of replay.streamChat(chatReq("q2"))) {
      if (chunk.type === "text-delta") second.push(chunk.text);
    }
    expect(second).toEqual(["查完了，共 3 个文件"]);
    await expect(async () => {
      for await (const _ of replay.streamChat(chatReq("q3"))) void _; // 第三次：无剧本
    }).rejects.toThrow(/回放剧本耗尽.*第 3 次.*expected ≤ 2/s);
  });

  it("override 注入：指定调用替换为故障（恢复类逻辑可测）或替代剧本", async () => {
    const failAtSecond = new ReplayProvider(fixtureCalls, [
      { atCall: 1, error: new Error("injected: rate limited") },
    ]);
    const got: string[] = [];
    for await (const chunk of failAtSecond.streamChat(chatReq("q1"))) {
      if (chunk.type === "text-delta") got.push(chunk.text);
    }
    expect(got).toEqual(["让我查一下"]); // 第一次正常
    await expect(async () => {
      for await (const _ of failAtSecond.streamChat(chatReq("q2"))) void _;
    }).rejects.toThrow("injected: rate limited");

    const replaceFirst = new ReplayProvider(fixtureCalls, [
      { atCall: 0, chunks: [{ type: "text-delta", text: "替身输出" }, { type: "done" }] },
    ]);
    const replaced: string[] = [];
    for await (const chunk of replaceFirst.streamChat(chatReq("q1"))) {
      if (chunk.type === "text-delta") replaced.push(chunk.text);
    }
    expect(replaced).toEqual(["替身输出"]);
  });
});

describe("录制→回放等价（O15 验收①：避免手写 mock 漂移）", () => {
  it("同一 loop 分别跑真 provider 与 ReplayProvider（回放其录制），事件流逐字节相等", async () => {
    async function runTurn(provider: ModelProvider): Promise<readonly SessionEvent[]> {
      const store = new SessionEventStore();
      const loop = new AgentLoop({
        sessionId: "s-replay",
        store,
        provider,
        identity: { provider: "mock", modelId: "m-1" },
        async executeTool(call) {
          return { content: `ran ${call.name}` };
        },
        async decideTurn(record) {
          return record.step < 2 ? { action: "continue" } : { action: "end" };
        },
      });
      await loop.runTurn("测试提问");
      return store.load("s-replay");
    }

    const scripted = new ScriptedProvider();
    scripted.mount(SCRIPT_A);
    scripted.mount(SCRIPT_B);
    const recorder = new RecordingProvider(scripted);
    const realStream = await runTurn(recorder);

    const replay = new ReplayProvider(parseCalls(recorder.toFixture()));
    const replayedStream = await runTurn(replay);

    // 归一化易变值（seq/ts + E14 定时流的真实 time + 真实时延计时）后逐
    // 字节相等——事件流快照等价即"无漂移"（时间戳与耗时都不属于被记录的
    // 事实，fixture 本就不录；计时 0/1ms 边界抖动曾两次记档——平滑面）。
    const zeroNumbers = (value: unknown): unknown => {
      if (typeof value === "number") return 0;
      if (Array.isArray(value)) return value.map(zeroNumbers);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, zeroNumbers(v)]));
      }
      return value;
    };
    const normalize = (events: readonly SessionEvent[]) =>
      stableStringify(
        events.map((e) => {
          const base = { ...e, seq: 0, ts: 0 };
          // 事件顶层 timing（tool/result 的 L9 分段计时）与 message.timing
          // （assistant/message）同为真实时延——统一抹平。
          const withTop = "timing" in base ? { ...base, timing: zeroNumbers(base.timing) } : base;
          const message = (withTop as { message?: unknown }).message;
          const withTiming =
            message !== null && typeof message === "object" && "timing" in (message as object)
              ? {
                  ...withTop,
                  message: {
                    ...(message as Record<string, unknown>),
                    timing: zeroNumbers((message as { timing: unknown }).timing),
                  },
                }
              : withTop;
          return "stream" in withTiming && Array.isArray(withTiming.stream)
            ? { ...withTiming, stream: withTiming.stream.map((s) => ({ time: 0, chunk: s.chunk })) }
            : withTiming;
        }),
      );
    expect(normalize(replayedStream)).toBe(normalize(realStream));
    expect(replayedStream.length).toBe(realStream.length);
  });
});
