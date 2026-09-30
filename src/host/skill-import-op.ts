/**
 * 技能外部源扫描与导入（T-P3-144 批次 A）——扫外部 Agent 工具落盘的技能
 * 目录，产出可导入候选（UI 勾选后整目录复制进 workspace 技能主目录）。
 *
 * 行为锚：
 *   - 源表取 zcode SUPPORTED_SKILL_AGENT_SOURCES（settingsSyncService.ts:148-181）
 *     裁剪 + `~/.agents/skills` 跨工具共享生态位（kimi/qwen/codex/opencode 四仓
 *     均消费它——存量大）；项目级补 .claude/.agents 两生态位；
 *   - 候选 = 源目录下一层：子目录含 SKILL.md → 目录技能（整目录导入）；直接
 *     子 .md → 单文件技能（kimi 平面形态——导入时转成 <name>/SKILL.md 目录
 *     形状落盘，消费面目录纪律不动）；
 *   - frontmatter 解析复用内核 parseSkillFrontmatter；body 空跳过（pi-desktop
 *     user_skills.rs:781-783 同语义）；候选带 warnings 不静默；
 *   - 导入**只复制不链接**：zcode 默认 symlink 是为 SSOT 多端投影，我方技能
 *     根即唯一消费根，复制已满足"快捷导入"且避免外部工具直改我工作区的
 *     意外写入面（调研报告 §4A 记档）；
 *   - 冲突绝不覆盖（zcode sameNameExists 语义）；apply 的源护栏 = sourcePath
 *     必须落在扫描源表目录内（防 UI 回传任意路径复制系统文件）。
 *
 * 只读面：scan 只读；apply 只写 workspace 技能主目录（与编辑器写回同一位）。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parseSkillFrontmatter, skillBody, SKILL_FILENAME } from "../kernel/skills.js";

/** 一个可导入候选（目录技能或单文件技能）。 */
export interface SkillImportCandidate {
  name: string;
  description?: string;
  /** SKILL.md（或单文件）字节数。 */
  bytes: number;
  sourceLabel: string;
  /** dir 形状 = 技能目录；file 形状 = .md 文件。 */
  sourcePath: string;
  kind: "dir" | "file";
  warning?: string;
}

/** 每源一行报告（读失败变 error 不静默——pi-desktop McpSourceReport 形态）。 */
export interface SkillImportSourceReport {
  label: string;
  dir: string;
  exists: boolean;
  count?: number;
  skipped?: number;
  error?: string;
}

export interface SkillImportScanResult {
  sources: SkillImportSourceReport[];
  candidates: SkillImportCandidate[];
}

export interface SkillImportDeps {
  homeDir: string;
  /** 工作区根（项目级源 + 导入落点定位——缺省不扫项目级源）。 */
  workspaceRoot?: string;
}

/** 单条导入项（UI 从候选回传——name/sourcePath/kind）。 */
export interface SkillImportItem {
  name: string;
  sourcePath: string;
  kind: "dir" | "file";
}

export interface SkillImportApplyResult {
  imported: { name: string; path: string }[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; error: string }[];
}

/** 扫描源表（表序即跨源重名的优先级——先到先得）。 */
export function skillImportSourceRoots(deps: SkillImportDeps): { label: string; dir: string }[] {
  const home = deps.homeDir;
  const sources: { label: string; dir: string }[] = [
    { label: "Claude Code", dir: path.join(home, ".claude", "skills") },
    { label: "Codex CLI", dir: path.join(home, ".codex", "skills") },
    { label: "通用（.agents）", dir: path.join(home, ".agents", "skills") },
    { label: "OpenCode", dir: path.join(home, ".config", "opencode", "skills") },
    { label: "Qwen Code", dir: path.join(home, ".qwen", "skills") },
    { label: "Trae", dir: path.join(home, ".trae", "skills") },
    { label: "Kiro", dir: path.join(home, ".kiro", "skills") },
    { label: "Roo", dir: path.join(home, ".roo", "skills") },
    { label: "Windsurf", dir: path.join(home, ".codeium", "windsurf", "skills") },
  ];
  if (deps.workspaceRoot !== undefined) {
    const ws = path.resolve(deps.workspaceRoot);
    sources.push(
      { label: "工作区（.claude）", dir: path.join(ws, ".claude", "skills") },
      { label: "工作区（.agents）", dir: path.join(ws, ".agents", "skills") },
    );
  }
  return sources;
}

/** 候选名称回退与 slug 预检（apply 的 fail 桶在此提前 warning）。 */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 单源一层扫描（zcode 表源全是"根目录直下即技能"布局）。 */
function scanSkillSourceDir(
  label: string,
  dir: string,
): { report: SkillImportSourceReport; candidates: SkillImportCandidate[] } {
  const report: SkillImportSourceReport = { label, dir, exists: existsSync(dir) };
  const candidates: SkillImportCandidate[] = [];
  if (!report.exists) return { report, candidates };
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    report.error = `读取失败：${e instanceof Error ? e.message : String(e)}`;
    return { report, candidates };
  }
  let skipped = 0;
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    let sourcePath: string;
    let mdPath: string;
    if (entry.isDirectory()) {
      sourcePath = path.join(dir, entry.name);
      mdPath = path.join(sourcePath, SKILL_FILENAME);
      if (!existsSync(mdPath)) continue; // 非技能目录（源根下的杂项）
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== SKILL_FILENAME) {
      sourcePath = path.join(dir, entry.name);
      mdPath = sourcePath;
    } else {
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(mdPath, "utf8");
    } catch {
      skipped++; // 读失败按坏条目计（单条不中断）
      continue;
    }
    if (skillBody(raw).trim() === "") {
      skipped++; // 空正文不是技能（pi-desktop 同语义）
      continue;
    }
    const parsed = parseSkillFrontmatter(raw);
    const fallbackName = entry.isDirectory() ? entry.name : entry.name.replace(/\.md$/, "");
    const name = parsed.fields.get("name") ?? fallbackName;
    const description = parsed.fields.get("description");
    let bytes = 0;
    try {
      bytes = statSync(mdPath).size;
    } catch {
      /* 大小展示面——失败不阻断 */
    }
    const warnings: string[] = [];
    if (parsed.fields.get("name") === undefined) warnings.push("frontmatter 缺 name——回退自目录/文件名");
    if (description === undefined || description.trim() === "") {
      warnings.push("缺 description——导入后清单不可见（装配会剔除），建议补");
    }
    if (!SKILL_NAME_RE.test(name)) warnings.push("名称非 slug 形状——导入时须改名");
    candidates.push({
      name,
      ...(description !== undefined && description.trim() !== "" ? { description: description.trim() } : {}),
      bytes,
      sourceLabel: label,
      sourcePath,
      kind: entry.isDirectory() ? "dir" : "file",
      ...(warnings.length > 0 ? { warning: warnings.join("；") } : {}),
    });
  }
  report.count = candidates.length;
  report.skipped = skipped;
  return { report, candidates };
}

/** 扫描入口（只读——候选不落任何文件）。 */
export async function skillImportScan(deps: SkillImportDeps): Promise<SkillImportScanResult> {
  const reports: SkillImportSourceReport[] = [];
  const candidates: SkillImportCandidate[] = [];
  const seenNames = new Set<string>();
  for (const src of skillImportSourceRoots(deps)) {
    const scanned = scanSkillSourceDir(src.label, src.dir);
    reports.push(scanned.report);
    for (const c of scanned.candidates) {
      if (seenNames.has(c.name)) {
        scanned.report.skipped = (scanned.report.skipped ?? 0) + 1;
        continue;
      }
      seenNames.add(c.name);
      candidates.push(c);
    }
  }
  return { sources: reports, candidates };
}

/**
 * 导入执行（整目录复制 / 单文件转目录形状）。护栏三道：name slug、目标
 * 已存在 skip（绝不覆盖）、sourcePath 必须落在扫描源表目录内（防 UI 回传
 * 任意路径复制系统文件）。单条失败不中断批次（pi-desktop runSkillImport 同）。
 */
export async function skillImportApply(
  deps: SkillImportDeps & { workspaceRoot: string },
  items: SkillImportItem[],
): Promise<SkillImportApplyResult> {
  const sourceRoots = skillImportSourceRoots(deps).map((s) => path.resolve(s.dir));
  const targetRoot = path.join(path.resolve(deps.workspaceRoot), ".zcode", "skills");
  const result: SkillImportApplyResult = { imported: [], skipped: [], failed: [] };
  for (const item of items) {
    const fail = (error: string) => result.failed.push({ name: item.name, error });
    if (!SKILL_NAME_RE.test(item.name) || item.name.includes("..")) {
      fail(`名称须为 slug 形状：${item.name}`);
      continue;
    }
    if (item.kind !== "dir" && item.kind !== "file") {
      fail(`kind 非法：${String(item.kind)}`);
      continue;
    }
    const source = path.resolve(item.sourcePath);
    const inSource = sourceRoots.some(
      (root) => source === root || source.startsWith(root + path.sep),
    );
    if (!inSource) {
      fail("来源路径不在扫描源表内（护栏拒绝）");
      continue;
    }
    const target = path.join(targetRoot, item.name);
    if (existsSync(target)) {
      result.skipped.push({ name: item.name, reason: "同名技能已存在（绝不覆盖）" });
      continue;
    }
    try {
      if (item.kind === "dir") {
        if (!existsSync(path.join(source, SKILL_FILENAME))) {
          fail("来源目录缺 SKILL.md");
          continue;
        }
        mkdirSync(targetRoot, { recursive: true });
        cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
      } else {
        // 单文件 → <name>/SKILL.md（kimi 平面形态转我方目录形状）；无
        // frontmatter 时按候选字段补齐（否则装配 invalid_metadata 剔除）
        const raw = readFileSync(source, "utf8");
        const parsed = parseSkillFrontmatter(raw);
        const content = parsed.fields.size > 0 || /^---/.test(raw.trim())
          ? raw
          : `---\nname: ${item.name}\ndescription: ${item.name}（导入时自动补——请编辑描述）\n---\n\n${raw}`;
        mkdirSync(target, { recursive: true });
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path.join(target, SKILL_FILENAME), content, "utf8");
      }
      result.imported.push({ name: item.name, path: item.kind === "dir" ? target : path.join(target, SKILL_FILENAME) });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}
