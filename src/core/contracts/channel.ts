/**
 * IM 渠道契约（T2-5 / EP-6，纯类型不接线——hermes 入站授权形状，
 * W3/T7-1 落 allowlist 四态（P0 安全项）+ W12/T7-3 渠道外置）。
 */

import type { SessionEvent } from "../skeleton/events.js";

/** 入站授权四态（blank principal 一律拒绝——无身份不可授权）。 */
export type ChannelAuthorizeMode = "open" | "allowlist" | "disabled" | "pairing";

/** authorize 的裁决（deny 携带原因——审计与用户可见反馈共用）。 */
export interface ChannelAuthorizeDecision {
  decision: "allow" | "deny";
  reason?: string;
}

/**
 * 渠道端口（W12/T7-3：im-feishu/im-slack 等实现本端口，内核只留 webhook
 * 路由 + 租约）。
 */
export interface Channel {
  /** 渠道 id（路由与日志归因键）。 */
  readonly channelId: string;
  /**
   * 入站授权（**入站第一个动作**——先鉴权再解析，未授权内容不进解析面）。
   * mode 与 allowlist 由装配面注入（settings 渠道段）；principal 为空串/
   * undefined 一律 deny（blank principal 拒绝，W3 P0）。
   */
  authorize(
    principal: string | undefined,
    mode: ChannelAuthorizeMode,
    allowlist: readonly string[],
  ): ChannelAuthorizeDecision;
  /** pairing 态的握手门（首次配对码交换；通过后 principal 进 allowlist）。 */
  handlePairing?(principal: string, code: string): ChannelAuthorizeDecision;
  /**
   * 入站消息处理（授权通过后调用）——产出投递意图（目标会话 + 文本）；
   * W3/T7-1：目标会话可由渠道侧声明（非写死单 sessionId）。
   */
  handleInbound(message: { principal: string; text: string; meta?: Record<string, string> }): {
    targetSessionId: string;
    text: string;
  };
  /** 出站投递：会话事件 → 渠道消息摘要（事件摘要投影，脱敏在渠道实现）。 */
  deliverEvent(sessionId: string, event: SessionEvent): Promise<void>;
}
