/**
 * CLI REPL（K1，T-8-01）——内核的薄壳：输入 → 协议请求 → 事件流摘要打印。
 * 无 TUI 依赖（readline 行式），子进程模式经 T-3-06 协议（agent-process）。
 *
 * 连接面（AgentConnection）与传输解耦：生产 = spawnAgentProcess（真实 stdio
 * 子进程）；测试 = 内存桥（直连 runAgentChildStdio 的注入流，同一行协议）。
 *
 * 命令（P0 最小集）：/revert <seq>（E4 对话态；代码态随 T-8-02 接入）、
 * /cancel、/approve <requestId> <allow|deny> [理由]、/answer <requestId>
 * <答复>（B8b question 答复分型）、/exit。其余输入作为
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
    case "todo/update": {
      // G2 多步任务进度：清单是 agent 自报的工作面，到达即整幅刷新
      //（E12 整值事件——items 就是当前状态，不需要 diff）。
      const marks: Record<string, string> = {
        pending: "☐",
        in_progress: "▶",
        completed: "✓",
      };
      const done = e.items.filter((i) => i.status === "completed").length;
      const lines = e.items.map(
        (i) => `◆   ${marks[i.status] ?? "☐"} ${i.content}`,
      );
      return [`◆ 任务清单（${done}/${e.items.length} 完成）`, ...lines].join("\n");
    }
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
  // A10/T-P1-47：最新已见轮号（turn/start 事件流观察——/steer 的
  // expectedTurn 来源；未见过任何轮时 null）
  let lastTurn: number | null = null;

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
      // C24：--session 记入会话批准缓存（同会话同规则免再问）、--feedback
      // 落审计。标志剥离后再按位置参数解析，避免与理由文本混淆。
      const tokens = [...rest];
      let scope: "once" | "session" | undefined;
      let feedback: string | undefined;
      const feedbackIdx = tokens.indexOf("--feedback");
      if (feedbackIdx >= 0) {
        const text = tokens[feedbackIdx + 1];
        tokens.splice(feedbackIdx, text === undefined ? 1 : 2);
        if (text !== undefined) feedback = text;
      }
      const sessionIdx = tokens.indexOf("--session");
      if (sessionIdx >= 0) {
        tokens.splice(sessionIdx, 1);
        scope = "session";
      }
      const requestId = tokens[0];
      const action = tokens[1];
      if (!requestId || (action !== "allow" && action !== "deny")) {
        out("用法：/approve <requestId> allow|deny [理由] [--session] [--feedback 文本]");
        return;
      }
      const reason = tokens.slice(2).join(" ");
      connection.send({
        type: "approve",
        requestId,
        action,
        ...(reason !== "" ? { reason } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(feedback !== undefined ? { feedback } : {}),
      });
      return;
    }
    if (name === "/answer") {
      // B8b question 答复（协议分型：question/answer，不复用 approve）——
      // 答复文本可空 = 用户跳过（子进程映射 deny 未作答）
      const requestId = rest[0];
      if (!requestId) {
        out("用法：/answer <requestId> <答复文本>（答复文本留空 = 跳过此问题）");
        return;
      }
      connection.send({ type: "question/answer", requestId, answer: rest.slice(1).join(" ") });
      return;
    }
    if (name === "/steer") {
      // A10/T-P1-47：steer 重定向在途轮——expectedTurn 由 CLI 从已见事件流
      // 取最新轮号（turn 级定位是 UI 层职责，用户不手输轮号）。
      const content = rest.join(" ");
      if (content === "") {
        out("用法：/steer <补充指令>（重定向当前在途轮；无在途轮时会被拒绝）");
        return;
      }
      if (lastTurn === null) {
        out("! 尚未见到任何轮（先发一条消息开启对话，再 /steer 重定向）");
        return;
      }
      connection.send({ type: "steer", expectedTurn: lastTurn, content });
      return;
    }
    if (name === "/fork") {
      // E5 fork 分支会话：/fork <新会话id> [before|after] [atSeq]——
      // 缺省 after + 最新；新会话的后续对话由新进程打开（本连接不动）。
      const targetId = rest[0];
      if (!targetId) {
        out("用法：/fork <新会话id> [before|after] [atSeq]（缺省 after + 最新切点）");
        return;
      }
      const position = rest[1];
      if (position !== undefined && position !== "before" && position !== "after") {
        out("用法：/fork <新会话id> [before|after] [atSeq]（position 只接受 before|after）");
        return;
      }
      const atSeqRaw = rest[2];
      let atSeq: number | undefined;
      if (atSeqRaw !== undefined) {
        atSeq = Number(atSeqRaw);
        if (!Number.isInteger(atSeq) || atSeq < 1) {
          out("用法：/fork <新会话id> [before|after] [atSeq]（atSeq 必须是正整数）");
          return;
        }
      }
      connection.send({
        type: "session/fork",
        targetId,
        ...(position !== undefined ? { position } : {}),
        ...(atSeq !== undefined ? { atSeq } : {}),
      });
      return;
    }
    out(`未知命令 ${String(name)}。可用：/revert <seq> /cancel /steer <补充指令> /approve <id> allow|deny [理由] [--session] [--feedback 文本] /answer <id> <答复> /fork <新会话id> [before|after] [atSeq] /exit`);
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
          // A10/T-P1-47：跟踪最新轮号（/steer 的 expectedTurn 来源）
          if (msg.event.type === "turn/start") lastTurn = msg.event.turn;
          const line = renderEventSummary(msg.event);
          if (line !== null) out(line);
          break;
        }
        case "approval_requested":
          out(`⏸ 待审批 [${msg.requestId}] ${msg.tool} ${oneLine(JSON.stringify(msg.args), 120)}`);
          out(`  /approve ${msg.requestId} allow|deny [理由] [--session] [--feedback 文本]（${Math.round(msg.timeoutMs / 1000)}s 内答复，超时按拒绝结算；--session 记住本会话）`);
          break;
        case "approval_settled":
          out(msg.allowed ? `✔ 审批已放行 ${msg.requestId}` : `✘ 审批已拒绝 ${msg.requestId}`);
          break;
        case "question_asked":
          out(`❓ 模型提问 [${msg.requestId}] ${msg.question}`);
          out(`  /answer ${msg.requestId} <答复文本>（${Math.round(msg.timeoutMs / 1000)}s 内答复，超时按未获答复结算；答复留空 = 跳过）`);
          break;
        case "reverted":
          out(
            msg.codeRestored
              ? `◆ 会话与代码已回退到 seq=${msg.targetSeq}`
              : `◆ 会话回退 → seq=${msg.targetSeq}（本会话无代码检查点，仅对话态）`,
          );
          break;
        case "forked":
          // E5：fork 回执——新会话已创建（后续对话由新进程打开，本连接不动）
          out(`⑂ 已分支到新会话 ${msg.sessionId}（切点 seq=${msg.cutSeq}，复制 ${msg.eventCount} 条事件）`);
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
