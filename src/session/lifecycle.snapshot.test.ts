/**
 * 批次 15a 快照即规格（T-P2-108）——跨卡一条链：
 * fork 三层树（E6）→ 引用注入（E9）→ SQL 检索（Q2）→ 归档（Q8）→ 清理
 * 候选（Q4，dry-run）的端到端一致性。每一环的细节断言在各自套件里，本
 * 文件钉的是**环与环之间**的接缝（流内事实同一份、归档语义在检索面可见、
 * 内存树不因归档改写）。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { NewSessionEvent } from "../kernel/events.js";
import { archiveSession, readArchivedSession } from "./archive.js";
import { cleanupSessions } from "./cleanup.js";
import { SessionArchivedError, SqliteEventStorage } from "./db.js";
import { ForkTree, ForkTreeError } from "./fork-tree.js";
import { buildChatMessages } from "./messages.js";
import { querySessions } from "./query.js";
import { ReferenceError, assertNoReferenceCycle, buildReferenceExcerpt, refsOfEvents } from "./reference.js";
import { SessionStore } from "./store.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-15a-snapshot-"));
  dirs.push(dir);
  return join(dir, "events.sqlite");
}

function turn(turnNo: number, text: string): NewSessionEvent[] {
  return [
    { type: "turn/start", turn: turnNo },
    { type: "step/start", turn: turnNo, step: 1 },
    { type: "user/message", turn: turnNo, message: { content: text }, source: "user" },
    { type: "assistant/message", turn: turnNo, step: 1, message: { content: `${text} → 答复` }, stream: [] },
    { type: "step/end", turn: turnNo, step: 1 },
    { type: "turn/end", turn: turnNo, reason: { kind: "completed" } },
  ];
}

describe("批次 15a 快照即规格（会话数据与生命周期全链）", () => {
  it("fork 三层树 → 引用注入 → SQL 检索 → 归档 → 清理候选：一条链上的接缝一致", async () => {
    const dbPath = tempDbPath();
    const storage = SqliteEventStorage.open({ path: dbPath });
    const store = new SessionStore(storage);

    // ① 三个会话：root 为源，mid/leaf 逐层 fork（E5 写血统；E6 只读重建）
    store.append("s-root", turn(1, "根会话的原始内容 ROOT-NEEDLE"));
    store.fork("s-root", { target: "s-mid" });
    store.fork("s-mid", { target: "s-leaf" });
    for (const id of ["s-root", "s-mid", "s-leaf"]) await store.flush(id);
    expect(store.load("s-mid")).toHaveLength(7); // root 6 事件 + 血统标记
    expect(store.load("s-leaf")).toHaveLength(8); // mid 7 + 自己的血统标记

    // ② E6：三层树（内存事实）+ 未知边界拒绝
    const tree = ForkTree.fromStore(store);
    const leaf = tree.treeOf("s-leaf");
    expect(leaf.root).toBe("s-root");
    expect(leaf.ancestors).toEqual(["s-root", "s-mid"]);
    expect(leaf.depth).toBe(2);
    expect(tree.childrenOf("s-root")).toEqual(["s-mid"]);
    expect(() => tree.treeOf("s-none")).toThrow(ForkTreeError);

    // ③ E9：leaf 引用 root——引用落流（指针）、内容读取时注入；环拒绝
    store.append("s-leaf", [
      { type: "turn/start", turn: 2 },
      {
        type: "user/message",
        turn: 2,
        message: { content: "参考根会话" },
        source: "user",
        // 视窗取到根会话首轮的用户消息（seq 1..4：turn/step 开合 + 两条消息）
        sessionRefs: [{ sessionId: "s-root", upToSeq: 4 }],
      },
      { type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ]);
    await store.flush("s-leaf"); // 引用轮落库（检索面与内存序同源）
    const leafStream = JSON.stringify(store.load("s-leaf"));
    expect(leafStream).toContain("ROOT-NEEDLE"); // （root 事件随 fork 复制进 leaf——谱系使然）
    expect(store.load("s-root")).toHaveLength(6); // 引用只落 leaf 的流

    const messages = buildChatMessages(store.load("s-leaf"), {
      resolveSessionRef: (ref) => buildReferenceExcerpt(store.load(ref.sessionId), ref),
    });
    const citing = messages.find((m) => m.role === "user" && m.content.includes("参考根会话"));
    expect(citing?.content).toContain("[引用会话 s-root]");
    expect(citing?.content).toContain("ROOT-NEEDLE");

    // 环拒绝：root 要反过来引用 leaf（leaf 已引 root）→ REFERENCE_CYCLE
    const reader = { refsOf: (id: string) => refsOfEvents(store.load(id)) };
    expect(refsOfEvents(store.load("s-leaf"))).toEqual([{ sessionId: "s-root", upToSeq: 4 }]);
    expect(() => assertNoReferenceCycle("s-root", [{ sessionId: "s-leaf" }], reader)).toThrow(
      ReferenceError,
    );

    // ④ Q2：SQL 检索跨三条会话（流事实同源——树的三个节点都在检索面可见）
    const all = querySessions(dbPath, { sessionIdPrefix: "s-" });
    expect(new Set(all.rows.map((r) => r.sessionId))).toEqual(
      new Set(["s-root", "s-mid", "s-leaf"]),
    );
    expect(all.total).toBe(store.load("s-root").length + store.load("s-mid").length + store.load("s-leaf").length);
    const needle = querySessions(dbPath, { contentLike: "ROOT-NEEDLE" });
    expect(needle.total).toBeGreaterThan(0);
    expect(needle.archivedSessions).toEqual([]);

    // ⑤ Q8：归档 root（归档 ≠ 删除）——主库读面 fail-closed，归档档可查
    const receipt = archiveSession(dbPath, "s-root", { reason: "retention" });
    expect(receipt.eventCount).toBe(7); // 6 事件 + 归档标记
    expect(() => storage.readAll("s-root")).toThrow(SessionArchivedError);

    const afterArchive = querySessions(dbPath, { sessionIdPrefix: "s-root" });
    expect(afterArchive.total).toBe(0); // 主库无行
    expect(afterArchive.archivedSessions).toEqual(["s-root"]); // 但检索面明示"已归档"
    const archived = readArchivedSession(dbPath, "s-root");
    expect(archived.events[archived.events.length - 1]!.type).toBe("session/archive");
    expect(archived.reason).toBe("retention");

    // ⑥ E6 内存树不因归档改写（归档是库面动作；内存序仍是流事实）
    expect(tree.treeOf("s-leaf").root).toBe("s-root");

    // ⑦ Q4：清理 dry-run——已归档 root 不再是候选（归档是终态去向，不重复清）
    const plan = cleanupSessions(dbPath, Date.now(), { dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(plan.sessions.map((s) => s.sessionId)).toEqual([]);
    expect(plan.archived).toEqual([]);

    storage.close();
  });
});
