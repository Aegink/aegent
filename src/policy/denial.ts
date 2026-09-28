/**
 * 拒绝面结构（C55，T-P2-202）——拒绝是结构化对象（原因 + 替代做法），
 * 不是裸字符串。
 *
 * 形状取 codex·execpolicy 的规则携带 justification（规则声明面字段，
 * 注册期拒绝空串——`justification cannot be empty`）+ 命中裁决回带
 * justification 的行为；"forbidden 须给替代做法"落我方 deny 动作规则
 * 的 alternatives 声明（linter 检出缺失）。拒绝要能告诉用户怎么办：
 * 渲染面把结构化形状变人话——主因 + 规则理由 + 编号替代清单，模型与
 * 用户读同一份（isError content 回喂模型可自修）。
 */

/** 一次结构化拒绝：为什么拒（reason）+ 为什么有这条规则 + 怎么办。 */
export interface DenialShape {
  /** 拒绝主因（人话；gate 层 = verdict.reason）。 */
  readonly reason: string;
  /** 规则理由（声明面 justification——这条规则为什么存在）。 */
  readonly justification?: string;
  /** 替代做法（声明面 alternatives——被拒之后可以怎么做）。 */
  readonly alternatives?: readonly string[];
}

/**
 * 渲染结构化拒绝为人话（C55 验收"拒绝要能告诉用户怎么办"）：
 * 首行主因；有 justification 补规则理由行；有 alternatives 逐条编号。
 * 无附加字段时与既有拒绝文本同形（零变化）。
 */
export function renderDenial(shape: DenialShape): string {
  let text = `被权限策略拒绝：${shape.reason}`;
  if (shape.justification !== undefined) {
    text += `\n规则理由：${shape.justification}`;
  }
  if (shape.alternatives !== undefined && shape.alternatives.length > 0) {
    text += `\n替代做法：`;
    for (const [i, alt] of shape.alternatives.entries()) {
      text += `\n  ${i + 1}. ${alt}`;
    }
  }
  return text;
}

/**
 * gate 渲染入口：verdict 带规则声明面数据（justification/alternatives）
 * 时构造完整形状（reason 取 verdict.reason——人话主因；声明面形状的
 * reason 是规则原文证据，仅在链上搬运用）；无声明数据返回 undefined——
 * 调用方维持既有拒绝文本。
 */
export function buildDenial(
  reason: string,
  declared: Omit<DenialShape, "reason"> | undefined,
): DenialShape | undefined {
  if (
    declared === undefined ||
    (declared.justification === undefined &&
      (declared.alternatives === undefined || declared.alternatives.length === 0))
  ) {
    return undefined;
  }
  return {
    reason,
    ...(declared.justification !== undefined ? { justification: declared.justification } : {}),
    ...(declared.alternatives !== undefined && declared.alternatives.length > 0
      ? { alternatives: declared.alternatives }
      : {}),
  };
}
