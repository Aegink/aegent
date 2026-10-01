/**
 * 提示词模板外部源扫描与导入（T-P3-146 D——skill-import-op 同构位）：
 * 扫外部 Agent 工具落盘的自定义命令目录，产出可导入候选（UI 勾选后按
 * 命名空间相对路径复制进 workspace 模板主目录）。
 *
 * 行为锚：
 *   - 源表 = 调研报告 §3 的四仓目录约定并集（claude / opencode / zcode /
     pi / qwen / 通用 .agents；codex 已废自定义 prompts——目录残留仍认）；
 *   - 候选 = 源目录下递归 .md（深度 ≤2——claude 子目录命名空间形态），
 *     命名空间 = 相对路径去 .md（导入后与我方文件域同构）；
 *   - frontmatter 解析复用内核 parseSkillFrontmatter（宽松 key: value 行）；
 *   - 导入只复制不链接（技能导入同决策——避免外部工具直改我工作区）；
 *   - 冲突绝不覆盖；apply 的源护栏 = sourcePath 必须落在扫描源表目录内。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parseSkillFrontmatter, skillBody } from "../kernel/skills.js";

/** 一个可导入候选（模板 .md 文件——命名空间来自相对路径）。 */
export interface PromptImportCandidate {
  /** 目标名（相对路径去 .md，`/` 命名空间）。 */
  name: string;
  description?: string;
  argumentHint?: string;
  bytes: number;
  sourceLabel: string;
  sourcePath: string;
  warning?: string;
}

/** 每源一行报告（读失败变 error 不静默）。 */
export interface PromptImportSourceReport {
  label: string;
  dir: string;
  exists: boolean;
  count?: number;
  skipped?: number;
  error?: string;
}

export interface PromptImportScanResult {
  sources: PromptImportSourceReport[];
  candidates: PromptImportCandidate[];
}

export interface PromptImportDeps {
  homeDir: string;
  workspaceRoot?: string;
}

/** 单条导入项（UI 从候选回传）。 */
export interface PromptImportItem {
  name: string;
  sourcePath: string;
}

export interface PromptImportApplyResult {
  imported: { name: string; path: string }[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; error: string }[];
}

/** 扫描源表（表序即跨源重名的优先级——先到先得）。 */
export function promptImportSourceRoots(deps: PromptImportDeps): { label: string; dir: string }[] {
  const home = deps.homeDir;
  const sources: { label: string; dir: string }[] = [
    { label: "Claude Code（用户）", dir: path.join(home, ".claude", "commands") },
    { label: "OpenCode（用户）", dir: path.join(home, ".config", "opencode", "command") },
    { label: "OpenCode commands", dir: path.join(home, ".config", "opencode", "commands") },
    { label: "ZCode（用户）", dir: path.join(home, ".zcode", "commands") },
    { label: "Pi（用户）", dir: path.join(home, ".pi", "agent", "prompts") },
    { label: "Qwen Code（用户）", dir: path.join(home, ".qwen", "commands") },
    { label: "通用（.agents）", dir: path.join(home, ".agents", "commands") },
    { label: "Codex（遗留）", dir: path.join(home, ".codex", "prompts") },
  ];
  if (deps.workspaceRoot !== undefined) {
    const ws = path.resolve(deps.workspaceRoot);
    sources.push(
      { label: "工作区（.claude/commands）", dir: path.join(ws, ".claude", "commands") },
      { label: "工作区（.opencode/command）", dir: path.join(ws, ".opencode", "command") },
      { label: "工作区（.opencode/commands）", dir: path.join(ws, ".opencode", "commands") },
      { label: "工作区（.zcode/commands）", dir: path.join(ws, ".zcode", "commands") },
      { label: "工作区（.pi/prompts）", dir: path.join(ws, ".pi", "prompts") },
      { label: "工作区（.qwen/commands）", dir: path.join(ws, ".qwen", "commands") },
      { label: "工作区（.agents/commands）", dir: path.join(ws, ".agents", "commands") },
    );
  }
  return sources;
}

/** 名称段规则（与我方文件域一致——导入时警告非 slug 名）。 */
const PROMPT_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 单源递归扫描（深度 ≤2；一层 = 平面形态，二层 = claude 命名空间形态）。 */
function scanPromptSourceDir(
  label: string,
  dir: string,
): { report: PromptImportSourceReport; candidates: PromptImportCandidate[] } {
  const report: PromptImportSourceReport = { label, dir, exists: existsSync(dir) };
  const candidates: PromptImportCandidate[] = [];
  if (!report.exists) return { report, candidates };
  const walk = (base: string, depth: number): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch (e) {
      if (base === dir) report.error = `读取失败：${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(base, entry.name);
      if (entry.isDirectory() && depth < 2) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const relative = path.relative(dir, full).replace(/\\/g, "/").replace(/\.md$/, "");
      let raw = "";
      try {
        raw = readFileSync(full, "utf8");
      } catch {
        report.skipped = (report.skipped ?? 0) + 1;
        continue;
      }
      if (skillBody(raw).trim() === "" && !/^---/.test(raw.trim())) {
        report.skipped = (report.skipped ?? 0) + 1; // 空文件不是模板
        continue;
      }
      const parsed = parseSkillFrontmatter(raw);
      const description = parsed.fields.get("description");
      const argumentHint = parsed.fields.get("argument-hint");
      let bytes = 0;
      try {
        bytes = statSync(full).size;
      } catch {
        /* 大小展示面——失败不阻断 */
      }
      const warnings: string[] = [];
      for (const segment of relative.split("/")) {
        if (!PROMPT_SEGMENT_RE.test(segment)) {
          warnings.push(`名称段「${segment}」非 slug——导入时须改名`);
          break;
        }
      }
      if (description === undefined || description.trim() === "") {
        warnings.push("缺 description——清单只有名字，建议补");
      }
      candidates.push({
        name: relative,
        ...(description !== undefined && description.trim() !== "" ? { description: description.trim() } : {}),
        ...(argumentHint !== undefined && argumentHint.trim() !== "" ? { argumentHint: argumentHint.trim() } : {}),
        bytes,
        sourceLabel: label,
        sourcePath: full,
        ...(warnings.length > 0 ? { warning: warnings.join("；") } : {}),
      });
    }
  };
  walk(dir, 0);
  report.count = candidates.length;
  return { report, candidates };
}

/** 扫描入口（只读——候选不落任何文件）。 */
export async function promptImportScan(deps: PromptImportDeps): Promise<PromptImportScanResult> {
  const reports: PromptImportSourceReport[] = [];
  const candidates: PromptImportCandidate[] = [];
  const seenNames = new Set<string>();
  for (const src of promptImportSourceRoots(deps)) {
    const scanned = scanPromptSourceDir(src.label, src.dir);
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
 * 导入执行（按命名空间相对路径复制进 workspace 模板主目录）。护栏三道：
 * 名称段 slug、目标已存在 skip（绝不覆盖）、sourcePath 必须落在扫描源表
 * 目录内（防 UI 回传任意路径复制系统文件）。单条失败不中断批次。
 */
export async function promptImportApply(
  deps: PromptImportDeps & { workspaceRoot: string },
  items: PromptImportItem[],
): Promise<PromptImportApplyResult> {
  const sourceRoots = promptImportSourceRoots(deps).map((s) => path.resolve(s.dir));
  const targetRoot = path.join(path.resolve(deps.workspaceRoot), ".zcode", "prompts");
  const result: PromptImportApplyResult = { imported: [], skipped: [], failed: [] };
  for (const item of items) {
    const fail = (error: string) => result.failed.push({ name: item.name, error });
    const segments = item.name.split("/");
    if (item.name === "" || item.name.includes("..") || segments.some((s) => !PROMPT_SEGMENT_RE.test(s))) {
      fail(`名称须为 slug 命名空间形状：${item.name}`);
      continue;
    }
    const source = path.resolve(item.sourcePath);
    const inSource = sourceRoots.some((root) => source === root || source.startsWith(root + path.sep));
    if (!inSource) {
      fail("来源路径不在扫描源表内（护栏拒绝）");
      continue;
    }
    if (!existsSync(source) || !statSync(source).isFile()) {
      fail("来源文件不存在");
      continue;
    }
    const target = path.join(targetRoot, ...segments) + ".md";
    if (existsSync(target)) {
      result.skipped.push({ name: item.name, reason: "同名模板已存在（绝不覆盖）" });
      continue;
    }
    try {
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target, { errorOnExist: true, force: false });
      result.imported.push({ name: item.name, path: target });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}
