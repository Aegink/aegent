/**
 * 工具激活层（C25/T-P1-76）——工具激活与工具批准分离。
 *
 * 形状取 kimi·toolPolicy/evaluate.ts 的 isToolActiveComposed：四层
 * （工作区 / 档案 / 全局 / 会话）**纯 AND** 合成——任一层说不可用，
 * 工具就不可达；全层放行才轮到批准层（gate 策略链）说话。
 *
 * 分离语义：激活失败不是策略裁决（不产生 Verdict）——不可达的工具
 * 连 ask 都不进，与 allow/ask/deny 批准语义正交。层内的 enabled
 * 白名单（非空 = 仅清单内可达）与 disabled 黑名单可同层并存：先黑
 * 后白（kimi 同序——显式禁用压过白名单收录）。
 *
 * 匹配方言用我方 wildcardMatch（evaluate.ts）：锚定全串、`*` 跨任意、
 * `?` 单字符——工具名维度通配（`github__*`、`bash*`）是活规则，不抄
 * kimi 的 picomatch 依赖（不为单卡引包）。
 */

import { wildcardMatch } from "./evaluate.js";

/** 单层配置：enabled 白名单（非空 = 仅清单内可达）+ disabled 黑名单。 */
export interface ToolActivationLayer {
  readonly enabled?: readonly string[];
  readonly disabled?: readonly string[];
}

/** C25 四层：工作区 / 档案 / 全局 / 会话——纯 AND（kimi ToolPolicyLayers 同构）。 */
export interface ToolActivationLayers {
  readonly workspace?: ToolActivationLayer;
  readonly profile?: ToolActivationLayer;
  readonly global?: ToolActivationLayer;
  readonly session?: ToolActivationLayer;
}

/** 全空层（缺省装配零行为变化的形状）。 */
export const EMPTY_ACTIVATION: ToolActivationLayers = {};

function matchesAny(name: string, patterns: readonly string[] | undefined): boolean {
  if (patterns === undefined) return false;
  return patterns.some((pattern) => wildcardMatch(name, pattern));
}

/**
 * 单层判定（kimi isToolActive 同名函数意图）：disabled 命中 → 不可用；
 * enabled 非空且不含 → 不可用；否则可用。
 */
export function isToolActive(layer: ToolActivationLayer, name: string): boolean {
  if (matchesAny(name, layer.disabled)) return false;
  if (layer.enabled !== undefined && layer.enabled.length > 0 && !matchesAny(name, layer.enabled)) {
    return false;
  }
  return true;
}

/**
 * 四层 AND 合成（kimi isToolActiveComposed 同名函数意图）：workspace /
 * profile / global / session 逐层判定，全部可用才可用。
 */
export function isToolActiveComposed(
  layers: ToolActivationLayers,
  name: string,
): boolean {
  return (
    (layers.workspace === undefined || isToolActive(layers.workspace, name)) &&
    (layers.profile === undefined || isToolActive(layers.profile, name)) &&
    (layers.global === undefined || isToolActive(layers.global, name)) &&
    (layers.session === undefined || isToolActive(layers.session, name))
  );
}
