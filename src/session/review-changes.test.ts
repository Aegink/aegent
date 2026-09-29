// U15/T-P3-117：变更评审提取纯函数——从流算变更清单/汇总/委派一览。
// 事件构造走 SessionEvent 形状（seq/ts/turn 手工排布，与 store 无关——纯函数面）。
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionEvent } from "../kernel/events.js";
import {
  reviewChangesFromEvents,
  summarizeReviewChanges,
} from "./review-changes.js";

let seq = 0;
let ts = 1_000;

beforeEach(() => {
  seq = 0;
  ts = 1_000;
});

function call(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  turn = 1,
): SessionEvent {
  seq += 1;
  ts += 10;
  return {
    type: "tool/call",
    seq,
    ts,
    turn,
    step: 1,
    callId,
    name,
    arguments: JSON.stringify(args),
  } as SessionEvent;
}

function result(
  callId: string,
  opts: {
    isError?: boolean;
    errorCode?: string;
    meta?: Record<string, unknown>;
    content?: string;
  } = {},
): SessionEvent {
  seq += 1;
  ts += 500;
  return {
    type: "tool/result",
    seq,
    ts,
    turn: 1,
    step: 1,
    callId,
    message: { content: opts.content ?? "ok", ...(opts.isError ? { isError: true } : {}) },
    ...(opts.errorCode ? { error: { name: "E", code: opts.errorCode } } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  } as SessionEvent;
}

describe("reviewChangesFromEvents — 变更提取", () => {
  it("write/edit/apply-patch 的结构化 path 全提取，失败调用不计入", () => {
    const events = [
      call("c1", "write", { path: "a.ts", content: "x" }),
      result("c1"),
      call("c2", "edit", { path: "b\\win.ts", oldText: "a", newText: "b" }),
      result("c2"),
      call("c3", "write", { path: "failed.ts", content: "x" }),
      result("c3", { isError: true, errorCode: "PATH_OUT_OF_WORKSPACE" }),
      call("c4", "apply-patch", {
        patchText: "*** Begin Patch\n*** Add File: new.md\n+hi\n*** Update File: old.md\n@@\n-a\n+b\n*** Delete File: gone.md\n*** End Patch",
      }),
      result("c4"),
    ];
    const r = reviewChangesFromEvents(events);
    expect(r.operations).toEqual([
      { path: "a.ts", op: "write", via: "write", seq: 1 },
      // Windows 反斜杠归一为 posix
      { path: "b/win.ts", op: "edit", via: "edit", seq: 3 },
      { path: "new.md", op: "write", via: "apply-patch", seq: 7 },
      { path: "old.md", op: "edit", via: "apply-patch", seq: 7 },
      { path: "gone.md", op: "delete", via: "apply-patch", seq: 7 },
    ]);
    expect(r.changes.map((c) => [c.path, c.op])).toEqual([
      ["a.ts", "write"],
      ["b/win.ts", "edit"],
      ["new.md", "write"],
      ["old.md", "edit"],
      ["gone.md", "delete"],
    ]);
    expect(summarizeReviewChanges(r.operations)).toEqual({
      files: 5,
      writes: 2,
      edits: 2,
      deletes: 1,
    });
  });

  it("bash 启发式：rm 目标 = 删除、重定向目标 = 写入、命令分段防整串误配", () => {
    const events = [
      call("b1", "bash", { command: "rm -rf build tmp.log && cat a.txt | grep x" }),
      result("b1"),
      call("b2", "bash", { command: "echo hi > out.txt; printf x >> app/trace.log 2>/dev/null" }),
      result("b2"),
      call("b3", "pwsh", { command: "Remove-Item temp.txt" }),
      result("b3"),
    ];
    const r = reviewChangesFromEvents(events);
    expect(r.operations.map((o) => [o.path, o.op, o.via])).toEqual([
      ["build", "delete", "bash"],
      ["tmp.log", "delete", "bash"],
      ["out.txt", "write", "bash"],
      ["app/trace.log", "write", "bash"],
    ]);
    // pwsh 的 Remove-Item 不在提取面（bash rm 语法启发式——记档不做）
    expect(r.operations.some((o) => o.path === "temp.txt")).toBe(false);
    // /dev/null 与管道右段不误报
    expect(r.operations.some((o) => o.path === "/dev/null")).toBe(false);
    expect(r.operations.some((o) => o.path === "grep")).toBe(false);
  });

  it("同路径多操作聚合为末态；在途 call（无 result）不进变更清单", () => {
    const events = [
      call("c1", "write", { path: "a.ts", content: "v1" }),
      result("c1"),
      call("c2", "edit", { path: "a.ts", oldText: "v1", newText: "v2" }),
      result("c2"),
      call("c3", "write", { path: "pending.ts", content: "x" }),
      // c3 无 result——在途
    ];
    const r = reviewChangesFromEvents(events);
    expect(r.changes).toEqual([
      { path: "a.ts", op: "edit", via: "edit", lastSeq: 3 },
    ]);
    // 操作流水全记（write+edit 两条）；在途 c3（pending.ts）不进流水
    expect(r.operations.map((o) => o.path)).toEqual(["a.ts", "a.ts"]);
  });

  it("坏 JSON arguments 与非对象 arguments 不炸面（防御性跳过）", () => {
    const bad: SessionEvent = {
      type: "tool/call",
      seq: 1,
      ts: 1_000,
      turn: 1,
      step: 1,
      callId: "cx",
      name: "write",
      arguments: "{not json",
    } as SessionEvent;
    const r = reviewChangesFromEvents([bad, result("cx")]);
    expect(r.operations).toEqual([]);
  });
});

describe("reviewChangesFromEvents — 子代理委派一览", () => {
  it("task 三态：completed / failed / cancelled + 耗时 + 子会话 id", () => {
    const events = [
      call("t1", "task", { description: "探索目录结构", prompt: "ls" }),
      result("t1", { meta: { subagent: { sessionId: "s-child-1", stopReason: "completed" } } }),
      call("t2", "task", { description: "写测试", prompt: "..." }),
      result("t2", {
        isError: true,
        errorCode: "SUBAGENT_FAILED",
        meta: { subagent: { sessionId: "s-child-2", stopReason: "failed" } },
      }),
      call("t3", "task", { description: "会被取消的任务", prompt: "..." }),
      result("t3", {
        isError: true,
        errorCode: "SUBAGENT_CANCELLED",
        meta: { subagent: { sessionId: "s-child-3", stopReason: "cancelled" } },
      }),
    ];
    const r = reviewChangesFromEvents(events);
    expect(r.delegations.map((d) => [d.description, d.status, d.subagentSessionId, d.errorCode])).toEqual([
      ["探索目录结构", "completed", "s-child-1", undefined],
      ["写测试", "failed", "s-child-2", "SUBAGENT_FAILED"],
      ["会被取消的任务", "cancelled", "s-child-3", "SUBAGENT_CANCELLED"],
    ]);
    // 耗时 = result.ts - call.ts（构造器每事件 +10/+500ms）
    expect(r.delegations[0]?.durationMs).toBe(500);
    // task 调用不产生文件变更条目
    expect(r.operations).toEqual([]);
  });

  it("在途 task（无 result）标 running、无耗时；混合普通工具不受影响", () => {
    const events = [
      call("t1", "task", { description: "跑一半", prompt: "..." }),
      call("r1", "write", { path: "x.ts", content: "y" }),
      result("r1"),
    ];
    const r = reviewChangesFromEvents(events);
    expect(r.delegations).toEqual([
      { callSeq: 1, turn: 1, description: "跑一半", status: "running" },
    ]);
    expect(r.changes).toEqual([{ path: "x.ts", op: "write", via: "write", lastSeq: 2 }]);
  });
});
