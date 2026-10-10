import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { ForkTree, ForkTreeError } from "./fork-tree.js";
import {ForkError, SessionEventStore, type SessionStore} from "./store.js";

const thisDir = path.dirname(fileURLToPath(new URL(import.meta.url)));

function turnEvents(turn: number, text: string): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: text }, source: "user" },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

/** 三层树：root → mid → leaf（E5 的 fork 写血统标记；E6 只读重建）。 */
function buildThreeLevel(): SessionStore {
  const store = new SessionEventStore();
  store.append("s-root", turnEvents(1, "root question"));
  const mid = store.fork("s-root", { target: "s-mid" });
  expect(mid.eventCount).toBe(4); // 3 事件 + 血统标记
  store.append("s-mid", turnEvents(2, "mid question"));
  const leaf = store.fork("s-mid", { target: "s-leaf" });
  void leaf;
  return store;
}

describe("fork 树（E6/T-P2-106）", () => {
  it("三层树重建：treeOf/childrenOf/rootOf/roots 全谱系（子流内多标记取最后一条）", () => {
    const store = buildThreeLevel();
    // 关键前置：leaf 流里有两枚 session/fork（mid 的被复制进前缀 + leaf 自己的）
    const leafForks = store.load("s-leaf").filter((e) => e.type === "session/fork");
    expect(leafForks).toHaveLength(2);
    expect(leafForks.map((f) => f.type === "session/fork" ? f.parentSessionId : "")).toEqual([
      "s-root",
      "s-mid",
    ]);

    const tree = ForkTree.fromStore(store);
    expect(tree.sessionIds()).toEqual(["s-leaf", "s-mid", "s-root"]);
    expect(tree.roots()).toEqual(["s-root"]);

    // 三层视图：leaf 的深度 2 / 根 s-root / 祖先链完整
    const leaf = tree.treeOf("s-leaf");
    expect(leaf).toEqual({
      sessionId: "s-leaf",
      root: "s-root",
      ancestors: ["s-root", "s-mid"],
      depth: 2,
      children: [],
      descendants: [],
    });
    // mid 的子树
    const mid = tree.treeOf("s-mid");
    expect(mid).toEqual({
      sessionId: "s-mid",
      root: "s-root",
      ancestors: ["s-root"],
      depth: 1,
      children: ["s-leaf"],
      descendants: ["s-leaf"],
    });
    // 根的子树（先序子孙）
    const root = tree.treeOf("s-root");
    expect(root.depth).toBe(0);
    expect(root.ancestors).toEqual([]);
    expect(root.children).toEqual(["s-mid"]);
    expect(root.descendants).toEqual(["s-mid", "s-leaf"]);

    expect(tree.rootOf("s-leaf")).toBe("s-root");
    expect(tree.rootOf("s-root")).toBe("s-root");
    expect(tree.childrenOf("s-root")).toEqual(["s-mid"]);
    expect(tree.childrenOf("s-mid")).toEqual(["s-leaf"]);
    expect(tree.childrenOf("s-leaf")).toEqual([]);
    expect(tree.danglingParents()).toEqual([]);
  });

  it("未知边界拒绝：未知会话的 treeOf/rootOf/childrenOf 类型化拒绝（不静默空树不新建）", () => {
    const tree = ForkTree.fromStore(buildThreeLevel());
    for (const call of [
      () => tree.treeOf("s-none"),
      () => tree.rootOf("s-none"),
      () => tree.childrenOf("s-none"),
    ]) {
      expect(call).toThrow(ForkTreeError);
    }
    try {
      tree.treeOf("s-none");
    } catch (error) {
      expect((error as ForkTreeError).code).toBe("UNKNOWN_SESSION");
      expect((error as ForkTreeError).sessionId).toBe("s-none");
    }
  });

  it("悬空父不凭空造节点：只装载子流时子作新根 + danglingParents 如实记录", () => {
    const store = buildThreeLevel();
    // 只喂 leaf（父 s-mid 不在已知集——如父已归档/未装载）
    const tree = ForkTree.fromStreams([{ sessionId: "s-leaf", events: store.load("s-leaf") }]);
    const leaf = tree.treeOf("s-leaf");
    expect(leaf.root).toBe("s-leaf"); // 不造父节点——子即新根
    expect(leaf.depth).toBe(0);
    expect(leaf.ancestors).toEqual([]);
    expect(tree.roots()).toEqual(["s-leaf"]);
    expect(tree.danglingParents()).toEqual([{ sessionId: "s-leaf", unknownParent: "s-mid" }]);
    // 未知父的 childrenOf 仍拒绝（悬空事实不改变"未知即拒绝"）
    expect(() => tree.childrenOf("s-mid")).toThrow(ForkTreeError);
  });

  it("同一抽象：E5 store.fork 产出即树事实 + fork-tree 只读零建表零落流（源码证伪）", () => {
    const store = buildThreeLevel();
    const before = JSON.stringify(store.sessionIds().map((id) => store.load(id)));

    const tree = ForkTree.fromStore(store);
    void tree.treeOf("s-root");
    // 只读断言：重建前后各流逐字节不变（零落流）+ 会话集不变（零新建）
    const after = JSON.stringify(store.sessionIds().map((id) => store.load(id)));
    expect(after).toBe(before);
    expect(store.sessionIds()).toEqual(["s-root", "s-mid", "s-leaf"]);

    // 源码证伪：fork-tree 不 import 存储/DB（零建表）、无第二套 fork 实现
    const source = readFileSync(path.join(thisDir, "fork-tree.ts"), "utf8");
    expect(source).not.toMatch(/from "\.\/db/);
    expect(source).not.toMatch(/from "\.\/archive/);
    expect(source).not.toMatch(/better-sqlite3/);
    expect(source).not.toMatch(/CREATE TABLE|INSERT INTO/);
    expect(source).not.toMatch(/target:|ForkError/); // 不复制 E5 的 fork 选项/拒绝面

    // E5 拒绝面仍唯一（未知源/重复目标由 store.fork 承载——本模块不另立）
    expect(() => store.fork("s-none", { target: "s-x" })).toThrow(ForkError);
    expect(() => store.fork("s-root", { target: "s-mid" })).toThrow(ForkError);
  });

  it("fromStreams 纯读面：输入数组与事件对象零改动", () => {
    const store = buildThreeLevel();
    const input = store.sessionIds().map((id) => ({ sessionId: id, events: [...store.load(id)] }));
    const snapshot = JSON.stringify(input);
    const tree = ForkTree.fromStreams(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(tree.rootOf("s-leaf")).toBe("s-root");
  });

  it("空流/单会话边界：roots 全列、childrenOf 空、无悬空", () => {
    const single = ForkTree.fromStreams([
      { sessionId: "solo", events: [] as SessionEvent[] },
    ]);
    expect(single.roots()).toEqual(["solo"]);
    expect(single.treeOf("solo")).toEqual({
      sessionId: "solo",
      root: "solo",
      ancestors: [],
      depth: 0,
      children: [],
      descendants: [],
    });
    expect(single.danglingParents()).toEqual([]);
  });
});
