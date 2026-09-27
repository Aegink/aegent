#!/usr/bin/env node
/**
 * ACP agent 独立启动入口（K4/T-P1-117）——`node dist/src/acp/main.js
 * [--provider echo|openai] …`（参数透传 agent-child 同款）。
 *
 * **独立包纪律**（K4 验收"仅 8 个文件；不塞进 CLI 包"的机内化）：本域
 * `src/acp/` 不被 `src/cli/` import（反向 import 断言在 acp.test.ts——
 * fs 扫描）；依赖方向 acp → kernel 单向。stdio 循环：一行入站 JSON-RPC
 * → parseIncoming → AcpAgent.handleIncoming / handleClientResponse →
 * 出站行（response/通知/agent→client 请求）。坏行 → error response
 * （PARSE_ERROR/INVALID_REQUEST）不崩。
 */

import { createInterface } from "node:readline";

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
