/**
 * ACP agent 端会话映射（K4/T-P1-117）——把 ACP 客户端的 JSON-RPC 方法
 * 映射到我方 agent 协议（AgentRequest），把 agent 协议消息反向映射为
 * ACP 通知（session/update 流式输出）与 agent→client 的 JSON-RPC 请求
 * （session/request_permission——审批挂起的 ACP 面）。
 *
 * 方法面（最小落地——真实客户端联调时再对齐规范全文，卡面记档）：
 * - `initialize` → 能力面回执（protocolVersion + agentCapabilities）
 * - `session/new` → 新会话 id（ACP sessionId 与我方一致——N1 统一 id）
 * - `session/prompt` → AgentRequest prompt；**response 在轮结束时返回**
 *   （ACP 长请求语义——stopReason 由 turn/end reason 映射）
 * - `session/cancel`（通知）→ AgentRequest cancel
 * - `session/request_permission`（**agent→client 请求**）：agent 协议的
 *   approval_requested 挂起 → 本层转 ACP 请求；client 的 response
 *   （options 选中的 optionId）→ AgentRequest approve（source="acp"——
 *   C6 审计面）；deny/关闭 → action:"deny"
 *
 * 依赖方向：acp → kernel 单向（协议与词汇同源——"内核协议自有 + ACP 适配"）。
 */

import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";
import { encodeNotification, encodeRequest, encodeResponse, type JsonRpcIncoming } from "./jsonrpc.js";

/** ACP 端复用的 agent 通道（与 host/bridge 的 AgentChannel 同形状）。 */
export interface AcpAgentChannel {
  send(request: AgentRequest): void;
  messages: AsyncIterable<AgentMessage>;
}

export interface AcpAgentOptions {
  agent: AcpAgentChannel;
  /** 缺省会话 id（session/new 未显式给 id 时用；测试注入定值）。 */
  sessionId: string;
  /** 行写出口（client 方向）。 */
  write: (line: string) => void;
}

/** turn/end reason.kind → ACP stopReason（公开约定词表的最小映射）。 */
const STOP_REASON_OF: Record<string, string> = {
  completed: "end_turn",
  aborted: "cancelled",
  blocked: "end_turn",
  error: "error",
  "max-tokens": "max_tokens",
};

interface PendingPrompt {
  readonly responseId: number | string;
  turn: number | undefined;
}

export class AcpAgent {
  private readonly pendingPrompts = new Map<string, PendingPrompt>();
  /** agent→client 的审批请求：jsonrpc id → 我方审批 requestId。 */
  private readonly permissionRequests = new Map<string, string>();
  private nextJsonRpcId = 1;
  private nextMessageOrdinal = 0;

  constructor(private readonly options: AcpAgentOptions) {
    void (async () => {
      for await (const message of options.agent.messages) {
        this.handleAgentMessage(message);
      }
    })().catch(() => {});
  }

  private handleAgentMessage(message: AgentMessage): void {
    if (message.type === "event") {
      this.forwardEvent(message.event);
      return;
    }
    if (message.type === "approval_requested") {
      // 审批挂起 → agent→client 的 ACP 请求（client response 经
      // handleClientResponse 回来转 approve）。
      const id = this.nextJsonRpcId++;
      this.permissionRequests.set(String(id), message.requestId);
      this.options.write(
        encodeRequest(id, "session/request_permission", {
          sessionId: this.options.sessionId,
          toolCall: { toolCallId: message.requestId, title: message.tool },
          options: [
            { kind: "allow_once", name: "allow", optionId: "allow" },
            { kind: "reject_once", name: "deny", optionId: "deny" },
          ],
        }),
      );
      return;
    }
    if (message.type === "error") {
      this.options.write(
        encodeNotification("session/error", {
          sessionId: this.options.sessionId,
          code: message.code,
          message: message.message,
        }),
      );
      return;
    }
    // accepted/idle/reverted/prompt_returned：ACP 面无对应（prompt 受理
    // 语义由 response 长请求承载——记档）。
  }

  private forwardEvent(event: SessionEvent): void {
    if (event.type === "assistant/message") {
      // 流式输出 → session/update 通知（agent_message_chunk——ACP 公开
      // 约定形状；attempt 是失败尝试不进流式面）。
      const text = (event.message as { content?: string }).content ?? "";
      if (text !== "") {
        this.options.write(
          encodeNotification("session/update", {
            sessionId: this.options.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text },
            },
          }),
        );
      }
      return;
    }
    if (event.type === "turn/start") {
      for (const pending of this.pendingPrompts.values()) {
        if (pending.turn === undefined) pending.turn = event.turn;
      }
      return;
    }
    if (event.type === "turn/end") {
      // 轮结算：挂起的 session/prompt response + 状态通知。
      const stopReason = STOP_REASON_OF[event.reason.kind] ?? "end_turn";
      for (const [messageId, pending] of [...this.pendingPrompts.entries()]) {
        if (pending.turn === event.turn) {
          this.pendingPrompts.delete(messageId);
          this.options.write(encodeResponse(pending.responseId, { stopReason }));
        }
      }
      this.options.write(
        encodeNotification("session/update", {
          sessionId: this.options.sessionId,
          update: { sessionUpdate: "turn_finished", turn: event.turn, stopReason },
        }),
      );
    }
  }

  /** 入站分发（jsonrpc.parseIncoming 的产物）；request 返回同步回执。 */
  handleIncoming(incoming: JsonRpcIncoming): { respond?: unknown } {
    if (incoming.kind === "notification") {
      if (incoming.method === "session/cancel") {
        this.options.agent.send({ type: "cancel", cause: { kind: "user" } });
      }
      return {};
    }
    const { id, method } = incoming;
    const params = (incoming.params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "initialize":
        return {
          respond: {
            protocolVersion: 1,
            agentCapabilities: { loadSession: false, promptCapabilities: { embeddedContext: false } },
          },
        };
      case "session/new": {
        // ACP sessionId 与我方一致（N1 统一 id——client 传入即沿用）。
        const sessionId =
          typeof params["sessionId"] === "string" && params["sessionId"] !== ""
            ? (params["sessionId"] as string)
            : this.options.sessionId;
        return { respond: { sessionId } };
      }
      case "session/prompt": {
        const messageId = `acp-${this.nextMessageOrdinal++}`;
        this.pendingPrompts.set(messageId, { responseId: id, turn: undefined });
        this.options.agent.send({
          type: "prompt",
          messageId,
          content: extractPromptText(params["content"]),
        });
        return {}; // 长请求——response 由 turn/end 路径回
      }
      default:
        // 未知方法面：空回执（未来扩展位）——不崩不挂。
        return { respond: {} };
    }
  }

  /** client 对 ACP 请求的答复（jsonrpc response 行）→ 审批答复转达。 */
  handleClientResponse(id: number | string, result: unknown): void {
    const key = String(id);
    const approvalRequestId = this.permissionRequests.get(key);
    if (approvalRequestId === undefined) return;
    this.permissionRequests.delete(key);
    this.options.agent.send({
      type: "approve",
      requestId: approvalRequestId,
      action: extractAllowAction(result),
      source: "acp",
    });
  }
}

/** ACP content（[{type:"text", text}] 或纯串）→ 我方 prompt 纯文本。 */
function extractPromptText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block !== null && typeof block === "object" &&
        typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

/** client 的 outcome（{outcome:"selected", optionId:"allow"}）→ allow/deny。 */
function extractAllowAction(result: unknown): "allow" | "deny" {
  if (result !== null && typeof result === "object") {
    const optionId = (result as { outcome?: { optionId?: unknown } }).outcome?.optionId;
    if (optionId === "allow") return "allow";
  }
  return "deny";
}
