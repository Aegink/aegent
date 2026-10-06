/**
 * replay 子命令测试（C6）——纯渲染面直测 + 真库端到端（真 sqlite + 真
 * 事件流，sessions.test 同款形状）。
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionEvent } from "../kernel/events.js";
import { SqliteEventStorage } from "../session/db.js";
import { renderReplayEntries, runReplayCommand } from "./replay.js";
import { replaySession } from "../obs/replay.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "aegent-cli-replay-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** 最小真实事件流：一轮 turn——user 消息 + header（请求面）+ assistant 响应。 */
function seedEvents(): SessionEvent[] {
  return [
    { type: "turn/start", turn: 1, seq: 1, ts: 1000 },
    {
      type: "user/message",
      turn: 1,
      seq: 2,
      ts: 1001,
      message: { content: "你好" },
    },
    {
      type: "request/header",
      turn: 1,
      seq: 3,
      ts: 1002,
      reason: "initial",
      config: { provider: "echo", modelId: "echo-1" },
    },
    {
      type: "assistant/message",
      turn: 1,
      seq: 4,
      ts: 1003,
      message: { content: "你好！有什么可以帮你？" },
    },
    { type: "turn/end", turn: 1, seq: 5, ts: 1004 },
  ] as unknown as SessionEvent[];
}

describe("C6 · aegent replay（L4 轨迹回放入口）", () => {
  it("渲染面：逐请求条目带 turn/step/身份/响应摘要（可见消息数由流投影重建）", () => {
    const entries = replaySession([
      { type: "user/message", turn: 2, seq: 9, ts: 1999, message: { content: "跑个测试" } },
      {
        type: "request/header",
        turn: 2,
        seq: 10,
        ts: 2000,
        reason: "initial",
        config: { provider: "openai", modelId: "gpt-x" },
      },
      {
        type: "assistant/message",
        turn: 2,
        seq: 11,
        ts: 2001,
        message: { content: "好" },
      },
    ] as unknown as Parameters<typeof replaySession>[0]);
    const lines = renderReplayEntries(entries, false);
    expect(lines.some((l) => l.includes("turn 2") && l.includes("openai/gpt-x"))).toBe(true);
    // 可见消息 = buildChatMessages 从流重建（E15 纪律：派生以组装事件为准）
    expect(lines.some((l) => l.includes("可见消息") && l.includes("条"))).toBe(true);
    expect(lines.some((l) => l.includes("响应：好"))).toBe(true);
  });

  it("真库端到端：seed 事件 → runReplayCommand 输出重放；空库输出提示", async () => {
    const dbPath = path.join(tmp, "sessions.db");
    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      storage.appendBatch("sess-replay-1", seedEvents());
    } finally {
      storage.close();
    }
    const out: string[] = [];
    const err: string[] = [];
    const code = await runReplayCommand(["sess-replay-1", "--db", dbPath], {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("重放");
    expect(out.join("\n")).toContain("turn 1");

    const empty = await runReplayCommand(["sess-none", "--db", dbPath], {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    expect(empty).toBe(0);
    expect(out.join("\n")).toContain("无会话 sess-none");
  });

  it("fail-closed：缺 id / 非法 id / 库路径不可打开各返回非零且错误可读", async () => {
    const err: string[] = [];
    const io = { out: () => {}, err: (l: string) => err.push(l) };
    expect(await runReplayCommand([], io)).toBe(1);
    expect(await runReplayCommand(["../bad id"], io)).toBe(1);
    // 已存在同名目录当库路径——better-sqlite3 open 失败（自动建库只对不存在文件）
    const dirAsDb = path.join(tmp, "db-as-dir");
    mkdirSync(dirAsDb, { recursive: true });
    expect(await runReplayCommand(["sess-x", "--db", dirAsDb], io)).toBe(1);
    expect(err.join("\n")).toContain("用法");
  });
});
