/**
 * 子代理权限降级算法（H5，T-P1-41）——"只继承 deny 与 external_directory，
 * 不继承授权"在我方规则模型的落法。
 *
 * opencode·subagent-permissions.ts 的 deriveSubagentSessionPermission 是
 * 两段结构：①父规则过滤（只留 `external_directory || deny`）+ ②默认禁用
 * 清单（子代理自身规则集未显式允许时补 deny todowrite/task）。本模块取同
 * 构的两段，映射到我方规则模型：
 *
 * - **动作维度过滤**：我方规则是 `Tool(args)` 行文本 + 动作闭集
 *   allow/ask/deny，无 opencode 的 permission 类目——external_directory 是
 *   opencode 特有的"工作区外目录访问授权"类别，我方工作区外访问由
 *   PathGuard（src/sandbox/path-guard.ts）结构性拒绝，无对应授权面，降级
 *   算法不发明对应物（YAGNI）——故过滤按**动作**维度：只保留 deny。
 * - **默认禁用清单**：子代理默认禁用 `task`（不可再分子代理）与
 *   `todo_write`（H5 验收原文的 todowrite 在我方 BUILTIN_TOOL_NAMES 的
 *   映射）；allowTools 选项可显式放开（opencode canTask/canTodo 同语义）
 *   ——放开只移除默认 deny，**绝不从父规则恢复 allow/ask**（红线）。
 *
 * 产物是 RuleSource[]（rule-loader 的加载输入形状）——供子代理装配
 * （T-P1-42 的子装配工厂）构造用户层规则集，经既有 loadRules → gate 路径
 * 生效，不走第二条评估路径。
 */

import type { RuleSource } from "./rule-loader.js";

/** 子代理默认禁用的工具清单（H5 验收原文；冻结只追加，C10 先例）。 */
export const SUBAGENT_DEFAULT_DENIED_TOOLS = ["task", "todo_write"] as const;

export interface DeriveSubagentRulesOptions {
  /**
   * 显式放开默认禁用清单中的工具（调用方责任：仅对确需该能力的子代理
   * 传入）。语义是"不加默认 deny"，不是"继承父会话授权"。
   */
  readonly allowTools?: readonly string[];
}

/**
 * 派生子代理的用户层规则集：①父规则只保留 deny 动作（allow/ask 全部
 * 丢弃——绝不继承授权）；②默认禁用清单追加显式 deny（未被 allowTools
 * 放开时）。顺序：继承的 deny 在前、默认禁用在后（首匹配胜语义下动作
 * 相同结果一致；顺序只影响 verdict.rule 回显哪条原文）。
 */
export function deriveSubagentRules(
  parentRules: readonly RuleSource[],
  options: DeriveSubagentRulesOptions = {},
): RuleSource[] {
  const allowed = new Set(options.allowTools ?? []);
  const inheritedDeny = parentRules.filter((rule) => rule.action === "deny");
  const defaultDenies = SUBAGENT_DEFAULT_DENIED_TOOLS.filter(
    (tool) => !allowed.has(tool),
  ).map((tool) => ({ raw: tool, action: "deny" as const }));
  return [...inheritedDeny, ...defaultDenies];
}
