/**
 * 子代理装配解析（U23/T-P3-126——agent-child 的行数纪律拆分位）：
 * settings subagents 段 → agent-process 的 subagents 装配选项。
 *
 * 独立模型预解析（resolveSubagentModel 链 + registry.resolveTarget）进
 * Map——预设量小，resolveModel 保持同步签名供 runner 按次取用。未配置
 * 独立模型面 / 条目不存在 / 注册表缺席 = 无该预设的模型条目（回退父
 * 会话模型——"独立配置缺省回退主模型"语义，与 U18 链同构）。
 */

import type { RegisteredModel } from "./model-switch.js";
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
