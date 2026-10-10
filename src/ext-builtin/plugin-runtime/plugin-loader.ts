/**
 * 插件装配装载（T-P3-133——I4/I5 的生产装配点，真新装配）：settings
 * plugins 段的 enabled 条目 → 逐条装载 → 工具登记进 ToolRegistry。
 *
 * 装载面两种传输：
 *   - inprocess：读 `<dir>/plugin.json` 再校验（I9——装载期双防线）→
 *     动态 import `<dir>/index.js`（default 导出 AegentPlugin）→
 *     loadPlugin → handle.tools 以 `<插件名>__<工具名>` 命名空间登记
 *     （MCP server__tool 同款分隔符约定）→ 贡献解析（T-P3-148——commands/
 *     skills/mcpServers 装载期物化，装配消费点在 agent-process）；
 *   - ws：connectWsPlugin（I4——trust 恒 untrusted），工具登记开关 =
 *     entry.allowTools（"不受信来源默认 deny，显式例外是策略面"）；ws 无
 *     清单文件，贡献面不适用。
 *
 * never-fail 装配（mcpServers 同款纪律）：单插件装载失败 warn 跳过不炸
 * 启动，诊断进报告供装配日志；收尾 dispose 由调用方在装配收尾执行。
 *
 * 事件投递接线记档：SDK 的 subscribe/deliver 在位（handle.deliver 挂接点
 * = store.append 后置观察），本卡装配只接工具登记（验收面）——投递接线
 * 随需要接线，避免为非验收面侵入 store 使用路径。
 *
 * T-P3-148 G：manifest.contributes.subscriptions 声明时，SDK subscribe 的
 * 白名单收紧为声明子集（未声明 = 旧语义任意 EVENT_TYPES——向后兼容）。
 * T-P3-148 F：entry.options 经 coerceSettingValues 合并 default 后作为
 * caps.pluginSettings 注入（MCP env 的 {setting} 引用同源）。
 */

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { loadPlugin, PluginSdkError, type AegentPlugin, type PluginHandle } from "../../mcp/plugin-sdk.js";
import { connectWsPlugin, type WsPluginHandle } from "../../mcp/ws-plugin.js";
import { validateManifest, type PluginManifest } from "./plugin-manifest.js";
import { claudeToAegentManifest, discoverManifestPath } from "./plugin-compat.js";
import { coerceSettingValues } from "./plugin-manifest-contributes.js";
import {
  resolvePluginContributions,
  type PluginCommandTemplate,
  type PluginMcpServerEntry,
} from "./plugin-contributions.js";
import type { ToolRegistry } from "../../kernel/tools/registry.js";
import type { PluginEntry } from "../../session/settings.js";
import type { Logger } from "../../kernel/logger.js";

/** 装载期可声明能力（与 host/plugins-gateway 的安装期闭集一致）。 */
export const PLUGIN_RUNTIME_CAPABILITIES = ["registerTool", "subscribe", "hooks"] as const;

/** 单条装载报告（never-fail——失败进报告不进启动路径）。 */
export interface PluginLoadReport {
  readonly name: string;
  readonly transport: "inprocess" | "ws";
  readonly ok: boolean;
  /** 登记进注册表的工具数（失败/未放行为 0）。 */
  readonly toolCount: number;
  readonly error?: string;
  /** V 兼容读入警告（claude 形状未映射字段——如实可见）。 */
  readonly warnings?: readonly string[];
}

/** 全部插件的贡献聚合（跨插件同名先到先得——装载序即优先序）。 */
export interface AggregatedContributions {
  /** 本轮实际注册进注册表的工具全名（`<插件名>__<工具名>`——热重载注销面）。 */
  readonly registeredToolNames: readonly string[];
  readonly commands: readonly PluginCommandTemplate[];
  readonly skillDirs: readonly { readonly dir: string; readonly namePrefix: string }[];
  readonly skillNames: readonly string[];
  readonly mcpServers: readonly PluginMcpServerEntry[];
}

/** 命名空间登记名（`<插件名>__<工具名>`——与 MCP 工具名约定一致）。 */
function pluginToolName(pluginName: string, toolName: string): string {
  return `${pluginName}__${toolName}`;
}

/** 工具登记（PluginToolDef → ToolDef 适配——execute 无 ctx，D4 红线）。 */
export function registerPluginTools(
  registry: ToolRegistry,
  pluginName: string,
  tools: readonly { def: { name: string; description?: string; parameters?: unknown; execute: (args: import("../../core/index.js").JsonRecord) => unknown } }[],
): number {
  let count = 0;
  for (const entry of tools) {
    const def = entry.def;
    registry.registerTool({
      name: pluginToolName(pluginName, def.name),
      ...(def.parameters !== undefined ? { parameters: def.parameters as never } : {}),
      execute: (args) => def.execute(args) as never,
      // 插件工具走内联描述（I3 descriptionText——插件写不了宿主描述目录；
      // 缺省兜底文案防 MODEL_UNKNOWN_ERROR）
      descriptionText: def.description ?? `${def.name}——插件 ${pluginName} 提供的工具。`,
    });
    count++;
  }
  return count;
}

/** inprocess 装载（清单再校验 + 入口 import + loadPlugin + 登记 + 贡献解析）。 */
async function loadInprocess(
  entry: PluginEntry,
  registry: ToolRegistry,
): Promise<{
  handle: PluginHandle;
  toolCount: number;
  commands: PluginCommandTemplate[];
  skillDirs: { dir: string; namePrefix: string }[];
  skillNames: string[];
  mcpServers: PluginMcpServerEntry[];
  warnings: string[];
  toolNames: string[];
}> {
  const dir = entry.source;
  // V：清单位置回退链 + claude 形状兼容转换（与 gateway 安装面同一管线）
  const discovered = discoverManifestPath(dir);
  if (discovered === undefined) {
    throw new PluginSdkError(`插件目录缺少 plugin.json：${dir}`);
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(discovered.path, "utf8"));
  } catch (e) {
    throw new PluginSdkError(`plugin.json 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  let compatWarnings: string[] = [];
  if (discovered.kind !== "aegent") {
    const compat = claudeToAegentManifest(rawManifest, dir, discovered.kind);
    rawManifest = compat.raw;
    compatWarnings = [...compat.warnings];
  }
  const manifestResult = validateManifest(rawManifest, PLUGIN_RUNTIME_CAPABILITIES);
  if (!manifestResult.ok) {
    throw new PluginSdkError(`清单校验失败：${manifestResult.errors.join("；")}`);
  }
  const manifest: PluginManifest = manifestResult.manifest;
  if (manifest.name !== entry.name) {
    throw new PluginSdkError(
      `清单名不一致：settings 记「${entry.name}」，plugin.json 是「${manifestResult.manifest.name}」`,
    );
  }
  const entryPath = path.join(dir, "index.js");
  // S（T-P3-148——grok-build trust.rs 降级语义的登记面）：untrusted 插件的
  // 工具登记默认 deny（settings 显式 allowTools 才放行——与 ws 面同一策略）；
  // trusted 插件正常登记。执行期审批（C 族）照旧叠加。
  const shouldRegisterTools = manifest.trust === "trusted" || entry.allowTools === true;
  // F：设置值合并（default 回退 + 类型不符回退——值错误不拒装载）
  const { merged: settingsValues } = coerceSettingValues(manifest.contributes?.settings, entry.options);
  let handle: PluginHandle;
  if (needsEntryModule(manifest)) {
    if (!existsSync(entryPath)) {
      throw new PluginSdkError(`插件目录缺少入口 index.js：${dir}`);
    }
    const mod = (await import(pathToFileURL(entryPath).href)) as {
      default?: AegentPlugin;
    } & Partial<AegentPlugin>;
    // plugin.json 是权威清单（T-P3-148 走查实录：入口 manifest: undefined 曾
    // 被 loadPlugin 校验拒绝——双份清单必然漂移，统一以文件为准注入）
    const entryExport = mod.default ?? (mod as AegentPlugin);
    const plugin: AegentPlugin = { ...(entryExport as object), manifest: rawManifest } as AegentPlugin;
    handle = await loadPlugin(plugin, {
      availableCapabilities: PLUGIN_RUNTIME_CAPABILITIES,
      // G：订阅声明白名单（未声明 = 旧语义）
      ...(manifest.contributes?.subscriptions !== undefined
        ? { declaredSubscriptions: manifest.contributes.subscriptions }
        : {}),
      ...(Object.keys(settingsValues).length > 0 ? { settingsValues } : {}),
    });
  } else {
    // 纯资源插件（无 capabilities/hooks——V claude 资源包同形态）：零入口
    // 合法（gateway needsEntry 同语义），no-op 激活
    handle = await loadPlugin({ manifest: rawManifest, onActivate() {} }, {
      availableCapabilities: PLUGIN_RUNTIME_CAPABILITIES,
    });
  }
  const toolCount = shouldRegisterTools ? registerPluginTools(registry, manifest.name, handle.tools) : 0;
  // B/D/E：贡献解析（文件读取面——路径已在清单校验收敛插件目录内）
  const contributions = resolvePluginContributions(manifest, dir, settingsValues);
  return {
    handle,
    toolCount,
    /** 本插件注册的工具全名（热重载注销面——dispose 前收集）。 */
    toolNames: shouldRegisterTools ? handle.tools.map((t) => `${manifest.name}__${t.def.name}`) : [],
    commands: [...contributions.commands],
    skillDirs: [...contributions.skillDirs],
    skillNames: [...contributions.skillNames],
    mcpServers: [...contributions.mcpServers],
    warnings: compatWarnings,
  };
}

/** 入口模块必需性（与 gateway needsEntry 同判据——有代码才要求入口）。 */
function needsEntryModule(manifest: PluginManifest): boolean {
  return manifest.capabilities.length > 0 || (manifest.hooks?.length ?? 0) > 0;
}

/**
 * 装配装载入口（agent-process 调用）：enabled 条目逐条装载，never-fail；
 * 返回报告 + 贡献聚合 + dispose 回调集（装配收尾执行——进程退出路径）。
 * 跨插件贡献同名先到先得（装载序 = settings 数组序——用户可排序的优先序）。
 */
export async function loadConfiguredPlugins(
  registry: ToolRegistry,
  entries: readonly PluginEntry[] | undefined,
  options?: { logger?: Logger },
): Promise<{
  reports: PluginLoadReport[];
  contributions: AggregatedContributions;
  disposeAll: () => Promise<void>;
}> {
  const reports: PluginLoadReport[] = [];
  const handles: { dispose: () => Promise<void> }[] = [];
  const registeredToolNames: string[] = [];
  const commands: PluginCommandTemplate[] = [];
  const seenCommands = new Set<string>();
  const skillDirs: { dir: string; namePrefix: string }[] = [];
  const skillNames: string[] = [];
  const seenSkills = new Set<string>();
  const mcpServers: PluginMcpServerEntry[] = [];
  for (const entry of entries ?? []) {
    if (entry.enabled === false) {
      reports.push({ name: entry.name, transport: entry.transport ?? "inprocess", ok: true, toolCount: 0 });
      continue;
    }
    const transport = entry.transport ?? "inprocess";
    try {
      if (transport === "ws") {
        const handle: WsPluginHandle = await connectWsPlugin(entry.source, {
          // 工具登记审批位：settings 显式 allowTools 才放行（缺省全拒——
          // "不受信来源默认 deny"的装配面消费）
          onToolRegistration: () => entry.allowTools === true,
        });
        handles.push(handle);
        const toolCount = registerPluginTools(registry, entry.name, handle.tools);
        for (const t of handle.tools) registeredToolNames.push(`${entry.name}__${t.def.name}`);
        reports.push({ name: entry.name, transport, ok: true, toolCount });
      } else {
        const loaded = await loadInprocess(entry, registry);
        handles.push(loaded.handle);
        for (const cmd of loaded.commands) {
          if (seenCommands.has(cmd.name)) {
            options?.logger?.warn(`plugin-contrib: 命令名跨插件重复，后者弃用：${cmd.name}`);
            continue;
          }
          seenCommands.add(cmd.name);
          commands.push(cmd);
        }
        for (const dirEntry of loaded.skillDirs) skillDirs.push(dirEntry);
        for (const name of loaded.skillNames) {
          if (!seenSkills.has(name)) {
            seenSkills.add(name);
            skillNames.push(name);
          }
        }
        mcpServers.push(...loaded.mcpServers);
        registeredToolNames.push(...loaded.toolNames);
        reports.push({
          name: entry.name,
          transport,
          ok: true,
          toolCount: loaded.toolCount,
          ...(loaded.warnings.length > 0 ? { warnings: loaded.warnings } : {}),
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      options?.logger?.warn(`plugin-load: [${entry.name}] ${message}`);
      reports.push({ name: entry.name, transport, ok: false, toolCount: 0, error: message });
    }
  }
  return {
    reports,
    contributions: { registeredToolNames, commands, skillDirs, skillNames, mcpServers },
    disposeAll: async () => {
      for (const handle of handles) {
        try {
          await handle.dispose();
        } catch {
          // 收尾幂等面——单个 dispose 失败不阻断其余收尾
        }
      }
    },
  };
}
