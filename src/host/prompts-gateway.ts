/**
 * 提示词模板管理面（T-P3-146 C——skills-gateway 的文件域同构位）：
 * 清单（多根扫描 + 旧内联库一次性迁移 + 停用标记）、编辑器写回（frontmatter
 * 组装 + 未知键保留 + 128KB 上限 + tmp 原子替换）、删除（受控根护栏）、
 * 目录打开（Reveal）。
 *
 * 迁移语义（C 的过渡桥梁）：settings prompts 段为数组形态（U16 内联库）时，
 * 首次清单读取把条目落成用户级 `~/.aegent/prompts/*.md`（同名文件绝不覆盖
 * ——文件先到先得），完成后写迁移标记；此后数组段只读不消费（旧版本回读
 * 兼容）。管理配置（disabled/roots/allowShellExpansion）走对象形态 patch。
 */

import { existsSync, rmSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  loadPromptTemplatesFromRoots,
  buildPromptMarkdown,
  readFrontmatterLines,
  validatePromptName,
  PROMPTS_DIR,
  USER_PROMPTS_DIR,
  PROMPT_BODY_MAX_BYTES,
} from "../kernel/prompts.js";
import { validateManifest } from "../kernel/plugin-manifest.js";
import { coerceSettingValues } from "../kernel/plugin-manifest-contributes.js";
import { resolvePluginContributions } from "../kernel/plugin-contributions.js";
import { readFileSync } from "node:fs";
import { PLUGIN_AVAILABLE_CAPABILITIES } from "./plugins-gateway.js";
import type { SettingsShape } from "../session/settings.js";

function readPluginJson(dir: string): string {
  return readFileSync(path.join(dir, "plugin.json"), "utf8");
}

/** 旧内联库迁移标记文件名（用户级模板根下）。 */
const MIGRATION_MARKER = ".migrated-from-settings.json";

export interface PromptListView {
  prompts: {
    name: string;
    description?: string;
    argumentHint?: string;
    agent?: string;
    model?: string;
    content: string;
    filePath: string;
    origin: string;
    source: "project" | "user" | "extra" | "builtin";
    disabled?: boolean;
  }[];
  diagnostics: { code: string; message: string; path: string }[];
  roots: string[];
  disabled: string[];
  /** 管理配置（对象形态段——UI patch 面；数组形态段 = 缺省值）。 */
  config: { disabled: string[]; roots: string[]; allowShellExpansion: boolean };
  /** 本次读取是否执行了旧内联库迁移（UI 提示面）。 */
  migratedFromSettings?: number;
}

/** settings prompts 段的配置投影（双形态 → 统一管理配置）。 */
export function promptsConfigOf(settings: SettingsShape): {
  disabled: string[];
  roots: string[];
  allowShellExpansion: boolean;
} {
  const section = settings.prompts;
  if (Array.isArray(section) || section === undefined) {
    return { disabled: [], roots: [], allowShellExpansion: false };
  }
  return {
    disabled: section.disabled ?? [],
    roots: section.roots ?? [],
    allowShellExpansion: section.allowShellExpansion === true,
  };
}

/** 提示词根清单（扫描序 = 遮蔽序：项目级 > 附加根 > 用户级）。 */
export function promptRoots(
  settings: SettingsShape,
  workspaceRoot: string | undefined,
  homeDir: string,
): { projectRoot?: string; extraRoots: string[]; userRoot: string; all: string[] } {
  const userRoot = path.join(homeDir, USER_PROMPTS_DIR);
  const projectRoot = workspaceRoot !== undefined ? path.join(path.resolve(workspaceRoot), PROMPTS_DIR) : undefined;
  const extraRoots = promptsConfigOf(settings).roots.map((r) => path.resolve(r));
  return {
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    extraRoots,
    userRoot,
    all: [...(projectRoot !== undefined ? [projectRoot] : []), ...extraRoots, userRoot],
  };
}

/** 旧内联库一次性迁移（数组段非空 + 标记缺失 → 落文件 + 写标记）。 */
async function migrateSettingsPrompts(
  settings: SettingsShape,
  userRoot: string,
): Promise<number | undefined> {
  const entries = Array.isArray(settings.prompts) ? settings.prompts : [];
  if (entries.length === 0) return undefined;
  const markerPath = path.join(userRoot, MIGRATION_MARKER);
  if (existsSync(markerPath)) return undefined;
  await mkdir(userRoot, { recursive: true });
  let migrated = 0;
  for (const entry of entries) {
    if (validatePromptName(entry.name) !== undefined) continue; // 非法名跳过（诊断面在清单可见性之外——记入标记）
    const target = path.join(userRoot, `${entry.name}.md`);
    if (existsSync(target)) continue; // 同名文件绝不覆盖（文件先到先得）
    const md = buildPromptMarkdown({
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      content: entry.content,
    });
    await writeFile(target, md, "utf8");
    migrated++;
  }
  await writeFile(
    markerPath,
    `${JSON.stringify({ migratedAt: new Date().toISOString(), count: migrated, total: entries.length }, null, 2)}\n`,
    "utf8",
  );
  return migrated;
}

/** 清单（扫描 + 停用标记；builtin 不在文件域——UI 从 ready/meta 目录取）。 */
export async function listPrompts(
  settings: SettingsShape,
  workspaceRoot: string | undefined,
  homeDir: string,
): Promise<PromptListView> {
  const config = promptsConfigOf(settings);
  const { userRoot, all } = promptRoots(settings, workspaceRoot, homeDir);
  const migratedFromSettings = await migrateSettingsPrompts(settings, userRoot);
  const scanned = loadPromptTemplatesFromRoots(all);
  const off = new Set(config.disabled.map((d) => d.toLowerCase()));
  // T-P3-148 B：插件贡献命令并入清单（补全面板/未知命令拦截/展开同一数据源
  // ——装载侧 promptContext 合并的镜像）。逐插件校验+贡献解析（现读——热
  // 加载后下一次清单即新）；失败插件跳过（never-fail）。
  const pluginPromptItems: {
    name: string;
    description?: string;
    argumentHint?: string;
    agent?: string;
    model?: string;
    content: string;
    filePath: string;
    origin: string;
    source: "project" | "user" | "extra" | "builtin";
    disabled?: boolean;
  }[] = [];
  for (const entry of settings.plugins ?? []) {
    if (entry.enabled === false || (entry.transport ?? "inprocess") !== "inprocess") continue;
    try {
      const raw = JSON.parse(readPluginJson(entry.source));
      const manifestResult = validateManifest(raw, PLUGIN_AVAILABLE_CAPABILITIES);
      if (!manifestResult.ok) continue;
      const { merged: settingsValues } = coerceSettingValues(
        manifestResult.manifest.contributes?.settings,
        entry.options,
      );
      const resolved = resolvePluginContributions(manifestResult.manifest, entry.source, settingsValues);
      for (const cmd of resolved.commands) {
        if (off.has(cmd.name.toLowerCase())) continue;
        pluginPromptItems.push({
          name: cmd.name,
          ...(cmd.description !== undefined ? { description: cmd.description } : {}),
          ...(cmd.argumentHint !== undefined ? { argumentHint: cmd.argumentHint } : {}),
          ...(cmd.agent !== undefined ? { agent: cmd.agent } : {}),
          ...(cmd.model !== undefined ? { model: cmd.model } : {}),
          content: cmd.content,
          filePath: cmd.filePath,
          origin: cmd.origin,
          source: "extra" as const,
        });
      }
    } catch {
      // 清单坏/读失败——跳过该插件（诊断在插件中心可见）
    }
  }
  return {
    prompts: [
      ...scanned.templates.map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      ...(t.argumentHint !== undefined ? { argumentHint: t.argumentHint } : {}),
      ...(t.agent !== undefined ? { agent: t.agent } : {}),
      ...(t.model !== undefined ? { model: t.model } : {}),
      content: t.content,
      filePath: t.filePath,
      origin: t.origin,
      source:
        workspaceRoot !== undefined && t.origin === path.join(path.resolve(workspaceRoot), PROMPTS_DIR)
          ? ("project" as const)
          : t.origin === userRoot
            ? ("user" as const)
            : ("extra" as const),
      ...(off.has(t.name.toLowerCase()) ? { disabled: true } : {}),
      })),
      ...pluginPromptItems,
    ],
    diagnostics: scanned.diagnostics,
    roots: scanned.roots,
    disabled: config.disabled,
    config,
    ...(migratedFromSettings !== undefined ? { migratedFromSettings } : {}),
  };
}

/** 保存目标根（scope 闭集：project 需 workspaceRoot；缺省 project）。 */
function saveTargetRoot(
  workspaceRoot: string | undefined,
  homeDir: string,
  scope?: string,
): string {
  const wantProject = scope !== "user";
  if (wantProject && workspaceRoot !== undefined) {
    return path.join(path.resolve(workspaceRoot), PROMPTS_DIR);
  }
  if (wantProject && workspaceRoot === undefined && scope === "project") {
    const error = new Error("host 未配置 workspace，项目级模板不可用");
    (error as unknown as { code: string }).code = "PROMPTS_UNAVAILABLE";
    throw error;
  }
  return path.join(homeDir, USER_PROMPTS_DIR);
}

/**
 * 模板写回（新建/编辑）：名称 slug 校验（含保留名与 MCP 冒号拒绝）+ 正文
 * 128KB 上限 + frontmatter 组装（未知键保留）+ tmp 原子替换。同名编辑 =
 * 覆盖其所在文件；跨目录改名不处理（用户删除重建——记档）。
 */
export async function savePrompt(
  payload: {
    name: string;
    content: string;
    description?: string;
    argumentHint?: string;
    agent?: string;
    model?: string;
    scope?: string;
  },
  deps: { workspaceRoot?: string; homeDir: string },
): Promise<{ saved: true; path: string }> {
  const nameError = validatePromptName(payload.name);
  if (nameError !== undefined) {
    const error = new Error(`模板名非法：${nameError}`);
    (error as unknown as { code: string }).code = "PROMPT_BAD_NAME";
    throw error;
  }
  if (payload.name.includes(":")) {
    const error = new Error("模板名不可含冒号（MCP prompts 命名空间保留符）");
    (error as unknown as { code: string }).code = "PROMPT_BAD_NAME";
    throw error;
  }
  const RESERVED = new Set(["cancel", "find", "search", "history", "settings", "help"]);
  if (RESERVED.has(payload.name.toLowerCase())) {
    const error = new Error(`模板名「${payload.name}」为本地命令保留名`);
    (error as unknown as { code: string }).code = "PROMPT_BAD_NAME";
    throw error;
  }
  if (Buffer.byteLength(payload.content, "utf8") > PROMPT_BODY_MAX_BYTES) {
    const error = new Error(
      `模板正文超限：${String(Buffer.byteLength(payload.content, "utf8"))} 字节（上限 ${String(PROMPT_BODY_MAX_BYTES)}）`,
    );
    (error as unknown as { code: string }).code = "PROMPT_BODY_TOO_LARGE";
    throw error;
  }
  const root = saveTargetRoot(deps.workspaceRoot, deps.homeDir, payload.scope);
  const target = path.join(root, `${payload.name}.md`);
  const md = buildPromptMarkdown({
    ...(payload.description !== undefined && payload.description.trim() !== "" ? { description: payload.description } : {}),
    ...(payload.argumentHint !== undefined && payload.argumentHint.trim() !== "" ? { argumentHint: payload.argumentHint } : {}),
    ...(payload.agent !== undefined && payload.agent.trim() !== "" ? { agent: payload.agent } : {}),
    ...(payload.model !== undefined && payload.model.trim() !== "" ? { model: payload.model } : {}),
    content: payload.content,
    preserveLines: existsSync(target) ? readFrontmatterLines(target) : [],
  });
  await mkdir(root, { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, md, "utf8");
  await rename(tmp, target);
  return { saved: true, path: target };
}

/**
 * 模板删除（受控根护栏——deleteSkillDir 同构）：目标必须是受控模板根
 * （项目级 / 附加根 / 用户级）内的 .md 文件。
 */
export function deletePromptFile(
  settings: SettingsShape,
  deps: { workspaceRoot?: string; homeDir: string },
  filePath: string,
): { deleted: true; path: string } {
  const resolved = path.resolve(filePath);
  if (!resolved.endsWith(".md")) {
    const error = new Error("删除目标须为 .md 模板文件");
    (error as unknown as { code: string }).code = "PROMPT_DELETE_BAD_TARGET";
    throw error;
  }
  const { all } = promptRoots(settings, deps.workspaceRoot, deps.homeDir);
  if (!all.some((root) => resolved.startsWith(root + path.sep))) {
    const error = new Error(`删除目标不在受控模板根内：${resolved}`);
    (error as unknown as { code: string }).code = "PROMPT_DELETE_UNCONTROLLED";
    throw error;
  }
  rmSync(resolved);
  return { deleted: true, path: resolved };
}

/** 打开模板所在文件夹（Reveal——pi-desktop 先例，explorer/open/xdg-open）。 */
export function revealPromptDir(filePath: string): { revealed: true } {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  if (!existsSync(dir)) {
    const error = new Error(`模板目录不存在：${dir}`);
    (error as unknown as { code: string }).code = "PROMPT_REVEAL_MISSING";
    throw error;
  }
  const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
  return { revealed: true };
}
