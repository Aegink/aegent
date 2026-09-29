/**
 * skills 目录加载（I2 / T-P1-08）——发现 / 诊断 / 调用格式化三件
 * （pi·skills.ts 的 loadSkills/SkillDiagnostic/formatSkillInvocation 同构，
 * 面收敛为我方目录约定）。
 *
 * 目录约定（自研命名，无上游约束）：`<workspaceRoot>/.zcode/skills/` 下
 * 递归发现 `SKILL.md`——技能名 = 所在目录名（frontmatter `name:` 可覆盖，
 * 一致性不校验——KISS）。技能目录内的附属资源（references/ 等）不作为技能
 * 深入扫描：有 SKILL.md 的目录即叶子。
 *
 * frontmatter 解析复用 T-7-09 的行解析经验（纯文本行，无 yaml 依赖）：
 * `---` 块内 `key: value` 单行标量，取 name/description，未知 key 忽略。
 *
 * 诊断纪律（验收②）：坏技能产诊断码跳过、绝不抛异常——一个坏文件不炸
 * 整个技能面（pi 同款 diagnostics 与 skills 并返）。无技能目录 = 空清单
 * 零诊断（可选能力，不存在的目录不是错误）。
 *
 * 消费面两处：①系统提示尾段（清单定格在 system/message 首次落流时点——
 * 改 SKILL.md 对**新会话**生效）；②skill_load 工具每次直读（正文即时生效，
 * 与 registry 描述"不缓存改完即生效"同纪律）。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** 技能目录约定（相对工作区根）。 */
export const SKILLS_DIR = ".zcode/skills";
/** 技能清单文件名（其所在目录即技能目录）。 */
export const SKILL_FILENAME = "SKILL.md";

export type SkillDiagnosticCode =
  | "read_failed"
  | "parse_failed"
  | "invalid_metadata"
  | "duplicate_name";

export interface SkillDiagnostic {
  readonly code: SkillDiagnosticCode;
  readonly message: string;
  /** 关联路径（SKILL.md 文件或技能根）。 */
  readonly path: string;
}

export interface SkillSummary {
  readonly name: string;
  /** 单行描述（系统提示清单面）。 */
  readonly description: string;
  /** SKILL.md 绝对路径（skill_load 的正文读取面）。 */
  readonly filePath: string;
  /** 技能声明的工作工具集（frontmatter `tools:` 逗号分隔；U22/T-P3-125
   * 编辑器写回面——缺省 undefined = 不限；消费面为提示词标注，见下）。 */
  readonly tools?: readonly string[];
  /** 来源根的技能目录（多根扫描标注——单根 loadSkills 无此字段；U22 清单
   * 卡片的来源标记面：主目录 = 工作区技能、附加根 = 外部来源技能）。 */
  readonly origin?: string;
}

export interface SkillLoadResult {
  readonly skills: SkillSummary[];
  readonly diagnostics: SkillDiagnostic[];
}

/** frontmatter 解析：`---` 块内逐行 `key: value`；块存在但行不合形状 → parse_failed。 */
export function parseSkillFrontmatter(raw: string): {
  fields: Map<string, string>;
  error?: "parse_failed";
} {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!block) return { fields: new Map() };
  const fields = new Map<string, string>();
  for (const line of block[1]!.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) return { fields, error: "parse_failed" };
    if (!fields.has(m[1]!)) fields.set(m[1]!, m[2]!.trim());
  }
  return { fields };
}

/** 剥 frontmatter 的正文（skill_load 输出面；无 frontmatter = 原文）。 */
export function skillBody(raw: string): string {
  const block = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw);
  return (block ? raw.slice(block[0].length) : raw).trim();
}

/** pi·formatSkillInvocation 同构：正文包进带名/位置标签的调用块。 */
export function formatSkillInvocation(skill: SkillSummary, body: string): string {
  return (
    `<skill name="${skill.name}" location="${skill.filePath}">\n` +
    `${body}\n</skill>`
  );
}

/** 递归收集技能目录下的 SKILL.md（有 SKILL.md 的目录即叶子，不再深入）。 */
function collectSkillFiles(dir: string, depth: number, out: string[]): void {
  // 深度上限防符号环/异常嵌套——正常技能面三层以内
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录不可读 = 该子树静默跳过（技能面可选，不做权限诊断）
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const child = path.join(dir, entry.name);
    const skillFile = path.join(child, SKILL_FILENAME);
    if (existsSync(skillFile)) {
      out.push(skillFile);
      continue;
    }
    collectSkillFiles(child, depth + 1, out);
  }
}

/** frontmatter `tools:` 行解析（U22 编辑器写回格式——逗号/空白分隔去空去重）。 */
function parseSkillTools(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const tools = [...new Set(raw.split(/[,\s]+/).filter((t) => t !== ""))];
  return tools.length > 0 ? tools : undefined;
}

/** 单根扫描（loadSkills 的内部分体——多根合并的复用面）。 */
function loadSkillsFromDir(dir: string): {
  skills: SkillSummary[];
  diagnostics: SkillDiagnostic[];
  root: string;
} {
  const skills: SkillSummary[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  if (!existsSync(dir)) return { skills, diagnostics, root: dir };
  const files: string[] = [];
  collectSkillFiles(dir, 0, files);
  for (const filePath of files) {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (e) {
      diagnostics.push({
        code: "read_failed",
        message: `读取失败：${e instanceof Error ? e.message : String(e)}`,
        path: filePath,
      });
      continue;
    }
    const parsed = parseSkillFrontmatter(raw);
    if (parsed.error) {
      diagnostics.push({
        code: "parse_failed",
        message: "frontmatter 存在但行不合 `key: value` 形状",
        path: filePath,
      });
      continue;
    }
    const name = parsed.fields.get("name") ?? path.basename(path.dirname(filePath));
    const description = parsed.fields.get("description");
    if (description === undefined || description.trim() === "") {
      diagnostics.push({
        code: "invalid_metadata",
        message: "frontmatter 缺少 description（技能清单需要它）",
        path: filePath,
      });
      continue;
    }
    if (skills.some((s) => s.name === name)) {
      diagnostics.push({
        code: "duplicate_name",
        message: `技能名重复：${name}（后者弃用）`,
        path: filePath,
      });
      continue;
    }
    const tools = parseSkillTools(parsed.fields.get("tools"));
    skills.push({
      name,
      description: description.trim(),
      filePath,
      ...(tools !== undefined ? { tools } : {}),
    });
  }
  return { skills, diagnostics, root: dir };
}

/** 加载选项（U22/T-P3-125）：disabled = 停用名单（清单装配消费——可停）。 */
export interface LoadSkillsOptions {
  /** 停用技能名集合（匹配 name——停用技能不进清单、不产诊断）。 */
  disabled?: readonly string[];
}

/**
 * 发现入口：扫描 `<skillsRoot>/.zcode/skills/`，产出清单 + 诊断。
 * 顺序 = 目录扫描序（稳定）；同名冲突后者弃用（先到先得）。
 * disabled（U22）：停用技能在清单装配前剔除——"启用开关"的装配消费面。
 */
export function loadSkills(skillsRoot: string, options?: LoadSkillsOptions): SkillLoadResult {
  const dir = path.join(path.resolve(skillsRoot), SKILLS_DIR);
  const result = loadSkillsFromDir(dir);
  if (options?.disabled === undefined || options.disabled.length === 0) return result;
  const off = new Set(options.disabled);
  return {
    skills: result.skills.filter((s) => !off.has(s.name)),
    diagnostics: result.diagnostics,
  };
}

/**
 * 多根合并扫描（U22/T-P3-125 来源目录管理——workspace 主目录 + settings
 * skills.roots 附加目录）：逐根扫描后拼接，跨根同名首到先得（后者弃用并落
 * 诊断——单根先到先得语义的跨根推广）。roots 顺序 = settings 数组序（用户
 * 可排序）。每个技能带 origin（来源根的技能目录绝对路径——UI 卡片的来源
 * 标记面：主目录 = 工作区技能、附加根 = 外部来源技能）。
 */
export function loadSkillsFromRoots(
  skillsRoot: string,
  extraRoots?: readonly string[],
  options?: LoadSkillsOptions,
): SkillLoadResult & { roots: string[] } {
  const skills: SkillSummary[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const scannedRoots: string[] = [];
  for (const root of [skillsRoot, ...(extraRoots ?? [])]) {
    const dir = path.join(path.resolve(root), SKILLS_DIR);
    scannedRoots.push(dir);
    const r = loadSkillsFromDir(dir);
    for (const s of r.skills) {
      if (skills.some((x) => x.name === s.name)) {
        diagnostics.push({
          code: "duplicate_name",
          message: `技能名跨来源重复：${s.name}（来源 ${s.filePath} 弃用）`,
          path: s.filePath,
        });
        continue;
      }
      skills.push({ ...s, origin: dir });
    }
    diagnostics.push(...r.diagnostics);
  }
  if (options?.disabled === undefined || options.disabled.length === 0) {
    return { skills, diagnostics, roots: scannedRoots };
  }
  const off = new Set(options.disabled);
  return { skills: skills.filter((s) => !off.has(s.name)), diagnostics, roots: scannedRoots };
}
