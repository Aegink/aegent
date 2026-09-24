import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { SqliteEventStorage } from "./db.js";
import { SessionStore } from "./store.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-db-"));
  dirs.push(dir);
  return join(dir, "events.sqlite");
}

function sampleEvents(turn: number): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "step/start", turn, step: turn },
    { type: "user/message", turn, message: { content: `q${turn}` }, source: "user" },
    { type: "assistant/message", turn, step: turn, message: { content: `a${turn}` }, stream: [] },
    {
      type: "tool/call",
      turn,
      step: turn,
      callId: `c${turn}`,
      name: "bash",
      arguments: `{"cmd":"echo ${turn}"}`,
    },
    {
      type: "tool/result",
      turn,
      step: turn,
      callId: `c${turn}`,
      message: { content: "ok" },
      meta: { exitCode: 0 },
    },
    { type: "step/end", turn, step: turn },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

describe("SqliteEventStorage（E2）", () => {
  it("验收：建库 → append 1000 事件 → 重开连接 → 逐条读回 seq 连续且 payload 相等", async () => {
    const path = tempDbPath();
    const storage = SqliteEventStorage.open({ path });
    const store = new SessionStore(storage);

    // 25 批 × 5 turn × 8 事件/turn = 1000 事件（每 turn 覆盖 8 种事件类型）
    const appended: SessionEvent[] = [];
    try {
      for (let batch = 0; batch < 25; batch++) {
        const events: NewSessionEvent[] = [];
        for (let i = 0; i < 5; i++) {
          const turn = batch * 5 + i + 1;
          events.push(...sampleEvents(turn));
        }
        appended.push(...store.append("s-long", events));
      }
      expect(appended).toHaveLength(1000);
      await store.flush("s-long");
    } finally {
      storage.close();
    }

    // 重开连接：新进程视角，走 restore 路径读回
    const storage2 = SqliteEventStorage.open({ path });
    try {
      const store2 = new SessionStore(storage2);
      const restored = await store2.restore("s-long");

      expect(restored).toHaveLength(1000);
      restored.forEach((event, i) => {
        expect(event.seq).toBe(i + 1);
        expect(event).toEqual(appended[i]!); // payload 逐条相等（含 ts / 载荷 / 类型）
      });
    } finally {
      storage2.close();
    }
  });

  it("schema 版本迁移：新库写 user_version=1，二次打开不重复执行 DDL", () => {
    const path = tempDbPath();
    const storage = SqliteEventStorage.open({ path });
    expect(storage.db.pragma("user_version", { simple: true })).toBe(1);
    // 二次打开（同连接走 migrate 幂等分支 + 不同连接走 v1 短路）
    const again = SqliteEventStorage.open({ path });
    expect(again.db.pragma("user_version", { simple: true })).toBe(1);
    again.close();
    storage.close();
  });

  it("旧代码拒绝打开更新版本的库（迁移只进不退）", () => {
    const path = tempDbPath();
    const storage = SqliteEventStorage.open({ path });
    storage.db.pragma("user_version = 99");
    expect(() => SqliteEventStorage.open({ path })).toThrow(/拒绝用旧代码打开新库/);
    storage.close();
  });

  it("readAll 对空会话返回空数组；未 flush 的事件不可见", async () => {
    const storage = SqliteEventStorage.open({ path: tempDbPath() });
    const store = new SessionStore(storage);
    store.append("s-quiet", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "x" }, source: "user" },
    ]);
    expect(storage.readAll("s-quiet")).toHaveLength(0); // write-behind：未排空不落库
    expect(storage.readAll("ghost")).toHaveLength(0);
    await store.flush("s-quiet");
    expect(storage.readAll("s-quiet")).toHaveLength(2);
    storage.close();
  });
});
