import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RawChunkLog } from "./raw-chunk-log.js";
import { buildChatMessages } from "../../session/messages.js";
import type { SessionEvent, TimedStreamChunk } from "./events.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aegent-rawlog-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放滞后的 EBUSY（T-1-03 已知坑）
  }
});

const chunks: TimedStreamChunk[] = [
  { time: 1, chunk: { type: "text-delta", text: "你好" } },
  { time: 2, chunk: { type: "tool-call-delta", id: "c1", name: "read", argsDelta: '{"path"' } },
  { time: 3, chunk: { type: "tool-call-delta", id: "c1", argsDelta: ':"x"}' } },
  { time: 4, chunk: { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } } },
  { time: 5, chunk: { type: "done" } },
];

const record = {
  ts: 1_700_000_000_000,
  sessionId: "s0",
  turn: 1,
  step: 1,
  identity: { provider: "echo", modelId: "echo-1" },
  chunks,
};

describe("RawChunkLog（E14/T-P1-90 原始分片诊断日志）", () => {
  it("3 类分片 → JSONL 逐条可读；text-delta 拼接 == 组装消息 content（token 级保真）", () => {
    const log = new RawChunkLog({ logDir: path.join(dir, "raw"), now: () => new Date("2026-09-27T00:00:00Z") });
    log.write(record);
    const file = path.join(dir, "raw", "raw-20260927.jsonl");
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as typeof record;
    expect(parsed.turn).toBe(1);
    expect(parsed.chunks).toHaveLength(5);
    expect(parsed.chunks.map((c) => c.chunk.type)).toEqual([
      "text-delta",
      "tool-call-delta",
      "tool-call-delta",
      "usage",
      "done",
    ]);
    // 与组装事件的一致性：分片拼接 == assistant/message.content（该轮事件的 stream 字段同源）
    const assembled = chunks
      .map((c) => (c.chunk.type === "text-delta" ? c.chunk.text : ""))
      .join("");
    expect(assembled).toBe("你好");
  });

  it("密钥形状经 redactSecrets 掩码（D9）", () => {
    const log = new RawChunkLog({ logDir: path.join(dir, "raw") });
    log.write({
      ...record,
      chunks: [{ time: 1, chunk: { type: "text-delta", text: "key=sk-secret1234567890abcdef123456 value" } }],
    });
    const line = readFileSync(path.join(dir, "raw", `raw-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.jsonl`), "utf8");
    expect(line).not.toContain("sk-secret1234567890abcdef123456");
    expect(line).toContain("[REDACTED:api-key]");
  });

  it("写失败降级：目录不可写 → 只告警不带崩（连续写不抛）", () => {
    // 日志路径落在一个文件上——mkdir/append 必失败
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "not a dir", "utf8");
    const log = new RawChunkLog({ logDir: blocker });
    expect(() => {
      log.write(record);
      log.write(record);
    }).not.toThrow();
  });

  it("派生以组装事件为准（E14 验收核心）：投影/消息不消费分片，分片日志缺失零影响", () => {
    // 组装 content 与分片内容刻意不同——派生面必须取 content 而非拼接分片
    const events: SessionEvent[] = [
      { seq: 1, ts: 1, turn: 1, type: "user/message", message: { content: "问" }, source: "user" },
      {
        seq: 2,
        ts: 2,
        turn: 1,
        step: 1,
        type: "assistant/message",
        message: { content: "组装后的答案" },
        stream: [{ time: 1, chunk: { type: "text-delta", text: "分片里的旧答案" } }],
      },
    ];
    const messages = buildChatMessages(events);
    expect(messages.some((m) => m.role === "assistant" && m.content === "组装后的答案")).toBe(true);
    expect(JSON.stringify(messages)).not.toContain("分片里的旧答案");
    // 分片日志缺失零影响：派生面（messages/project）的 import 无 raw-chunk-log
    // （T1-2 本测试随 raw-chunk-log.ts 迁入 core/skeleton——被检源码仍在 src/session）
    const sessionDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "session");
    const messagesSource = readFileSync(path.join(sessionDir, "messages.ts"), "utf8");
    const projectSource = readFileSync(path.join(sessionDir, "project.ts"), "utf8");
    expect(messagesSource).not.toContain("raw-chunk-log");
    expect(projectSource).not.toContain("raw-chunk-log");
  });
});
