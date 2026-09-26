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

export type QueueMode = "all" | "one-at-a-time";

/** 入队收执：只有 messageId——没有完成句柄（A9）。 */
export interface EnqueueReceipt {
  messageId: string;
}

export interface QueuedPrompt {
  messageId: string;
  content: string;
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
  enqueue(content: string): EnqueueReceipt {
    if (this.items.length >= this.maxSize) {
      throw new QueueFullError(this.maxSize, this.mode);
    }
    const messageId = `q${++this.counter}`;
    this.items.push({ messageId, content });
    return { messageId };
  }

  /** 在注入点排空：all 一次全量（FIFO）；one-at-a-time 只出最旧一条。 */
  drain(): QueuedPrompt[] {
    if (this.items.length === 0) return [];
    if (this.mode === "all") return this.items.splice(0);
    return [this.items.shift()!];
  }

  /** 仍在队列里的消息数（可观测；one-at-a-time 下常 > 0 直到轮结束）。 */
  get size(): number {
    return this.items.length;
  }

  get queueMode(): QueueMode {
    return this.mode;
  }
}
