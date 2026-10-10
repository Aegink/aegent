/**
 * 事件流 → ChatMessage 序列的重建（不变量 1 的消费面）——与 loop.buildMessages
 * 同一语义（user/system/assistant 逐字、tool/call 挂回前一条 assistant、
 * assistant/attempt 不进模型历史）。抽公共实现是因为压缩（T-7-02 摘要覆盖
 * 区间）与新窗口重建（T-7-03 保留规则产出）都要"从事件流现算消息"，三处各写
 * 一遍必然漂移；loop 侧内嵌实现换用本 helper 在 T-7-04 接线时顺路做。
 */

import type { AttachmentRef } from "../../index.js";
import type { ChatAudio, ChatImage, ChatMessage } from "../../index.js";
import type { SessionEvent, SessionRef } from "../../index.js";
import { coalesceEvents } from "./coalescer.js";

export interface BuildMessagesOptions {
  /** 只取 seq ≤ upToSeq 的事件（压缩覆盖区间 / 有效视窗过滤用）；缺省全流。 */
  upToSeq?: number;
  /**
   * 附件图片解析注入（P1/T-P1-124——投影保持纯函数，store 读取由调用方
   * 注入）。缺省不注入 = 不展开图片（user/message 的 attachments 引用只落
   * 流不进请求——未配置附件能力时零行为变化）。返回 null = 该出现不进请求。
   * 第二参 = 出现在该消息 attachments 数组中的下标（P2 卸载面按 (seq,index)
   * 定位——调用方可按需忽略）。
   */
  resolveImage?: (ref: AttachmentRef, imageIndex: number) => ChatImage | null;
  /**
   * 附件音频解析注入（T-P3-149 E1——同 resolveImage 语义）。仅对可直读
   * 格式（audio/wav | audio/mpeg——OpenAI input_audio 闭集）调用；返回
   * 非空即同时进 audios 与占位行（标签语义），null/缺省 = 保持占位行降级。
   */
  resolveAudio?: (ref: AttachmentRef) => ChatAudio | null;
  /**
   * 会话引用解析注入（E9/T-P2-107——投影保持纯函数，被引会话的读取由调用
   * 方注入；**流存引用不存内容**：会话流里只有 {sessionId, upToSeq?}）。
   * 返回的文本（有界快照——session/reference.ts 的 buildReferenceExcerpt）
   * 追加到该条 user/message 的 content 之后。返回 null = 该引用不注入；
   * 缺省不注入 = 引用只落流不进请求（零行为变化）。
   */
  resolveSessionRef?: (ref: SessionRef) => string | null;
}

export function buildChatMessages(
  events: readonly SessionEvent[],
  opts: BuildMessagesOptions = {},
): ChatMessage[] {
  // E15/T-P1-88：高频只读面先折叠（progress 等瞬态冗余不进消息——输出
  // 与逐条遍历等价，遍历量随冗余度下降）；输入数组本体零改动。
  const coalesced = coalesceEvents(events);
  // P2/T-P1-125：预扫卸载决策（image/offload 整值事件不折叠）——
  // seq -> 已卸载的 attachments 下标集合
  const offloadedImages = new Map<number, Set<number>>();
  for (const ev of coalesced) {
    if (ev.type === "image/offload") {
      for (const t of ev.targets) {
        let set = offloadedImages.get(t.seq);
        if (!set) {
          set = new Set<number>();
          offloadedImages.set(t.seq, set);
        }
        for (const idx of t.imageIndexes) set.add(idx);
      }
    }
  }
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
        // P2/T-P1-125：image/offload 持久决策在此消费——被卸出现（seq+index）
        // 从 images 剔除并在 content 追加占位行（模型可见容量事实 + 回取
        // 键 attachmentId）；**只进不退**——无自动恢复路径。
        let images: ChatImage[] | undefined;
        let audios: ChatAudio[] | undefined;
        let placeholderLines = "";
        const resolve = opts.resolveImage;
        if (e.attachments?.length) {
          const offloaded = offloadedImages.get(e.seq);
          const resolved: ChatImage[] = [];
          const resolvedAudios: ChatAudio[] = [];
          e.attachments.forEach((ref, index) => {
            if (offloaded?.has(index)) {
              placeholderLines += `
[image offloaded: ${ref.name ?? "image"} (${ref.mediaType}, ${ref.size}B, id=${ref.attachmentId})]`;
              return;
            }
            // P4/T-P2-406 + T-P3-149 E1：音频附件——wav/mp3 且 resolver 在位
            // 时进请求（input_audio；占位行保留作标签语义），其余格式一律
            // 占位行降级（kimi"不可用即占位"同款——音频字节不硬塞不支持的
            // 请求面；未转写渲染占位行说明容量事实，与 image offload 同构）
            if (ref.mediaType.startsWith("audio/")) {
              const label = ref.name ?? "voice";
              const direct =
                (ref.mediaType === "audio/wav" || ref.mediaType === "audio/mpeg") && opts.resolveAudio !== undefined
                  ? opts.resolveAudio(ref)
                  : null;
              if (direct !== null) {
                resolvedAudios.push(direct);
                placeholderLines += `
[audio attached: ${label} (${ref.mediaType}, id=${ref.attachmentId})]`;
                return;
              }
              placeholderLines += ref.transcription !== undefined
                ? `
[voice note: ${label} (${ref.mediaType}, id=${ref.attachmentId})] ${ref.transcription}`
                : `
[voice note: ${label} (${ref.mediaType}, ${ref.size}B, id=${ref.attachmentId}) — 未转写]`;
              return;
            }
            if (resolve) {
              const img = resolve(ref, index);
              if (img !== null) resolved.push(img);
            }
          });
          if (resolved.length > 0) images = resolved;
          if (resolvedAudios.length > 0) audios = resolvedAudios;
        }
        // E9/T-P2-107：会话引用注入（流里只有 {sessionId, upToSeq?} 指针；
        // 快照文本由 resolver 现算——引用不展开全量，有界快照见 reference.ts）
        let refSections = "";
        if (e.sessionRefs?.length && opts.resolveSessionRef) {
          for (const ref of e.sessionRefs) {
            const text = opts.resolveSessionRef(ref);
            if (text !== null && text !== "") refSections += `\n\n${text}`;
          }
        }
        messages.push({
          role: "user",
          content:
            refSections !== "" || placeholderLines !== ""
              ? `${e.message.content}${refSections}${placeholderLines}`
              : e.message.content,
          ...(images ? { images } : {}),
          ...(audios ? { audios } : {}),
        });
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
