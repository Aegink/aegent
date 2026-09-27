import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderTranscript, type TranscriptEntry } from "./transcript.js";
import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";

let seq = 0;
const ev = (e: NewSessionEvent): SessionEvent =>
  ({ ...e, seq: ++seq, ts: 1_700_000_000_000 + seq }) as SessionEvent;

const kinds = (entries: readonly TranscriptEntry[]): string[] => entries.map((e) => e.kind);

describe("renderTranscript（E7/T-P1-96 会话记录检视面）", () => {
  it("完整会话流（3 轮要素 + 工具 + 压缩 + revert + 命令）→ 结构化条目逐项断言", () => {
    const events: SessionEvent[] = [
      ev({ type: "turn/start", turn: 1 }),
      ev({ type: "user/message", turn: 1, message: { content: "查一下配置" }, source: "user", promptId: "p1" }),
      ev({ type: "step/start", turn: 1, step: 1 }),
      ev({ type: "tool/call", turn: 1, step: 1, callId: "c1", name: "read", arguments: '{"path":"x"}' }),
      ev({ type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "配置内容 X" } }),
      ev({ type: "assistant/message", turn: 1, step: 1, message: { content: "查到了" }, stream: [] }),
      ev({ type: "step/end", turn: 1, step: 1 }),
      ev({ type: "turn/end", turn: 1, reason: { kind: "completed" }, produced: [6] }),
      ev({ type: "session/revert", turn: 0, targetSeq: 4, phase: "revert" }),
      ev({ type: "command/run", turn: 0, commandId: "c9", name: "revert", args: "4", source: "cli" }),
      ev({ type: "command/done", turn: 0, commandId: "c9", kind: "success", text: "已受理" }),
    ];
    const t = renderTranscript(events);
    // 回合帧
    expect(kinds(t).filter((k) => k === "turn-start")).toHaveLength(1);
    const turnEnd = t.find((e): e is Extract<TranscriptEntry, { kind: "turn-end" }> => e.kind === "turn-end")!;
    expect(turnEnd.reason).toBe("completed");
    expect(turnEnd.produced).toEqual([6]); // E18 产出集合透出
    // 消息行（user 原声 + assistant）
    const messages = t.filter((e): e is Extract<TranscriptEntry, { kind: "message" }> => e.kind === "message");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0]!.content).toBe("查一下配置");
    expect(messages[0]!.promptId).toBe("p1");
    // 工具行聚合 result（callId 关联）
    const tool = t.find((e): e is Extract<TranscriptEntry, { kind: "tool" }> => e.kind === "tool")!;
    expect(tool.name).toBe("read");
    expect(tool.result).toEqual({ content: "配置内容 X" });
    // revert 行
    const revert = t.find((e): e is Extract<TranscriptEntry, { kind: "revert" }> => e.kind === "revert")!;
    expect(revert.targetSeq).toBe(4);
    // 命令行（run 与 done 分行、outcome 承载结算）
    const commands = t.filter((e): e is Extract<TranscriptEntry, { kind: "command" }> => e.kind === "command");
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({ phase: "run", name: "revert", args: "4" });
    expect(commands[1]).toMatchObject({ phase: "done", outcome: "success", text: "已受理" });
  });

  it("噪声事件不产生条目（E14 派生权威同构：progress/step/header/attempt 等）", () => {
    const events: SessionEvent[] = [
      ev({ type: "turn/start", turn: 1 }),
      ev({ type: "user/message", turn: 1, message: { content: "q" }, source: "user" }),
      ev({ type: "step/start", turn: 1, step: 1 }),
      ev({ type: "request/header", turn: 1, step: 1, reason: "initial", config: { provider: "p", modelId: "m" } }),
      ev({ type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" }),
      ev({ type: "tool/progress", turn: 1, step: 1, callId: "c1", seqInCall: 1, message: "进行中" }),
      ev({ type: "assistant/attempt", turn: 1, step: 1, stream: [] }),
      ev({ type: "assistant/retrying", turn: 1, step: 1, attempt: 1, delayMs: 500, error: { name: "E", message: "e" } }),
      ev({ type: "model/switch", turn: 0, from: { provider: "a", modelId: "a" }, to: { provider: "b", modelId: "b" }, reason: "user" }),
      ev({ type: "todo/update", turn: 1, items: [] }),
      ev({ type: "goal/set", turn: 1, text: "g", status: "active" }),
      ev({ type: "plugin", turn: 0, namespace: "ns" }),
    ];
    const t = renderTranscript(events);
    // 只有 turn 帧、user 消息、工具行（噪声全静默）
    expect(kinds(t).sort()).toEqual(["message", "tool", "turn-start"]);
  });

  it("abort 轮的部分产出正确成帧（interrupted 消息 + aborted 结局）；E17 压缩 status 透出", () => {
    const events: SessionEvent[] = [
      ev({ type: "turn/start", turn: 1 }),
      ev({ type: "user/message", turn: 1, message: { content: "q" }, source: "user" }),
      ev({
        type: "assistant/message",
        turn: 1,
        step: 1,
        message: { content: "半截" },
        stream: [],
        interrupted: true,
      }),
      ev({ type: "turn/end", turn: 1, reason: { kind: "aborted", cause: { kind: "user" } } }),
      ev({
        type: "compaction",
        turn: 0,
        summary: "",
        retainedTail: 0,
        tokensBefore: 100,
        status: "started",
        reason: "context_limit",
      }),
    ];
    const t = renderTranscript(events);
    const messages = t.filter((e): e is Extract<TranscriptEntry, { kind: "message" }> => e.kind === "message");
    const msg = messages.find((m) => m.role === "assistant")!;
    expect(msg.interrupted).toBe(true);
    const turnEnd = t.find((e): e is Extract<TranscriptEntry, { kind: "turn-end" }> => e.kind === "turn-end")!;
    expect(turnEnd.reason).toBe("aborted");
    expect(turnEnd.produced).toBeUndefined(); // 无产出 → 无 produced（E18 缺席语义）
    const compaction = t.find((e): e is Extract<TranscriptEntry, { kind: "compaction" }> => e.kind === "compaction")!;
    expect(compaction.status).toBe("started");
    expect(compaction.summary).toBeUndefined(); // started 空摘要不渲染（E17 形状）
  });

  it("空流 → 空条目不抛；入边证伪：零 store/loop 依赖（脱离内核的结构保证）", () => {
    expect(renderTranscript([])).toEqual([]);
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "transcript.ts"), "utf8");
    const imports = source.match(/from "[^"]+"/g) ?? [];
    // 入边只有词汇表类型（kernel/events）——零 store/loop/agent-process 依赖
    expect(imports).toEqual(['from "../kernel/events.js"']);
  });
});

describe("transcript × image/offload（P2/T-P1-125，T-P1-127 盘点⑦增补）", () => {
  it("卸载决策产生条目（容量事实可见——与 compaction 同级）", () => {
    const events = [
      { type: "turn/start", seq: 1, ts: 0, turn: 1 },
      {
        type: "user/message",
        seq: 2,
        ts: 0,
        turn: 1,
        message: { content: "看图" },
        source: "user",
        attachments: [{ attachmentId: "a1", mediaType: "image/png", size: 100 }],
      },
      {
        type: "image/offload",
        seq: 3,
        ts: 0,
        turn: 1,
        targets: [{ seq: 2, imageIndexes: [0] }],
      },
    ] as unknown as Parameters<typeof renderTranscript>[0];
    const entries = renderTranscript(events);
    const offload = entries.find((e) => e.kind === "offload");
    expect(offload).toEqual({ kind: "offload", seq: 3, targets: [{ seq: 2, imageIndexes: [0] }] });
  });
});
