/**
 * 换更小上下文模型先压缩（F24 ModelDownshift，T-7-06）——检测到目标模型的
 * 上下文窗口装不下当前会话内容时，**先压缩再切换**（codex·compact_model_fallback.rs:29
 * 的 `CompactionReason::ModelDownshift => "model_downshift"`：换模压缩在事件面
 * 有自己的 reason，回放时可见）。运行时换模本体（J6）是 P1——本模块只做
 * "换模时的先压缩判定与触发"，切换动作由调用方在本函数 resolve 之后执行
 * （次序由测试钉死：压缩完成先于切换）。
 *
 * 事件留痕：压缩走 T-7-02 生命周期，`compaction` 事件 reason="model_downshift"
 * （compactionReasonOf 映射）——"为什么压缩"在事件流上可回放。
 */

import type { ModelIdentity } from "../models/identity.js";
import type { SessionProjection } from "../session/project.js";
import { type CompactionEngine, type CompactionResult } from "./compaction.js";
import { estimateMessagesTokens } from "./overflow.js";

export interface DownshiftDecision {
  /** true = 目标窗口装不下当前内容，已先执行压缩。 */
  needsCompaction: boolean;
  /** 本函数内执行的压缩结果（needsCompaction=false 时缺席）。 */
  compaction?: CompactionResult;
}

/**
 * 换模前的判定入口（F24）。判定口径：当前会话 token > 目标上下文窗口 →
 * 需要先压缩（严格大于——恰好装下不压，避免无谓的摘要损失）。
 * token 来源优先级：投影的 lastUsage（provider 权威计量，total 缺失折算
 * input+output）→ 本地保守估算（overflow.ts，方向注释见其头注释）。
 * 相位固定 PreTurn：换模发生在轮边界（模型身份是请求级设置，MidTurn 途中
 * 不换——Q13 两相位下没有第三个合法落点）。
 */
export async function maybeDownshift(input: {
  targetModel: ModelIdentity;
  targetContextWindow: number;
  /** "压缩那一刻"的投影状态（F22：重建/判定都从当前投影现算，不用压缩前快照）。 */
  projection: SessionProjection;
  engine: CompactionEngine;
  turn: number;
}): Promise<DownshiftDecision> {
  const { projection } = input;
  const usage = projection.lastUsage;
  const currentTokens = usage
    ? usage.totalTokens ?? usage.inputTokens + usage.outputTokens
    : estimateMessagesTokens(projection.messages);

  if (currentTokens <= input.targetContextWindow) {
    return { needsCompaction: false };
  }

  const compaction = await input.engine.run({
    turn: input.turn,
    phase: "PreTurn",
    request: {
      reason: "model-downshift",
      targetModel: input.targetModel,
      targetContextWindow: input.targetContextWindow,
    },
  });
  return { needsCompaction: true, compaction };
}
