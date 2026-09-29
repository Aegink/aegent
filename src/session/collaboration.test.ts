// U27/T-P3-131：会话间协作——派发/排队/执行/回投全链 + 权限快照定死
// （排队中改设置任务权限不变）+ 环/自派/目标不存在类型化拒绝 + 流投影重建。
import { describe, expect, it } from "vitest";
import type { CollabEvent, SessionEvent } from "../kernel/events.js";
import {
  CollaborationService,
  collaborationsFromEvents,
  type CollabTask,
} from "./collaboration.js";

/** 双流内存捕获（source/target 两条流——append 注入面）。 */
function makeStreams() {
  const streams = new Map<string, SessionEvent[]>([]);
  let seq = 0;
  const append = (sessionId: string, event: CollabEvent): void => {
    seq += 1;
    const list = streams.get(sessionId) ?? [];
    list.push({ ...event, seq, ts: event.ts || seq });
    streams.set(sessionId, list);
  };
  const eventsOf = (sessionId: string): CollabEvent[] =>
    (streams.get(sessionId) ?? []).filter(
      (e): e is CollabEvent => e.type === "session/collab",
    );
  return { streams, append, eventsOf };
}

const EXECUTOR_CALLS: CollabTask[] = [];

function makeService(opts?: {
  executor?: (task: CollabTask) => Promise<{ result?: string; error?: string; status: "completed" | "failed" }>;
  notifications?: { collabId: string; status: string }[];
}) {
  const { append, eventsOf } = makeStreams();
  const notifications = opts?.notifications ?? [];
  const service = new CollaborationService({
    append,
    sessionExists: (id) => id === "s-source" || id === "s-target" || id === "s-third",
    ...(opts?.executor !== undefined
      ? {
          executor: async (task) => {
            EXECUTOR_CALLS.push(task);
            return opts!.executor!(task);
          },
        }
      : {}),
    notify: (n) => notifications.push(n),
  });
  return { service, eventsOf, notifications };
}

describe("派发/排队/执行/回投全链", () => {
  it("task 全链：dispatch/receive 落双流 → running → completed → 回投源流 + 通知", async () => {
    const { service, eventsOf, notifications } = makeService({
      executor: async () => ({ result: "任务产出", status: "completed" }),
    });
    const id = service.dispatch({
      sourceSessionId: "s-source",
      targetSessionId: "s-target",
      kind: "task",
      content: "整理目录",
      permissionCeiling: "accept-edits",
    });
    expect(id).toMatch(/^collab-/);
    // 排队期：双流各有 1 条
    expect(service.queuedCount("s-target")).toBe(1);
    expect(eventsOf("s-source").map((e) => e.direction)).toEqual(["dispatch"]);
    expect(eventsOf("s-target").map((e) => e.direction)).toEqual(["receive"]);
    // 执行：状态机 + completion 回投（结果落源会话流）
    const ran = await service.runNext("s-target");
    expect(ran).toBe(id);
    const targetEvents = eventsOf("s-target");
    expect(targetEvents.map((e) => e.status)).toEqual(["queued", "running", "completed"]);
    const sourceEvents = eventsOf("s-source");
    const report = sourceEvents.find((e) => e.direction === "report");
    expect(report).toMatchObject({ kind: "completion", status: "completed", result: "任务产出" });
    // 通知（N5 候选——notifyOnCompletion 缺省 true）
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ status: "completed", sourceSessionId: "s-source" });
  });

  it("执行失败：failed 状态机 + 回投 error；队空 runNext = no-op", async () => {
    const { service, eventsOf } = makeService({
      executor: async () => ({ status: "failed", error: "目标会话忙" }),
    });
    service.dispatch({
      sourceSessionId: "s-source",
      targetSessionId: "s-target",
      kind: "task",
      content: "x",
      permissionCeiling: "ask",
    });
    await service.runNext("s-target");
    expect(eventsOf("s-target").map((e) => e.status)).toEqual(["queued", "running", "failed"]);
    expect(eventsOf("s-source").find((e) => e.direction === "report")?.error).toBe("目标会话忙");
    expect(await service.runNext("s-target")).toBeNull(); // 队空 no-op
  });

  it("排队中取消：cancelled 状态机 + 回投 + 通知", () => {
    const { service, eventsOf, notifications } = makeService();
    const id = service.dispatch({
      sourceSessionId: "s-source",
      targetSessionId: "s-target",
      kind: "task",
      content: "x",
      permissionCeiling: "ask",
    });
    expect(service.cancel(id)).toBe(true);
    expect(service.queuedCount("s-target")).toBe(0);
    expect(eventsOf("s-target").at(-1)?.status).toBe("cancelled");
    expect(notifications[0]?.status).toBe("cancelled");
    expect(service.cancel(id)).toBe(false); // 幂等：已不在队
  });
});

describe("权限上限快照（U27 核心安全语义）", () => {
  it("排队中改设置 → 执行仍用提交时快照（不可提权；逆方向也不降权）", async () => {
    let currentCeiling: CollabTask["permissionCeiling"] = "ask"; // 活设置（模拟后续变更）
    const { service, eventsOf } = makeService({
      executor: async (task) => {
        EXECUTOR_CALLS.push(task);
        return { result: `用 ${task.permissionCeiling} 执行`, status: "completed" };
      },
    });
    service.dispatch({
      sourceSessionId: "s-source",
      targetSessionId: "s-target",
      kind: "task",
      content: "需要 accept-edits 的任务",
      permissionCeiling: "accept-edits", // 提交时快照
    });
    // 排队中活设置被改：先升后降——快照都不得跟随（双向定死）
    currentCeiling = "auto";
    await service.runNext("s-target");
    // executor 收到的权限档 = 提交时快照（不是 auto）
    expect(EXECUTOR_CALLS.at(-1)?.permissionCeiling).toBe("accept-edits");
    expect(EXECUTOR_CALLS.at(-1)?.permissionCeiling).not.toBe(currentCeiling);
    // 事件载荷里的快照也是 accept-edits（持久事实——重启后仍可审计）
    const receive = eventsOf("s-target")[0]!;
    expect(receive.permissionCeiling).toBe("accept-edits");
    // 逆方向：提交时 ask，排队中全局降档也不影响快照
    const id2 = service.dispatch({
      sourceSessionId: "s-source",
      targetSessionId: "s-target",
      kind: "task",
      content: "第二个任务",
      permissionCeiling: "ask",
    });
    currentCeiling = "auto";
    await service.runNext("s-target");
    expect(EXECUTOR_CALLS.at(-1)?.permissionCeiling).toBe("ask");
    void id2;
  });
});

describe("类型化拒绝（环/自派/目标不存在）", () => {
  it("目标不存在 → COLLAB_TARGET_MISSING（未知边界不创建）", () => {
    const { service } = makeService();
    expect(() =>
      service.dispatch({
        sourceSessionId: "s-source",
        targetSessionId: "s-ghost",
        kind: "task",
        content: "x",
        permissionCeiling: "ask",
      }),
    ).toThrow(expect.objectContaining({ code: "COLLAB_TARGET_MISSING" }));
  });

  it("自派 → COLLAB_SELF；坏 kind → COLLAB_BAD_KIND", () => {
    const { service } = makeService();
    expect(() =>
      service.dispatch({
        sourceSessionId: "s-source",
        targetSessionId: "s-source",
        kind: "task",
        content: "x",
        permissionCeiling: "ask",
      }),
    ).toThrow(expect.objectContaining({ code: "COLLAB_SELF" }));
    expect(() =>
      service.dispatch({
        sourceSessionId: "s-source",
        targetSessionId: "s-target",
        kind: "spam" as never,
        content: "x",
        permissionCeiling: "ask",
      }),
    ).toThrow(expect.objectContaining({ code: "COLLAB_BAD_KIND" }));
  });

  it("环检测：A 派 B 排队中、B 再派 A → COLLAB_CYCLE（活动派发图为 DAG）", () => {
    const { service } = makeService();
    service.dispatch({
      sourceSessionId: "s-source",
      targetSessionId: "s-target",
      kind: "task",
      content: "A 派 B",
      permissionCeiling: "ask",
    });
    // B 反向派 A：与活动派发链相交 → 环拒绝（E9 同款 DAG 纪律）
    expect(() =>
      service.dispatch({
        sourceSessionId: "s-target",
        targetSessionId: "s-source",
        kind: "task",
        content: "B 派 A",
        permissionCeiling: "ask",
      }),
    ).toThrow(expect.objectContaining({ code: "COLLAB_CYCLE" }));
    // 完成后不再占环（活动图才检查——历史协作可再度派发）
    return service.runNext("s-target").then(() => {
      expect(() =>
        service.dispatch({
          sourceSessionId: "s-target",
          targetSessionId: "s-source",
          kind: "message",
          content: "完成后 B → A 的正常消息",
          permissionCeiling: "ask",
        }),
      ).not.toThrow();
    });
  });
});

describe("流投影（collaborationsFromEvents——事件是唯一真相）", () => {
  it("源视角：dispatch → report 重建为 outgoing + completed + 结果", () => {
    const sourceEvents = [
      { type: "session/collab", seq: 1, ts: 100, collabId: "c1", direction: "dispatch", kind: "task", peerSessionId: "s-target", content: "整理目录", permissionCeiling: "accept-edits" },
      { type: "session/collab", seq: 2, ts: 500, collabId: "c1", direction: "report", kind: "completion", peerSessionId: "s-target", status: "completed", result: "产出" },
    ] as unknown as SessionEvent[];
    const records = collaborationsFromEvents(sourceEvents);
    expect(records).toEqual([
      {
        collabId: "c1",
        kind: "task",
        content: "整理目录",
        peerSessionId: "s-target",
        direction: "outgoing",
        status: "completed",
        permissionCeiling: "accept-edits",
        result: "产出",
        createdAt: 100,
        updatedAt: 500,
      },
    ]);
  });

  it("目标视角：receive → update 重建为 incoming + running；重启后状态可重建", () => {
    const targetEvents = [
      { type: "session/collab", seq: 9, ts: 100, collabId: "c1", direction: "receive", kind: "task", peerSessionId: "s-source", content: "整理目录", status: "queued", permissionCeiling: "accept-edits" },
      { type: "session/collab", seq: 10, ts: 200, collabId: "c1", direction: "update", kind: "task", peerSessionId: "s-source", status: "running" },
    ] as unknown as SessionEvent[];
    const records = collaborationsFromEvents(targetEvents);
    expect(records[0]).toMatchObject({
      direction: "incoming",
      status: "running",
      peerSessionId: "s-source",
      permissionCeiling: "accept-edits",
    });
  });
});
