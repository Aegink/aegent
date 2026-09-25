/**
 * CLI REPL（K1，T-8-01）——内核的薄壳：输入 → 协议请求 → 事件流摘要打印。
 * 无 TUI 依赖（readline 行式），子进程模式经 T-3-06 协议（agent-process）。
 *
 * 连接面（AgentConnection）与传输解耦：生产 = spawnAgentProcess（真实 stdio
 * 子进程）；测试 = 内存桥（直连 runAgentChildStdio 的注入流，同一行协议）。
 *
 * 命令（P0 最小集）：/revert <seq>（E4 对话态；代码态随 T-8-02 接入）、
 * /cancel、/approve <requestId> <allow|deny> [理由]、/exit。其余输入作为
 * prompt 入队（A9：accepted 收执即返回，轮终态经事件流观察）。
 */

import {
  type AgentMessage,
  type AgentRequest,
} from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";

export interface AgentConnection {
  send(request: AgentRequest): void;
  messages: AsyncIterable<AgentMessage>;
  kill(): Promise<void>;
}

/** 单行摘要的正文上限（超长截断；行式输出不刷屏）。 */
const SUMMARY_CONTENT_LIMIT = 200;

function oneLine(text: string, limit = SUMMARY_CONTENT_LIMIT): string {
  const flat = text.replace(/\r?\n/g, " ⏎ ");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * 事件 → 单行摘要；返回 null = 不打印（静默类：user/message 的用户原声、
 * request/header 的 wire 细节）。P0 的展示纪律：事实类事件一行一条。
 */
export function renderEventSummary(e: SessionEvent): string | null {
  switch (e.type) {
    case "turn/start":
      return `── turn ${e.turn} 开始`;
    case "turn/end":
      return `── turn ${e.turn} 结束（${e.reason.kind}）`;
    case "user/message":
      return e.source === "injected" ? `（注入）${oneLine(e.message.content)}` : null;
    case "assistant/message":
      if (e.interrupted) return `⚠（中断，前缀）${oneLine(e.message.content)}`;
      return e.message.content === ""
        ? "⬢ （模型转入工具调用）"
        : `⬢ ${oneLine(e.message.content)}`;
    case "assistant/attempt":
      return "⚠ 尝试未产出可见消息";
    case "tool/call":
      return `→ ${e.name} ${oneLine(e.arguments, 120)}`;
    case "tool/result": {
      const mark = e.message.isError ? "✗" : "←";
      return `${mark} ${oneLine(e.message.content)}`;
    }
    case "compaction":
      return `◆ 上下文压缩（tokensBefore=${e.tokensBefore}，seq=${e.seq}${e.reason ? `，reason=${e.reason}` : ""}）`;
    case "checkpoint":
      return `◆ 代码检查点 ref=${JSON.stringify(e.ref)}`;
    case "session/revert":
      return e.phase === "revert"
        ? `◆ 会话回退 → seq=${e.targetSeq}`
        : "◆ 会话回退已撤销";
    case "system/message":
      return "◆ 系统提示已装配";
    case "request/header":
      return null;
    default:
      return null;
  }
}

export interface RunCliOptions {
  connection: AgentConnection;
  /** 输入行流（smoke = stdin 管道；交互 = readline iterator；测试 = 生成器）。 */
  input: AsyncIterable<string>;
  /** 输出口（stdout 或测试收集器）。 */
  out: (line: string) => void;
}

/**
 * REPL 主循环：并发消费子进程消息流（渲染摘要）与输入行（命令分派）。
 * 输入结束（EOF / /exit）即 dispose——stdin 关闭语义（子进程把 stdin 关闭
 * 视作 dispose，不留悬挂轮）。
 */
export async function runCli(options: RunCliOptions): Promise<void> {
  const { connection, out } = options;
  let messageId = 0;

  const handleCommand = (command: string): void => {
    const [name, ...rest] = command.split(/\s+/);
    if (name === "/revert") {
      const targetSeq = Number(rest[0]);
      if (!Number.isInteger(targetSeq) || targetSeq < 0) {
        out("用法：/revert <seq>（seq 为要回退到的事件序号）");
        return;
      }
      connection.send({ type: "revert", targetSeq });
      return;
    }
    if (name === "/cancel") {
      connection.send({ type: "cancel", cause: { kind: "user" } });
      return;
    }
    if (name === "/approve") {
      const requestId = rest[0];
      const action = rest[1];
      if (!requestId || (action !== "allow" && action !== "deny")) {
        out("用法：/approve <requestId> allow|deny [理由]");
        return;
      }
      const reason = rest.slice(2).join(" ");
      connection.send({
        type: "approve",
        requestId,
        action,
        ...(reason !== "" ? { reason } : {}),
      });
      return;
    }
    out(`未知命令 ${String(name)}。可用：/revert <seq> /cancel /approve <id> allow|deny [理由] /exit`);
  };

  // idle 观测（对象属性承载——TS 不跨闭包窄化可变捕获）
  const idle = { now: false, waiter: null as (() => void) | null };

  const consuming = (async () => {
    for await (const msg of connection.messages) {
      switch (msg.type) {
        case "ready":
          break;
        case "accepted":
          break;
        case "idle":
          // 子进程宣告空闲：EOF 等待在此放行（"处理完剩余工作再退"）
          idle.now = true;
          idle.waiter?.();
          break;
        case "event": {
          const line = renderEventSummary(msg.event);
          if (line !== null) out(line);
          break;
        }
        case "approval_requested":
          out(`⏸ 待审批 [${msg.requestId}] ${msg.tool} ${oneLine(JSON.stringify(msg.args), 120)}`);
          out(`  /approve ${msg.requestId} allow|deny [理由]（${Math.round(msg.timeoutMs / 1000)}s 内答复，超时按拒绝结算）`);
          break;
        case "approval_settled":
          out(msg.allowed ? `✔ 审批已放行 ${msg.requestId}` : `✘ 审批已拒绝 ${msg.requestId}`);
          break;
        case "error":
          out(`! [${msg.code}] ${oneLine(msg.message)}`);
          break;
      }
    }
  })();

  let exitRequested = false;
  let sentPrompts = 0;
  for await (const line of options.input) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed === "/exit" || trimmed === "/quit") {
      exitRequested = true;
      break;
    }
    if (trimmed.startsWith("/")) {
      handleCommand(trimmed);
      continue;
    }
    messageId += 1;
    sentPrompts += 1;
    // 子进程即将变忙：此前的 idle 宣告作废，EOF 要等下一轮空闲
    idle.now = false;
    connection.send({ type: "prompt", messageId: `cli-${messageId}`, content: trimmed });
  }
  if (exitRequested) {
    // 显式退出：立即 dispose（在途轮被取消是用户决策的一部分）
    connection.send({ type: "dispose" });
  } else if (sentPrompts > 0) {
    // 输入流 EOF（管道结束 / Ctrl+D）且有在途工作：等子进程空闲（在途轮与
    // 队列清空）再 dispose——脚本化会话由此保证完整事件流，不因 EOF 掐断
    // 在途轮。没发过 prompt 就 EOF（空输入）无工作可等，直接 dispose。
    if (!idle.now) {
      await new Promise<void>((resolve) => {
        idle.waiter = resolve;
      });
    }
    connection.send({ type: "dispose" });
  } else {
    connection.send({ type: "dispose" });
  }
  await consuming;
  void exitRequested;
}
