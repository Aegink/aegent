/**
 * 插件管理面（T-P3-133——settings-gateway 的行数纪律拆分位）：装载清单
 * 与安装期校验。校验只读 **plugin.json 清单**（I9 validateManifest——
 * host 进程零代码执行：入口模块的 import 只发生在子进程装配期）。
 *
 * inprocess 目录约定（卡内定形，codex·manifest.rs 的"清单声明资源"行为
 * 锚）：`<dir>/plugin.json` = I9 清单形状（name/trust/capabilities/hooks），
 * `<dir>/index.js` = 入口模块（I5 AegentPlugin——装载期核对 manifest.name
 * 一致）。ws 条目 = ws:// URL（I4——trust 恒 untrusted，无清单文件）。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { validateManifest, type PluginManifest } from "../kernel/plugin-manifest.js";
import { claudeToAegentManifest, discoverManifestPath } from "../kernel/plugin-compat.js";
import type { SettingsShape } from "../session/settings.js";

/** 宿主已实现能力清单（I9：声明未实现能力即拒绝——与装配面同一闭集）。 */
export const PLUGIN_AVAILABLE_CAPABILITIES = ["registerTool", "subscribe", "hooks"] as const;

/** inprocess 插件的清单文件名与入口约定。 */
export const PLUGIN_MANIFEST_FILENAME = "plugin.json";
export const PLUGIN_ENTRY_FILENAME = "index.js";

/** 清单回包投影（管理/详情/审批/视图四面的共享形状）。 */
export type PluginManifestView = Pick<
  PluginManifest,
  "name" | "trust" | "capabilities" | "theme" | "version" | "description" | "contributes"
>;

export interface PluginDiagnostics {
  readonly name: string;
  readonly transport: "inprocess" | "ws";
  readonly source: string;
  readonly enabled: boolean;
  readonly allowTools: boolean;
  /** 市场来源标记（market install 落盘——UI 市场徽标与卸载入口的条件面）。 */
  readonly marketplace?: string;
  /** inprocess 清单校验产出（校验通过时在位——trust 徽标数据面）。 */
  readonly manifest?: PluginManifestView;
  /** 校验失败诊断（fail 类型化——清单坏不炸面，错误行可见）。 */
  readonly error?: string;
  /** V 兼容读入警告（claude 形状未映射字段——不拒装，如实可见）。 */
  readonly warnings?: readonly string[];
}

/** ws URL 形状校验（协议 + 非空 host——连接失败在装配期 never-fail 跳过）。 */
function wsUrlError(source: string): string | undefined {
  try {
    const url = new URL(source);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return `ws 插件 source 须为 ws:// 或 wss:// URL，收到：${url.protocol}`;
    }
    if (url.host === "") return "ws 插件 URL 缺少 host";
    return undefined;
  } catch {
    return `ws 插件 source 不是合法 URL：${source.slice(0, 80)}`;
  }
}

/** inprocess 目录校验（清单存在 → JSON 解析 → I9 全量校验——零代码执行）。 */
function inprocessError(
  dir: string,
): { error?: string; manifest?: PluginManifestView; warnings?: string[] } {
  // V（T-P3-148）：清单位置回退链（plugin.json → .claude-plugin →
  // .codex-plugin）+ claude 形状兼容转换（warnings 如实回传不拒装）
  const discovered = discoverManifestPath(dir);
  if (discovered === undefined) {
    return { error: `插件目录缺少 plugin.json（约定：清单 + ${PLUGIN_ENTRY_FILENAME} 入口；兼容 .claude-plugin/plugin.json）` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(discovered.path, "utf8"));
  } catch (e) {
    return { error: `plugin.json 不是合法 JSON：${e instanceof Error ? e.message : String(e)}` };
  }
  let warnings: string[] = [];
  if (discovered.kind !== "aegent") {
    const compat = claudeToAegentManifest(raw, dir, discovered.kind);
    raw = compat.raw;
    warnings = [...compat.warnings];
  }
  const result = validateManifest(raw, PLUGIN_AVAILABLE_CAPABILITIES);
  if (!result.ok) {
    return { error: `清单校验失败：${result.errors.join("；")}`, warnings };
  }
  const manifest = result.manifest;
  // T-P3-141：入口按需——声明了 capabilities/hooks 才要求 index.js（有代码
  // 才有入口）；纯主题/资源插件零代码可载，无入口合法（内核装载面照旧
  // never-fail 跳过——主题应用走 host 的 CSS 读取，不经内核入口）。
  const needsEntry =
    manifest.capabilities.length > 0 || (manifest.hooks?.length ?? 0) > 0;
  if (needsEntry && !existsSync(path.join(dir, PLUGIN_ENTRY_FILENAME))) {
    return { error: `插件目录缺少入口 ${PLUGIN_ENTRY_FILENAME}` };
  }
  // T-P3-148 A：贡献引用文件的存在性校验（pi-desktop check 预检同款——
  // 声明了就要存在；路径形状已在 validateManifest 收敛，此处 resolve 后
  // 落前缀检查防 symlink/大小写异形——纵深防御）
  const missing: string[] = [];
  for (const cmd of manifest.contributes?.commands ?? []) {
    if (cmd.file === undefined) continue;
    const abs = path.resolve(dir, cmd.file);
    if (!abs.startsWith(path.resolve(dir) + path.sep) || !existsSync(abs)) {
      missing.push(`命令文件 ${cmd.file}`);
    }
  }
  for (const skillDir of manifest.contributes?.skills ?? []) {
    const abs = path.resolve(dir, skillDir);
    if (!abs.startsWith(path.resolve(dir) + path.sep) || !existsSync(abs)) {
      missing.push(`技能目录 ${skillDir}`);
    }
  }
  for (const view of manifest.contributes?.views ?? []) {
    const abs = path.resolve(dir, view.entry);
    if (!abs.startsWith(path.resolve(dir) + path.sep) || !existsSync(abs)) {
      missing.push(`视图入口 ${view.entry}`);
    }
  }
  if (missing.length > 0) {
    return { error: `贡献引用缺失：${missing.join("、")}` };
  }
  return {
    manifest: {
      name: manifest.name,
      trust: manifest.trust,
      capabilities: manifest.capabilities,
      ...(manifest.theme !== undefined ? { theme: manifest.theme } : {}),
      ...(manifest.version !== undefined ? { version: manifest.version } : {}),
      ...(manifest.description !== undefined ? { description: manifest.description } : {}),
      ...(manifest.contributes !== undefined ? { contributes: manifest.contributes } : {}),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** 装载清单视图（settings.plugins → 逐条校验诊断——管理页数据面）。 */
export function listPlugins(settings: SettingsShape): PluginDiagnostics[] {
  return (settings.plugins ?? []).map((entry) => {
    const transport = entry.transport ?? "inprocess";
    if (entry.enabled === false) {
      // 停用条目跳过校验（开关是开回的路径——坏清单在停用态不拦人）
      return {
        name: entry.name,
        transport,
        source: entry.source,
        enabled: false,
        allowTools: entry.allowTools === true,
        ...(entry.marketplace !== undefined ? { marketplace: entry.marketplace } : {}),
      };
    }
    if (transport === "ws") {
      const error = wsUrlError(entry.source);
      return {
        name: entry.name,
        transport,
        source: entry.source,
        enabled: true,
        allowTools: entry.allowTools === true,
        ...(entry.marketplace !== undefined ? { marketplace: entry.marketplace } : {}),
        ...(error !== undefined ? { error } : {}),
      };
    }
    const checked = inprocessError(entry.source);
    return {
      name: entry.name,
      transport,
      source: entry.source,
      enabled: true,
      allowTools: entry.allowTools === true,
      ...(entry.marketplace !== undefined ? { marketplace: entry.marketplace } : {}),
      ...(checked.error !== undefined ? { error: checked.error } : {}),
      ...(checked.manifest !== undefined ? { manifest: checked.manifest } : {}),
      ...(checked.warnings !== undefined && checked.warnings.length > 0 ? { warnings: checked.warnings } : {}),
    };
  });
}

/**
 * 安装期校验（UI 安装表单的"先校验后落档"面——与清单同函数复用）。
 * T-P3-148 Q：回包携带完整 manifest pick（审批对话框的真实清单预览数据面）。
 */
export function checkPluginDir(dir: string): {
  ok: boolean;
  name?: string;
  trust?: string;
  manifest?: PluginDiagnostics["manifest"];
  error?: string;
} {
  const checked = inprocessError(dir);
  if (checked.error !== undefined) return { ok: false, error: checked.error };
  return {
    ok: true,
    name: checked.manifest!.name,
    trust: checked.manifest!.trust,
    manifest: checked.manifest,
  };
}

/** 插件视图 HTML 的读取上限（256KB——视图不是应用载体，同 theme.css）。 */
const PLUGIN_VIEW_HTML_MAX_BYTES = 256 * 1024;

/**
 * 插件视图 HTML 读取（T-P3-148 C——受控 iframe 渲染的数据面）：按插件名 +
 * 视图 id 定位 enabled inprocess 条目的 contributes.views 条目 → 相对 entry
 * 读取（resolveInside 防逃逸 + 256KB 上限）→ 宿主注入两段头部：
 *   ①CSP meta：default-src 'none' + connect-src 'none'——srcdoc iframe 的
 *     出网点收敛（pi egress 策略的 v1 等价物：视图自足、无宿主网络面）；
 *   ②初始外观常量 `window.__AEGENT_VIEW__`（先于页面代码——piViewOpen 的
 *     "URL 参数为初始态"同构）。
 * 视图与宿主的桥 = postMessage 窄消息面（v1 只读：外观事件；无宿主句柄）。
 */
export function pluginViewHtml(
  settings: SettingsShape,
  name: string,
  viewId: string,
  appearance: { base: "light" | "dark"; locale: string },
): { html: string; title: string; viewId: string } {
  const entry = (settings.plugins ?? []).find((p) => p.name === name && p.enabled !== false);
  if (entry === undefined || (entry.transport ?? "inprocess") !== "inprocess") {
    throw typedError("PLUGIN_VIEW_NOT_FOUND", `插件「${name}」不存在、已停用或非目录插件`);
  }
  const checked = inprocessError(entry.source);
  if (checked.error !== undefined || checked.manifest === undefined) {
    throw typedError("PLUGIN_VIEW_NOT_FOUND", `插件「${name}」清单校验失败：${checked.error ?? ""}`);
  }
  const view = checked.manifest.contributes?.views?.find((v) => v.id === viewId);
  if (view === undefined) {
    throw typedError("PLUGIN_VIEW_NOT_FOUND", `插件「${name}」未声明视图「${viewId}」`);
  }
  const rootDir = path.resolve(entry.source);
  const htmlPath = path.resolve(rootDir, view.entry);
  if (!htmlPath.startsWith(rootDir + path.sep) && htmlPath !== rootDir) {
    throw typedError("PLUGIN_VIEW_NOT_FOUND", `视图 entry 越出插件目录：${view.entry}`);
  }
  let stat;
  try {
    stat = statSync(htmlPath);
  } catch {
    throw typedError("PLUGIN_VIEW_NOT_FOUND", `视图入口不存在：${view.entry}`);
  }
  if (stat.size > PLUGIN_VIEW_HTML_MAX_BYTES) {
    throw typedError("PLUGIN_VIEW_NOT_FOUND", `视图 HTML 超过 256KB 上限：${view.entry}`);
  }
  let html: string;
  try {
    html = readFileSync(htmlPath, "utf8");
  } catch (e) {
    throw typedError("PLUGIN_VIEW_NOT_FOUND", `视图 HTML 读取失败：${e instanceof Error ? e.message : String(e)}`);
  }
  const inject = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none';" />` +
    `<script>window.__AEGENT_VIEW__=${JSON.stringify({ base: appearance.base, locale: appearance.locale, pluginName: name, viewId })};</script>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}
${inject}`);
  } else {
    html = `${inject}
${html}`;
  }
  return { html, title: view.title, viewId };
}

function typedError(code: string, message: string): Error {
  const error = new Error(message);
  (error as unknown as { code: string }).code = code;
  return error;
}

/** 插件主题 CSS 的读取上限（256KB——主题样式不是应用载体）。 */
const PLUGIN_THEME_CSS_MAX_BYTES = 256 * 1024;

/** 插件主题 CSS 读取（T-P3-141——UI 注入 <style> 的数据面）：
 *  按插件名定位 enabled 的 inprocess 条目 → 清单 theme 贡献 → 相对 css
 *  文件读取。路径收敛在插件目录内（防清单写 .. / 绝对路径的任意文件读）、
 *  体积上限、类型化拒绝（找不到/无主题/超限），UI 回退基础主题。 */
export function pluginThemeCss(
  settings: SettingsShape,
  name: string,
): { css: string; base: "light" | "dark"; displayName: string } {
  const entry = (settings.plugins ?? []).find((p) => p.name === name && p.enabled !== false);
  if (entry === undefined || (entry.transport ?? "inprocess") !== "inprocess") {
    const error = new Error(`插件「${name}」不存在、已停用或非目录插件`);
    (error as unknown as { code: string }).code = "PLUGIN_THEME_NOT_FOUND";
    throw error;
  }
  const checked = inprocessError(entry.source);
  if (checked.error !== undefined || checked.manifest === undefined) {
    const error = new Error(`插件「${name}」清单校验失败：${checked.error ?? ""}`);
    (error as unknown as { code: string }).code = "PLUGIN_THEME_NOT_FOUND";
    throw error;
  }
  const theme = checked.manifest.theme;
  if (theme === undefined) {
    const error = new Error(`插件「${name}」未声明 theme 贡献`);
    (error as unknown as { code: string }).code = "PLUGIN_THEME_NOT_FOUND";
    throw error;
  }
  const rootDir = path.resolve(entry.source);
  const cssPath = path.resolve(rootDir, theme.css);
  if (!cssPath.startsWith(rootDir + path.sep) && cssPath !== rootDir) {
    const error = new Error(`插件「${name}」的 theme.css 越出插件目录（防任意文件读）`);
    (error as unknown as { code: string }).code = "PLUGIN_THEME_NOT_FOUND";
    throw error;
  }
  let css: string;
  try {
    const stat = statSync(cssPath);
    if (stat.size > PLUGIN_THEME_CSS_MAX_BYTES) {
      const error = new Error(`插件主题 css 超过 256KB 上限：${theme.css}`);
      (error as unknown as { code: string }).code = "PLUGIN_THEME_NOT_FOUND";
      throw error;
    }
    css = readFileSync(cssPath, "utf8");
  } catch (e) {
    if (e instanceof Error && (e as unknown as { code?: string }).code === "PLUGIN_THEME_NOT_FOUND") throw e;
    const error = new Error(`插件主题 css 读取失败：${theme.css}`);
    (error as unknown as { code: string }).code = "PLUGIN_THEME_NOT_FOUND";
    throw error;
  }
  return { css, base: theme.base, displayName: theme.name ?? name };
}
