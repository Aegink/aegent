/**
 * prompt 队列（A2/A9）——turn 只能入队，协议不提供 per-prompt 完成语义。
 *
 * A9 的纪律取自 dsh·followup-enqueue（原文要点）："one follow-up does not own
 * the activity that follows it"——messageId 只证明 **inbox admission**（已收进
 * 队列），不能锚定"这条 prompt 的结果"：steer、注入上下文、工具续跑都可能
 * 在其后发生。因此 enqueue 即返回 `{messageId}` 收执就结束，**没有**完成句柄、
 * **没有** `finished()`（有 steer 的会话里"这条 prompt 的结果"无法定义）。
 * 完成与否只能观察整会话的整值事实（turn/start、turn/end、run-state），
 * 那些由 loop 与 T-3-05 的 run-state 提供，与本队列无关。
 *
 * A2 的注入节奏取 pi·types.ts:55 的 QueueMode（枚举不是布尔）：
 * - "all"：每个注入点排空并注入全部排队消息；
 * - "one-at-a-time"：每个注入点只出最旧一条，其余留给后面的注入点。
 *
 * 排空点在 loop 的 step 边界（T-3-03 接线）：steer 消息以 user/message 落盘
 * （source="user"——它们是人类原话，l0-events §3.2 的 source 记的是来源不是
 * 机制；"发生在 step 边界"由事件在流中的位置自证），随后按入队顺序进入
 * 下一次模型请求。
 */

import type { AttachmentRef } from "../attachments/types.js";
import type { SessionRef } from "./events.js";

export type QueueMode = "all" | "one-at-a-time";

/** 入队收执：只有 messageId——没有完成句柄（A9）。 */
export interface EnqueueReceipt {
  messageId: string;
}

export interface QueuedPrompt {
  messageId: string;
  content: string;
  /**
   * 附件引用（P1/T-P1-124）：编排面（agent-process）已校验限额并落 store
   * 后的 ref 列表，随 prompt 穿队列到 runTurn 落流；无附件缺省缺字段
   * （queue 语义零变化）。
   */
  attachments?: AttachmentRef[];
  /**
   * 会话引用（E9/T-P2-107）：编排面（agent-process）已过环检测与限额的
   * 引用列表，随 prompt 穿队列到 runTurn 落流（**只落引用不落内容**——
   * 被引会话的内容字节绝不进本会话的流）；无引用缺省缺字段（零变化）。
   */
  sessionRefs?: SessionRef[];
  /**
   * T-P3-146 A/H 展开面回填：command = 模板调用原文（transcript chip 数据源）；
   * model = 命令级模型覆盖（frontmatter model——runTurn 的 turn 级生效）。
   * 缺省缺字段 = 普通输入零变化。
   */
  meta?: { command?: string; model?: { provider: import("../models/provider.js").ModelProvider; identity: import("../models/identity.js").ModelIdentity } };
}

/** M9/T-P1-48 有限队列：超限入队类型化拒绝（fail-closed 不静默丢）。 */
export class QueueFullError extends Error {
  readonly code = "QUEUE_FULL";
  constructor(
    readonly maxSize: number,
    readonly queuedMode: QueueMode,
  ) {
    super(`prompt 队列已满（上限 ${maxSize}，${queuedMode} 模式）——新输入被拒绝而非静默丢弃`);
    this.name = "QueueFullError";
  }
}

export class PromptQueue {
  private readonly items: QueuedPrompt[] = [];
  private counter = 0;

  /**
   * 节奏可配（A2）：默认 all。一个会话一个队列实例。
   * M9 有限队列：maxSize 上限可配，缺省 64（宽松但有限——pi-desktop·ADR 0041
   * "the queue is finite"；无界排队会掩盖背压，超限入队走 QueueFullError
   * 类型化拒绝，调用方（协议层）转 error 行可见）。
   */
  constructor(
    private readonly mode: QueueMode = "all",
    private readonly maxSize: number = 64,
  ) {}

  /**
   * 入队即收执：同步返回 `{messageId}`，调用方到此为止——没有 promise、
   * 没有回调、没有 per-prompt 结果可等（A9）。
   * 队列已满时抛 QueueFullError（M9 fail-closed）——消息不收执不排队。
   */
  enqueue(
    content: string,
    attachments?: readonly AttachmentRef[],
    sessionRefs?: readonly SessionRef[],
    meta?: QueuedPrompt["meta"],
  ): EnqueueReceipt {
    if (this.items.length >= this.maxSize) {
      throw new QueueFullError(this.maxSize, this.mode);
    }
    const messageId = `q${++this.counter}`;
    this.items.push({
      messageId,
      content,
      ...(attachments !== undefined && attachments.length > 0 ? { attachments: [...attachments] } : {}),
      ...(sessionRefs !== undefined && sessionRefs.length > 0 ? { sessionRefs: [...sessionRefs] } : {}),
      ...(meta !== undefined ? { meta } : {}),
    });
    return { messageId };
  }

  /** 在注入点排空：all 一次全量（FIFO）；one-at-a-time 只出最旧一条。 */
  drain(): QueuedPrompt[] {
    if (this.items.length === 0) return [];
    if (this.mode === "all") return this.items.splice(0);
    return [this.items.shift()!];
  }

  /**
   * A8/T-P1-52 全量取出（无视 QueueMode）：轮以 aborted 终止时，未消费的
   * 输入经此退回调用方（"退回输入框"——不独立重放，pi-desktop·Stop
   * "retains accepted input … without independently replaying it" 同构）。
   */
  drainAll(): QueuedPrompt[] {
    return this.items.splice(0);
  }

  /**
   * T-P3-174 批次 7：行内移除（排队条行删除——messageId 定位；不存在返回
   * false，调用方回类型化 error）。
   */
  remove(messageId: string): boolean {
    const idx = this.items.findIndex((i) => i.messageId === messageId);
    if (idx < 0) return false;
    this.items.splice(idx, 1);
    return true;
  }

  /** T-P3-174 批次 7：行内编辑（排队条行内容改写——messageId 不存在 false）。 */
  edit(messageId: string, content: string): boolean {
    const item = this.items.find((i) => i.messageId === messageId);
    if (item === undefined || content.trim() === "") return false;
    item.content = content;
    return true;
  }

  /** 仍在队列里的消息数（可观测；one-at-a-time 下常 > 0 直到轮结束）。 */
  get size(): number {
    return this.items.length;
  }

  get queueMode(): QueueMode {
    return this.mode;
  }
}
