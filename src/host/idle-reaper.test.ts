import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EVENT_TYPES, type NewSessionEvent, type SessionEvent } from "../kernel/events.js";
import { SqliteEventStorage } from "../session/db.js";
import { SessionStore } from "../session/store.js";
import { DEFAULT_IDLE_TIMEOUT_MS, IdleReaper, type SessionReapedNotice } from "./idle-reaper.js";
import { HostRegistry } from "./registry.js";

const MIN = 60_000;
const T0 = 1_800_000_000_000;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function sampleTurn(turn: number): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "step/start", turn, step: turn },
    { type: "user/message", turn, message: { content: `q${turn}` }, source: "user" },
    { type: "assistant/message", turn, step: turn, message: { content: `a${turn}` }, stream: [] },
    { type: "step/end", turn, step: turn },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

describe("会话空闲回收（M4/T-P2-104）", () => {
  it("空闲判定（时钟注入）：恰在界上不动，严格超过阈值才回收 + 通知广播", () => {
    let now = T0;
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-child", reapable: true, now: () => now });
    const notices: SessionReapedNotice[] = [];
    const reaper = new IdleReaper({
      registry,
      idleTimeoutMs: 30 * MIN,
      now: () => now,
      onReap: (n) => notices.push(n),
    });

    now = T0 + 30 * MIN; // 恰在阈值界上：不回收
    expect(reaper.sweep()).toEqual([]);
    expect(registry.get("s-child")).toBe(host);

    now = T0 + 31 * MIN;
    const reaped = reaper.sweep();
    expect(reaped).toHaveLength(1);
    expect(reaped[0]).toEqual({
      sessionId: "s-child",
      hostId: host.hostId,
      reason: "idle_timeout",
      lastActiveAt: T0,
      idleMs: 31 * MIN,
      reapedAt: T0 + 31 * MIN,
    });
    expect(notices).toEqual(reaped); // 通知广播面（distinct reason 可观测）
    // 内存态释放：registry 摘除；dispose 后 emit 静默不抛
    expect(registry.get("s-child")).toBeUndefined();
    expect(registry.list()).toEqual([]);
    const late: SessionEvent = { type: "surface/detach", turn: 0, seq: 1, ts: now, surfaceId: "x" };
    expect(() => host.emit(late)).not.toThrow();
  });

  it("活跃推进：markActive 与事件流入都刷新最后活跃；占位伪事件不污染", () => {
    let now = T0;
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-live", reapable: true, now: () => now });
    const reaper = new IdleReaper({ registry, idleTimeoutMs: 30 * MIN, now: () => now });

    now = T0 + 20 * MIN;
    host.markActive(); // 显式活跃（最近写命令/事件时点）
    now = T0 + 40 * MIN; // 距 markActive 20 分钟 < 阈值
    expect(reaper.sweep()).toEqual([]);

    now = T0 + 60 * MIN;
    const ev: SessionEvent = { type: "surface/detach", turn: 0, seq: 1, ts: T0 + 60 * MIN, surfaceId: "x" };
    host.emit(ev); // 事件流入自动推进（ts > 0 的真实事件）
    expect(host.lastActiveAt).toBe(T0 + 60 * MIN);
    now = T0 + 80 * MIN;
    expect(reaper.sweep()).toEqual([]);

    // 占位伪事件（ts=0 的 surfaceEventOf 转发）不污染活跃时刻
    const placeholder: SessionEvent = { type: "surface/attach", turn: 0, seq: 2, ts: 0, surfaceId: "x" };
    host.emit(placeholder);
    expect(host.lastActiveAt).toBe(T0 + 60 * MIN);
  });

  it("主会话豁免与守卫：未 opt-in 恒不回收；有连接端/持约者不回收", () => {
    let now = T0;
    const registry = new HostRegistry();
    const main = registry.register({ sessionId: "s-main", now: () => now }); // 缺省不可回收
    const child = registry.register({ sessionId: "s-child", reapable: true, now: () => now });
    const reaper = new IdleReaper({ registry, idleTimeoutMs: 30 * MIN, now: () => now });

    const handle = child.surfaces.connect("web-1", "push");
    now = T0 + 40 * MIN; // 超阈值但连接端在 → 不回收（连接即存活性）
    expect(reaper.sweep()).toEqual([]);
    expect(registry.get("s-child")).toBe(child);

    const lease = child.surfaces.acquireRunLease("web-1");
    now = T0 + 50 * MIN; // 持约在途 → 仍不回收（绝不杀进行中的工作）
    expect(reaper.sweep()).toEqual([]);
    expect(child.surfaces.currentLeaseHolder()).toBe("web-1");

    lease.release();
    handle.close();
    now = T0 + 60 * MIN; // 无端无约 + 超阈值 → 回收；主会话仍豁免
    expect(reaper.sweep().map((r) => r.sessionId)).toEqual(["s-child"]);
    expect(registry.get("s-main")).toBe(main);
    expect(registry.get("s-child")).toBeUndefined();
  });

  it("禁用面与阈值可配：0 / Infinity 恒不回收；自定义短阈值生效", () => {
    let now = T0;
    const registry = new HostRegistry();
    registry.register({ sessionId: "s-child", reapable: true, now: () => now });

    now = T0 + 10 * 365 * 24 * 60 * MIN;
    expect(new IdleReaper({ registry, idleTimeoutMs: 0, now: () => now }).sweep()).toEqual([]);
    expect(
      new IdleReaper({ registry, idleTimeoutMs: Number.POSITIVE_INFINITY, now: () => now }).sweep(),
    ).toEqual([]);
    expect(registry.get("s-child")).not.toBeUndefined();

    const reaped = new IdleReaper({ registry, idleTimeoutMs: 1 * MIN, now: () => now }).sweep();
    expect(reaped.map((r) => r.sessionId)).toEqual(["s-child"]);
    expect(new IdleReaper({ registry }).timeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS);
  });

  it("回收后可查（存储面完整）：只清内存不清存储——事件流逐字节不变且零新增", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-reaper-"));
    dirs.push(dir);
    const storage = SqliteEventStorage.open({ path: join(dir, "events.sqlite") });
    const store = new SessionStore(storage);
    store.append("s-child", sampleTurn(1));
    await store.flush("s-child");

    let now = T0;
    const registry = new HostRegistry();
    registry.register({ sessionId: "s-child", reapable: true, now: () => now });
    const reaper = new IdleReaper({ registry, idleTimeoutMs: 30 * MIN, now: () => now });

    now = T0 + 60 * MIN;
    expect(reaper.sweep().map((r) => r.sessionId)).toEqual(["s-child"]);
    expect(registry.has("s-child")).toBe(false);

    // 存储面完整：内存序 + 已落库流原样（回收零落流零删行）
    expect(store.load("s-child")).toHaveLength(6);
    expect(storage.readAll("s-child")).toHaveLength(6);
    const before = JSON.stringify(storage.readAll("s-child"));
    await store.flush("s-child"); // 无新事件 → no-op
    expect(JSON.stringify(storage.readAll("s-child"))).toBe(before);

    // 零事件扩展复核（卡面定形：回收是进程内运行时事实，不进词汇表——
    // EVENT_TYPES 28 基线（P2/T-P2-306 #23 审批取代后））
    expect(EVENT_TYPES).toHaveLength(28);
    storage.close();
  });
});
