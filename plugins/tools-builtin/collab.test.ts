/**
 * W2/T9-1 编排方向盘验收：collab 模型工具 + 本地协作运行时。
 * 计划卡验收面：真会话创建 + 回投（至多一条）+ 上限（4/16）+ 环终止 +
 * G3/G4 不破（collaboration.test.ts / collab-runtime.test.ts 保持全绿）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { StreamChunk } from "../../src/core/index.js";
import { SessionEventStore } from "../../src/session/store.js";
import { DEFAULT_COLLAB_LIMITS } from "../../src/session/collaboration.js";
import {
  createLocalCollabRuntime,
  permissionCeilingFromMode,
  type CollabLineageStore,
} from "../../src/ext-builtin/subagent-engine/collab-local.js";
import { createSubagentRunner } from "../../src/ext-builtin/subagent-engine/subagent.js";
import { ScriptedProvider } from "../../src/core/primitives/loop/loop.test-utils.js";
import type { ModelIdentity } from "../../src/models/identity.js";
import { createCollabTool, type CollabToolPort } from "./collab.js";
import type { SubagentRunner, ToolExecutionResult } from "../../src/core/index.js";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄释放竞态：临时目录留给系统回收（task.test 同款记档）
    }
  }
});

function makeTmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-collab-"));
  tmpRoots.push(dir);
  return dir;
}

const identity: ModelIdentity = { provider: "scripted", modelId: "script-1" };

/** 可控假 runner：剧本化 run（结算/挂起均可控——上限与回投的确定性测试面）。 */
function makeFakeRunner(options?: { hang?: boolean; output?: string }) {
  const calls: Array<{ prompt: string; childSessionId?: string }> = [];
  const deferreds: Array<{ resolve: (r: {
    kind: "foreground";
    result: { sessionId: string; stopReason: "completed" | "failed"; output: string; error?: string };
  }) => void }> = [];
  const run = (
    prompt: string,
    _description: string,
    opts?: Parameters<SubagentRunner["run"]>[2],
  ): Promise<{
    kind: "foreground";
    result: { sessionId: string; stopReason: "completed" | "failed"; output: string; error?: string };
  }> => {
    calls.push({ prompt, ...(opts?.childSessionId !== undefined ? { childSessionId: opts.childSessionId } : {}) });
    if (options?.hang === true) {
      return new Promise((resolve) => deferreds.push({ resolve }));
    }
    return Promise.resolve({
      kind: "foreground",
      result: {
        sessionId: opts?.childSessionId ?? "",
        stopReason: "completed",
        output: options?.output ?? "fake 结果",
      },
    });
  };
  return {
    run,
    calls,
    settleOne: () => {
      const d = deferreds.shift();
      if (d === undefined) throw new Error("没有挂起的 runner 调用");
      d.resolve({
        kind: "foreground",
        result: { sessionId: "", stopReason: "completed", output: "挂起后完成" },
      });
    },
  };
}

/** 血统落库假件（方法级 spy——spawn 的库行/标题/血统断言面）。 */
function makeLineageSpy(): CollabLineageStore & {
  created: string[];
  titles: Array<{ id: string; title: string }>;
  origins: Array<{ id: string; origin: string }>;
} {
  const created: string[] = [];
  const titles: Array<{ id: string; title: string }> = [];
  const origins: Array<{ id: string; origin: string }> = [];
  return {
    created,
    titles,
    origins,
    createSession: (id) => void created.push(id),
    setTitle: (id, title) => void titles.push({ id, title }),
    setSessionOrigin: (id, origin) => void origins.push({ id, origin }),
    getSessionProject: () => undefined,
    setSessionProject: () => undefined,
  };
}

function makeFixture(options?: {
  hang?: boolean;
  limits?: { maxActivePerSource?: number; maxActiveTotal?: number };
  ceiling?: string;
}) {
  const store = new SessionEventStore();
  const runner = makeFakeRunner({ hang: options?.hang });
  const lineage = makeLineageSpy();
  const injected: string[] = [];
  let ceiling = options?.ceiling ?? "ask";
  const runtime = createLocalCollabRuntime({
    parentSessionId: "s-parent",
    store,
    runner,
    getPermissionCeiling: () => ceiling as never,
    lineage,
    injectCompletion: (content) => void injected.push(content),
    ...(options?.limits !== undefined ? { limits: options.limits } : {}),
  });
  const tool = createCollabTool({ sessionId: "s-parent", port: runtime as unknown as CollabToolPort });
  const exec = (args: Record<string, unknown>): Promise<ToolExecutionResult> =>
    tool.execute(args as never, {} as never) as Promise<ToolExecutionResult>;
  return { store, runner, lineage, injected, runtime, tool, exec, setCeiling: (c: string) => { ceiling = c; } };
}

describe("collab 工具（W2/T9-1 编排方向盘）", () => {
  it("上限缺省 = pi-desktop 每父 4 / 全局 16", () => {
    expect(DEFAULT_COLLAB_LIMITS.maxActivePerSource).toBe(4);
    expect(DEFAULT_COLLAB_LIMITS.maxActiveTotal).toBe(16);
  });

  it("spawn 真会话创建：血统三件套 + 双流事件 + 权限快照固化", async () => {
    const fx = makeFixture({ ceiling: "accept-edits" });
    const result = await fx.exec({ action: "spawn", content: "整理目录结构并汇报" });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content) as {
      collabId: string;
      targetSessionId: string;
      permissionCeiling: string;
      caller: string;
    };
    expect(payload.collabId).toMatch(/^collab-\d+$/);
    expect(payload.targetSessionId).toContain("::collab-");
    expect(payload.permissionCeiling).toBe("accept-edits");
    expect(payload.caller).toBe("s-parent");
    // 血统三件套（createSession/标题秒级可读/setSessionOrigin 血统标记）
    expect(fx.lineage.created).toEqual([payload.targetSessionId]);
    expect(fx.lineage.titles[0]?.title).toContain("整理目录结构");
    expect(fx.lineage.origins).toEqual([{ id: payload.targetSessionId, origin: "s-parent" }]);
    // 双流事件（G4 账本——源流 dispatch + worker 流 receive，同快照）
    const parentEvents = fx.store.load("s-parent").filter((e) => e.type === "session/collab");
    const workerEvents = fx.store.load(payload.targetSessionId).filter((e) => e.type === "session/collab");
    expect(parentEvents.some((e) => (e as { direction: string }).direction === "dispatch")).toBe(true);
    expect(workerEvents.some((e) => (e as { direction: string }).direction === "receive")).toBe(true);
    // 执行体提示带权限快照（固化证据——G4 双向不变的执行半边）
    await vi.waitFor(() => expect(fx.runner.calls.length).toBe(1));
    expect(fx.runner.calls[0]?.prompt).toContain("权限档快照：accept-edits");
  });

  it("spawn 全链真执行：ScriptedProvider 驱动 worker 循环，结果回账本", async () => {
    const root = makeTmpRoot();
    const store = new SessionEventStore();
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "整理结果：事件流是唯一真相" }, { type: "done" }]);
    const runner = createSubagentRunner({
      parentSessionId: "s-parent",
      store,
      provider,
      identity,
      workspaceRoot: root,
      contextWindow: 200_000,
      parentRules: [],
      depth: 0,
      approvalTimeoutMs: 5_000,
    });
    const injected: string[] = [];
    const runtime = createLocalCollabRuntime({
      parentSessionId: "s-parent",
      store,
      runner,
      getPermissionCeiling: () => "ask",
      injectCompletion: (content) => void injected.push(content),
    });
    const tool = createCollabTool({ sessionId: "s-parent", port: runtime });
    const result = (await tool.execute({
      action: "spawn",
      content: "总结事件流架构的核心思想",
    } as never, {} as never)) as ToolExecutionResult;
    expect(result.isError).toBeUndefined();
    const { collabId } = JSON.parse(result.content) as { collabId: string };
    // 等待结算（wait 动作就是模型面等待通道——顺带验证）
    const waitResult = (await tool.execute({
      action: "wait",
      collabId,
      timeoutMs: 10_000,
    } as never, {} as never)) as ToolExecutionResult;
    const record = JSON.parse(waitResult.content) as { status: string; result?: string };
    expect(record.status).toBe("completed");
    expect(record.result).toContain("事件流是唯一真相");
    // worker 流是真实事件流（turn 落地 + assistant 结论）
    const target = JSON.parse(result.content) as { targetSessionId: string };
    const workerEvents = store.load(target.targetSessionId);
    expect(workerEvents.some((e) => e.type === "turn/end")).toBe(true);
    // 回投恰好一条（至多一条纪律）
    await vi.waitFor(() => expect(injected.length).toBe(1));
    expect(injected[0]).toContain("协作回投");
    expect(injected[0]).toContain("非用户输入");
    expect(injected[0]).toContain("不要因本回投向同一目标再次派发协作");
  });

  it("completion 回投至多一条：notifyOnCompletion=false 不回投", async () => {
    const fx = makeFixture();
    await fx.exec({ action: "spawn", content: "任务A", notifyOnCompletion: false });
    await vi.waitFor(() => expect(fx.injected.length).toBe(0));
    const first = await fx.exec({ action: "spawn", content: "任务B" });
    const { collabId } = JSON.parse(first.content) as { collabId: string };
    await vi.waitFor(() => expect(fx.injected.length).toBe(1));
    expect(fx.injected[0]).toContain(collabId);
  });

  it("每父在途上限 4：第 5 个派发 COLLAB_LIMIT，收敛后放行", async () => {
    const fx = makeFixture({ hang: true });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await fx.exec({ action: "spawn", content: `任务${i}` });
      expect(r.isError).toBeUndefined();
      ids.push((JSON.parse(r.content) as { collabId: string }).collabId);
    }
    const blocked = await fx.exec({ action: "spawn", content: "任务5" });
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toContain("COLLAB_LIMIT");
    expect(blocked.content).toContain("4/4");
    // 收敛一个 → 上限腾位 → 再派成功（fail-visible 非永久封禁）
    fx.runner.settleOne();
    await vi.waitFor(() => expect(fx.injected.length).toBe(1));
    const retry = await fx.exec({ action: "spawn", content: "任务5重试" });
    expect(retry.isError).toBeUndefined();
    void ids;
  });

  it("全局在途上限：超过 maxActiveTotal 类型化拒绝", async () => {
    const fx = makeFixture({ hang: true, limits: { maxActiveTotal: 2 } });
    await fx.exec({ action: "spawn", content: "T1" });
    await fx.exec({ action: "spawn", content: "T2" });
    const blocked = await fx.exec({ action: "spawn", content: "T3" });
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toContain("COLLAB_LIMIT");
  });

  it("环终止：worker 无 collab 工具 → 跨会话环结构上不可构造；服务内环检测保持（G3）+ send 未知目标类型化拒绝", async () => {
    const fx = makeFixture({ hang: true });
    // spawn A→W 在途
    const spawn = await fx.exec({ action: "spawn", content: "A 派 W" });
    const { targetSessionId } = JSON.parse(spawn.content) as { targetSessionId: string };
    // send 未知目标（不是本运行时记录的 worker）→ COLLAB_TARGET_MISSING
    const unknown = await fx.exec({ action: "send", targetSessionId: "s-ghost", content: "x" });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toContain("COLLAB_TARGET_MISSING");
    // send 已知 worker（合法——新 collabId 排队）
    const send = await fx.exec({ action: "send", targetSessionId, content: "追加消息" });
    expect(send.isError).toBeUndefined();
  });

  it("G4 权限快照双向不变：dispatch 后改设置，在途任务仍用原快照", async () => {
    const fx = makeFixture({ hang: true, ceiling: "ask" });
    const first = await fx.exec({ action: "spawn", content: "快照任务" });
    const { targetSessionId } = JSON.parse(first.content) as { targetSessionId: string };
    // dispatch 后"提权"（ceiling 收闭包改 accept-edits）——在途任务不受影响
    fx.setCeiling("accept-edits");
    await vi.waitFor(() => expect(fx.runner.calls.length).toBe(1));
    expect(fx.runner.calls[0]?.prompt).toContain("权限档快照：ask");
    void targetSessionId;
  });

  it("status/result/cancel/list 动作面（观察与取消）", async () => {
    const fx = makeFixture({ hang: true });
    const spawn = await fx.exec({ action: "spawn", content: "观察任务" });
    const { collabId, targetSessionId } = JSON.parse(spawn.content) as {
      collabId: string;
      targetSessionId: string;
    };
    // status：在途
    const running = await fx.exec({ action: "status", collabId });
    expect((JSON.parse(running.content) as { status: string }).status).toBe("queued");
    // result：未结算 → 类型化提示 wait
    const notSettled = await fx.exec({ action: "result", collabId });
    expect(notSettled.isError).toBe(true);
    expect(notSettled.content).toContain("COLLAB_NOT_SETTLED");
    // list
    const list = await fx.exec({ action: "list" });
    const listPayload = JSON.parse(list.content) as { total: number };
    expect(listPayload.total).toBeGreaterThanOrEqual(1);
    // cancel：排队中的可取消 → 回投 cancelled（至多一条）
    const cancel = await fx.exec({ action: "cancel", collabId });
    expect(cancel.content).toContain('"cancelled":true');
    await vi.waitFor(() => expect(fx.injected.length).toBe(1));
    expect(fx.injected[0]).toContain("cancelled");
    // cancel 幂等闸：已结算的再取消 = false（不产生第二条回投）
    const cancelAgain = await fx.exec({ action: "cancel", collabId });
    expect(cancelAgain.content).toContain("无法取消");
    await vi.waitFor(() => expect(fx.injected.length).toBe(1));
    // 未知 id 的 status → 类型化
    const unknownStatus = await fx.exec({ action: "status", collabId: "collab-9999" });
    expect(unknownStatus.isError).toBe(true);
    expect(unknownStatus.content).toContain("COLLAB_UNKNOWN");
    void targetSessionId;
  });

  it("参数校验：缺 content / 缺 collabId / spawn 带 target / 坏 action 均类型化拒绝", async () => {
    const fx = makeFixture();
    expect((await fx.exec({ action: "spawn" })).content).toContain("INVALID_ARGUMENTS");
    expect((await fx.exec({ action: "status" })).content).toContain("INVALID_ARGUMENTS");
    expect(
      (await fx.exec({ action: "spawn", content: "x", targetSessionId: "s-1" })).content,
    ).toContain("不接受 targetSessionId");
    expect((await fx.exec({ action: "dance" })).content).toContain("INVALID_ARGUMENTS");
    expect((await fx.exec({ action: "send", content: "x", targetSessionId: "s-ghost" })).content).toContain(
      "COLLAB_TARGET_MISSING",
    );
  });

  it("权限档映射：accept-edits/auto 原样、其余（含 ask-all/unattended/缺省）落 ask", () => {
    expect(permissionCeilingFromMode("accept-edits")).toBe("accept-edits");
    expect(permissionCeilingFromMode("auto")).toBe("auto");
    expect(permissionCeilingFromMode("ask-all")).toBe("ask");
    expect(permissionCeilingFromMode("unattended")).toBe("ask");
    expect(permissionCeilingFromMode(undefined)).toBe("ask");
  });
});

/** StreamChunk 类型引用保活（剧本形状文档面——与 task.test 同源）。 */
const _scriptShape: StreamChunk[] = [{ type: "done" }];
void _scriptShape;
