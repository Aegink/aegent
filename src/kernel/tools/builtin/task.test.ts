import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { NewSessionEvent, StreamChunk } from "../../../kernel/events.js";
import type { RuleSource } from "../../../policy/rule-loader.js";
import { SessionStore } from "../../../session/store.js";
import { project } from "../../../session/project.js";
import { PathGuard } from "../../../sandbox/path-guard.js";
import { ToolRegistry } from "../registry.js";
import { registerBuiltinTools } from "./index.js";
import { ScriptedProvider } from "../../loop.test-utils.js";
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
  registerBuiltinTools(registry, { task: { runSubagent: runner } });
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
    await expect(deep("p", "d")).rejects.toThrow(SubagentDepthError);
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
});
