/**
 * 压缩后的新窗口重建（F22/F23，T-7-03）——`startNewContextWindow` 从"压缩
 * 那一刻"的状态现算首请求消息集（codex·session/mod.rs:4530
 * `start_new_context_window` 的形态），绝不消费压缩前的快照：入参是当前事件
 * 流，最新 `compaction` 事件的 retainedTail/summary 就是重建参数，压缩后追加
 * 的新事件（seq > retainedTail）自然包含在重建结果里。
 *
 * 重建集的组成（顺序固定，逐条可断言）：
 *   1. system 消息（注入的系统提示）——即使在摘要覆盖区间也原样保留、
 *      绝不被摘要改写（F22 验收面）；
 *   2. 压缩摘要——user 角色的合成消息（不落事件；重建是请求时的现算，
 *      与 loop.buildMessages 同一纪律：不养第二份历史）；
 *   3. developer 注入消息（source="injected" 的 user 消息）——F23 的
 *      "不可丢"声明：独立 token 预算内从新到旧保留
 *      （codex·session/mod.rs:4536 retained_client_developer_messages +
 *      truncate_retained_messages_for_remote_compaction 的行为；预算默认值
 *      4096 是我方自研默认，非上游照抄）；
 *   4. seq > retainedTail 的原文消息（保留尾部）。
 *
 * 依赖约定：切点合法性（不劈开 tool/call↔tool/result 配对）由切点选择方
 * （T-7-02 边界策略 / T-7-05 配平状态机）保证，本函数忠实重建不修复。
 * 覆盖范围是有效视窗（effectiveEvents）——revert 掉 compaction 即回到
 * 无压缩状态全量重建。
 */

import type { ChatMessage } from "../models/provider.js";
import type { SessionEvent } from "../kernel/events.js";
import { buildChatMessages, effectiveEvents } from "../session/messages.js";
import { estimateTextTokens } from "./overflow.js";

/** F23 独立预算默认值（自研默认；codex RETAINED_MESSAGE_TOKEN_BUDGET=64_000 是远程压缩场景）。 */
export const DEFAULT_DEVELOPER_BUDGET_TOKENS = 4096;

export interface NewWindowKeepRules {
  /**
   * developer 注入消息的独立保留预算（token，本地估算口径）。从新到旧保留，
   * 预算耗尽即停；最新一条即使超预算也保留（注入上下文整条丢失比超预算危险）。
   */
  developerBudgetTokens?: number;
}

export function startNewContextWindow(
  events: readonly SessionEvent[],
  keepRules: NewWindowKeepRules = {},
): ChatMessage[] {
  const effective = effectiveEvents(events);
  // E17/T-P1-93：**切换权威只认已结算的压缩**（status 缺省 = completed 的
  // 旧流兼容口径）——started（进行中/崩溃残留）与 failed（摘要失败）不是
  // 状态变更的结算事实，以其切换窗口会让模型拿到空摘要。
  const settledCompactions = effective.filter(
    (e): e is Extract<SessionEvent, { type: "compaction" }> =>
      e.type === "compaction" && (e.status === undefined || e.status === "completed"),
  );
  // 无压缩（或压缩被 revert）：不抛——重建语义退化为全量现算
  if (settledCompactions.length === 0) return buildChatMessages(effective);
  // 只认最新一次压缩：更早 compaction 的 seq 必然 ≤ 最新 retainedTail（被摘要覆盖）
  const latest = settledCompactions[settledCompactions.length - 1]!;
  const { summary, retainedTail } = latest;

  const messages: ChatMessage[] = [];

  // 1. 注入的系统提示：摘要覆盖区间内的 system 消息原样保留（F22：不被摘要改写）
  for (const e of effective) {
    if (e.seq > retainedTail) break;
    if (e.type === "system/message") {
      messages.push({ role: "system", content: e.message.content });
    }
  }

  // 2. 压缩摘要（user 角色，声明性前缀——模型需要知道这是压缩产物而非用户新指令）
  messages.push({
    role: "user",
    content: `[会话压缩摘要] 以下是此前对话的摘要，原始内容已按保留策略裁剪：\n${summary}`,
  });

  // 3. developer 注入消息：F23 预算内从新到旧保留，回填按原会话顺序
  const budget = keepRules.developerBudgetTokens ?? DEFAULT_DEVELOPER_BUDGET_TOKENS;
  const injected = effective.filter(
    (e) => e.type === "user/message" && e.source === "injected" && e.seq <= retainedTail,
  );
  const keptDeveloper: SessionEvent[] = [];
  let used = 0;
  for (let i = injected.length - 1; i >= 0; i--) {
    const e = injected[i]!;
    const cost = estimateTextTokens(e.type === "user/message" ? e.message.content : "");
    const isFirst = keptDeveloper.length === 0;
    if (!isFirst && used + cost > budget) break;
    used += cost;
    keptDeveloper.unshift(e);
  }
  for (const e of keptDeveloper) {
    if (e.type === "user/message") {
      messages.push({ role: "user", content: e.message.content });
    }
  }

  // 4. 保留尾部：seq > retainedTail 的原文，忠实重建
  messages.push(...buildChatMessages(effective.filter((e) => e.seq > retainedTail)));

  return messages;
}
