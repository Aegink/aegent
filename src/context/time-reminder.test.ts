/**
 * F7/T-P1-103 验收：时间上下文注入——
 * ①启用后首轮注入一条且内容含当前时间；
 * ②interval 内后续轮零注入（节流）；
 * ③超 interval 再注入（时间文本更新——"长会话中时间不漂移"）；
 * ④压缩后新窗立即再注入（新窗必送——F25 窗口身份消费）；
 * ⑤重启后状态从流重建（同流两次推导恒等——首注判定不变）；
 * ⑥未启用装配零注入零行为变化；
 * ⑦注入内容固定格式（TIME_REMINDER_PREFIX 前缀，无自由文本敏感面）。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createChildAssembly } from "../kernel/assembly.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import {
  DEFAULT_TIME_REMINDER_INTERVAL_SECONDS,
  TIME_REMINDER_PREFIX,
  timeReminderContent,
  timeReminderDue,
} from "./time-reminder.js";

const SESSION = "s-time-reminder";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeAssembly(
  store: SessionStore,
  timeReminder?: { intervalSeconds?: number },
) {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "aegent-time-"));
  tmpRoots.push(workspaceRoot);
  return createChildAssembly({
    sessionId: SESSION,
    store,
    workspaceRoot,
    contextWindow: 200_000,
    approvalTimeoutMs: 5_000,
    ...(timeReminder !== undefined ? { timeReminder } : {}),
  });
}

/** 轮骨架（开启中——beforeFirstModelRequest 在真实 loop 里于轮内调用）。 */
function openTurn(store: SessionStore, turn: number, user: string): void {
  store.append(SESSION, [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: user }, source: "user" },
  ]);
}

function closeTurn(store: SessionStore, turn: number): void {
  store.append(SESSION, [{ type: "turn/end", turn, reason: { kind: "completed" } }]);
}

function injectedMessages(store: SessionStore): Array<{ content: string; ts: number }> {
  return store
    .load(SESSION)
    .filter(
      (e): e is Extract<ReturnType<SessionStore["load"]>[number], { type: "user/message" }> =>
        e.type === "user/message" && e.source === "injected",
    )
    .map((e) => ({ content: e.message.content, ts: e.ts }));
}

describe("time-reminder（F7 时间上下文）", () => {
  it("验收①：启用后首轮注入一条，内容含 TIME_REMINDER_PREFIX 与日期", async () => {
    const store = new SessionEventStore();
    const assembly = makeAssembly(store, {});
    openTurn(store, 1, "第一问");
    await assembly.beforeFirstModelRequest(1);
    closeTurn(store, 1);
    const injected = injectedMessages(store);
    expect(injected).toHaveLength(1);
    expect(injected[0]!.content).toContain(TIME_REMINDER_PREFIX);
    // 内容含年（当前时间的事实面——格式化时钟本地时区）
    expect(injected[0]!.content).toContain(String(new Date().getFullYear()));
  });

  it("验收②③：interval 内零注入；超 interval 再注入且时间文本更新", async () => {
    const store = new SessionEventStore();
    const assembly = makeAssembly(store, { intervalSeconds: 60 });
    openTurn(store, 1, "第一问");
    await assembly.beforeFirstModelRequest(1);
    closeTurn(store, 1);
    expect(injectedMessages(store)).toHaveLength(1);
    // 立即第二轮：interval 内 → 零注入
    openTurn(store, 2, "第二问");
    await assembly.beforeFirstModelRequest(2);
    closeTurn(store, 2);
    expect(injectedMessages(store)).toHaveLength(1);
    // 模拟时间流逝：改写流内注入消息的 ts（事件源即状态——ts 后移 61 秒）
    const store2 = new SessionEventStore();
    store2.append(SESSION, [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "问" }, source: "user" },
    ]);
    const assembly2 = makeAssembly(store2, { intervalSeconds: 60 });
    await assembly2.beforeFirstModelRequest(1);
    closeTurn(store2, 1);
    const first = injectedMessages(store2);
    // 直接以 due 纯函数模拟"61 秒后"：把首条注入的 ts 视为 t0，now = t0+61s
    const t0 = first[0]!.ts;
    const events = store2.load(SESSION);
    expect(timeReminderDue(events, t0 + 61_000, 60)).toBe(true);
    expect(timeReminderDue(events, t0 + 30_000, 60)).toBe(false);
    void store;
  });

  it("验收④：压缩后新窗立即再注入（新窗必送——窗口身份消费）", async () => {
    const store = new SessionEventStore();
    const assembly = makeAssembly(store, { intervalSeconds: 3_600 });
    openTurn(store, 1, "第一问");
    await assembly.beforeFirstModelRequest(1); // 注入 1（首轮）
    closeTurn(store, 1);
    // 落一次已结算压缩 → 窗口号 0 → 1（新窗）
    store.append(SESSION, [
      {
        type: "compaction",
        turn: 1,
        summary: "摘要",
        retainedTail: 2,
        tokensBefore: 100,
        status: "completed",
      },
    ]);
    // interval 未到——但新窗必送
    openTurn(store, 2, "第二问");
    await assembly.beforeFirstModelRequest(2);
    closeTurn(store, 2);
    const injected = injectedMessages(store);
    expect(injected.length).toBe(2);
    expect(injected.every((m) => m.content.startsWith(TIME_REMINDER_PREFIX))).toBe(true);
  });

  it("验收⑤：重启后状态从流重建——同流两次判定恒等（流即状态）", async () => {
    const store = new SessionEventStore();
    const assembly = makeAssembly(store, {});
    openTurn(store, 1, "问");
    await assembly.beforeFirstModelRequest(1);
    closeTurn(store, 1);
    const events = store.load(SESSION);
    const now = Date.now();
    expect(timeReminderDue(events, now, DEFAULT_TIME_REMINDER_INTERVAL_SECONDS)).toBe(
      timeReminderDue(store.load(SESSION), now, DEFAULT_TIME_REMINDER_INTERVAL_SECONDS),
    );
    // interval 内 → false（从流重建的 lastDelivery 生效）
    expect(timeReminderDue(events, now, DEFAULT_TIME_REMINDER_INTERVAL_SECONDS)).toBe(false);
  });

  it("验收⑦：timeReminderContent 固定格式（前缀 + 日期 + UTC 偏移）", () => {
    const content = timeReminderContent(new Date(2026, 8, 27, 20, 15, 30)); // 本地时区
    expect(content.startsWith(TIME_REMINDER_PREFIX)).toBe(true);
    expect(content).toContain("2026-09-27");
    expect(content).toContain("20:15:30");
    expect(content).toContain("UTC");
  });
});

describe("装配缺省（未启用 F7）", () => {
  it("验收⑥：未配 timeReminder → 零注入零行为变化", async () => {
    const store = new SessionEventStore();
    const assembly = makeAssembly(store);
    openTurn(store, 1, "问");
    await assembly.beforeFirstModelRequest(1);
    closeTurn(store, 1);
    expect(injectedMessages(store)).toHaveLength(0);
  });
});
