/**
 * claude 插件格式兼容读入（T-P3-148 V——qwen 三转换器 + zcode/codex 目录
 * 回退链的最小我方位）：
 *
 *   1. 清单位置回退链：`plugin.json` → `.claude-plugin/plugin.json` →
 *      `.codex-plugin/plugin.json`（zcode findManifest 同序——claude-plugin
 *      已是事实标准，兼容读入让生态插件可直接被浏览/安装）；
 *   2. 字段映射（qwen claude-converter 的映射表裁剪）：
 *      - skills（string|string[] 目录）→ contributes.skills（我方目录扫描
 *        语义一致，零转换）；
 *      - commands（目录）→ 展开 *.md 为 contributes.commands 的 file 条目
 *        （我方 file 形式本就解析 frontmatter 的 description/argument-hint）；
 *      - mcpServers（对象映射，stdio 形状）→ contributes.mcpServers
 *        （serverName = 键名；http/sse 形状跳过——我方 MCP 域 v1 仅 stdio）；
 *      - userConfig（zcode 形状）→ contributes.settings（类型映射；
 *        directory/file 归并为 string）；
 *      - hooks/agents 等其余字段不映射，产 warning（安装可过、声明面缺失
 *        如实可见——fail-soft 与生态兼容的平衡点）。
 *
 * 输出仍是"raw manifest"形状——交给既有 validateManifest 全量校验（闭集/
 * 上限/路径防线全部复用，兼容层不引入第二条校验路径）。
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** 清单位置回退链（zcode findManifest 同序；返回 {path, kind}）。 */
export function discoverManifestPath(dir: string): { path: string; kind: "aegent" | "claude" | "codex" } | undefined {
  const candidates: { relative: string; kind: "aegent" | "claude" | "codex" }[] = [
    { relative: "plugin.json", kind: "aegent" },
    { relative: path.join(".claude-plugin", "plugin.json"), kind: "claude" },
    { relative: path.join(".codex-plugin", "plugin.json"), kind: "codex" },
  ];
  for (const candidate of candidates) {
    const abs = path.join(dir, candidate.relative);
    if (existsSync(abs)) return { path: abs, kind: candidate.kind };
  }
  return undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v !== "undefined" && typeof v === "object" && !Array.isArray(v);

/** 递归收集 .md（commands 目录展开——深度上限防环）。 */
function collectMd(dir: string, base: string, depth: number, out: string[]): void {
  if (depth > 6) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMd(child, base, depth + 1, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      const relative = path.relative(base, child).replace(/\\/g, "/");
      out.push(relative);
    }
  }
}

/** 兼容转换结果：raw manifest（喂 validateManifest）+ 映射诊断。 */
export interface CompatResult {
  readonly raw: Record<string, unknown>;
  readonly warnings: readonly string[];
}

/**
 * claude/zcode 形状 → 我方 manifest v2 形状（只映射、不校验——校验统一走
 * validateManifest；非 claude 清单原样返回零警告）。
 */
export function claudeToAegentManifest(raw: unknown, pluginDir: string, kind: "aegent" | "claude" | "codex"): CompatResult {
  const warnings: string[] = [];
  if (!isRecord(raw)) return { raw: {}, warnings };
  const out: Record<string, unknown> = { ...raw };
  if (kind === "aegent") return { raw: out, warnings };
  delete out["contributes"]; // claude 清单无此键——防混写
  const contributes: Record<string, unknown> = {};
  // 源键删除表（映射过的键从 raw 摘除——闭集校验不允许双形态并存）
  const consumed = new Set<string>();

  // skills：目录路径（string|string[]）——我方同语义直通
  const skills = raw["skills"];
  if (typeof skills === "string" || Array.isArray(skills)) {
    const list = (Array.isArray(skills) ? skills : [skills]).filter((s): s is string => typeof s === "string" && s.trim() !== "");
    if (list.length > 0) {
      contributes["skills"] = list.map((s) => s.replace(/^\.\//, "").replace(/\\/g, "/"));
      consumed.add("skills");
    }
  }

  // commands：目录展开为 file 条目（frontmatter 由装载面解析）
  const commands = raw["commands"];
  if (typeof commands === "string" && commands.trim() !== "") {
    const abs = path.resolve(pluginDir, commands);
    const files: string[] = [];
    collectMd(abs, pluginDir, 0, files);
    contributes["commands"] = files.slice(0, 32).map((f) => ({ file: f }));
    if (files.length > 32) warnings.push(`commands 目录超过 32 个文件——截断（上限 ${32}）`);
    consumed.add("commands");
  }

  // mcpServers：对象映射（stdio 形状）→ 条目数组
  const mcpServers = raw["mcpServers"];
  if (isRecord(mcpServers)) {
    const entries: Record<string, unknown>[] = [];
    for (const [serverName, value] of Object.entries(mcpServers)) {
      if (!isRecord(value)) {
        warnings.push(`mcpServers.${serverName} 非 .mcp.json 形状对象——跳过`);
        continue;
      }
      if (typeof value["url"] === "string" || value["type"] === "http" || value["type"] === "sse") {
        warnings.push(`mcpServers.${serverName} 是 http/sse 形状——我方 MCP 域 v1 仅 stdio，跳过`);
        continue;
      }
      if (typeof value["command"] !== "string" || value["command"] === "") {
        warnings.push(`mcpServers.${serverName} 缺 command——跳过`);
        continue;
      }
      entries.push({
        serverName: serverName.replace(/[^a-z0-9._-]/gi, "-").toLowerCase(),
        command: value["command"],
        ...(Array.isArray(value["args"]) ? { args: value["args"] } : {}),
        ...(isRecord(value["env"]) ? { env: value["env"] } : {}),
      });
    }
    if (entries.length > 0) {
      contributes["mcpServers"] = entries;
      consumed.add("mcpServers");
    }
  }

  // userConfig（zcode 形状）→ settings
  const userConfig = raw["userConfig"];
  if (isRecord(userConfig)) {
    const settings: Record<string, unknown>[] = [];
    for (const [key, value] of Object.entries(userConfig)) {
      if (!isRecord(value)) continue;
      const slugKey = key.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^[^a-z0-9]+/, "") || "setting";
      const rawType = typeof value["type"] === "string" ? value["type"] : "string";
      const type = rawType === "number" ? "number" : rawType === "boolean" ? "boolean" : "string";
      if (type === "string" || type === "number" || type === "boolean") {
        settings.push({
          name: slugKey,
          type,
          ...(value["default"] !== undefined && typeof value["default"] === typeof (type === "number" ? 0 : type === "boolean" ? true : "") ? { default: value["default"] } : {}),
          ...(typeof value["description"] === "string" ? { description: value["description"] } : {}),
          ...(value["sensitive"] === true ? { sensitive: true } : {}),
          ...(value["required"] === true ? { required: true } : {}),
        });
      }
    }
    if (settings.length > 0) {
      contributes["settings"] = settings;
      consumed.add("userConfig");
    }
  }

  // hooks：claude 形状不映射（事件模型不同——下方统一告警并摘除）
  for (const key of ["hooks", "agents", "lspServers", "outputStyles", "channels", "settings", "dependencies"] as const) {
    if (raw[key] !== undefined) {
      warnings.push(`字段「${key}」未映射——忽略`);
      delete out[key]; // 未映射键一并摘除——闭集校验不允许残留
    }
  }

  // claude/zcode 清单没有我方 trust/capabilities 面——注入安全缺省
  // （untrusted + 无能力声明：贡献面经 contributes 表达，不默认给运行时能力）
  if (out["trust"] === undefined) out["trust"] = "untrusted";
  if (out["capabilities"] === undefined) out["capabilities"] = [];
  for (const key of consumed) delete out[key];
  if (Object.keys(contributes).length > 0) out["contributes"] = contributes;
  return { raw: out, warnings };
}
