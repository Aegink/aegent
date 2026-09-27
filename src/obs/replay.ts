/**
 * 轨迹回放（L4，T-P1-126，codex·rollout-trace"observe first, interpret
 * later"同构）——事件流 → **请求级**重放：每个 request/header 重建它发出
 * 时刻的完整模型请求（消息序列 + 身份 + 工具清单）与对应响应。
 *
 * 与 E7 transcript（人类检视条目流）分工：transcript 给人看（回合帧视角），
 * replay 给调试/审计看（"这轮模型看到了什么、回了什么、哪个请求产出了
 * 哪个工具调用"）。两读面同源 buildChatMessages（消息派生不漂移）。
 *
 * 纯读面零扩展（热路径零改动——素材全在位：request/header + 消息/工具事件）；
 * codex 的 bundle 三件套（manifest/trace.jsonl/payloads）不取——L1"事件即
 * 轨迹"在位，事件流本身就是原始轨迹。重放请求消息**不含图片字节**（流存
 * 引用不存字节——P1 纪律；ref 事实在 user/message 载荷可查）。
 */

import type { ChatMessage } from "../models/provider.js";
import type { TokenUsage, SessionEvent } from "../kernel/events.js";
import { buildChatMessages } from "../session/messages.js";

/** 一次模型请求的重放条目（request/header 的流内事实 → 请求/响应对）。 */
export interface ReplayEntry {
  /** 所属用户轮。 */
  turn: number;
  /**
   * 所属 step（同轮多请求由 series reason 区分——每 step 一请求）。可选：
   * compaction 副调用的 header 无 step 语境（F5/T-P1-18）。
   */
  step?: number;
  /** 请求头 reason（initial/resume/change/series/compaction——副调用可区分）。 */
  reason: string;
  /** 模型身份（request/header.config 的二元组）。 */
  identity: { provider: string; modelId: string };
  /** 该请求发出时模型可见的消息序列（buildChatMessages upToSeq 语义）。 */
  messages: ChatMessage[];
  /** 请求面工具清单（header 携带时；toolsProvider 现取的运行时清单不在流内）。 */
  tools?: unknown;
  /** 模型响应（该 step 的 assistant/message 回填；缺省 = 无可见产出——中断/失败）。 */
  response?: {
    content: string;
    toolCalls: { id: string; name: string; arguments: string }[];
    usage?: TokenUsage;
  };
}

/** 事件流 → 逐请求重放条目（纯函数；输入只读；按流序）。 */
export function replaySession(events: readonly SessionEvent[]): ReplayEntry[] {
  // 预扫：收集每 step 的响应素材（assistant/message + tool/call 挂同 turn+step）
  const responses = new Map<
    string,
    { content: string; usage?: TokenUsage; interrupted?: boolean }
  >();
  const toolCalls = new Map<string, { id: string; name: string; arguments: string }[]>();
  for (const e of events) {
    const key = `${e.turn}:${"step" in e ? (e as { step?: number }).step : undefined}`;
    if (e.type === "assistant/message") {
      responses.set(key, {
        content: e.message.content,
        ...(e.usage !== undefined ? { usage: e.usage } : {}),
        ...(e.interrupted ? { interrupted: true } : {}),
      });
    } else if (e.type === "tool/call") {
      const list = toolCalls.get(key) ?? [];
      list.push({ id: e.callId, name: e.name, arguments: e.arguments });
      toolCalls.set(key, list);
    }
  }

  const entries: ReplayEntry[] = [];
  for (const e of events) {
    if (e.type !== "request/header") continue;
    const config = e.config as { provider?: unknown; modelId?: unknown };
    const key = `${e.turn}:${e.step}`;
    const response = responses.get(key);
    const calls = toolCalls.get(key);
    entries.push({
      turn: e.turn,
      ...(e.step !== undefined ? { step: e.step } : {}),
      reason: e.reason,
      identity: {
        provider: String(config.provider ?? ""),
        modelId: String(config.modelId ?? ""),
      },
      // 该请求发出时刻的模型可见消息（upToSeq = header 自身 seq——E15
      // "派生以组装事件为准"；压缩换载荷的装配层偏差记档：重放是流派生
      // 语义，非逐字节 wire 重演）
      messages: buildChatMessages(events, { upToSeq: e.seq }),
      ...(e.tools !== undefined ? { tools: e.tools } : {}),
      ...(response
        ? {
            response: {
              content: response.content,
              toolCalls: calls ?? [],
              ...(response.usage !== undefined ? { usage: response.usage } : {}),
            },
          }
        : {}),
    });
  }
  return entries;
}
