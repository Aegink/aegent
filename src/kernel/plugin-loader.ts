/**
 * 插件装配装载（T-P3-133——I4/I5 的生产装配点，真新装配）：settings
 * plugins 段的 enabled 条目 → 逐条装载 → 工具登记进 ToolRegistry。
 *
 * 装载面两种传输：
 *   - inprocess：读 `<dir>/plugin.json` 再校验（I9——装载期双防线）→
 *     动态 import `<dir>/index.js`（default 导出 AegentPlugin）→
 *     loadPlugin → handle.tools 以 `<插件名>__<工具名>` 命名空间登记
 *     （MCP server__tool 同款分隔符约定）；
 *   - ws：connectWsPlugin（I4——trust 恒 untrusted），工具登记开关 =
 *     entry.allowTools（"不受信来源默认 deny，显式例外是策略面"）。
 *
 * never-fail 装配（mcpServers 同款纪律）：单插件装载失败 warn 跳过不炸
 * 启动，诊断进报告供装配日志；收尾 dispose 由调用方在装配收尾执行。
 *
 * 事件投递接线记档：SDK 的 subscribe/deliver 在位（handle.deliver 挂接点
 * = store.append 后置观察），本卡装配只接工具登记（验收面）——投递接线
 * 随需要接线，避免为非验收面侵入 store 使用路径。
 */

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { loadPlugin, PluginSdkError, type AegentPlugin, type PluginHandle } from "../mcp/plugin-sdk.js";
import { connectWsPlugin, type WsPluginHandle } from "../mcp/ws-plugin.js";
import { validateManifest } from "../kernel/plugin-manifest.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { PluginEntry } from "../session/settings.js";
import type { Logger } from "./logger.js";

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
}

/** 命名空间登记名（`<插件名>__<工具名>`——与 MCP 工具名约定一致）。 */
function pluginToolName(pluginName: string, toolName: string): string {
  return `${pluginName}__${toolName}`;
}

/** 工具登记（PluginToolDef → ToolDef 适配——execute 无 ctx，D4 红线）。 */
function registerPluginTools(
  registry: ToolRegistry,
  pluginName: string,
  tools: readonly { def: { name: string; parameters?: unknown; execute: (args: import("../kernel/events.js").JsonRecord) => unknown } }[],
): number {
  let count = 0;
  for (const entry of tools) {
    const def = entry.def;
    registry.registerTool({
      name: pluginToolName(pluginName, def.name),
      ...(def.parameters !== undefined ? { parameters: def.parameters as never } : {}),
      execute: (args) => def.execute(args) as never,
    });
    count++;
  }
  return count;
}

/** inprocess 装载（清单再校验 + 入口 import + loadPlugin + 登记）。 */
async function loadInprocess(
  entry: PluginEntry,
  registry: ToolRegistry,
): Promise<{ handle: PluginHandle; toolCount: number }> {
  const dir = entry.source;
  const manifestPath = path.join(dir, "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new PluginSdkError(`插件目录缺少 plugin.json：${dir}`);
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new PluginSdkError(`plugin.json 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  const manifestResult = validateManifest(rawManifest, PLUGIN_RUNTIME_CAPABILITIES);
  if (!manifestResult.ok) {
    throw new PluginSdkError(`清单校验失败：${manifestResult.errors.join("；")}`);
  }
  if (manifestResult.manifest.name !== entry.name) {
    throw new PluginSdkError(
      `清单名不一致：settings 记「${entry.name}」，plugin.json 是「${manifestResult.manifest.name}」`,
    );
  }
  const entryPath = path.join(dir, "index.js");
  if (!existsSync(entryPath)) {
    throw new PluginSdkError(`插件目录缺少入口 index.js：${dir}`);
  }
  const mod = (await import(pathToFileURL(entryPath).href)) as {
    default?: AegentPlugin;
  } & Partial<AegentPlugin>;
  const plugin = mod.default ?? (mod as AegentPlugin);
  const handle = await loadPlugin(plugin, {
    availableCapabilities: PLUGIN_RUNTIME_CAPABILITIES,
  });
  const toolCount = registerPluginTools(registry, manifestResult.manifest.name, handle.tools);
  return { handle, toolCount };
}

/**
 * 装配装载入口（agent-process 调用）：enabled 条目逐条装载，never-fail；
 * 返回报告 + dispose 回调集（装配收尾执行——进程退出路径）。
 */
export async function loadConfiguredPlugins(
  registry: ToolRegistry,
  entries: readonly PluginEntry[] | undefined,
  options?: { logger?: Logger },
): Promise<{ reports: PluginLoadReport[]; disposeAll: () => Promise<void> }> {
  const reports: PluginLoadReport[] = [];
  const handles: { dispose: () => Promise<void> }[] = [];
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
        reports.push({ name: entry.name, transport, ok: true, toolCount });
      } else {
        const { handle, toolCount } = await loadInprocess(entry, registry);
        handles.push(handle);
        reports.push({ name: entry.name, transport, ok: true, toolCount });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      options?.logger?.warn(`plugin-load: [${entry.name}] ${message}`);
      reports.push({ name: entry.name, transport, ok: false, toolCount: 0, error: message });
    }
  }
  return {
    reports,
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
