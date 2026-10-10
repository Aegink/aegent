/**
 * 插件贡献解析（T-P3-148 B/D/E/F——manifest contributes → 运行时贡献面）：
 * 装载期把校验过的清单贡献解析成宿主可消费的三类产物——
 *   - commands：PromptTemplateSummary 形状（名字空间 `<插件名>/<命令名>`，
 *     进提示词模板目录合并——zcode 插件命令 priority 低于用户级同语义）；
 *   - skills：技能目录清单（loadSkillsFromRoots extraDirs 的输入——名字
 *     空间化发生在扫描层，三消费口一致）；
 *   - mcpServers：stdio server 条目（运行时名 `plugin:<插件名>:<server>`，
 *     zcode toNamespacedServerName 同构；env 的 `{setting}` 引用在此解析
 *     ——pi-desktop resolveMcpRefs 同构：只查插件自身设置表，解析失败
 *     整台 server 跳过不做部分合并）。
 *
 * 纪律：本模块是装载面（子进程内）——文件读取只触达插件目录内（路径已在
 * 安装期校验相对形状，此处 resolve 后仍须落前缀检查——纵深防御）；单个
 * 贡献解析失败落诊断跳过，不炸装载（never-fail 同纪律）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { parseSkillFrontmatter, SKILL_FILENAME, type SkillSummary } from "../../kernel/skills.js";
import { PROMPT_BODY_MAX_BYTES, validatePromptName, type PromptTemplateSummary } from "../../kernel/prompts.js";
import { templatePlaceholders } from "../../kernel/prompt-args.js";
import type { McpServerEntry } from "../../session/settings.js";
import type { PluginManifest } from "./plugin-manifest.js";
import type {
  PluginCommandContrib,
  PluginMcpServerContrib,
  PluginSettingContrib,
} from "./plugin-manifest-contributes.js";

/** 贡献解析诊断（单个贡献失败跳过的可见面）。 */
export interface ContributionDiagnostic {
  readonly code: "read_failed" | "parse_failed" | "too_large" | "bad_name" | "not_found" | "setting_missing";
  readonly message: string;
  /** 关联文件（命令文件/技能文件；env 引用缺失时为清单路径）。 */
  readonly path?: string;
}

/**
 * 插件命令模板（= PromptTemplateSummary 形状——命令合并进模板目录时
 * 零适配；file 形式 filePath = 命令文件、template 内联 = plugin.json）。
 */
export type PluginCommandTemplate = PromptTemplateSummary;

/** 解析产出的 MCP 条目（McpServerEntry 形状 + 插件来源标记）。 */
export interface PluginMcpServerEntry extends McpServerEntry {
  readonly pluginName: string;
}

/** 一个插件的贡献解析产物。 */
export interface PluginContributions {
  readonly commands: readonly PluginCommandTemplate[];
  /** 技能目录（loadSkillsFromRoots extraDirs 的直接输入）。 */
  readonly skillDirs: readonly { readonly dir: string; readonly namePrefix: string }[];
  /** 技能清单预览（详情面展示；运行时清单以扫描为准）。 */
  readonly skillNames: readonly string[];
  readonly mcpServers: readonly PluginMcpServerEntry[];
  readonly diagnostics: readonly ContributionDiagnostic[];
}

const FRONTMATTER_BODY_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** 相对路径 → 插件目录内绝对路径（resolve 后落前缀检查——纵深防御二道防线）。 */
function insidePlugin(pluginDir: string, relative: string): string | undefined {
  const abs = path.resolve(pluginDir, relative);
  const rel = path.relative(path.resolve(pluginDir), abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return abs;
}

/** 命令贡献解析（file 读文件+frontmatter / template 内联——zcode 二选一同规则）。 */
function resolveCommand(
  pluginDir: string,
  pluginName: string,
  entry: PluginCommandContrib,
  out: { commands: PluginCommandTemplate[]; diagnostics: ContributionDiagnostic[] },
): void {
  const slug = entry.name ?? (entry.file !== undefined ? path.basename(entry.file).replace(/\.md$/, "") : "");
  // 斜杠调用名 = 短名（用户输入 /hi 而非 /插件名/hi——zcode/claude 语义；
  // 跨源冲突由装载聚合的首到先得+弃用诊断处理，命名空间不进调用名）
  const name = slug;
  if (validatePromptName(name) !== undefined || name.includes("/")) {
    out.diagnostics.push({ code: "bad_name", message: `命令名不合模板名规则：${name}` });
    return;
  }
  let content: string;
  let filePath: string | undefined;
  let description = entry.description;
  let argumentHint = entry.argumentHint;
  let agent = entry.agent;
  let model = entry.model;
  if (entry.template !== undefined) {
    content = entry.template;
  } else if (entry.file !== undefined) {
    const abs = insidePlugin(pluginDir, entry.file);
    if (abs === undefined || !existsSync(abs)) {
      out.diagnostics.push({ code: "not_found", message: `命令文件不存在或越界：${entry.file}`, path: entry.file });
      return;
    }
    filePath = abs;
    let raw: string;
    try {
      raw = readFileSync(abs, "utf8");
    } catch (e) {
      out.diagnostics.push({ code: "read_failed", message: `命令文件读取失败：${e instanceof Error ? e.message : String(e)}`, path: abs });
      return;
    }
    if (Buffer.byteLength(raw, "utf8") > PROMPT_BODY_MAX_BYTES) {
      out.diagnostics.push({ code: "too_large", message: `命令文件超过 ${String(PROMPT_BODY_MAX_BYTES)} 字节上限`, path: abs });
      return;
    }
    const parsed = parseSkillFrontmatter(raw);
    if (!parsed.error) {
      description = description ?? parsed.fields.get("description");
      argumentHint = argumentHint ?? parsed.fields.get("argument-hint");
      agent = agent ?? parsed.fields.get("agent");
      model = model ?? parsed.fields.get("model");
    }
    content = raw.replace(FRONTMATTER_BODY_RE, "").trim();
  } else {
    return; // 校验面已拒绝；此处兜底
  }
  if (content === "") {
    out.diagnostics.push({ code: "parse_failed", message: `命令正文为空：${name}`, path: filePath });
    return;
  }
  out.commands.push({
    name,
    ...(description !== undefined && description.trim() !== "" ? { description: description.trim() } : {}),
    ...(argumentHint !== undefined && argumentHint.trim() !== "" ? { argumentHint: argumentHint.trim() } : {}),
    ...(agent !== undefined && agent.trim() !== "" ? { agent: agent.trim() } : {}),
    ...(model !== undefined && model.trim() !== "" ? { model: model.trim() } : {}),
    content,
    filePath: filePath ?? path.join(pluginDir, "plugin.json"),
    origin: pluginDir,
    placeholders: templatePlaceholders(content),
  });
}

/** 技能贡献解析（目录直扫预览——运行时清单由 loadSkillsFromRoots 统一扫描）。 */
function resolveSkills(
  pluginDir: string,
  pluginName: string,
  dirs: readonly string[],
  out: { skillDirs: { dir: string; namePrefix: string }[]; skillNames: string[]; diagnostics: ContributionDiagnostic[] },
): void {
  for (const relative of dirs) {
    const abs = insidePlugin(pluginDir, relative);
    if (abs === undefined || !existsSync(abs)) {
      out.diagnostics.push({ code: "not_found", message: `技能目录不存在或越界：${relative}` });
      continue;
    }
    out.skillDirs.push({ dir: abs, namePrefix: pluginName });
    // 预览清单（≤128KB 逐文件——pi MAX_SKILL_BYTES 同值；frontmatter 缺
    // description 的坏文件由运行时扫描产诊断，此处只做命名空间预览）
    const files = collectSkillMd(abs, 0, []);
    for (const filePath of files) {
      try {
        if (statSync(filePath).size > 128 * 1024) {
          out.diagnostics.push({ code: "too_large", message: `技能文件超过 128KB 上限（跳过）`, path: filePath });
          continue;
        }
        const parsed = parseSkillFrontmatter(readFileSync(filePath, "utf8"));
        if (parsed.error) continue;
        const base = parsed.fields.get("name") ?? path.basename(path.dirname(filePath));
        out.skillNames.push(`${pluginName}/${base}`);
      } catch {
        // 预览读取失败不阻断——运行时扫描会再报
      }
    }
  }
}

/** 递归收集 SKILL.md（与 skills.ts collectSkillFiles 同形状——叶子即技能目录）。 */
function collectSkillMd(dir: string, depth: number, out: string[]): string[] {
  if (depth > 8) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSkillMd(child, depth + 1, out);
    else if (entry.isFile() && entry.name === SKILL_FILENAME) out.push(child);
  }
  return out;
}

/** env 值解析（pi-desktop resolveMcpRefs 同构：字面直传；{setting} 只查
 * 插件自身设置表——宿主进程环境变量永不参与；缺失 = 整台 server 跳过）。 */
function resolveEnv(
  manifestPath: string,
  env: PluginMcpServerContrib["env"],
  settings: Readonly<Record<string, unknown>>,
  schema: readonly PluginSettingContrib[] | undefined,
  out: { diagnostics: ContributionDiagnostic[] },
): Record<string, string> | undefined {
  if (env === undefined) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      resolved[key] = value;
      continue;
    }
    const raw = settings[value.setting];
    if (raw === undefined || raw === null || raw === "") {
      const declared = schema?.some((s) => s.name === value.setting) === true;
      out.diagnostics.push({
        code: "setting_missing",
        message: declared
          ? `MCP env「${key}」引用的设置「${value.setting}」未配置——server 跳过`
          : `MCP env「${key}」引用了未声明的设置「${value.setting}」——server 跳过`,
        path: manifestPath,
      });
      return undefined;
    }
    resolved[key] = String(raw);
  }
  return resolved;
}

/** 单插件贡献解析入口（装载期调用——manifest 已过全量校验）。 */
export function resolvePluginContributions(
  manifest: PluginManifest,
  pluginDir: string,
  settingsValues: Readonly<Record<string, unknown>>,
): PluginContributions {
  const out = {
    commands: [] as PluginCommandTemplate[],
    skillDirs: [] as { dir: string; namePrefix: string }[],
    skillNames: [] as string[],
    mcpServers: [] as PluginMcpServerEntry[],
    diagnostics: [] as ContributionDiagnostic[],
  };
  const contributes = manifest.contributes;
  if (contributes === undefined) return out;
  for (const entry of contributes.commands ?? []) {
    resolveCommand(pluginDir, manifest.name, entry, out);
  }
  if ((contributes.skills ?? []).length > 0) {
    resolveSkills(pluginDir, manifest.name, contributes.skills ?? [], out);
  }
  for (const server of contributes.mcpServers ?? []) {
    const env = resolveEnv(
      path.join(pluginDir, "plugin.json"),
      server.env,
      settingsValues,
      contributes.settings,
      out,
    );
    if (env === undefined && server.env !== undefined) continue; // 引用解析失败——整台跳过
    out.mcpServers.push({
      name: `plugin:${manifest.name}:${server.serverName}`,
      command: server.command,
      ...(server.args !== undefined ? { args: [...server.args] } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(server.timeoutMs !== undefined ? { timeoutMs: server.timeoutMs } : {}),
      pluginName: manifest.name,
    });
  }
  return out;
}
