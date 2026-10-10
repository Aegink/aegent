/**
 * prompt 入队闸门（A13/T-P1-48）——三态裁决：放行 / 拦截（带理由）/ 改写消息。
 *
 * 形状取 kimi·machine.ts:57 的 PromptGateVerdict（boolean | {block, message?}）
 * 与其出队裁决时点（promptGateActor 消费 queue[0]——我方同构为 drainQueue 注入
 * 前逐条过 gate）。三态语义（kimi machine.test 的改写用例同构）：
 * - `true`（或 {block:false} 无 message）：放行，内容原样进模型历史；
 * - `false` 或 `{block:true, message?}`：拦截——消息**不进模型历史**（不落流：
 *   不进历史的输入不落盘，A9 纪律自洽；队列本就是 inbox 内存态），拦截事实
 *   经 logger.warn 留痕（D14 告警先例），message 是给用户的理由；
 * - `{block:false, message:"改写后内容"}`：改写放行——落盘的 user/message
 *   就是改写后文本（改写事实由流内容自然承载，零事件扩展）。
 *
 * gate 挂点在 loop.drainQueue（step 边界注入前）；缺省不装配 = 全放行
 * （P0 行为零变化）。gate 抛错沿 runTurn 的 catch 走 failTurn 收轮
 * （装配钩子异常与 hook 崩溃同轨）。
 */

export type PromptGateVerdict = boolean | { block: boolean; message?: string };

export type PromptGate = (message: {
  messageId: string;
  content: string;
}) => Promise<PromptGateVerdict>;

export interface NormalizedVerdict {
  block: boolean;
  /** block=true：拦截理由；block=false 且存在：改写后的完整内容。 */
  message?: string;
}

/** 三态归一化（kimi machine.ts:324-335 promptGateActor 同构）：boolean 与对象两种形状收敛为统一裁决。 */
export function normalizePromptVerdict(verdict: PromptGateVerdict): NormalizedVerdict {
  if (typeof verdict === "boolean") return { block: !verdict };
  return verdict.message !== undefined
    ? { block: verdict.block, message: verdict.message }
    : { block: verdict.block };
}
