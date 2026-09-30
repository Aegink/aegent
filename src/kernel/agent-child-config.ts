/**
 * agent-child 装配配置解析（U23/T-P3-126 + U24/T-P3-127——agent-child 的
 * 行数纪律拆分位）：
 *   - 子代理装配（settings subagents 段 → defs + 独立模型闭包）；
 *   - 用户规则文件（C22 user 档文件位 ~/.aegent/rules.txt → RuleSource[]）。
 *
 * 独立模型预解析（resolveSubagentModel 链 + registry.resolveTarget）进
 * Map——预设量小，resolveModel 保持同步签名供 runner 按次取用。未配置
 * 独立模型面 / 条目不存在 / 注册表缺席 = 无该预设的模型条目（回退父
 * 会话模型——"独立配置缺省回退主模型"语义，与 U18 链同构）。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { RegisteredModel } from "./model-switch.js";
import { parseRulesText } from "../policy/rule-loader.js";
import type { SettingsShape } from "../session/settings.js";
import {
  resolveSubagentModel,
  type ResolvedSubagent,
  type SubagentDefinition,
} from "../session/subagents-config.js";

/** 子代理装配选项（agent-process options.subagents 的形状）。 */
export interface SubagentAssemblyOptions {
  defs?: SubagentDefinition[];
  resolveModel?: (
    subagent: ResolvedSubagent,
  ) => { provider: import("../models/provider.js").ModelProvider; identity: import("../models/identity.js").ModelIdentity } | undefined;
}

/** 解析 settings subagents 段为装配选项（无配置 = undefined——零行为变化）。 */
export function resolveSubagentAssembly(
  settings: SettingsShape,
  resolveTarget: (entryName: string, modelOverride: string | undefined) => Promise<RegisteredModel | undefined>,
): Promise<SubagentAssemblyOptions | undefined> {
  const defs = settings.subagents;
  if ((defs?.length ?? 0) === 0) return Promise.resolve(undefined);
  return (async () => {
    const modelMap = new Map<string, RegisteredModel>();
    for (const def of defs!) {
      if (def.modelProvider === undefined && def.model === undefined) continue;
      const target = resolveSubagentModel(def, settings.providers, settings.defaultModel);
      if (target === undefined) continue;
      const registered = await resolveTarget(target.entry.name, def.model);
      if (registered !== undefined) modelMap.set(def.name, registered);
    }
    return {
      defs,
      ...(modelMap.size > 0 ? { resolveModel: (s: ResolvedSubagent) => modelMap.get(s.name) } : {}),
    };
  })();
}

// ---------------------------------------------------------------------------
// 用户规则文件（C22 user 档文件位——U24/T-P3-127 指令中心）
// ---------------------------------------------------------------------------

/** 用户级规则文件路径（`~/.aegent/rules.txt`——指令中心编辑写回的位）。 */
export function userRulesPath(home?: string): string {
  return path.join(home ?? homedir(), ".aegent", "rules.txt");
}

/** 全局指令文件路径（`~/.aegent/AGENTS.md`——F2 合并的最远层）。 */
export function globalAgentsFile(home?: string): string {
  return path.join(home ?? homedir(), ".aegent", "AGENTS.md");
}

/**
 * 装配消费（agent-child main 调用）：读规则文件 → parseRulesText 解析。
 * 文件缺失 = 空规则集（可选能力）；坏行已由解析层跳过（装配只装载合法
 * 行——"一条坏规则不炸整个配置"的文件位延伸）。
 */
export function loadUserRuleSources(rulesPath?: string): import("../policy/rule-loader.js").RuleSource[] {
  const file = rulesPath ?? userRulesPath();
  if (!existsSync(file)) return [];
  try {
    return parseRulesText(readFileSync(file, "utf8")).sources;
  } catch {
    return []; // 读取失败与缺失同语义（规则面可选，不做权限诊断）
  }
}

/**
 * 项目层规则文件（T-P3-137 八轮 C——kimi/qwen 分层同构）：
 * `<workspace>/.aegent/rules.txt`。装载顺序 = 用户层在前、项目层在后
 * （首匹配胜——用户级规则优先于项目级）。文件缺失 = 空集。
 */
export function projectRulesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".aegent", "rules.txt");
}

export function loadProjectRuleSources(workspaceRoot: string): import("../policy/rule-loader.js").RuleSource[] {
  const file = projectRulesPath(workspaceRoot);
  if (!existsSync(file)) return [];
  try {
    return parseRulesText(readFileSync(file, "utf8")).sources;
  } catch {
    return [];
  }
}
