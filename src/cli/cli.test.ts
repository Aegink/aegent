/**
 * CLI REPL 测试（K1，T-8-01）——内存桥直连 runAgentChildStdio（同一行协议，
 * 不 spawn 真进程、不需 build），脚本化会话（生成器喂行）断言：
 * ① 完整事件流的摘要输出（echo provider 两轮）；
 * ② 审批全链路：脚本 provider 产 write 调用 → 无规则 ask 挂起 →
 *    approval_requested 摘要 → /approve allow → 工具真实落盘（场景①的
 *    "过策略 → 改文件"链路预演，端到端联测在 T-8-05）；
 * ③ /revert 对话态回退（E4：session/revert 事件经协议转发可见）；
 * ④ renderEventSummary 的事件渲染单元断言。
 */

import { PassThrough } from "node:stream";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type AgentConnection,
  renderEventSummary,
  runCli,
} from "./repl.js";
import { resolveChildSessionArgv } from "./index.js";
import { InvalidSessionIdError } from "../session/session-id.js";
import { runAgentChildStdio, type AgentChildOptions } from "../kernel/agent-process.js";
import { decodeMessage } from "../kernel/agent-protocol.js";
import type { ModelProvider } from "../models/provider.js";
import { InMemoryEventStorage } from "../session/store.js";
import type { StreamChunk } from "../kernel/events.js";

// ---------------------------------------------------------------------------
// 内存桥：PassThrough 流 + 行分帧 + decodeMessage——与 spawnAgentProcess
// 的父进程侧同一纪律（子进程输出当不可信输入）。
// ---------------------------------------------------------------------------

function startMemoryChild(childOptions: AgentChildOptions = {}): {
  connection: AgentConnection;
  done: Promise<void>;
} {
  const childInput = new PassThrough();
  const childOutput = new PassThrough();
  childOutput.setEncoding("utf8");
  const done = runAgentChildStdio({
    ...childOptions,
    input: childInput,
    output: childOutput,
    exit: () => {
      // 测试不真退出进程：exit 语义 = 消息流关闭（父进程观察子进程退出的等价物）
      childOutput.end();
    },
  }).then(
    () => undefined,
    () => undefined,
  );
  const messages = (async function* () {
    let buffer = "";
    for await (const chunk of childOutput) {
      buffer += chunk as string;
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() === "") continue;
        yield decodeMessage(line);
      }
    }
  })();
  return {
    connection: {
      send: (request) => childInput.write(`${JSON.stringify(request)}\n`),
      messages,
      kill: async () => {
        childInput.end();
        await done;
      },
    },
    done,
  };
}

/** 脚本 provider：每次调用消费一列 chunk 剧本（耗尽后重复最后一份）。 */
function scriptedProvider(steps: StreamChunk[][]): ModelProvider {
  let call = 0;
  return {
    async *streamChat() {
      const script = steps[Math.min(call, steps.length - 1)] ?? [];
      call += 1;
      for (const chunk of script) {
        yield chunk;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 脚本化会话运行器：喂行 → 收摘要输出 → 完成后收尾
// ---------------------------------------------------------------------------

async function runScriptedSession(
  childOptions: AgentChildOptions,
  script: (ctx: {
    output: string[];
    waitFor: (predicate: (line: string) => boolean) => Promise<void>;
  }) => AsyncGenerator<string, void, void>,
): Promise<string[]> {
  const { connection } = startMemoryChild(childOptions);
  const output: string[] = [];
  const waiters: { predicate: (line: string) => boolean; resolve: () => void }[] = [];
  const waitFor = (predicate: (line: string) => boolean): Promise<void> =>
    new Promise<void>((resolve) => {
      if (output.some(predicate)) {
        resolve();
        return;
      }
      waiters.push({ predicate, resolve });
    });
  const out = (line: string): void => {
    output.push(line);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.predicate(line)) {
        waiters.splice(i, 1)[0]!.resolve();
      }
    }
  };
  await runCli({ connection, input: script({ output, waitFor }), out });
  await connection.kill();
  return output;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe("aegent CLI（T-8-01）", () => {
  it("脚本化会话产生完整事件流摘要（echo provider 两轮）", async () => {
    const lines = await runScriptedSession(
      {
        assembly: {
          workspaceRoot: mkdtempSync(path.join(tmpdir(), "aegent-cli-")),
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* () {
        yield "第一句话";
        yield "第二句话";
      },
    );
    // 系统提示落流 → 两轮完整 → echo 内容原样可见
    expect(lines).toContain("◆ 系统提示已装配");
    expect(lines).toContain("── turn 1 开始");
    expect(lines).toContain("⬢ echo: 第一句话");
    expect(lines).toContain("── turn 1 结束（completed）");
    expect(lines).toContain("── turn 2 开始");
    expect(lines).toContain("⬢ echo: 第二句话");
    expect(lines).toContain("── turn 2 结束（completed）");
    // 用户原声与 request/header 是静默类
    expect(lines).not.toContain("第一句话");
  });

  it("审批全链路：write 无规则 ask 挂起 → /approve allow → 文件落盘", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-approve-"));
    const target = path.join(workspace, "hello.txt");
    const provider = scriptedProvider([
      [
        {
          type: "tool-call-delta",
          id: "call_1",
          name: "write",
          argsDelta: JSON.stringify({ path: target, content: "你好，场景①" }),
        },
        { type: "done" },
      ],
      [
        { type: "text-delta", text: "已写入。" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } },
        { type: "done" },
      ],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield `把"你好，场景①"写进 ${target}`;
        // write 无用户规则 → 链 abstain → gate 默认 ask → broker 挂起
        await waitFor((line) => line.includes("⏸ 待审批 [call_1]") && line.includes("write"));
        yield "/approve call_1 allow 放行演示";
        // 放行后：工具真实执行 + 第二轮（无 toolCalls → completed 收轮）
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("✔ 审批已放行 call_1"))).toBe(true);
    expect(lines.some((l) => l.startsWith("→ write"))).toBe(true);
    expect(lines.some((l) => l.startsWith("←") && l.includes("Successfully wrote"))).toBe(true);
    // 文件真实落盘（审批前的挂起阶段不执行——落盘只发生在放行后）
    expect(await readFile(target, "utf8")).toBe("你好，场景①");
  });

  it("T-P1-02 C22/C24：/approve --session 后同会话同规则免再问（bash 同命令第二轮直过）", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-scope-"));
    const command = "echo scope-cache-演示";
    const toolCall = (id: string) => [
      {
        type: "tool-call-delta",
        id,
        name: "bash",
        argsDelta: JSON.stringify({ command }),
      },
      { type: "done" },
    ] as StreamChunk[];
    const provider = scriptedProvider([
      toolCall("call_1"),
      [
        { type: "text-delta", text: "第一轮完成" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } },
        { type: "done" },
      ],
      toolCall("call_2"),
      [
        { type: "text-delta", text: "第二轮免问" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } },
        { type: "done" },
      ],
    ]);
    const lines = await runScriptedSession(
      { provider, assembly: { workspaceRoot: workspace, contextWindow: 200_000, approvalTimeoutMs: 5_000 } },
      async function* ({ waitFor }) {
        yield "跑一下命令";
        await waitFor((line) => line.includes("⏸ 待审批 [call_1]"));
        yield "/approve call_1 allow --session";
        await waitFor((line) => line.includes("── turn 1 结束"));
        yield "再跑一次同样的命令";
        // 轮 2：同会话同规则（bash 同命令原文 → 引擎提案同 raw）→ 缓存命中免问
        await waitFor((line) => line.includes("── turn 2 结束"));
      },
    );
    expect(lines.some((l) => l.includes("⏸ 待审批 [call_1]"))).toBe(true);
    expect(lines.some((l) => l.includes("⏸ 待审批 [call_2]"))).toBe(false);
    expect(lines.filter((l) => l.includes("✔ 审批已放行"))).toHaveLength(1);
  });

  it("T-P1-02 对照：不带 --session 的批准是 once——同命令第二轮再次询问", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-once-"));
    const command = "echo once-演示";
    const toolCall = (id: string) => [
      {
        type: "tool-call-delta",
        id,
        name: "bash",
        argsDelta: JSON.stringify({ command }),
      },
      { type: "done" },
    ] as StreamChunk[];
    const provider = scriptedProvider([
      toolCall("call_1"),
      [
        { type: "text-delta", text: "一轮" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } },
        { type: "done" },
      ],
      toolCall("call_2"),
      [
        { type: "text-delta", text: "二轮" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } },
        { type: "done" },
      ],
    ]);
    const lines = await runScriptedSession(
      { provider, assembly: { workspaceRoot: workspace, contextWindow: 200_000, approvalTimeoutMs: 5_000 } },
      async function* ({ waitFor }) {
        yield "跑一下命令";
        await waitFor((line) => line.includes("⏸ 待审批 [call_1]"));
        yield "/approve call_1 allow";
        await waitFor((line) => line.includes("── turn 1 结束"));
        yield "再跑一次";
        await waitFor((line) => line.includes("⏸ 待审批 [call_2]"));
        yield "/approve call_2 deny 理由不变";
        await waitFor((line) => line.includes("── turn 2 结束"));
      },
    );
    expect(lines.some((l) => l.includes("⏸ 待审批 [call_1]"))).toBe(true);
    expect(lines.some((l) => l.includes("⏸ 待审批 [call_2]"))).toBe(true);
  });

  it("T-P1-10 G2：todo_write 更新任务清单——元操作白名单直过，进度在 CLI 可见", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-todo-"));
    const provider = scriptedProvider([
      [
        {
          type: "tool-call-delta",
          id: "call_1",
          name: "todo_write",
          argsDelta: JSON.stringify({
            items: [
              { content: "研究词汇表", status: "completed" },
              { content: "写 todo 工具", status: "in_progress" },
              { content: "验收", status: "pending" },
            ],
          }),
        },
        { type: "done" },
      ],
      [
        { type: "text-delta", text: "清单已同步。" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } },
        { type: "done" },
      ],
    ]);
    const lines = await runScriptedSession(
      { provider, assembly: { workspaceRoot: workspace, contextWindow: 200_000, approvalTimeoutMs: 5_000 } },
      async function* ({ waitFor }) {
        yield "列个任务清单";
        await waitFor((line) => line.includes("── turn 1 结束"));
      },
    );
    // 核心层 meta-ops 白名单放行：todo_write 不经审批（对照 write 的 ⏸ 流程）
    expect(lines.some((l) => l.includes("⏸ 待审批"))).toBe(false);
    expect(lines.some((l) => l.includes("→ todo_write"))).toBe(true);
    // 多步任务进度整幅可见（E12 整值——每次到达即当前状态）
    expect(lines.some((l) => l.includes("◆ 任务清单（1/3 完成）"))).toBe(true);
    expect(lines.some((l) => l.includes("✓ 研究词汇表"))).toBe(true);
    expect(lines.some((l) => l.includes("▶ 写 todo 工具"))).toBe(true);
    expect(lines.some((l) => l.includes("☐ 验收"))).toBe(true);
  });

  it("T-P1-11 G1/G7：plan 模式端到端——进出经审批、硬关压过默认 ask、退出后恢复", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-plan-"));
    const planCall = (id: string, name: string) =>
      [
        { type: "tool-call-delta", id, name, argsDelta: "{}" },
        { type: "done" },
      ] as StreamChunk[];
    const bashCall = (id: string) =>
      [
        {
          type: "tool-call-delta",
          id,
          name: "bash",
          argsDelta: JSON.stringify({ command: "echo plan-demo" }),
        },
        { type: "done" },
      ] as StreamChunk[];
    const tail = (text: string) =>
      [
        { type: "text-delta", text },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } },
        { type: "done" },
      ] as StreamChunk[];
    const provider = scriptedProvider([
      planCall("call_1", "plan_enter"),
      tail("已进入计划模式"),
      bashCall("call_2"),
      tail("被硬关了"),
      planCall("call_3", "plan_exit"),
      tail("已退出计划模式"),
      bashCall("call_4"),
      tail("恢复正常"),
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          planMode: true,
        },
      },
      async function* ({ waitFor }) {
        yield "先做计划";
        // 进出都要用户批准（plan_enter 默认 ask）
        await waitFor((line) => line.includes("⏸ 待审批 [call_1] plan_enter"));
        yield "/approve call_1 allow";
        await waitFor((line) => line.includes("── turn 1 结束"));
        // plan 激活：bash 被出口硬关——直接 ✗，不弹审批（规则/默认 ask 压不过）
        yield "跑个命令试试";
        await waitFor((line) => line.includes("── turn 2 结束"));
        yield "退出计划模式";
        await waitFor((line) => line.includes("⏸ 待审批 [call_3] plan_exit"));
        yield "/approve call_3 allow";
        await waitFor((line) => line.includes("── turn 3 结束"));
        // 退出后恢复既有裁决：bash 回到默认 ask（弹审批）
        yield "再跑一次";
        await waitFor((line) => line.includes("⏸ 待审批 [call_4] bash"));
        yield "/approve call_4 allow";
        await waitFor((line) => line.includes("── turn 4 结束"));
      },
    );
    expect(lines.some((l) => l.includes("⏸ 待审批 [call_1] plan_enter"))).toBe(true);
    expect(lines.some((l) => l.includes("已进入计划模式"))).toBe(true);
    // 硬关：call_2 直接拒（含"plan 模式硬关"），且全程无 call_2 审批弹窗
    expect(lines.some((l) => l.startsWith("✗") && l.includes("plan 模式硬关"))).toBe(true);
    expect(lines.some((l) => l.includes("⏸ 待审批 [call_2]"))).toBe(false);
    // 退出后恢复：call_4 回到默认 ask
    expect(lines.some((l) => l.includes("⏸ 待审批 [call_4] bash"))).toBe(true);
  });

  it("T-P1-12 G3：goal 跨轮保持——每轮开始注入目标提醒（beforeFirstModelRequest 位）", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-goal-"));
    const lines = await runScriptedSession(
      {
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          goal: { text: "完成词汇表扩展" },
        },
      },
      async function* ({ waitFor }) {
        yield "第一轮";
        await waitFor((line) => line.includes("── turn 1 结束"));
        yield "第二轮";
        await waitFor((line) => line.includes("── turn 2 结束"));
      },
    );
    // 初始 goal/set 落流 + 每轮开始注入提醒（injected 渲染为"（注入）"前缀）
    const reminders = lines.filter(
      (l) => l.includes("（注入）[目标提醒]") && l.includes("完成词汇表扩展"),
    );
    expect(reminders.length).toBeGreaterThanOrEqual(2);
  });

  it("/cancel 后未消费输入退回可见（A8/T-P1-52）：⮐ 待处理输入行；不丢也不自动执行", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-return-"));
    const target = path.join(workspace, "note.txt");
    const provider = scriptedProvider([
      // 第 1 次调用：产 read 调用（ask 挂起 = 排队窗口），挂起期间取消
      [
        {
          type: "tool-call-delta",
          id: "call_1",
          name: "read",
          argsDelta: JSON.stringify({ path: target }),
        },
        { type: "done" },
      ],
      // 第 2 次调用不会被消费（取消后队列退回、无续轮）
      [{ type: "text-delta", text: "不该出现" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          // 审批挂起不响应 cancel 信号（C5 Deferred 只认答复/超时）——
          // 400ms 超时结算 isError 后，派发循环的取消检查才接管收轮
          approvalTimeoutMs: 400,
        },
      },
      async function* ({ waitFor }) {
        yield `读一下 ${target}`;
        // read 的 ask 审批挂起（在途轮）——第二条 prompt 排队（未消费）
        yield "排队的第二条";
        await waitFor((line) => line.includes("⏸ 待审批 [call_1]") && line.includes("read"));
        yield "/cancel";
        // aborted → 未消费输入退回可见
        await waitFor((line) => line.includes("⮐ 待处理输入：排队的第二条"));
        await waitFor((line) => line.includes("── turn 1 结束（aborted）"));
      },
    );
    expect(lines.some((l) => l.includes("⮐ 待处理输入：排队的第二条"))).toBe(true);
    // 已消费进历史的首条不退回；退回的排队条目零自动执行（无第二轮）
    expect(lines.some((l) => l.includes("── turn 2"))).toBe(false);
  });

  it("/steer 重定向在途轮（A10/T-P1-47）：审批窗口受理无拒绝；轮结束后 TURN_NOT_ACTIVE", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-steer-"));
    const target = path.join(workspace, "note.txt");
    const provider = scriptedProvider([
      // 第 1 次调用：产 read 调用（无规则 ask → 审批挂起 = 在途轮窗口）
      [
        {
          type: "tool-call-delta",
          id: "call_1",
          name: "read",
          argsDelta: JSON.stringify({ path: target }),
        },
        { type: "done" },
      ],
      // 第 2 次调用：拿到 read 结果收束（step 边界已注入 steer 内容）
      [{ type: "text-delta", text: "读完了，已并入你的补充。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield `读一下 ${target}`;
        // 审批挂起（在途轮窗口）期间 /steer 到达——expectedTurn 由 CLI 从
        // turn/start 事件流自动跟踪，受理无专用回执（user/message 落流，
        // 用户原声展示静默）
        yield "/steer 顺便把行号也报一下";
        await waitFor((line) => line.includes("⏸ 待审批 [call_1]") && line.includes("read"));
        yield "/approve call_1 allow";
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
        // 轮已结束：/steer → TURN_NOT_ACTIVE 类型化拒绝
        yield "/steer 迟到的补充";
        await waitFor((line) => line.includes("[TURN_NOT_ACTIVE]"));
      },
    );
    expect(lines.some((l) => l.includes("── turn 1 结束（completed）"))).toBe(true);
    // 受理路径零拒绝：[TURN_NOT_ACTIVE] 恰一次（只有轮结束后那次）
    expect(lines.filter((l) => l.includes("[TURN_NOT_ACTIVE]"))).toHaveLength(1);
  });

  it("/fork 分支会话（E5/T-P1-40）：forked 回执可见；目标冲突得类型化错误行", async () => {
    const lines = await runScriptedSession(
      {
        assembly: {
          workspaceRoot: mkdtempSync(path.join(tmpdir(), "aegent-cli-fork-")),
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield "第一句话";
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
        yield "/fork f-branch";
        await waitFor((line) => line.includes("⑂ 已分支到新会话 f-branch"));
        yield "/fork f-branch";
        await waitFor((line) => line.includes("[FORK_TARGET_EXISTS]"));
      },
    );
    expect(lines.some((l) => l.includes("⑂ 已分支到新会话 f-branch") && l.includes("切点 seq="))).toBe(true);
    expect(lines.some((l) => l.includes("[FORK_TARGET_EXISTS]"))).toBe(true);
  });

  it("T-P1-44 H3 端到端：task 派发经父审批 → 子循环（delegation 声明 + Deny broker）→ 结算回喂", async () => {
    const provider = scriptedProvider([
      // 父第 1 次调用：产 task 调用（父 gate 默认 ask → 挂起）
      [
        {
          type: "tool-call-delta",
          id: "call_1",
          name: "task",
          argsDelta: JSON.stringify({ description: "整理要点", prompt: "整理事件流要点" }),
        },
        { type: "done" },
      ],
      // 子代理第 1 次调用：直接产出最终答复（子轮 completed）
      [{ type: "text-delta", text: "子代理的整理结果：事件流是唯一真相" }, { type: "done" }],
      // 父第 2 次调用：拿到 task_result 收尾
      [{ type: "text-delta", text: "子代理完成了。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: mkdtempSync(path.join(tmpdir(), "aegent-cli-task-")),
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          subagent: {},
        },
      },
      async function* ({ waitFor }) {
        yield "派个活";
        // task 无用户规则 → 链 abstain → gate 默认 ask → 父审批挂起
        await waitFor((line) => line.includes("⏸ 待审批 [call_1]") && line.includes("task"));
        yield "/approve call_1 allow";
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    // 子代理结算经 tool/result 回喂（task_result 渲染可见）且父轮正常收尾
    expect(lines.some((l) => l.startsWith("→ task"))).toBe(true);
    expect(
      lines.some((l) => l.includes("←") && l.includes("task_result") && l.includes("唯一真相")),
    ).toBe(true);
  });

  it("/revert 对话态回退（session/revert 事件经协议转发）", async () => {
    const lines = await runScriptedSession(
      {
        assembly: {
          workspaceRoot: mkdtempSync(path.join(tmpdir(), "aegent-cli-revert-")),
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield "第一句话";
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
        yield "/revert 2";
        await waitFor((line) => line.includes("◆ 会话回退 → seq=2"));
      },
    );
    expect(lines).toContain("◆ 会话回退 → seq=2");
    // 越界 revert 经 error 行回传（协议失败路径）
  });

  it("越界 /revert 得到类型化错误行", async () => {
    const lines = await runScriptedSession(
      {
        assembly: {
          workspaceRoot: mkdtempSync(path.join(tmpdir(), "aegent-cli-revert-err-")),
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield "随便说点什么";
        await waitFor((line) => line.includes("turn 1 结束"));
        yield "/revert 99999";
        await waitFor((line) => line.includes("[REVERT_FAILED]"));
      },
    );
    expect(lines.some((l) => l.includes("[REVERT_FAILED]") && l.includes("越界"))).toBe(true);
  });
});

describe("renderEventSummary", () => {
  it("关键事件渲染为单行摘要；静默类返回 null", () => {
    const mk = (over: Record<string, unknown>): SessionEventLike =>
      ({ seq: 1, ts: 0, turn: 1, ...over }) as SessionEventLike;
    expect(renderEventSummary(mk({ type: "turn/start" }))).toBe("── turn 1 开始");
    expect(
      renderEventSummary(mk({ type: "turn/end", reason: { kind: "completed" } })),
    ).toBe("── turn 1 结束（completed）");
    expect(
      renderEventSummary(mk({ type: "assistant/message", message: { content: "你好" } })),
    ).toBe("⬢ 你好");
    expect(
      renderEventSummary(
        mk({
          type: "assistant/message",
          message: { content: "前缀" },
          interrupted: true,
        }),
      ),
    ).toBe("⚠（中断，前缀）前缀");
    expect(
      renderEventSummary(mk({ type: "tool/call", step: 1, callId: "c", name: "bash", arguments: "{\"command\":\"ls\"}" })),
    ).toBe("→ bash {\"command\":\"ls\"}");
    expect(
      renderEventSummary(
        mk({ type: "tool/result", step: 1, callId: "c", message: { content: "ok", isError: true } }),
      ),
    ).toBe("✗ ok");
    expect(
      renderEventSummary(
        mk({ type: "session/revert", targetSeq: 7, phase: "revert" }),
      ),
    ).toBe("◆ 会话回退 → seq=7");
    expect(
      renderEventSummary(
        mk({ type: "session/revert", targetSeq: 0, phase: "undo" }),
      ),
    ).toBe("◆ 会话回退已撤销");
    expect(renderEventSummary(mk({ type: "request/header", step: 1, config: {}, reason: "initial" }))).toBeNull();
    expect(
      renderEventSummary(mk({ type: "user/message", message: { content: "原话" }, source: "user" })),
    ).toBeNull();
    expect(
      renderEventSummary(mk({ type: "user/message", message: { content: "预算提醒" }, source: "injected" })),
    ).toBe("（注入）预算提醒");
  });
});

type SessionEventLike = Parameters<typeof renderEventSummary>[0];

// ---------------------------------------------------------------------------
// question 全链路（B8b / T-P1-21）：提问挂起分型可见 → /answer 答复回喂 →
// 超时按拒结算
// ---------------------------------------------------------------------------

describe("question 问答面（B8b / T-P1-21）", () => {
  it("验收①②：提问挂起可见（question_asked 分型行）→ /answer 答复回喂 → turn 正常收尾", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-question-"));
    const provider = scriptedProvider([
      [
        { type: "tool-call-delta", id: "q1", name: "question", argsDelta: JSON.stringify({ question: "用方案 A 还是方案 B？" }) },
        { type: "done" },
      ],
      [{ type: "text-delta", text: "已按你的选择推进方案 B。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          questionTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield "继续之前请确认方案";
        // 验收①：question_asked 协议行 → REPL ❓ 渲染（分型，不走 ⏸ 审批面）
        await waitFor((line) => line.includes("❓ 模型提问 [q1]"));
        yield "/answer q1 方案 B";
        // 验收②：答复作为工具结果回喂，模型收尾、turn completed
        await waitFor((line) => line.includes("用户答复：方案 B"));
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("❓ 模型提问 [q1] 用方案 A 还是方案 B？"))).toBe(true);
    expect(lines.some((l) => l.includes("/answer q1 <答复文本>"))).toBe(true);
    expect(lines.some((l) => l.includes("← 用户答复：方案 B"))).toBe(true);
    // 结算面分型：question 不冒用审批 UI（✔ 审批已放行只属于权限审批）
    expect(lines.some((l) => l.includes("✔ 审批已放行"))).toBe(false);
    expect(lines.some((l) => l.includes("⏸ 待审批"))).toBe(false);
  });

  it("验收③：超时按拒结算（C50 语义复用）——无答复时 isError 回喂、turn 正常收尾", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-question-timeout-"));
    const provider = scriptedProvider([
      [
        { type: "tool-call-delta", id: "q2", name: "question", argsDelta: JSON.stringify({ question: "要继续吗？" }) },
        { type: "done" },
      ],
      [{ type: "text-delta", text: "好的，我按默认方案继续。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          questionTimeoutMs: 400,
        },
      },
      async function* ({ waitFor }) {
        yield "请确认";
        await waitFor((line) => line.includes("❓ 模型提问 [q2]"));
        // 不答复：超时 → tool/result isError（✗）回喂 → 模型自适应收尾
        await waitFor((line) => line.startsWith("✗") && line.includes("问题超时"));
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("问题超时（400ms）未获用户答复：要继续吗？"))).toBe(true);
    expect(lines.some((l) => l.includes("我按默认方案继续"))).toBe(true);
  });

  it("C8：/preset 预设成套切换端到端（T-P1-73）——切换回执可见、未知名本地拒", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-preset-"));
    const provider = scriptedProvider([
      [{ type: "text-delta", text: "好的。" }, { type: "done" }],
      [{ type: "text-delta", text: "好的。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield "/preset workspace";
        // 验收④：切换经 config/refresh 通道生效，回执行可见
        await waitFor((line) => line.includes("✔ 配置已刷新"));
        yield "/preset ghost";
        // 未知名本地即拒（不等子进程）
        await waitFor((line) => line.includes("/preset <readonly|workspace|yolo>"));
        yield "继续";
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("✔ 配置已刷新：sandboxMode"))).toBe(true);
  });

  it("C33：/unattended 无人值守端到端（T-P1-77）——on 时询问转拒绝不挂起、off 恢复审批", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-unattended-"));
    let call = 0;
    const provider = scriptedProvider([
      // on 状态下：write 无规则 → abstain → 无人值守转 deny（不挂起）→
      // 模型收到 isError 后收尾；第二轮 off 恢复 → 挂起
      [{ type: "text-delta", text: "好的，已停下。" }, { type: "done" }],
      [{ type: "text-delta", text: "好的。" }, { type: "done" }],
    ]);
    void call;
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield "/unattended on";
        await waitFor((line) => line.includes("✔ 配置已刷新：unattended"));
        yield `写点东西到 ${workspace}/x.txt`;
        // 无人值守：无审批挂起提示（ask 已转 deny），轮正常收尾
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
        yield "/unattended off";
        await waitFor((line) => line.includes("✔ 配置已刷新：unattended"));
      },
    );
    expect(lines.some((l) => l.includes("✔ 配置已刷新：unattended"))).toBe(true);
    // 轮内没有任何挂起提示（⏸ 待审批）——ask 被转换而非挂起
    expect(lines.some((l) => l.includes("⏸ 待审批"))).toBe(false);
  });


  it("C52：/approve --args 携带修改后参数端到端（T-P1-79）——工具执行改后参数", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-mi-"));
    const target = path.join(workspace, "mi.txt");
    const provider = scriptedProvider([
      [
        {
          type: "tool-call-delta",
          id: "mi",
          name: "write",
          argsDelta: JSON.stringify({ path: target, content: "原始内容" }),
        },
        { type: "done" },
      ],
      [{ type: "text-delta", text: "完成。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield `把"原始内容"写进 ${target}`;
        await waitFor((line) => line.includes("⏸ 待审批 [mi]"));
        // 用户改内容后批准（"改成这样再执行"）
        yield `/approve mi allow 改好了 --args {"path":"${target.split(String.fromCharCode(92)).join("/")}","content":"修改后的内容"}`;
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("✔ 审批已放行 mi"))).toBe(true);
    // 文件落盘的是**修改后**内容（工具收到改后 args）
    expect(await readFile(target, "utf8")).toBe("修改后的内容");
  });

  it("C19：/check 策略 dry-run 端到端（T-P1-75）——allow/deny/ask 三态回执可见、零执行", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-check-"));
    const provider = scriptedProvider([
      [{ type: "text-delta", text: "好的。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          rules: [
            { raw: "bash(git status)", action: "allow" },
            { raw: "bash(git push)", action: "deny" },
          ],
        },
      },
      async function* ({ waitFor }) {
        yield '/check bash {"command":"git status"}';
        await waitFor((line) => line.includes("dry-run [bash] allow"));
        yield '/check bash {"command":"git push"}';
        await waitFor((line) => line.includes("dry-run [bash] deny"));
        yield '/check bash {"command":"curl http://x.example"}';
        // 无规则 → 整链 abstain → dry-run 面如实回"需审批"（不挂起不执行）
        await waitFor((line) => line.includes("dry-run [bash] ask"));
        yield "继续";
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("✔ dry-run [bash] allow"))).toBe(true);
    expect(lines.some((l) => l.includes("✘ dry-run [bash] deny"))).toBe(true);
    expect(lines.some((l) => l.includes("⏸ dry-run [bash] ask"))).toBe(true);
  });

  it("C19：/check 本地参数校验——坏 JSON / 非对象参数本地即拒（不等子进程）", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-check-bad-"));
    const provider = scriptedProvider([
      [{ type: "text-delta", text: "好的。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield "/check bash {bad json";
        await waitFor((line) => line.includes("不是合法 JSON"));
        yield "/check bash [1,2]";
        await waitFor((line) => line.includes("必须是 JSON 对象"));
        yield "继续";
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("! /check 的参数不是合法 JSON"))).toBe(true);
    expect(lines.some((l) => l.includes("! /check 的参数必须是 JSON 对象"))).toBe(true);
  });

  it("C36：模型作者问题文本超 200 字符截断（T-P1-70）——提示有界、答复照常回喂", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-question-bound-"));
    const longQuestion = "超长问题".repeat(80); // 320 字符 > 200 上界
    const provider = scriptedProvider([
      [
        { type: "tool-call-delta", id: "qb", name: "question", argsDelta: JSON.stringify({ question: longQuestion }) },
        { type: "done" },
      ],
      [{ type: "text-delta", text: "已按答复推进。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          questionTimeoutMs: 5_000,
        },
      },
      async function* ({ waitFor }) {
        yield "请回答我的问题";
        // 提示面有界：问题按 MAX_USER_HINT_LENGTH=200 截断渲染
        await waitFor((line) => line.includes("❓ 模型提问 [qb]"));
        yield "/answer qb 好";
        await waitFor((line) => line.includes("用户答复：好"));
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    // ❓ 行渲染的是截断后文本（200 字符 = 50 次重复），不含完整 320 字符
    const askLine = lines.find((l) => l.includes("❓ 模型提问 [qb]"));
    expect(askLine).toBeDefined();
    expect(askLine?.includes("超长问题".repeat(50))).toBe(true);
    expect(askLine?.includes("超长问题".repeat(80))).toBe(false);
    expect(lines.some((l) => l.includes("← 用户答复：好"))).toBe(true);
  });

  it("meta-ops 直过：question 不弹权限审批（挂起即问答本身），plan 模式下仍可提问", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-cli-question-plan-"));
    const provider = scriptedProvider([
      [
        { type: "tool-call-delta", id: "q3", name: "question", argsDelta: JSON.stringify({ question: "计划里先做迁移还是先做 UI？" }) },
        { type: "done" },
      ],
      [{ type: "text-delta", text: "明白了，先做迁移。" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      {
        provider,
        assembly: {
          workspaceRoot: workspace,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          questionTimeoutMs: 5_000,
          planMode: true,
        },
      },
      async function* ({ waitFor }) {
        yield "我们讨论一下计划";
        await waitFor((line) => line.includes("❓ 模型提问 [q3]"));
        // plan 模式硬关只拦写/执行类（WRITE_EXECUTE_TOOLS）——question 是
        // 元交互，meta-ops 白名单放行、出口硬关不误伤
        yield "/answer q3 先做迁移";
        await waitFor((line) => line.includes("用户答复：先做迁移"));
        await waitFor((line) => line.includes("── turn 1 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("← 用户答复：先做迁移"))).toBe(true);
    expect(lines.some((l) => l.includes("plan 模式硬关"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M3/T-P1-86：/resume 端到端（REPL 快链——协议全链在 agent-process.test）
// ---------------------------------------------------------------------------

describe("/resume 崩溃续跑（M3 / T-P1-86）", () => {
  it("/resume → resumed 回执渲染 + 新轮完成（原输入重开）", async () => {
    const storage = new InMemoryEventStorage();
    storage.appendBatch(
      "s0",
      [
        { type: "turn/start", turn: 1 },
        { type: "user/message", turn: 1, message: { content: "崩溃前的指令" }, source: "user", promptId: "p1" },
        { type: "step/start", turn: 1, step: 1 },
        { type: "step/start", turn: 1, step: 2 },
      ].map((e, i) => ({ ...e, seq: i + 1, ts: 1_700_000_000_000 }) as Parameters<typeof storage.appendBatch>[1][number]),
    );
    const provider = scriptedProvider([
      [{ type: "text-delta", text: "续跑完成" }, { type: "done" }],
    ]);
    const lines = await runScriptedSession(
      { storage, provider },
      async function* ({ waitFor }) {
        yield "/resume";
        await waitFor((line) => line.includes("↻ 续跑崩溃轮 turn 1"));
        await waitFor((line) => line.includes("── turn 2 结束（completed）"));
      },
    );
    expect(lines.some((l) => l.includes("↻ 续跑崩溃轮 turn 1"))).toBe(true);
    // 新轮以原输入重开：assistant 回复行可见（user 原声是静默渲染类——
    // 原输入 content 的流内断言在 agent-process.test 协议面）
    expect(lines.some((l) => l.includes("续跑完成"))).toBe(true);
    expect(lines.some((l) => l.includes("── turn 2 结束（completed）"))).toBe(true);
  });
});

describe("L7 命令生命周期落流（T-P1-95）", () => {
  it("/preset 命令 → 流内 command/run+done 配对（commandId 相等、run 先）；未知命令 done=error", async () => {
    const storage = new InMemoryEventStorage();
    const lines = await runScriptedSession(
      { storage },
      async function* () {
        yield "/preset workspace";
        yield "/unknowncmd foo";
        yield "第一句话"; // 触发一个真实轮（命令事件与轮事件并存不互扰）
      },
    );
    const events = storage.readAll("s0").map((e) => e as { type: string; commandId?: string; name?: string; kind?: string });
    const runs = events.filter((e) => e.type === "command/run");
    const dones = events.filter((e) => e.type === "command/done");
    expect(runs).toHaveLength(2); // preset + unknowncmd
    expect(dones).toHaveLength(2);
    // 配对不变量：run/done 的 commandId 一一对应、顺序 run 先
    expect(runs[0]!.name).toBe("preset");
    const presetId = runs[0]!.commandId!;
    expect(dones.find((e) => e.commandId === presetId)!.kind).toBe("success");
    const unknownId = runs[1]!.commandId!;
    expect(dones.find((e) => e.commandId === unknownId)!.kind).toBe("error");
    // run/done 与轮事件并存（turn/start 在流内且互不干扰）
    expect(events.some((e) => e.type === "turn/start")).toBe(true);
    expect(lines.some((l) => l.includes("配置已刷新"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N1/T-P1-110：CLI 会话 id 规范生成点（resolveChildSessionArgv 纯函数直测
// ——main 的真实 spawn 面不可直测，同 agent-child 先例）
// ---------------------------------------------------------------------------

describe("N1/T-P1-110 CLI 会话 id 生成点", () => {
  it("无 --session → 注入 UUID 形状的新 id（非 s0）", () => {
    const { args } = resolveChildSessionArgv(["--provider", "echo"]);
    const idx = args.indexOf("--session");
    expect(idx).toBeGreaterThanOrEqual(0);
    const id = args[idx + 1]!;
    expect(id).not.toBe("s0");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("两次生成互不等（唯一性）", () => {
    const a = resolveChildSessionArgv([]).args;
    const b = resolveChildSessionArgv([]).args;
    expect(a[a.indexOf("--session") + 1]).not.toBe(b[b.indexOf("--session") + 1]);
  });

  it("显式合法 --session 照用（脚手架短 id 兼容）", () => {
    const { args } = resolveChildSessionArgv(["--session", "s0", "--db", "x.db"]);
    expect(args).toEqual(["--session", "s0", "--db", "x.db"]);
  });

  it("显式非法 --session（空白/空/点开头）→ InvalidSessionIdError 启动即拒", () => {
    expect(() => resolveChildSessionArgv(["--session", "bad id"])).toThrowError(
      expect.objectContaining({ code: "INVALID_SESSION_ID" }),
    );
    expect(() => resolveChildSessionArgv(["--session"])).toThrowError(
      expect.objectContaining({ code: "INVALID_SESSION_ID" }),
    );
    expect(() => resolveChildSessionArgv(["--session", ".hidden"])).toThrowError(
      expect.objectContaining({ code: "INVALID_SESSION_ID" }),
    );
  });
});
