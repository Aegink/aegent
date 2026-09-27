/**
 * 事件合并器（E15，T-P1-88）——投影视图的冗余折叠，独立于投影与存储。
 *
 * 取 zcode·zcodeSessionEventCoalescer 的形状：合并键提取（coalesce key）+
 * 合并函数 + 独立模块。落点偏离记档：zcode 的合并发生在后台推送通道
 * （acceptSessionEvent → 定时 flush 给 UI），本方消费点是**高频只读面**——
 * 消息重建（buildChatMessages，每次模型请求从全流重建）与大流只读投影
 * （foldCoalesced）。事件流本体永不改写（不变量 1）：coalesceEvents 是
 * 纯函数，输入数组逐字节不动；折叠只发生在读取侧的内存副本。
 *
 * 默认规则（tool/progress 同 callId 只留最新一条）：进度是瞬态事实
 * （B7/T-P1-16"投影不消费"），中间条目对消息重建与投影零贡献——只读面
 * 跳过它们。校验权威（E16 fold 的写入前校验）**不折叠**：孤儿进度/闭合后
 * 补报的拒绝语义必须在完整流上判定，coalesce 只服务读取加速。
 */

import type { SessionEvent } from "../kernel/events.js";
import { Projector } from "./project.js";

export interface CoalesceRule {
  /** 参与折叠的事件类型（词汇表成员）。 */
  readonly typeName: string;
  /** 折叠键：同键的同类型事件在只读视图中只保留 seq 最大的一条。 */
  readonly keyOf: (event: SessionEvent) => string;
}

/** B7 进度：同 callId 只看最新（进度是"当前在哪一步"的瞬态事实）。 */
export const PROGRESS_RULE: CoalesceRule = {
  typeName: "tool/progress",
  keyOf: (event) => (event.type === "tool/progress" ? event.callId : ""),
};

export const DEFAULT_COALESCE_RULES: readonly CoalesceRule[] = [PROGRESS_RULE];

/**
 * 投影视图折叠：返回筛选后的**新数组**（保序；输入数组与其元素零改动）。
 * 规则未命中 / 无冗余时走快速路径返回浅拷贝（语义与输入等价）。
 */
export function coalesceEvents(
  events: readonly SessionEvent[],
  rules: readonly CoalesceRule[] = DEFAULT_COALESCE_RULES,
): readonly SessionEvent[] {
  const redundant = new Set<number>();
  const seen = new Set<string>();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    const rule = rules.find((r) => r.typeName === event.type);
    if (!rule) continue;
    const composite = `${event.type}:${rule.keyOf(event)}`;
    if (seen.has(composite)) redundant.add(i);
    else seen.add(composite);
  }
  if (redundant.size === 0) return [...events];
  return events.filter((_, i) => !redundant.has(i));
}

/**
 * 只读投影组合：折叠后的流过 fold——给诊断/统计等只读消费方。**不是**
 * E16 校验面（append/restore 路径必须用完整流校验，见头注释）。
 * 折叠产生 seq 断档（E16 的 seq 连续性校验会拒）——视图内**重编号**为
 * 连续（保持相对顺序）：seq 在视图中是位置序而非事实序；store 流本体
 * 依旧逐字节不动。
 */
export function foldCoalesced(
  events: readonly SessionEvent[],
  rules: readonly CoalesceRule[] = DEFAULT_COALESCE_RULES,
): ReturnType<typeof Projector.fold> {
  const coalesced = coalesceEvents(events, rules);
  const renumbered = coalesced.map((event, i) =>
    event.seq === i + 1 ? event : { ...event, seq: i + 1 },
  );
  return Projector.fold(renumbered);
}
