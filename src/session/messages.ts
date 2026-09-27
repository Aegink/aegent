/**
 * 事件流 → ChatMessage 序列的重建（不变量 1 的消费面）——与 loop.buildMessages
 * 同一语义（user/system/assistant 逐字、tool/call 挂回前一条 assistant、
 * assistant/attempt 不进模型历史）。抽公共实现是因为压缩（T-7-02 摘要覆盖
 * 区间）与新窗口重建（T-7-03 保留规则产出）都要"从事件流现算消息"，三处各写
 * 一遍必然漂移；loop 侧内嵌实现换用本 helper 在 T-7-04 接线时顺路做。
 */

import type { AttachmentRef } from "../attachments/types.js";
import type { ChatImage, ChatMessage } from "../models/provider.js";
import type { SessionEvent } from "../kernel/events.js";
import { coalesceEvents } from "./coalescer.js";

export interface BuildMessagesOptions {
  /** 只取 seq ≤ upToSeq 的事件（压缩覆盖区间 / 有效视窗过滤用）；缺省全流。 */
  upToSeq?: number;
  /**
   * 附件图片解析注入（P1/T-P1-124——投影保持纯函数，store 读取由调用方
   * 注入；P2/T-P1-125 的卸载状态也经此并入）。缺省不注入 = 不展开图片
   * （user/message 的 attachments 引用只落流不进请求——未配置附件能力时
   * 零行为变化）。返回 null = 该出现不进请求（占位路径，P2 卸载消费）。
   */
  resolveImage?: (ref: AttachmentRef) => ChatImage | null;
}

export function buildChatMessages(
  events: readonly SessionEvent[],
  opts: BuildMessagesOptions = {},
): ChatMessage[] {
  // E15/T-P1-88：高频只读面先折叠（progress 等瞬态冗余不进消息——输出
  // 与逐条遍历等价，遍历量随冗余度下降）；输入数组本体零改动。
  const coalesced = coalesceEvents(events);
  const upTo = opts.upToSeq ?? Number.POSITIVE_INFINITY;
  type AssistantMsg = Extract<ChatMessage, { role: "assistant" }>;
  const messages: ChatMessage[] = [];
  let lastAssistant: AssistantMsg | null = null;
  let pendingCalls: { id: string; name: string; arguments: string }[] = [];
  const flushCalls = () => {
    if (lastAssistant && pendingCalls.length > 0) {
      lastAssistant.toolCalls = [...(lastAssistant.toolCalls ?? []), ...pendingCalls];
      pendingCalls = [];
    }
  };
  for (const e of coalesced) {
    if (e.seq > upTo) continue;
    switch (e.type) {
      case "user/message": {
        flushCalls();
        // P1/T-P1-124：附件引用经注入的 resolver 展开为图片块（声明性追加
        // 于 content 之后）；resolver 缺省/返回 null 的出现不进请求。
        let images: ChatImage[] | undefined;
        const resolve = opts.resolveImage;
        if (resolve && e.attachments?.length) {
          const resolved = e.attachments
            .map((ref) => resolve(ref))
            .filter((img): img is ChatImage => img !== null);
          if (resolved.length > 0) images = resolved;
        }
        messages.push({ role: "user", content: e.message.content, ...(images ? { images } : {}) });
        break;
      }
      case "system/message":
        flushCalls();
        messages.push({ role: "system", content: e.message.content });
        break;
      case "assistant/message":
        flushCalls();
        lastAssistant = { role: "assistant", content: e.message.content };
        messages.push(lastAssistant);
        break;
      case "tool/call":
        pendingCalls.push({ id: e.callId, name: e.name, arguments: e.arguments });
        break;
      case "tool/result":
        flushCalls();
        messages.push({
          role: "tool",
          callId: e.callId,
          content: e.message.content,
          ...(e.message.isError ? { isError: true as const } : {}),
        });
        break;
      default:
        // attempt / compaction / checkpoint / header / turn.* / revert 不进消息
        break;
    }
  }
  flushCalls();
  return messages;
}

/**
 * 有效视窗（E4 消费面的事件级形态）：遵循最新 session/revert 标记（undo 恢复
 * 全量），返回该视窗内的事件。loop.buildMessages 的 cut 逻辑同款；压缩与
 * 新窗口重建都必须只看有效视窗——绝不摘要已被 revert 的内容。
 */
export function effectiveEvents(events: readonly SessionEvent[]): readonly SessionEvent[] {
  let cut = Number.POSITIVE_INFINITY;
  for (const e of events) {
    if (e.type === "session/revert") {
      cut = e.phase === "revert" ? e.targetSeq : Number.POSITIVE_INFINITY;
    }
  }
  if (cut === Number.POSITIVE_INFINITY) return events;
  return events.filter((e) => e.seq <= cut);
}
