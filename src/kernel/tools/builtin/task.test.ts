import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { NewSessionEvent, StreamChunk } from "../../../kernel/events.js";
import type { RuleSource } from "../../../policy/rule-loader.js";
import { isWriteExecuteTool } from "../../../policy/protected-paths.js";
import { SessionStore } from "../../../session/store.js";
import { project } from "../../../session/project.js";
import { PathGuard } from "../../../sandbox/path-guard.js";
import { ToolRegistry } from "../registry.js";
import { registerBuiltinTools } from "./index.js";
import { ScriptedProvider } from "../../loop.test-utils.js";
import { AgentLoop } from "../../loop.js";
import { createSubagentRunner, SubagentDepthError } from "../../subagent.js";
import type { ModelIdentity } from "../../../models/identity.js";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄释放竞态：临时目录留给系统回收（T-P1-35 坑记录）
    }
  }
});

function makeTmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-task-"));
  tmpRoots.push(dir);
  return dir;
}

const identity: ModelIdentity = { provider: "scripted", modelId: "script-1" };

/** 构造（父 registry + runner）：task 经 dispatch 派发，剧本 provider 驱动子代理。 */
function makeFixture(options?: {
  maxDepth?: number;
  parentRules?: RuleSource[];
  scripts?: StreamChunk[][];
}) {
  const root = makeTmpRoot();
  const store = new SessionStore();
  const provider = new ScriptedProvider();
  for (const script of options?.scripts ?? []) provider.mount(script);
  const runner = createSubagentRunner({
    parentSessionId: "s0",
    store,
    provider,
    identity,
    workspaceRoot: root,
    contextWindow: 200_000,
    parentRules: options?.parentRules ?? [],
    depth: 0,
    ...(options?.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    approvalTimeoutMs: 5_000,
  });
  const registry = new ToolRegistry({ sessionId: "s0" });
  registerBuiltinTools(registry, { task: { runSubagent: runner.run } });
  return { root, store, provider, registry, runner };
}

describe("task 工具与子代理 runner（H1/H4/T-P1-42）", () => {
  it("验收①②：派发产出独立子会话——子代理完成纯推理任务，final 输出经 <task_result> 落父流；父流零中间事件（H4）", async () => {
    const { store, provider, registry, runner } = makeFixture({
      scripts: [
        // 子代理唯一一次模型调用：直接产出最终答复（无工具调用 → 一轮即完成）
        [{ type: "text-delta", text: "整理结果：aegent 的事件流是唯一真相" }, { type: "done" }],
      ],
    });
    void runner;

    const result = await registry.dispatch({
      callId: "c-parent",
      name: "task",
      arguments: JSON.stringify({
        description: "总结要点",
        prompt: "总结事件流架构的核心思想",
      }),
    });

    // 验收②：final 输出经 <task_result> 落 result，meta 带 lineage
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("<task_result>");
    expect(result.content).toContain("整理结果：aegent 的事件流是唯一真相");
    const lineage = (result.meta as { subagent?: { sessionId: string; stopReason: string } })
      ?.subagent;
    expect(lineage?.stopReason).toBe("completed");
    expect(lineage?.sessionId).toContain("s0::task-");

    // 子会话结构：完整 turn 生命周期（H1"内核起子循环"——子代理就是一次普通轮）
    const childEvents = store.load(lineage!.sessionId);
    expect(childEvents.some((e) => e.type === "turn/start")).toBe(true);
    expect(childEvents.some((e) => e.type === "turn/end")).toBe(true);
    // 结算前子流已 flush（E10）
    expect(store.pendingCount(lineage!.sessionId)).toBe(0);
    // 模型身份继承（子代理请求走 runner 注入的 provider/identity）
    expect(provider.requests.length).toBe(1);
    // T-P1-44 验收③：delegation 声明进子代理首请求 system（dsh
    // SUBAGENT_DELEGATION_CONTEXT 同构——范围定死/审批自动拒绝/上报限制）
    const systemMsg = provider.requests[0]!.messages.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("委派子代理声明");
    expect(systemMsg?.content).toContain("无法从本会话内部放宽");
    // 父会话提示零变化由 system-prompt.test 的缺省断言钉死（delegation 缺省不渲染）
    // 子会话消息投影的 final assistant 与 result 内容一致
    const childMessages = project(childEvents).messages;
    expect(childMessages.at(-1)?.content).toBe("整理结果：aegent 的事件流是唯一真相");

    // 验收①（H4 结构断言）：dispatch 本体零写父流（tool/call+result 由
    // loop 落，属既有语义）——子代理的 read/assistant/turn 中间事件
    // 结构上进不了父流
    expect(store.load("s0")).toHaveLength(0);
  });

  it("验收③：深度限制双保险——maxDepth=1 时孙代 task 被 H5 deny 规则在 gate 拦下（TOOL_POLICY_DENIED 含 task 规则）", async () => {
    const { store, registry } = makeFixture({
      maxDepth: 1,
      scripts: [
        // 子代理第 1 次调用：再派 task
        [
          { type: "tool-call-delta", id: "g1", name: "task", argsDelta: '{"description":"再分","prompt":"继续拆"}' },
          { type: "done" },
        ],
        // 子代理第 2 次调用：拿到拒绝后收尾
        [{ type: "text-delta", text: "收到，不可再分，我直接做" }, { type: "done" }],
      ],
    });

    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "首层派发", prompt: "随便做点事" }),
    });

    // 整体 completed（子代理自适应收尾），但孙代 task 的结果被 gate deny 拦下
    //（H5 默认禁用的第一道 = deny 规则；深度检查是第二道，见下一用例）
    expect(result.isError).toBeUndefined();
    const childEvents = store.load(
      (result.meta as { subagent: { sessionId: string } }).subagent.sessionId,
    );
    const grandchildResult = childEvents.find(
      (e): e is Extract<typeof e, { type: "tool/result" }> =>
        e.type === "tool/result" && e.callId === "g1",
    );
    expect(grandchildResult?.message.isError).toBe(true);
    expect(grandchildResult?.error?.code).toBe("TOOL_POLICY_DENIED");
    expect(grandchildResult?.message.content).toContain("task");
  });

  it("验收③b：maxDepth=2 时递归委派仍被 H3 拦（task 默认 ask → Deny broker 确定性拒绝）——P1 边界落测试", async () => {
    const { store, registry } = makeFixture({
      maxDepth: 2,
      scripts: [
        // 子代理（depth 1）第 1 次调用：再派 task（无 deny task 规则——
        // 但默认 ask 落 Deny broker）
        [
          { type: "tool-call-delta", id: "g1", name: "task", argsDelta: '{"description":"再分","prompt":"继续拆"}' },
          { type: "done" },
        ],
        // 子代理第 2 次调用：拿到拒绝后收尾
        [{ type: "text-delta", text: "深度到底了，我直接做" }, { type: "done" }],
      ],
    });

    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "首层派发", prompt: "随便做点事" }),
    });

    expect(result.isError).toBeUndefined();
    const childEvents = store.load(
      (result.meta as { subagent: { sessionId: string } }).subagent.sessionId,
    );
    const grandchildResult = childEvents.find(
      (e): e is Extract<typeof e, { type: "tool/result" }> =>
        e.type === "tool/result" && e.callId === "g1",
    );
    // H3 红线：无规则的 task 落默认 ask，子代理审批确定性拒绝（dsh
    // approvalPolicy 'never' 同构）——递归委派的可用性是 P2 权限配置面
    expect(grandchildResult?.message.isError).toBe(true);
    expect(grandchildResult?.error?.code).toBe("TOOL_POLICY_DENIED");
    expect(grandchildResult?.message.content).toContain("审批拒绝");
  });

  it("runner 直调深度超限抛 SubagentDepthError（先于任何状态创建——无半态子会话）", async () => {
    const { store, provider, runner } = makeFixture({ maxDepth: 1 });
    const deep = createSubagentRunner({
      parentSessionId: "x",
      store,
      provider,
      identity,
      workspaceRoot: makeTmpRoot(),
      contextWindow: 200_000,
      parentRules: [],
      depth: 1,
      maxDepth: 1,
      approvalTimeoutMs: 5_000,
    });
    await expect(deep.run("p", "d")).rejects.toThrow(SubagentDepthError);
    // 无新会话创建（先于状态创建的纯拒绝——store 无该流）
    expect(store.load("x::task-1")).toHaveLength(0);
  });

  it("验收④：子代理内工具全部确定性不可用——todo_write 被 H5 deny 规则拦、question/read 落默认 ask 被 Deny broker 拒（H3 语义：审批类操作自动拒绝）", async () => {
    const { store, registry } = makeFixture({
      scripts: [
        [
          { type: "tool-call-delta", id: "w1", name: "todo_write", argsDelta: '{"items":[{"content":"x","status":"in_progress"}]}' },
          { type: "done" },
        ],
        [
          { type: "tool-call-delta", id: "r1", name: "read", argsDelta: '{"path":"notes.txt"}' },
          { type: "done" },
        ],
        [{ type: "text-delta", text: "没有可用工具，我直接答复" }, { type: "done" }],
      ],
    });

    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "探边界", prompt: "试试工具" }),
    });
    expect(result.isError).toBeUndefined();

    const childEvents = store.load(
      (result.meta as { subagent: { sessionId: string } }).subagent.sessionId,
    );
    // todo_write：H5 默认禁用清单成员——deny 规则在子 gate 第一道拦下
    const todoDenied = childEvents.find(
      (e): e is Extract<typeof e, { type: "tool/result" }> =>
        e.type === "tool/result" && e.callId === "w1",
    );
    expect(todoDenied?.message.isError).toBe(true);
    expect(todoDenied?.error?.code).toBe("TOOL_POLICY_DENIED");
    expect(todoDenied?.message.content).toContain("todo_write");
    // read：默认 ask（C3 不变量 3）→ Deny broker 确定性拒绝（H3——子代理
    // 权限不高于父会话：父会话 read 也要问人，子代理无人可问）
    const readDenied = childEvents.find(
      (e): e is Extract<typeof e, { type: "tool/result" }> =>
        e.type === "tool/result" && e.callId === "r1",
    );
    expect(readDenied?.message.isError).toBe(true);
    expect(readDenied?.error?.code).toBe("TOOL_POLICY_DENIED");
    expect(readDenied?.message.content).toContain("审批拒绝");
  });

  it("H5 降级联动：父规则 bash deny 在子代理 gate 拦下 bash 调用（继承 deny、allow 不复活）", async () => {
    const { store, registry } = makeFixture({
      parentRules: [
        { raw: "bash(echo *)", action: "allow" },
        { raw: "bash", action: "deny" },
      ],
      scripts: [
        [
          { type: "tool-call-delta", id: "b1", name: "bash", argsDelta: '{"command":"echo hi"}' },
          { type: "done" },
        ],
        [{ type: "text-delta", text: "bash 被拦，我换方式" }, { type: "done" }],
      ],
    });

    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "权限边界", prompt: "跑个命令" }),
    });
    expect(result.isError).toBeUndefined();

    const childEvents = store.load(
      (result.meta as { subagent: { sessionId: string } }).subagent.sessionId,
    );
    const bashResult = childEvents.find(
      (e): e is Extract<typeof e, { type: "tool/result" }> =>
        e.type === "tool/result" && e.callId === "b1",
    );
    // 父层 allow(echo) 不复活（H5 只继承 deny）；deny(bash) 在子 gate 拦下
    expect(bashResult?.message.isError).toBe(true);
    expect(bashResult?.error?.code).toBe("TOOL_POLICY_DENIED");
    expect(bashResult?.message.content).toContain("deny");
  });

  it("失败结算：子代理模型调用失败 → 父流 isError result（不悬挂不炸父 step），stopReason=failed", async () => {
    // 无剧本：子代理首次模型调用即抛（ScriptedProvider 无剧本报错）
    const { store, registry } = makeFixture({ scripts: [] });

    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "会失败", prompt: "干活" }),
    });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("SUBAGENT_FAILED");
    expect(result.content).toContain("task_error");
    const lineage = (result.meta as { subagent?: { sessionId: string; stopReason: string } })
      ?.subagent;
    expect(lineage?.stopReason).toBe("failed");
    // 子流仍落了 turn/end{error}（failTurn 闭合语义），且已 flush
    const childEvents = store.load(lineage!.sessionId);
    const turnEnd = childEvents.find(
      (e): e is Extract<typeof e, { type: "turn/end" }> => e.type === "turn/end",
    );
    expect(turnEnd?.reason.kind).toBe("error");
    expect(store.pendingCount(lineage!.sessionId)).toBe(0);
  });

  it("T-P1-43 取消联动（先于派发）：signal 已 abort → 不起子轮直接 cancelled 结算（零子会话零模型调用）", async () => {
    const { store, provider, registry } = makeFixture({
      scripts: [[{ type: "text-delta", text: "不该到达" }, { type: "done" }]],
    });
    const controller = new AbortController();
    controller.abort();

    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "迟到", prompt: "别跑" }),
      signal: controller.signal,
    });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("SUBAGENT_CANCELLED");
    expect(result.content).toContain("派发前已取消");
    expect(provider.requests.length).toBe(0);
    // 零子会话（无半态）
    expect(store.load("s0::task-1")).toHaveLength(0);
  });

  it("T-P1-43 取消联动（运行中）：父取消 → 子轮 CancelCause=parent 收轮 aborted → cancelled 结算 + 子流已 flush", async () => {
    const root = makeTmpRoot();
    const store = new SessionStore();
    // GatedProvider：首次模型调用挂起等放行——测试在挂起期间注入取消
    class GatedProvider {
      readonly requests: number[] = [];
      private release!: () => void;
      readonly gate = new Promise<void>((resolve) => {
        this.release = resolve;
      });
      letRelease() {
        this.release();
      }
      async *streamChat(): AsyncIterable<StreamChunk> {
        this.requests.push(this.requests.length + 1);
        await this.gate;
        yield { type: "text-delta", text: "子代理收尾输出" };
        yield { type: "done" };
      }
    }
    const gated = new GatedProvider();
    const runner = createSubagentRunner({
      parentSessionId: "s0",
      store,
      provider: gated as unknown as Parameters<typeof createSubagentRunner>[0]["provider"],
      identity,
      workspaceRoot: root,
      contextWindow: 200_000,
      parentRules: [],
      depth: 0,
      approvalTimeoutMs: 5_000,
    });

    const controller = new AbortController();
    const pending = runner.run("长任务", "慢慢做", { signal: controller.signal });
    // 等子代理进入模型调用（挂起中）
    for (let i = 0; i < 200 && gated.requests.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(gated.requests.length).toBe(1);

    // 父取消：signal abort → 联动 subLoop.cancel({kind:"parent"})
    controller.abort();
    gated.letRelease(); // 放行在途流——协作式收轮（不 race 弃掉在途 promise）

    const outcome = await pending;
    // 前台路径返回 foreground 包裹（T-P3-145 G 联合形状）
    expect(outcome.kind).toBe("foreground");
    if (outcome.kind !== "foreground") throw new Error("unreachable");
    const result = outcome.result;
    expect(result.stopReason).toBe("cancelled");
    expect(result.error).toContain("parent");
    // 子流落了 aborted 终态且已 flush（取消也要有干净的结算事实）
    const childEvents = store.load(result.sessionId);
    const turnEnd = childEvents.find(
      (e): e is Extract<typeof e, { type: "turn/end" }> => e.type === "turn/end",
    );
    expect(turnEnd?.reason.kind).toBe("aborted");
    if (turnEnd?.reason.kind === "aborted") {
      expect(turnEnd.reason.cause.kind).toBe("parent");
    }
    expect(store.pendingCount(result.sessionId)).toBe(0);
  });

  it("T-P1-43 端到端：父 loop cancel → ctx.signal abort → 子轮 parent 取消 → 父流 isError result 落盘后父轮 aborted（原子并入栅栏全链）", async () => {
    const root = makeTmpRoot();
    const store = new SessionStore();

    // 子 provider：挂起等放行（时序控制点）
    class GatedProvider {
      readonly requests: number[] = [];
      private release!: () => void;
      readonly gate = new Promise<void>((resolve) => {
        this.release = resolve;
      });
      letRelease() {
        this.release();
      }
      async *streamChat(): AsyncIterable<StreamChunk> {
        this.requests.push(this.requests.length + 1);
        await this.gate;
        yield { type: "text-delta", text: "不会到达（已取消）" };
        yield { type: "done" };
      }
    }
    const gated = new GatedProvider();
    const runner = createSubagentRunner({
      parentSessionId: "s1",
      store,
      provider: gated as unknown as Parameters<typeof createSubagentRunner>[0]["provider"],
      identity,
      workspaceRoot: root,
      contextWindow: 200_000,
      parentRules: [],
      depth: 0,
      approvalTimeoutMs: 5_000,
    });
    // 父 registry：只注册 task（经 dispatch 走真实 ToolContext 注入面）
    const parentRegistry = new ToolRegistry({ sessionId: "s1" });
    registerBuiltinTools(parentRegistry, { task: { runSubagent: runner.run } });

    // 父 provider：第 1 次调用派 task，第 2 次调用收尾（在取消后不可达——
    // 父轮在 tool/result 落盘后的边界收 aborted）
    const parentProvider = new ScriptedProvider();
    parentProvider.mount([
      { type: "tool-call-delta", id: "p1", name: "task", argsDelta: '{"description":"长活","prompt":"干活"}' },
      { type: "done" },
    ]);
    parentProvider.mount([{ type: "text-delta", text: "不该到达" }, { type: "done" }]);

    // 直接构造父 loop（makeLoop 内部自建 store——runner 需要与父 loop
    // 共享同一 SessionStore 才能断言父子两流的栅栏事实）
    const parentLoop = new AgentLoop({
      sessionId: "s1",
      store,
      provider: parentProvider,
      identity: { provider: "mock", modelId: "m-1" },
      executeTool: (call) => parentRegistry.dispatch(call),
      decideTurn: (record) =>
        record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" },
    });

    const pending = parentLoop.runTurn("派个活");
    // 等子代理进入模型调用（挂起中）→ 父取消
    for (let i = 0; i < 200 && gated.requests.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(gated.requests.length).toBe(1);
    parentLoop.cancel({ kind: "user" });
    gated.letRelease();

    const reason = await pending;
    expect(reason.kind).toBe("aborted");

    // 栅栏全链断言：
    // ②先取父流 result（isError, SUBAGENT_CANCELLED）与其 meta 的子会话 id
    const parentEvents = store.load("s1");
    const taskResult = parentEvents.find(
      (e): e is Extract<typeof e, { type: "tool/result" }> =>
        e.type === "tool/result" && e.callId === "p1",
    );
    expect(taskResult?.message.isError).toBe(true);
    expect(taskResult?.error?.code).toBe("SUBAGENT_CANCELLED");
    const childSessionId = (
      taskResult?.meta as { subagent?: { sessionId?: string } } | undefined
    )?.subagent?.sessionId;
    expect(childSessionId).toBeTruthy();
    // ①子流 aborted 终态（cause=parent）+ 已 flush（取消也有干净结算事实）
    const childEvents = store.load(childSessionId!);
    const childTurnEnd = childEvents.find(
      (e): e is Extract<typeof e, { type: "turn/end" }> => e.type === "turn/end",
    );
    expect(childTurnEnd?.reason.kind).toBe("aborted");
    if (childTurnEnd?.reason.kind === "aborted") {
      expect(childTurnEnd.reason.cause.kind).toBe("parent");
    }
    expect(store.pendingCount(childSessionId!)).toBe(0);
    // ③父流：tool/result 先于 turn/end 落盘（原子并入——取消的子代理产出
    // 是类型化失败事实，不是半成品）
    const resultIdx = taskResult?.seq ?? 0;
    const parentTurnEnd = parentEvents.find(
      (e): e is Extract<typeof e, { type: "turn/end" }> => e.type === "turn/end",
    );
    expect(parentTurnEnd?.reason.kind).toBe("aborted");
    expect(parentTurnEnd?.seq ?? 0).toBeGreaterThan(resultIdx);
  });

  it("T-P1-44 验收④：C46 出口级硬拦在子代理同效——.git/config 写在子 gate 被硬拦（降级不是绕过出口）", async () => {
    const { store, registry } = makeFixture({
      scripts: [
        [
          {
            type: "tool-call-delta",
            id: "w1",
            name: "write",
            argsDelta: '{"path":".git/config","content":"evil"}',
          },
          { type: "done" },
        ],
        [{ type: "text-delta", text: "写不进去，我说明限制" }, { type: "done" }],
      ],
    });

    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "探硬拦", prompt: "改 git 配置" }),
    });
    expect(result.isError).toBeUndefined();

    const childEvents = store.load(
      (result.meta as { subagent: { sessionId: string } }).subagent.sessionId,
    );
    const writeResult = childEvents.find(
      (e): e is Extract<typeof e, { type: "tool/result" }> =>
        e.type === "tool/result" && e.callId === "w1",
    );
    // 硬拦在出口级（C46/C57 纪律）：规则无法授权的保留元数据路径写
    expect(writeResult?.message.isError).toBe(true);
    expect(writeResult?.error?.code).toBe("TOOL_POLICY_DENIED");
    expect(writeResult?.message.content).toContain("硬拦");
  });
});

describe("T-P1-45 收口盘点：子代理与既有机制六面", () => {
  it("收口①plan×task：task 不属 plan 硬关面（isWriteExecuteTool=false）——借道绕硬关结构性不可行（子代理写文件被 Deny broker 拒）", async () => {
    // 静态判定：plan_guard 的 WRITE_EXECUTE_TOOLS 不含 task（派发是委派动作
    // 不是工作区写入；硬关面注释同步说明）
    expect(isWriteExecuteTool("task")).toBe(false);
    // 行为防绕过：plan 模式的担忧是"借子代理之手写文件"——但子代理写
    // hello.txt 也走子 gate（无规则 → ask → Deny broker 确定性拒绝），
    // 与 C46 硬拦同构——绕道通道不存在
    const { store, registry } = makeFixture({
      scripts: [
        [
          { type: "tool-call-delta", id: "w1", name: "write", argsDelta: '{"path":"hello.txt","content":"借道写入"}' },
          { type: "done" },
        ],
        [{ type: "text-delta", text: "写不了，上报限制" }, { type: "done" }],
      ],
    });
    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "借道", prompt: "写文件" }),
    });
    expect(result.isError).toBeUndefined();
    const childEvents = store.load(
      (result.meta as { subagent: { sessionId: string } }).subagent.sessionId,
    );
    const writeResult = childEvents.find(
      (e): e is Extract<typeof e, { type: "tool/result" }> =>
        e.type === "tool/result" && e.callId === "w1",
    );
    expect(writeResult?.message.isError).toBe(true);
    expect(writeResult?.error?.code).toBe("TOOL_POLICY_DENIED");
    expect(writeResult?.message.content).toContain("审批拒绝");
  });

  it("收口⑥快照即规格（O21/O22 反哺）：task 派发成功结算的全链快照——Scenario 头行 + 父子双流单行 JSON", async () => {
    const { store, registry } = makeFixture({
      scripts: [
        [{ type: "text-delta", text: "子代理的整理结果" }, { type: "done" }],
      ],
    });
    const result = await registry.dispatch({
      callId: "c1",
      name: "task",
      arguments: JSON.stringify({ description: "整理", prompt: "整理要点" }),
    });
    expect(result.isError).toBeUndefined();
    const childSessionId = (
      result.meta as { subagent: { sessionId: string } }
    ).subagent.sessionId;

    // 快照：Scenario 头行（O21）+ 父子双流 [emit] 单行 JSON（O23 渲染纪律）
    const lines = [
      "Scenario: task 派发成功结算——子代理独立子会话跑完一轮，final 输出经 <task_result> 原子并入父流（tool/result 携 meta.lineage），父流零中间事件",
      ...[...store.load("s0"), ...store.load(childSessionId)].map(
        (e) => `[emit] ${JSON.stringify(e)}`,
      ),
    ];
    const snapshot = lines.join("\n");
    // 显式文本断言（T-P1-37 卡内定形：不用 .snap 文件，diff 可读性优先）
    expect(snapshot.split("\n")[0]).toContain("Scenario: task 派发成功结算");
    expect(snapshot).toContain('"type":"assistant/message"');
    // task 不落 session/fork 标记（那是 E5 fork 的 lineage；task 的 lineage 在 result.meta）
    expect(snapshot).not.toContain('"type":"session/fork"');
    expect(snapshot).toContain('"type":"turn/end"');
    // 子流的 delegation 声明（T-P1-44）在快照里可读——读快照即知这是子代理会话
    expect(snapshot).toContain("委派子代理声明");
    // 父流零中间事件在快照里可读：s0 的流为空（dispatch 不写父流）
    expect(snapshot).toContain("<task_result>");
  });
});
