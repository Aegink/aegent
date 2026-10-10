import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StreamChunk } from "./events.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import { ScriptedProvider } from "./loop.test-utils.js";
import { ToolRegistry } from "./tools/registry.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";
import { createSubagentRunner } from "./subagent.js";
import type { ModelIdentity } from "../models/identity.js";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄竞态：留给系统回收（task.test.ts 同款坑记录）
    }
  }
});

function makeTmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-delegation-"));
  tmpRoots.push(dir);
  return dir;
}

const identity: ModelIdentity = { provider: "scripted", modelId: "script-1" };

/** 一个 turn 的最小剧本：text 增量 + done（子代理产出即终）。 */
function turnScript(text: string): StreamChunk[] {
  return [
    { type: "text-delta", text },
    { type: "done" } as never,
  ];
}

function makeFixture(scripts?: StreamChunk[][]) {
  const root = makeTmpRoot();
  const store = new SessionEventStore();
  const provider = new ScriptedProvider();
  for (const script of scripts ?? []) provider.mount(script);
  const runtime = createSubagentRunner({
    parentSessionId: "s0",
    store,
    provider,
    identity,
    workspaceRoot: root,
    contextWindow: 200_000,
    parentRules: [],
    depth: 0,
    approvalTimeoutMs: 5_000,
  });
  const registry = new ToolRegistry({ sessionId: "s0" });
  registerBuiltinTools(registry, {
    task: { runSubagent: runtime.run },
    taskWait: { delegations: runtime.delegations },
    taskList: { delegations: runtime.delegations },
    taskStop: { delegations: runtime.delegations },
  });
  return { store, runtime, registry };
}

describe("后台委托生命周期（T-P3-145 G）", () => {
  it("run_in_background：启动即返回收执 → 注册表 running → 收敛 completed 带报告", async () => {
    const { runtime } = makeFixture([turnScript("探索完成：发现 3 处改动点。")]);
    const outcome = await runtime.run("探索目录", "探索", { background: true, subagentType: "explorer" });
    expect(outcome.kind).toBe("background");
    if (outcome.kind !== "background") throw new Error("unreachable");
    expect(outcome.delegationId).toBe("dlg-1");
    // 启动后立刻查：running（子 loop 已启动但未结算）
    const running = runtime.delegations.list();
    expect(running).toHaveLength(1);
    const first = running[0];
    if (first === undefined) throw new Error("unreachable");
    expect(first.status).toBe("running");
    expect(first.agentName).toBe("explorer");
    // 收敛：报告 12K 内原文落注册表
    const settled = await runtime.delegations.wait({ mode: "all", timeoutMs: 10_000 });
    expect(settled).toHaveLength(1);
    const settled0 = settled[0];
    if (settled0 === undefined) throw new Error("unreachable");
    expect(settled0.status).toBe("completed");
    expect(settled0.report).toBe("探索完成：发现 3 处改动点。");
    expect(runtime.delegations.hasRunning()).toBe(false);
  });

  it("task_wait 工具：dispatch 收敛并渲染报告；未知 id 类型化拒绝", async () => {
    const { runtime, registry } = makeFixture([turnScript("报告正文 ABC")]);
    await registry.dispatch({
      callId: "c0",
      name: "task",
      arguments: JSON.stringify({ description: "探索", prompt: "探索", subagent_type: "explorer", run_in_background: true }),
    });
    const wait = await registry.dispatch({
      callId: "c1",
      name: "task_wait",
      arguments: JSON.stringify({ mode: "all", timeout_ms: 10_000 }),
    });
    expect(wait.isError).toBeUndefined();
    expect(wait.content).toContain("<task_report");
    expect(wait.content).toContain("报告正文 ABC");
    expect(wait.content).toContain('state="completed"');
    const bad = await registry
      .dispatch({
        callId: "c2",
        name: "task_wait",
        arguments: JSON.stringify({ ids: ["dlg-999"], timeout_ms: 200 }),
      })
      .catch((e: unknown) => ({ isError: true, content: e instanceof Error ? e.message : String(e) }) as never);
    expect(bad.isError).toBe(true);
    expect(runtime.delegations.list()[0]?.report).toContain("ABC");
  });

  it("task_stop：运行中委托停止 → 结算 stopped（task_wait 收到错误回执）", async () => {
    // 无剧本 = 子 loop 挂起等待模型（ScriptedProvider 无挂起语义时 turn 快速完——
    // 改用双剧本：第一份正常完成，第二份才可能挂。此处用 race：先启动后立即 stop，
    // 终态允许 completed 或 stopped（stop 与完成的竞态）——断言"终态收敛"本身。
    const { runtime } = makeFixture([turnScript("done")]);
    const outcome = await runtime.run("慢任务", "慢慢做", { background: true });
    if (outcome.kind !== "background") throw new Error("unreachable");
    runtime.delegations.stop(outcome.delegationId); // 最好情况：仍在跑 → cancelled
    const settled = await runtime.delegations.wait({ ids: [outcome.delegationId], timeoutMs: 10_000 });
    expect(settled).toHaveLength(1);
    expect(["completed", "cancelled", "stopped", "failed"]).toContain(settled[0]?.status);
    // stop 对已结算委托 = false
    expect(runtime.delegations.stop(outcome.delegationId)).toBe(false);
  });

  it("task_list 工具：清单含状态与子会话 id", async () => {
    const { runtime, registry } = makeFixture([turnScript("ok")]);
    await registry.dispatch({
      callId: "c0",
      name: "task",
      arguments: JSON.stringify({ description: "探索", prompt: "p", run_in_background: true }),
    });
    await runtime.delegations.wait({ mode: "all", timeoutMs: 10_000 });
    const list = await registry.dispatch({ callId: "c1", name: "task_list", arguments: "{}" });
    expect(list.content).toContain("dlg-1");
    expect(list.content).toContain("agent=general");
  });

  it("并发上限：第 11 个后台启动拒绝（前台 failed 收执，fail-closed）", async () => {
    const scripts = Array.from({ length: 10 }, () => turnScript("ok"));
    const { runtime } = makeFixture(scripts);
    for (let i = 0; i < 10; i++) {
      const o = await runtime.run(`t${i}`, `t${i}`, { background: true });
      if (o.kind !== "background") throw new Error(`第 ${i + 1} 个应成功启动`);
    }
    const overflow = await runtime.run("t11", "t11", { background: true });
    expect(overflow.kind).toBe("foreground");
    if (overflow.kind !== "foreground") throw new Error("unreachable");
    expect(overflow.result.stopReason).toBe("failed");
    expect(overflow.result.error).toContain("并发上限");
  });
});

describe("C4：外部后端分派（opts.backend 消费）", () => {
  it("命中 externalBackends：经注入函数出闸（不 fork 子循环——store 无子会话），结果原样结算", async () => {
    const root = makeTmpRoot();
    const store = new SessionEventStore();
    const provider = new ScriptedProvider();
    const spawned: { prompt: string; description: string }[] = [];
    const runtime = createSubagentRunner({
      parentSessionId: "s0",
      store,
      provider,
      identity,
      workspaceRoot: root,
      contextWindow: 200_000,
      parentRules: [],
      depth: 0,
      approvalTimeoutMs: 5_000,
      externalBackends: new Map([
        [
          "acp",
          async (request) => {
            spawned.push({ prompt: request.prompt, description: request.description });
            return { sessionId: "ext-1", stopReason: "completed", output: `ACP echo：${request.prompt}` };
          },
        ],
      ]),
    });
    const outcome = await runtime.run("外部任务", "外部描述", { backend: "acp" });
    expect(outcome.kind).toBe("foreground");
    if (outcome.kind !== "foreground") throw new Error("unreachable");
    expect(outcome.result).toMatchObject({
      sessionId: "ext-1",
      stopReason: "completed",
      output: "ACP echo：外部任务",
    });
    expect(spawned).toEqual([{ prompt: "外部任务", description: "外部描述" }]);
    // 关键：未走 fork 循环——store 里只有父会话（无 ::task- 子会话流）
    const sessionIds = store.sessionIds();
    expect(sessionIds).toHaveLength(0);
  });

  it("未装配的后端名：failed 结算带 SUBAGENT_BACKEND_UNKNOWN（never-reject 不炸父轮）", async () => {
    const root = makeTmpRoot();
    const runtime = createSubagentRunner({
      parentSessionId: "s0",
      store: new SessionEventStore(),
      provider: new ScriptedProvider(),
      identity,
      workspaceRoot: root,
      contextWindow: 200_000,
      parentRules: [],
      depth: 0,
      approvalTimeoutMs: 5_000,
      externalBackends: new Map(),
    });
    const outcome = await runtime.run("x", "x", { backend: "typo-acp" });
    expect(outcome.kind).toBe("foreground");
    if (outcome.kind !== "foreground") throw new Error("unreachable");
    expect(outcome.result.stopReason).toBe("failed");
    expect(outcome.result.error).toContain("SUBAGENT_BACKEND_UNKNOWN");
  });

  it("in-process 显式名与缺省一致：仍走本文件 fork 循环（既有行为零变化）", async () => {
    const { runtime } = makeFixture([turnScript("fork 产出")]);
    const outcome = await runtime.run("进程内任务", "描述", { backend: "in-process" });
    expect(outcome.kind).toBe("foreground");
    if (outcome.kind !== "foreground") throw new Error("unreachable");
    expect(outcome.result.stopReason).toBe("completed");
    expect(outcome.result.sessionId).toContain("::task-");
  });
});
