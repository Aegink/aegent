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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { validateManifest, type PluginManifest } from "../kernel/plugin-manifest.js";
import type { SettingsShape } from "../session/settings.js";

/** 宿主已实现能力清单（I9：声明未实现能力即拒绝——与装配面同一闭集）。 */
export const PLUGIN_AVAILABLE_CAPABILITIES = ["registerTool", "subscribe", "hooks"] as const;

/** inprocess 插件的清单文件名与入口约定。 */
export const PLUGIN_MANIFEST_FILENAME = "plugin.json";
export const PLUGIN_ENTRY_FILENAME = "index.js";

export interface PluginDiagnostics {
  readonly name: string;
  readonly transport: "inprocess" | "ws";
  readonly source: string;
  readonly enabled: boolean;
  readonly allowTools: boolean;
  /** inprocess 清单校验产出（校验通过时在位——trust 徽标数据面）。 */
  readonly manifest?: Pick<PluginManifest, "name" | "trust" | "capabilities">;
  /** 校验失败诊断（fail 类型化——清单坏不炸面，错误行可见）。 */
  readonly error?: string;
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
function inprocessError(dir: string): { error?: string; manifest?: Pick<PluginManifest, "name" | "trust" | "capabilities"> } {
  const manifestPath = path.join(dir, PLUGIN_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    return { error: `插件目录缺少 ${PLUGIN_MANIFEST_FILENAME}（约定：清单 + ${PLUGIN_ENTRY_FILENAME} 入口）` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return { error: `plugin.json 不是合法 JSON：${e instanceof Error ? e.message : String(e)}` };
  }
  const result = validateManifest(raw, PLUGIN_AVAILABLE_CAPABILITIES);
  if (!result.ok) {
    return { error: `清单校验失败：${result.errors.join("；")}` };
  }
  const manifest = result.manifest;
  if (!existsSync(path.join(dir, PLUGIN_ENTRY_FILENAME))) {
    return { error: `插件目录缺少入口 ${PLUGIN_ENTRY_FILENAME}` };
  }
  return { manifest: { name: manifest.name, trust: manifest.trust, capabilities: manifest.capabilities } };
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
      ...(checked.error !== undefined ? { error: checked.error } : {}),
      ...(checked.manifest !== undefined ? { manifest: checked.manifest } : {}),
    };
  });
}

/** 安装期校验（UI 安装表单的"先校验后落档"面——与清单同函数复用）。 */
export function checkPluginDir(dir: string): { ok: boolean; name?: string; trust?: string; error?: string } {
  const checked = inprocessError(dir);
  if (checked.error !== undefined) return { ok: false, error: checked.error };
  return { ok: true, name: checked.manifest!.name, trust: checked.manifest!.trust };
}
