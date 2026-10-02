/**
 * 插件/市场域设置 op 实现拆分位（T-P3-148——settings-gateway 的行数纪律
 * 拆分位，settings-provider-ops 同模式）：插件视图/打包/市场动作/四模板
 * 脚手架四面的实现体。gateway 方法只做一行委托。
 */

import path from "node:path";

import { checkPluginDir, pluginViewHtml } from "./plugins-gateway.js";
import { packPlugin } from "./plugins-pack.js";
import {
  marketAdd,
  marketList,
  marketPlugins,
  marketRefresh,
  marketRemove,
} from "./plugins-marketplace.js";
import {
  marketCheckUpdates,
  marketInstallPlugin,
  marketUninstallPlugin,
} from "./plugins-marketplace-install.js";
import {
  PLUGIN_TEMPLATE_IDS,
  scaffoldPlugin,
  upsertDevMarketplace,
  type PluginTemplateId,
} from "../kernel/plugin-scaffold.js";

/** 域依赖（gateway 构造参数的投影——避免整网关注入）。 */
export interface PluginOpsDeps {
  readonly settingsPath: string;
  readonly homeDir: string;
  readonly workspaceRoot?: string;
  readonly getSettings: () => Promise<import("../session/settings.js").SettingsShape>;
}

function marketError(message: string): Error {
  const error = new Error(message);
  (error as unknown as { code: string }).code = "MARKET_OP_INVALID";
  return error;
}

/** C：视图 HTML 读取（受控 iframe 渲染数据面——CSP 收敛出网）。 */
export async function pluginViewHtmlOp(
  deps: PluginOpsDeps,
  call: { name: string; view: string; base: "light" | "dark" },
): Promise<unknown> {
  const settings = await deps.getSettings();
  const locale = settings.appearance?.language === "en" ? "en" : "zh-CN";
  return pluginViewHtml(settings, call.name, call.view, { base: call.base, locale });
}

/** T：插件打包（store-only zip + sha256）。 */
export function pluginPackOp(dir: string): Promise<unknown> {
  return Promise.resolve(packPlugin(dir));
}

/** K/L/R：市场域动作面（action 闭集——协议层已校验）。 */
export async function marketOpImpl(
  deps: PluginOpsDeps,
  call: { action: string; source?: string; marketplace?: string; name?: string },
): Promise<unknown> {
  const ctx = {
    homeDir: deps.homeDir,
    settingsPath: deps.settingsPath,
  };
  switch (call.action) {
    case "add":
      if (call.source === undefined || call.source.trim() === "") {
        throw marketError("market add 需要 source");
      }
      return { added: await marketAdd(ctx, call.source) };
    case "remove":
      if (call.marketplace === undefined) throw marketError("market remove 需要 marketplace");
      return marketRemove(ctx, call.marketplace);
    case "list":
      return marketList(ctx);
    case "refresh":
      if (call.marketplace === undefined) throw marketError("market refresh 需要 marketplace");
      return { refreshed: await marketRefresh(ctx, call.marketplace) };
    case "plugins":
      if (call.marketplace === undefined) throw marketError("market plugins 需要 marketplace");
      return marketPlugins(ctx, call.marketplace);
    case "install":
      if (call.marketplace === undefined || call.name === undefined) {
        throw marketError("market install 需要 marketplace + name");
      }
      return { installed: await marketInstallPlugin(ctx, call.marketplace, call.name) };
    case "uninstall":
      if (call.marketplace === undefined || call.name === undefined) {
        throw marketError("market uninstall 需要 marketplace + name");
      }
      return marketUninstallPlugin(ctx, call.marketplace, call.name);
    case "updates":
      return marketCheckUpdates(ctx);
    default:
      throw marketError(`未知市场动作：${String(call.action)}`);
  }
}

/** H/J：四模板脚手架 + dev 市场登记（生成不自动装载）。 */
export function pluginScaffoldOp(
  deps: PluginOpsDeps,
  call: { name: string; template: string; displayName?: string; description?: string },
): Promise<unknown> {
  if (deps.workspaceRoot === undefined) {
    const error = new Error("host 未配置 workspace，插件创建面不可用");
    (error as unknown as { code: string }).code = "SKILLS_UNAVAILABLE";
    return Promise.reject(error);
  }
  if (!(PLUGIN_TEMPLATE_IDS as readonly string[]).includes(call.template)) {
    const error = new Error(`未知模板：${String(call.template)}`);
    (error as unknown as { code: string }).code = "PLUGIN_TEMPLATE_UNKNOWN";
    return Promise.reject(error);
  }
  const targetDir = path.join(deps.workspaceRoot, "plugins", call.name);
  const scaffolded = scaffoldPlugin({
    slug: call.name,
    template: call.template as PluginTemplateId,
    targetDir,
    ...(call.displayName !== undefined ? { displayName: call.displayName } : {}),
    ...(call.description !== undefined ? { description: call.description } : {}),
  });
  // J：登记进本地 dev 市场（<workspace>/plugins/marketplace.json）
  const market = upsertDevMarketplace({
    workspaceRoot: deps.workspaceRoot,
    name: call.name,
    dir: scaffolded.dir,
    version: String(scaffolded.manifest.version ?? "0.0.0"),
    ...(call.description !== undefined ? { description: call.description } : {}),
  });
  // 生成 → 预检一次（pi-desktop check 同构——warnings/errors 一并回传）
  const check = checkPluginDir(scaffolded.dir);
  return Promise.resolve({
    dir: scaffolded.dir,
    files: scaffolded.files,
    manifest: scaffolded.manifest,
    marketplace: market,
    check,
  });
}

import type { SettingsGateway } from "./settings-gateway.js";
import type { SettingsCall } from "./protocol-settings.js";

/**
 * bridge 的插件/市场族 op 分发（一行收敛面）：命中返回 Promise 结果，
 * 未命中返回 undefined（回落 gateway 既有链）。载荷按 op 闭集取值。
 */
export function tryPluginSettingsOp(
  gateway: SettingsGateway,
  call: SettingsCall,
  onPluginsMutated?: () => void,
): Promise<unknown> | undefined {
  switch (call.op) {
    case "plugin-check":
      return gateway.pluginCheck(call.dir!);
    case "plugin-scaffold":
      return gateway.pluginScaffold({
        name: call.name!,
        template: call.template!,
        ...(call.displayName !== undefined ? { displayName: call.displayName } : {}),
        ...(call.pluginDescription !== undefined ? { description: call.pluginDescription } : {}),
      });
    case "plugin-view-html":
      return gateway.pluginViewHtml({ name: call.name!, view: call.view!, base: call.base === "light" ? "light" : "dark" });
    case "plugin-pack":
      return gateway.pluginPack(call.dir!);
    case "market":
      return (async () => {
        const result = await gateway.marketOp({
          action: call.action!,
          ...(call.source !== undefined ? { source: call.source } : {}),
          ...(call.name !== undefined ? { name: call.name } : {}),
          ...(call.marketplace !== undefined ? { marketplace: call.marketplace } : {}),
        });
        // T-P3-148 热加载：市场装/卸也是 host 落盘——同通道热重载子进程
        if (call.action === "install" || call.action === "uninstall") onPluginsMutated?.();
        return result;
      })();
    case "update":
      // settings 段级更新——plugins 段落盘即热重载（安装/启停/移除共用通道）
      return (async () => {
        const settings = await gateway.update(call.patch ?? {});
        if (call.patch !== undefined && "plugins" in call.patch) onPluginsMutated?.();
        return { settings };
      })();
    default:
      return undefined;
  }
}

/**
 * 插件/市场族 settings op 载荷形状校验（T-P3-148——从 protocol-settings
 * 域拆分的行数纪律位；报错串与原实现逐字一致，protocol-settings.test 的
 * 信封回归用例继续覆盖）。
 */
export function validatePluginSettingsCall(
  op: string,
  record: Record<string, unknown>,
): void {
  if ((op === "plugin-check" || op === "plugin-pack") && (typeof record["dir"] !== "string" || record["dir"].trim() === ""))
    throw new Error(`settings op=${op} 需要 dir（插件目录绝对路径）非空字符串`);
  if (op === "plugin-view-html" && (typeof record["name"] !== "string" || record["name"] === "" || typeof record["view"] !== "string" || record["view"] === ""))
    throw new Error("settings op=plugin-view-html 需要 name + view（非空字符串）");
  if (op === "market") {
    const MARKET_ACTIONS = ["add", "remove", "list", "refresh", "plugins", "install", "uninstall", "updates"];
    if (typeof record["action"] !== "string" || !(MARKET_ACTIONS as readonly string[]).includes(record["action"]))
      throw new Error(`settings op=market 的 action 非法（合法：${MARKET_ACTIONS.join("|")}）`);
  }
  if (op === "plugin-scaffold") {
    const TEMPLATES = ["view-basic", "agent-tool", "skill-pack", "full"];
    if (typeof record["template"] !== "string" || !(TEMPLATES as readonly string[]).includes(record["template"]))
      throw new Error(`settings op=plugin-scaffold 的 template 非法（合法：${TEMPLATES.join("|")}）`);
    if (typeof record["name"] !== "string" || record["name"].trim() === "")
      throw new Error("settings op=plugin-scaffold 需要 name（插件 slug）非空字符串");
  }
  if (op === "plugin-theme-css" && (typeof record["name"] !== "string" || record["name"] === ""))
    throw new Error("settings op=plugin-theme-css 需要 name（插件名）非空字符串");
}
