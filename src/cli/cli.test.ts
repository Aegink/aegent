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
import { runAgentChildStdio, type AgentChildOptions } from "../kernel/agent-process.js";
import { decodeMessage } from "../kernel/agent-protocol.js";
import type { ModelProvider } from "../models/provider.js";
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
