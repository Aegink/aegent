/**
 * 四值决策与裁决（C32/C18）。
 *
 * 第四值 abstain 取自两层上游实证：qwen·autoMode 把"无规则命中"（L4 返回
 * 'default'）与"显式 ask 规则"分开（三快路径只在 default 时触发）；agentscope
 * 的 tool.check_permissions 有同位的 PASSTHROUGH。裁决形状取
 * claude-official·claude-code.d.ts 的 'tool.check' 结果 `{decision, reason?,
 * rule?}`（🔴 专有，只学声明形状不摘代码）。
 *
 * abstain 与 ask 的分工：模块级"没意见往下走"用 undefined（C20 的 kimi
 * 语义，chain 遍历时跳过）；abstain 是**链级出口**的"整链无人应答"——
 * 消费方（T-5-12 gate）据此自行决定默认动作（危险库/默认 ask），而不是
 * 被链伪造一个 ask。本文件只定类型与合成器；allow<ask<deny 的全序与
 * max() 聚合是 T-5-06（aggregate.ts）的事，此处不做。
 */

import type { DenialShape } from "./denial.js";
import type { PolicyAction, PolicyOutcome } from "./chain.js";

/** C 层四值决策（C32）：allow / ask / deny / abstain。 */
export type Decision = PolicyAction | "abstain";

/** 裁决（C18）：可解释——因哪条规则、什么理由。 */
export interface Verdict {
  readonly action: Decision;
  /** 命中的规则原文（如 Bash(git push:*)）；非规则来源的裁决缺席。 */
  readonly rule?: string;
  readonly reason: string;
  /** C55 结构化拒绝面（T-P2-202）：命中规则声明面数据——gate 渲染"怎么办"。 */
  readonly denial?: DenialShape;
}

/**
 * 把一个模块应答合成为裁决：模块自带 reason/rule 证据时透传，缺席时
 * 以模块名合成人话理由；带规则原文的证据并入合成理由（C18 的"因哪条
 * 规则"不允许只藏在 rule 字段里）。空 reason 不允许出链。
 */
export function verdictFromOutcome(
  moduleName: string,
  outcome: PolicyOutcome,
): Verdict {
  const base = outcome.reason ?? `策略模块 ${moduleName} 裁决为 ${outcome.action}`;
  return {
    action: outcome.action,
    ...(outcome.rule !== undefined ? { rule: outcome.rule } : {}),
    ...(outcome.denial !== undefined ? { denial: outcome.denial } : {}),
    reason:
      outcome.rule !== undefined && outcome.reason === undefined
        ? `${base}（依规则 ${outcome.rule}）`
        : base,
  };
}

/** 整链弃权裁决（C32 验收：无匹配策略返回 abstain 而非 ask）。 */
export function abstainVerdict(): Verdict {
  return { action: "abstain", reason: "权限链上无策略模块应答" };
}
