/**
 * F26/T-P1-100 装配接线验收：PreTurn 检查点的压缩指纹触发——
 * ①流内有已结算压缩且 compHash ≠ 当前装配指纹 → beforeFirstModelRequest
 *   发起 comp_hash_changed 压缩（事件落流）；
 * ②compHash = 当前指纹 → 不触发；③旧流（无指纹）→ 不触发。
 * 触发判定/引擎行为本身由 compaction.test.ts 单测承载（compHashChangeRequest
 * 纯函数 + engine 落盘），本文件只钉装配位（beforeFirstModelRequest 同位）。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createChildAssembly } from "./assembly.js";
import type { SessionEvent } from "./events.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import {
  compactionFingerprint,
  DEFAULT_RETAINED_FROM_END,
} from "../context/compaction.js";
import { DEFAULT_DEVELOPER_BUDGET_TOKENS } from "../context/new-window.js";

const SESSION = "s-assembly-fingerprint";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeAssembly(store: SessionStore) {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "aegent-fingerprint-"));
  tmpRoots.push(workspaceRoot);
  return createChildAssembly({
    sessionId: SESSION,
    store,
    workspaceRoot,
    contextWindow: 200_000,
    approvalTimeoutMs: 5_000,
  });
}

/** 与缺省装配同源的当前指纹（无摘要模型 + truncating + 缺省保留/预算）。 */
function defaultFingerprint(): string {
  return compactionFingerprint({
    summarizerKind: "truncating",
    retainedFromEnd: DEFAULT_RETAINED_FROM_END,
    developerBudgetTokens: DEFAULT_DEVELOPER_BUDGET_TOKENS,
  });
}

function seedCompaction(store: SessionStore, compHash?: string): void {
  store.append(SESSION, [
    { type: "turn/start", turn: 1 },
    { type: "user/message", turn: 1, message: { content: "历史" }, source: "user" },
    { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    {
      type: "compaction",
      turn: 1,
      summary: "旧摘要",
      retainedTail: 1,
      tokensBefore: 100,
      status: "completed",
      ...(compHash !== undefined ? { compHash } : {}),
    },
  ]);
}

describe("装配 PreTurn 指纹触发（F26 接线位）", () => {
  it("指纹变化 → comp_hash_changed 压缩落流且带当前指纹", async () => {
    const store = new SessionEventStore();
    seedCompaction(store, "deadbeef");
    const assembly = makeAssembly(store);
    await assembly.beforeFirstModelRequest(2);
    const triggered = store
      .load(SESSION)
      .filter((e): e is Extract<SessionEvent, { type: "compaction" }> => e.type === "compaction" && e.reason === "comp_hash_changed");
    expect(triggered.length).toBe(2); // started + completed
    expect(triggered.every((e) => e.compHash === defaultFingerprint())).toBe(true);
  });

  it("指纹相同 → 零触发", async () => {
    const store = new SessionEventStore();
    seedCompaction(store, defaultFingerprint());
    const assembly = makeAssembly(store);
    await assembly.beforeFirstModelRequest(2);
    expect(
      store.load(SESSION).filter((e) => e.type === "compaction" && e.reason === "comp_hash_changed"),
    ).toHaveLength(0);
  });

  it("旧流无指纹 → 零触发（双值齐备纪律的装配面）", async () => {
    const store = new SessionEventStore();
    seedCompaction(store, undefined);
    const assembly = makeAssembly(store);
    await assembly.beforeFirstModelRequest(2);
    expect(
      store.load(SESSION).filter((e) => e.type === "compaction" && e.reason === "comp_hash_changed"),
    ).toHaveLength(0);
  });
});
