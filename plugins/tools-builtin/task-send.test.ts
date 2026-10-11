/**
 * W9/T9-2 验收：task resume + task_send 定向投递 + continuable 回投。
 * 计划卡验收面：unknown id → 可见不抛；still running → 提示 TaskWait；
 * working → steer（step 边界注入落流）；terminal → resume（同子会话续跑）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { StreamChunk } from "../../src/core/index.js";
import { SessionEventStore } from "../../src/session/store.js";
import { ToolRegistry } from "../../src/core/index.js";
import type { ModelIdentity } from "../../src/models/identity.js";
import { createSubagentRunner } from "../../src/ext-builtin/subagent-engine/subagent.js";
import { registerBuiltinTools } from "./index.js";
import { createTaskSendTool } from "./task-lifecycle.js";

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
  const dir = mkdtempSync(join(tmpdir(), "aegent-task-send-"));
  tmpRoots.push(dir);
  return dir;
}

const identity: ModelIdentity = { provider: "scripted", modelId: "script-1" };

/** 门控 provider：模型调用挂起等放行——steer 注入窗口的确定性测试面。 */
class GatedProvider {
  readonly requests: number[] = [];
  private release!: () => void;
  readonly gate: Promise<void> = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  letRelease(): void {
    this.release();
  }
  async *streamChat(): AsyncIterable<StreamChunk> {
    this.requests.push(this.requests.length + 1);
    await this.gate;
    yield { type: "text-delta", text: "子代理收尾输出" };
    yield { type: "done" };
  }
}

function makeFixture(options?: { sendToParent?: (message: string) => void }) {
  const root = makeTmpRoot();
  const store = new SessionEventStore();
  const provider = new GatedProvider();
  const runner = createSubagentRunner({
    parentSessionId: "s0",
    store,
    provider: provider as unknown as Parameters<typeof createSubagentRunner>[0]["provider"],
    identity,
    workspaceRoot: root,
    contextWindow: 200_000,
    parentRules: [],
    depth: 0,
    approvalTimeoutMs: 5_000,
    ...(options?.sendToParent !== undefined ? { sendToParent: options.sendToParent } : {}),
  });
  const registry = new ToolRegistry({ env: undefined, sessionId: "s0" });
  registerBuiltinTools(registry, {
    task: { runSubagent: runner.run, delegations: runner.delegations },
    taskWait: { delegations: runner.delegations },
    taskList: { delegations: runner.delegations },
    taskStop: { delegations: runner.delegations },
    taskSend: { delegations: runner.delegations },
  });
  const dispatch = (name: string, args: Record<string, unknown>) =>
    registry.dispatch({ callId: `c-${Math.random().toString(36).slice(2, 8)}`, name, arguments: JSON.stringify(args) });
  return { store, runner, provider, registry, dispatch };
}

describe("task_send / resume（W9/T9-2 定向投递与续跑）", () => {
  it("unknown id → 可见不抛（DELEGATION_UNKNOWN，task_list 提示）", async () => {
    const fx = makeFixture();
    const r = await fx.dispatch("task_send", { delegationId: "dlg-999", message: "hello" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("DELEGATION_UNKNOWN");
    expect(r.content).toContain("dlg-999");
    // resume 同面（未知 id 带可续清单）
    const rr = await fx.dispatch("task", { description: "x", prompt: "继续", resume: "dlg-999" });
    expect(rr.isError).toBe(true);
    expect(rr.content).toContain("DELEGATION_UNKNOWN");
    expect(rr.content).toContain("（空）");
  });

  it("task resume：still running → 类型化拒绝并提示 TaskWait", async () => {
    const fx = makeFixture();
    const start = await fx.dispatch("task", {
      description: "慢任务",
      prompt: "长任务",
      run_in_background: true,
    });
    expect(start.content).toContain('state="started"');
    for (let i = 0; i < 200 && fx.provider.requests.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const r = await fx.dispatch("task", { description: "x", prompt: "继续干", resume: "dlg-1" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("DELEGATION_RUNNING");
    expect(r.content).toContain("task_wait");
    fx.provider.letRelease();
    await fx.runner.delegations.wait({ timeoutMs: 10_000 });
  });

  it("task_send working → steer：受理 + 消息经 step 边界/续跑轮落子流", async () => {
    const fx = makeFixture();
    await fx.dispatch("task", { description: "长任务", prompt: "初始任务", run_in_background: true });
    for (let i = 0; i < 200 && fx.provider.requests.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    // working 目标 → steer 受理（只返回 acceptance）
    const r = await fx.dispatch("task_send", { delegationId: "dlg-1", message: "补充约束：只改 A 文件" });
    expect(r.isError).toBeUndefined();
    const receipt = JSON.parse(r.content) as { accepted: boolean; mode: string; delegationId: string };
    expect(receipt.accepted).toBe(true);
    expect(receipt.mode).toBe("steer");
    expect(receipt.delegationId).toBe("dlg-1");
    // 放行 → 首轮收束 → steer 残留续跑轮消化队列（消息不丢）
    fx.provider.letRelease();
    await fx.runner.delegations.wait({ timeoutMs: 15_000 });
    // steer 消息以 user/message 落子流（A2 注入事实——流存原文）
    const childSession = fx.store.sessionIds().find((id) => id.startsWith("s0::task-"));
    expect(childSession).toBeDefined();
    const userMessages = fx.store
      .load(childSession!)
      .filter((e) => e.type === "user/message")
      .map((e) => (e as { message: { content: string } }).message.content);
    expect(userMessages.some((c) => c.includes("补充约束：只改 A 文件"))).toBe(true);
  });

  it("task_send terminal → resume：同子会话续跑新轮（新委托 id）", async () => {
    const fx = makeFixture();
    const start = await fx.dispatch("task", { description: "首任务", prompt: "初始任务", run_in_background: true });
    const firstChild = ((start.meta as { subagent?: { sessionId: string } } | undefined)?.subagent?.sessionId) ?? "";
    fx.provider.letRelease();
    await fx.runner.delegations.wait({ timeoutMs: 15_000 });
    // terminal → resume（同 childSessionId 新链环）
    const r = await fx.dispatch("task_send", { delegationId: "dlg-1", message: "第二段任务" });
    expect(r.isError).toBeUndefined();
    const receipt = JSON.parse(r.content) as {
      accepted: boolean;
      mode: string;
      delegationId: string;
      childSessionId: string;
    };
    expect(receipt.accepted).toBe(true);
    expect(receipt.mode).toBe("resume");
    expect(receipt.delegationId).not.toBe("dlg-1");
    expect(receipt.childSessionId).toBe(firstChild);
    // 续跑轮完成（provider 门已开——直接跑完）
    await fx.runner.delegations.wait({ ids: [receipt.delegationId], timeoutMs: 15_000 });
    const list = await fx.dispatch("task_list", {});
    expect(list.content).toContain("dlg-1");
    expect(list.content).toContain(receipt.delegationId);
  });

  it("task resume：terminal 委托续跑受理（resume 参数面）", async () => {
    const fx = makeFixture();
    const start = await fx.dispatch("task", { description: "首任务", prompt: "初始任务", run_in_background: true });
    const firstChild = ((start.meta as { subagent?: { sessionId: string } } | undefined)?.subagent?.sessionId) ?? "";
    fx.provider.letRelease();
    await fx.runner.delegations.wait({ timeoutMs: 15_000 });
    const r = await fx.dispatch("task", { description: "续", prompt: "第二段任务", resume: "dlg-1" });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain('state="resumed"');
    expect(r.content).toContain(firstChild);
    await fx.runner.delegations.wait({ timeoutMs: 15_000 });
  });

  it("continuable：sendToParent 在位时子提示带回投指引；task_send(\"parent\") 落父队列", async () => {
    const injected: string[] = [];
    const fx = makeFixture({ sendToParent: (m) => void injected.push(m) });
    await fx.dispatch("task", { description: "回投任务", prompt: "初始任务", run_in_background: true });
    for (let i = 0; i < 200 && fx.provider.requests.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    fx.provider.letRelease();
    await fx.runner.delegations.wait({ timeoutMs: 15_000 });
    // 子流首条 user/message 带指引（withContinuableReturnGuidance）
    const childSession = fx.store.sessionIds().find((id) => id.startsWith("s0::task-"));
    expect(childSession).toBeDefined();
    const firstUser = fx.store.load(childSession!).find((e) => e.type === "user/message");
    expect((firstUser as { message: { content: string } }).message.content).toContain("续跑协作指引");
    expect((firstUser as { message: { content: string } }).message.content).toContain("task_send");
    // "parent" 邮槽（工具级回投面）
    const mailslot = createTaskSendTool({
      delegations: fx.runner.delegations,
      sendToParent: (m) => void injected.push(m),
    });
    const r = (await mailslot.execute(
      { delegationId: "parent", message: "自足结果：架构调研完成" } as never,
      {} as never,
    )) as { content: string; isError?: boolean };
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content).accepted).toBe(true);
    expect(injected).toContain("自足结果：架构调研完成");
    // 顶层无 sendToParent → "parent" 类型化拒绝
    const topLevel = createTaskSendTool({ delegations: fx.runner.delegations });
    const denied = (await topLevel.execute(
      { delegationId: "parent", message: "x" } as never,
      {} as never,
    )) as { isError?: boolean; content: string };
    expect(denied.isError).toBe(true);
    expect(denied.content).toContain("DELEGATION_NO_PARENT_CHANNEL");
  });
});
