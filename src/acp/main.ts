#!/usr/bin/env node
/**
 * ACP agent 独立启动入口（K4/T-P1-117）——`node dist/src/acp/main.js
 * [--provider echo] [--session-id <id>]`。
 *
 * **独立包纪律**（K4 验收"仅 8 个文件；不塞进 CLI 包"的机内化）：本域
 * `src/acp/` 不被 `src/cli/` import（反向 import 断言在 acp.test.ts——
 * fs 扫描）；依赖方向 acp → kernel 单向。stdio 循环：一行入站 JSON-RPC
 * → parseIncoming → AcpAgent.handleIncoming / handleClientResponse →
 * 出站行（response/通知/agent→client 请求）。坏行 → error response
 * （PARSE_ERROR/INVALID_REQUEST）不崩。
 *
 * C4：echo provider 落地（spawnAcpTransport → createAcpBackend → 本入口
 * 的全链自测闭环——无需真模型即可端到端验证 ACP 后端装配）。openai
 * provider（真实模型 ACP 面）记档留位：需完整 agent 循环装配，随 ACP
 * 真实客户端联调批交付。
 */

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";

import {
  INVALID_REQUEST,
  PARSE_ERROR,
  encodeErrorResponse,
  parseIncoming,
} from "./jsonrpc.js";
import { AcpAgent, type AcpAgentChannel } from "./acp-agent.js";

export interface AcpStdioOptions {
  agent: AcpAgentChannel;
  sessionId: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** 测试注入：进程退出替换（缺省不退出——readline close 自然收束）。 */
  onClosed?: () => void;
}

export function runAcpStdio(options: AcpStdioOptions): void {
  const agent = new AcpAgent({
    agent: options.agent,
    sessionId: options.sessionId,
    write: (line) => options.output.write(`${line}\n`),
  });
  const rl = createInterface({ input: options.input, crlfDelay: Infinity });
  rl.on("line", (line: string) => {
    if (line.trim() === "") return;
    let incoming;
    try {
      incoming = parseIncoming(line);
    } catch (error) {
      const isParse = error instanceof Error && error.name === "JsonRpcParseError";
      options.output.write(
        `${encodeErrorResponse(
          undefined,
          isParse ? PARSE_ERROR : INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        )}\n`,
      );
      return;
    }
    try {
      const { respond } = agent.handleIncoming(incoming);
      if (incoming.kind === "request" && respond !== undefined) {
        options.output.write(`${JSON.stringify({ jsonrpc: "2.0", id: incoming.id, result: respond })}\n`);
      } else if (incoming.kind === "request") {
        // 方法面暂无回执的 request（未来扩展位）——空 result 回执。
        options.output.write(`${JSON.stringify({ jsonrpc: "2.0", id: incoming.id, result: {} })}\n`);
      }
    } catch (error) {
      if (incoming.kind === "request") {
        options.output.write(
          `${encodeErrorResponse(
            incoming.id,
            INVALID_REQUEST,
            error instanceof Error ? error.message : String(error),
          )}\n`,
        );
      }
    }
  });
  rl.on("close", () => {
    options.onClosed?.();
  });
}

/**
 * echo agent 通道：prompt → turn/start + assistant/message（原文回显）+
 * turn/end(completed)。事件 seq/turn 自造（协议一致——本进程无 store，
 * AcpAgent 只消费 type/message.content/reason.kind 三面）。
 */
export function createEchoAgent(): AcpAgentChannel {
  const queue: AgentMessage[] = [];
  let wake: () => void = () => {};
  let closed = false;
  let turnSeq = 0;
  let eventSeq = 0;
  const emit = (event: SessionEvent): void => {
    queue.push({ type: "event", event });
    wake();
  };
  return {
    send: (request: AgentRequest): void => {
      if (request.type !== "prompt") return; // cancel/approve：echo 无操作面
      const turn = ++turnSeq;
      const ts = Date.now();
      emit({ type: "turn/start", turn, seq: ++eventSeq, ts });
      emit({
        type: "assistant/message",
        turn,
        seq: ++eventSeq,
        ts,
        step: 1,
        message: { content: `echo：${request.content}` },
        stream: [],
      });
      emit({ type: "turn/end", turn, seq: ++eventSeq, ts, reason: { kind: "completed" } });
    },
    messages: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<AgentMessage>> => {
          for (;;) {
            const message = queue.shift();
            if (message !== undefined) return { done: false, value: message };
            if (closed) return { done: true, value: undefined as never };
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
      }),
    },
  };
}

// 入口判定：仅直接执行本文件时运行（dist 产物 / node --experimental-strip-types）；
// 测试 import 走不到这里。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let sessionId = "acp-echo-session";
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") {
      const provider = argv[++i] ?? "echo";
      if (provider !== "echo") {
        console.error(`未知 provider「${provider}」——当前可用：echo（openai 面随 ACP 真实联调批交付）`);
        process.exit(2);
      }
      continue;
    }
    if (arg === "--session-id") {
      sessionId = argv[++i] ?? sessionId;
      continue;
    }
    console.error(`未知参数「${String(arg)}」——可用：--provider echo [--session-id <id>]`);
    process.exit(2);
  }
  runAcpStdio({
    agent: createEchoAgent(),
    sessionId,
    input: process.stdin,
    output: process.stdout,
  });
}
