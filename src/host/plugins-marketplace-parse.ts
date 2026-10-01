/**
 * 插件市场解析面（T-P3-148 K——plugins-marketplace.ts 的行数纪律拆分位）：
 * 清单形状 / 条目 source 解析 / git URL 归一化 / add 输入判定表。
 * fail-soft 语义（坏条目跳过不炸市场——codex marketplace.rs 同语义）与
 * 路径防线（相对段禁 `..`）都在本层；记录 IO 与市场操作在主文件。
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

export interface MarketEntryVersion {
  version: string;
  changelog?: string;
  /** 已撤下架版本——更新检查跳过、详情如实标注（pi yanked 同语义）。 */
  yanked?: boolean;
}

export interface MarketEntry {
  name: string;
  source: { type: "local"; path: string } | { type: "git"; url: string; subdir?: string; ref?: string; sha?: string };
  version?: string;
  description?: string;
  category?: string;
  /** U（T-P3-148）：版本轴（catalog v2 面——首个未 yanked 版本为更新目标）。 */
  versions?: MarketEntryVersion[];
}

export interface MarketplaceManifest {
  name: string;
  description?: string;
  plugins: MarketEntry[];
}

const MARKET_NAME_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 相对路径段校验（禁绝对/`..`——codex resolve_manifest_path 同防线）。 */
function relativeInsideError(value: string, label: string): string | undefined {
  if (value === "") return `${label} 不能为空`;
  if (/^([A-Za-z]:[\\/]|\\\\|\/)/.test(value)) return `${label} 须为相对路径：${value}`;
  if (value.split(/[\\/]/).includes("..")) return `${label} 不得含 ".." 上跳：${value}`;
  return undefined;
}

/** 条目 source 解析（字符串 = local 相对路径；对象 = local/git 显式）。 */
function parseEntrySource(raw: unknown, marketRoot: string): { source: MarketEntry["source"] } | { error: string } {
  if (typeof raw === "string") {
    const err = relativeInsideError(raw, "source");
    if (err !== undefined) return { error: err };
    return { source: { type: "local", path: raw.replace(/^\.\//, "").replace(/\\/g, "/") } };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "source 须为相对路径字符串或 {source: local|git, ...} 对象" };
  }
  const rec = raw as Record<string, unknown>;
  const kind = typeof rec["source"] === "string" ? rec["source"] : typeof rec["type"] === "string" ? rec["type"] : "";
  if (kind === "local") {
    const p = rec["path"];
    if (typeof p !== "string") return { error: "local source 需要 path 字符串" };
    const err = relativeInsideError(p, "source.path");
    if (err !== undefined) return { error: err };
    return { source: { type: "local", path: p.replace(/^\.\//, "").replace(/\\/g, "/") } };
  }
  if (kind === "git") {
    const url = rec["url"];
    if (typeof url !== "string" || url === "") return { error: "git source 需要 url 字符串" };
    const subdir = typeof rec["path"] === "string" ? rec["path"] : undefined;
    if (subdir !== undefined) {
      const err = relativeInsideError(subdir, "source.path");
      if (err !== undefined) return { error: err };
    }
    const ref = typeof rec["ref"] === "string" && rec["ref"].trim() !== "" ? rec["ref"].trim() : undefined;
    const sha = typeof rec["sha"] === "string" && rec["sha"].trim() !== "" ? rec["sha"].trim() : undefined;
    return { source: { type: "git", url: normalizeGitUrl(url), ...(subdir !== undefined ? { subdir } : {}), ...(ref !== undefined ? { ref } : {}), ...(sha !== undefined ? { sha } : {}) } };
  }
  return { error: `不支持的 source 类型：${String(kind)}（v1 合法：local|git）` };
}

/** git URL 归一化（codex normalize_git_plugin_source_url 同规则）。 */
export function normalizeGitUrl(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    if (/^https:\/\/github\.com\//i.test(value) && !value.toLowerCase().endsWith(".git")) {
      return `${value}.git`;
    }
    return value;
  }
  if (/^(file:\/\/|\/|[A-Za-z]:[\\/]|ssh:\/\/)/.test(value)) return value;
  if (/^git@[^:]+:/.test(value)) return value;
  const segments = value.split("#")[0]?.split("/") ?? [];
  if (segments.length === 2 && segments.every((s) => /^[A-Za-z0-9-_.]+$/.test(s))) {
    return `https://github.com/${segments[0]}/${segments[1]?.replace(/\.git$/, "")}.git`;
  }
  throw new Error(`无法识别的 git URL：${value}`);
}

/** 市场清单解析（fail-soft：坏条目跳过——name 形状 + source 解析 + 去重）。 */
export function parseMarketplaceManifest(raw: unknown, marketRoot: string): { manifest: MarketplaceManifest } | { error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "市场清单必须是 JSON 对象" };
  }
  const rec = raw as Record<string, unknown>;
  const name = rec["name"];
  if (typeof name !== "string" || !MARKET_NAME_SHAPE.test(name)) {
    return { error: `市场 name 须为 slug 形状：${String(name)}` };
  }
  const rawPlugins = rec["plugins"];
  if (!Array.isArray(rawPlugins)) return { error: "市场清单 plugins 须为数组" };
  const plugins: MarketEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of rawPlugins.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      warnings.push(`plugins[${String(index)}] 不是对象——跳过`);
      continue;
    }
    const e = item as Record<string, unknown>;
    const entryName = e["name"];
    if (typeof entryName !== "string" || !MARKET_NAME_SHAPE.test(entryName)) {
      warnings.push(`plugins[${String(index)}].name 非 slug——跳过`);
      continue;
    }
    if (seen.has(entryName)) {
      warnings.push(`plugins[${String(index)}] 重名 ${entryName}——后者跳过`);
      continue;
    }
    const parsed = parseEntrySource(e["source"], marketRoot);
    if ("error" in parsed) {
      warnings.push(`plugins[${String(index)}]（${entryName}）：${parsed.error}——跳过`);
      continue;
    }
    seen.add(entryName);
    plugins.push({
      name: entryName,
      source: parsed.source,
      ...(typeof e["version"] === "string" ? { version: e["version"] } : {}),
      ...(typeof e["description"] === "string" ? { description: e["description"] } : {}),
      ...(typeof e["category"] === "string" ? { category: e["category"] } : {}),
      ...(Array.isArray(e["versions"])
        ? {
            versions: (e["versions"] as unknown[]).flatMap((v) => {
              if (v === null || typeof v !== "object" || typeof (v as Record<string, unknown>)["version"] !== "string") {
                warnings.push(`plugins[${String(index)}].versions 条目缺 version——跳过`);
                return [];
              }
              const rec = v as Record<string, unknown>;
              return [{
                version: rec["version"] as string,
                ...(typeof rec["changelog"] === "string" ? { changelog: rec["changelog"] } : {}),
                ...(rec["yanked"] === true ? { yanked: true } : {}),
              }];
            }),
          }
        : {}),
    });
  }
  return {
    manifest: {
      name,
      ...(typeof rec["description"] === "string" ? { description: rec["description"] } : {}),
      plugins,
    },
  };
}

// ---------------------------------------------------------------------------
// 输入解析（add 市场源的输入判定表——zcode parseMarketplaceSourceInput 裁剪）
// ---------------------------------------------------------------------------

export type MarketSourceInput =
  | { type: "directory"; path: string }
  | { type: "file"; path: string }
  | { type: "git"; url: string; ref?: string };

/** 市场源输入判定（.git|/_git/、github URL、ssh、shorthand、本地路径）。 */
export function parseMarketSourceInput(input: string): { source: MarketSourceInput } | { error: string } {
  const value = input.trim();
  if (value === "") return { error: "市场源不能为空" };
  const hashIndex = value.lastIndexOf("#");
  const ref = hashIndex > 0 ? value.slice(hashIndex + 1).trim() : undefined;
  const base = hashIndex > 0 ? value.slice(0, hashIndex) : value;
  const looksRemote = /^(https?:\/\/|ssh:\/\/|git@)/.test(base) || base.endsWith(".git") || base.includes("/_git/");
  if (looksRemote) {
    const refErr = ref !== undefined && (ref === "" || ref.startsWith("-")) ? `ref 非法：${String(ref)}` : undefined;
    if (refErr !== undefined) return { error: refErr };
    try {
      return { source: { type: "git", url: normalizeGitUrl(base), ...(ref !== undefined ? { ref } : {}) } };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  // 本地：目录 / .json 文件（~ 展开）
  const expanded = base === "~" || base.startsWith("~/")
    ? path.join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? "", base.slice(1).replace(/^\//, "").replace(/\\/g, "/"))
    : base;
  const abs = path.resolve(expanded);
  if (!existsSync(abs)) {
    // 本地不存在的 owner/repo 两段 = shorthand
    const segments = base.split("/");
    if (segments.length === 2 && segments.every((s) => /^[A-Za-z0-9-_.]+$/.test(s))) {
      try {
        return { source: { type: "git", url: normalizeGitUrl(base), ...(ref !== undefined ? { ref } : {}) } };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return { error: `市场源不存在，且不是 owner/repo 简写：${input}` };
  }
  const stat = statSync(abs);
  if (stat.isDirectory()) return { source: { type: "directory", path: abs } };
  if (stat.isFile() && abs.endsWith(".json")) return { source: { type: "file", path: abs } };
  return { error: "本地市场源须为目录或 .json 文件" };
}

