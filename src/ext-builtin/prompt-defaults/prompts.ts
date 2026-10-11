/**
 * 提示词模板文件域（T-P3-146 C——zcode/opencode/claude 全文件化的我方位，
 * kernel/skills.ts 同构先例）：`<workspaceRoot>/.zcode/prompts/`（项目级）+
 * settings prompts.roots 附加根 + `~/.aegent/prompts/`（用户级）下的 `.md`
 * 文件，frontmatter 承载 description / argument-hint / agent / model，正文
 * 即模板。子目录 = 命名空间（`dir/cmd.md` → `/dir/cmd`，claude/zcode 同构）。
 *
 * 纪律：
 *   - 首到先得（跨根同名后者弃用并落诊断——loadSkillsFromRoots 同语义）；
 *   - 坏文件产诊断码跳过、绝不抛异常（skills 同款——一个坏文件不炸整个域）；
 *   - 未知 frontmatter 键在保存时保留（zcode preserveFrontmatterLines——
 *     编辑不丢用户手写字段）；
 *   - 内置模板（G）在展开查找面垫底：用户同名文件覆盖内置（opencode 语义）。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parseSkillFrontmatter } from "./skills.js";

/** 模板目录约定（相对工作区根；用户级 = ~/.aegent/prompts）。 */
export const PROMPTS_DIR = ".zcode/prompts";
/** 用户级模板目录（home 下——无工作区也有模板面）。 */
export const USER_PROMPTS_DIR = ".aegent/prompts";
/** 模板正文字节上限（保存面——与技能 128KB 同值）。 */
export const PROMPT_BODY_MAX_BYTES = 128 * 1024;

export type PromptDiagnosticCode =
  | "read_failed"
  | "parse_failed"
  | "invalid_name"
  | "duplicate_name"
  | "too_large";

export interface PromptDiagnostic {
  readonly code: PromptDiagnosticCode;
  readonly message: string;
  readonly path: string;
}

/** 一个已发现模板（文件形态——MCP prompts 是另一来源，形状对齐）。 */
export interface PromptTemplateSummary {
  /** 斜杠调用名（相对路径去 .md，子目录以 `/` 连接）。 */
  readonly name: string;
  readonly description?: string;
  /** 参数提示（frontmatter `argument-hint`，如 "<file> [focus]"）。 */
  readonly argumentHint?: string;
  /** 模板级执行语义（H：以指定子代理执行 / 命令级模型覆盖）。 */
  readonly agent?: string;
  readonly model?: string;
  /** 模板正文（frontmatter 之后）。 */
  readonly content: string;
  readonly filePath: string;
  /** 来源根目录（清单来源标记面）。 */
  readonly origin: string;
  /** 模板内出现的参数占位符（$ARGUMENTS/$1/…——UI hint 面派生）。 */
  readonly placeholders?: readonly string[];
}

/** frontmatter 消费的键闭集（其余键保存时原样保留）。 */
const CONSUMED_FRONTMATTER_KEYS = new Set(["description", "argument-hint", "agent", "model"]);

/** 名称段规则（每段 slug 形状——skills 同款；Windows 保留名拒绝）。 */
const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${String(i + 1)}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${String(i + 1)}`),
]);

/** 名称校验（保存与扫描共用）：段 slug、无 `..`、Windows 保留名、总长 128B。 */
export function validatePromptName(name: string): string | undefined {
  if (name === "" || name.length > 128 || Buffer.byteLength(name, "utf8") > 128) {
    return "名称须为 1~128 字节";
  }
  for (const segment of name.split("/")) {
    if (!SEGMENT_RE.test(segment) || segment.includes("..") || WINDOWS_RESERVED.has(segment)) {
      return `段「${segment}」须为 slug 形状（小写字母数字开头，. - _ 可内用；非 Windows 保留名）`;
    }
  }
  return undefined;
}

/** 递归收集模板 .md（深度上限防环；隐藏目录跳过）。 */
function collectPromptFiles(dir: string, depth: number, out: string[]): void {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPromptFiles(child, depth + 1, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(child);
    }
  }
}

/** 单根扫描（root 即模板目录本身——loadSkillsFromDir 的 dir 语义不同：技能根
 * 需拼 SKILLS_DIR，模板根已含目录段）。 */
function loadPromptsFromDir(dir: string): {
  templates: PromptTemplateSummary[];
  diagnostics: PromptDiagnostic[];
  root: string;
} {
  const templates: PromptTemplateSummary[] = [];
  const diagnostics: PromptDiagnostic[] = [];
  if (!existsSync(dir)) return { templates, diagnostics, root: dir };
  const files: string[] = [];
  collectPromptFiles(dir, 0, files);
  for (const filePath of files) {
    const relative = path.relative(dir, filePath).replace(/\\/g, "/").replace(/\.md$/, "");
    if (validatePromptName(relative) !== undefined) {
      diagnostics.push({ code: "invalid_name", message: `文件名不合模板名规则：${relative}`, path: filePath });
      continue;
    }
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
    if (raw.length > PROMPT_BODY_MAX_BYTES * 4) {
      // 扫描面软上限（4 倍裕量）：超大文件不是模板是数据（保存面硬上限 128KB）
      diagnostics.push({ code: "too_large", message: `文件过大（> ${String(PROMPT_BODY_MAX_BYTES * 4)} 字符）`, path: filePath });
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
    const description = parsed.fields.get("description");
    const argumentHint = parsed.fields.get("argument-hint");
    const agent = parsed.fields.get("agent");
    const model = parsed.fields.get("model");
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
    templates.push({
      name: relative,
      ...(description !== undefined && description.trim() !== "" ? { description: description.trim() } : {}),
      ...(argumentHint !== undefined && argumentHint.trim() !== "" ? { argumentHint: argumentHint.trim() } : {}),
      ...(agent !== undefined && agent.trim() !== "" ? { agent: agent.trim() } : {}),
      ...(model !== undefined && model.trim() !== "" ? { model: model.trim() } : {}),
      content: body,
      filePath,
      origin: dir,
    });
  }
  return { templates, diagnostics, root: dir };
}

/** 多根合并扫描（首到先得——项目级 > settings.roots > 用户级的遮蔽序）。 */
export function loadPromptTemplatesFromRoots(roots: readonly string[]): {
  templates: PromptTemplateSummary[];
  diagnostics: PromptDiagnostic[];
  roots: string[];
} {
  const templates: PromptTemplateSummary[] = [];
  const diagnostics: PromptDiagnostic[] = [];
  const scanned: string[] = [];
  for (const root of roots) {
    const abs = path.resolve(root);
    scanned.push(abs);
    const r = loadPromptsFromDir(abs);
    for (const t of r.templates) {
      if (templates.some((x) => x.name === t.name)) {
        diagnostics.push({
          code: "duplicate_name",
          message: `模板名跨来源重复：${t.name}（来源 ${t.filePath} 弃用）`,
          path: t.filePath,
        });
        continue;
      }
      templates.push(t);
    }
    diagnostics.push(...r.diagnostics);
  }
  return { templates, diagnostics, roots: scanned };
}

/**
 * frontmatter 组装（保存面）：消费键写入，未知键保留（zcode 纪律）。
 * preserve 传入既有文件的 frontmatter 原始行——其中非消费键原样带回。
 */
export function buildPromptMarkdown(payload: {
  description?: string;
  argumentHint?: string;
  agent?: string;
  model?: string;
  content: string;
  /** 既有文件的 frontmatter 行（无 frontmatter = 空数组）——未知键保留源。 */
  preserveLines?: readonly string[];
}): string {
  const preserved = (payload.preserveLines ?? []).filter((line) => {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:/.exec(line);
    return m === null || !CONSUMED_FRONTMATTER_KEYS.has(m[1]!.toLowerCase());
  });
  const oneLine = (v: string): string => v.replace(/\r?\n/g, " ").trim();
  const consumed = [
    ...(payload.description !== undefined ? [`description: ${oneLine(payload.description)}`] : []),
    ...(payload.argumentHint !== undefined ? [`argument-hint: ${oneLine(payload.argumentHint)}`] : []),
    ...(payload.agent !== undefined ? [`agent: ${oneLine(payload.agent)}`] : []),
    ...(payload.model !== undefined ? [`model: ${oneLine(payload.model)}`] : []),
  ];
  const lines = [...preserved, ...consumed];
  const frontmatter = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n\n` : "";
  return `${frontmatter}${payload.content.trim()}\n`;
}

/** 读既有文件的 frontmatter 行（未知键保留源；无 frontmatter = 空数组）。 */
export function readFrontmatterLines(filePath: string): string[] {
  try {
    const raw = readFileSync(filePath, "utf8");
    const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    return block !== null ? block[1]!.split(/\r?\n/) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// G：内置模板命令（opencode init/review 同构——代码内嵌正文，用户同名覆盖）
// ---------------------------------------------------------------------------

/** 内置模板正文（/init——生成/改进 AGENTS.md 项目说明）。 */
const INIT_TEMPLATE = [
  "请为本工作区生成或改进 `AGENTS.md`（仓库根；已存在则在其基础上改进，不推翻既有正确内容）。",
  "",
  "步骤：",
  "1. 通读仓库结构与关键入口（README、package.json/清单文件、主要源码目录），必要时用工具抽样确认；",
  "2. 归纳：项目定位一句话、目录地图（各目录职责一行）、构建/测试/运行命令、代码风格与约定、已知注意事项；",
  "3. 写入/更新 `AGENTS.md`：面向\"接手的 AI 助手\"，按上述五节组织，正文精炼（≤80 行），不确定的内容标注【未验证】而不是编造。",
].join("\n");

/** 内置模板清单（展开查找面垫底——用户同名文件覆盖）。 */
export const BUILTIN_PROMPT_TEMPLATES: readonly PromptTemplateSummary[] = [
  {
    name: "init",
    description: "生成/改进项目 AGENTS.md（内置——同名文件可覆盖）",
    argumentHint: "（可选）补充要求",
    content: INIT_TEMPLATE,
    filePath: "builtin://init",
    origin: "builtin",
  },
];

/** 展开查找面：文件模板（含禁用剔除）优先，内置垫底。 */
export function lookupPromptTemplate(
  name: string,
  fileTemplates: readonly PromptTemplateSummary[],
  disabled: readonly string[],
): PromptTemplateSummary | undefined {
  const lower = name.toLowerCase();
  const off = new Set(disabled.map((d) => d.toLowerCase()));
  const file = fileTemplates.find((t) => t.name.toLowerCase() === lower);
  if (file !== undefined) return off.has(lower) ? undefined : file;
  return BUILTIN_PROMPT_TEMPLATES.find((t) => t.name.toLowerCase() === lower);
}

// ---------------------------------------------------------------------------
// H：发送时动态展开两件（shell 前置执行 / @file 注入）——只在展开管线调用
// ---------------------------------------------------------------------------

/**
 * `!`cmd`` 前置执行注入（claude/zcode 同语法；zcode 安全边界同档）：所有
 * 匹配并行 spawn、输出按序回填；15s 超时、64KB 输出上限、非零退出抛类型化
 * 错误（错误含 stderr 前 2000 字符预览——fail-closed，展开失败整条拒发）。
 * **消费前提**：settings prompts.allowShellExpansion === true（开关缺省关
 * ——模板触发的任意命令执行是高危面，显式开启才生效）。
 */
export async function expandShellInjections(
  content: string,
  opts?: { cwd?: string; timeoutMs?: number; maxBytes?: number },
): Promise<string> {
  const matches = [...content.matchAll(/!`([^`]+)`/g)];
  if (matches.length === 0) return content;
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const maxBytes = opts?.maxBytes ?? 64 * 1024;
  const { spawn } = await import("node:child_process");
  const runOne = (cmd: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
      const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", cmd] : ["-c", cmd];
      const child = spawn(shell, shellArgs, {
        ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
        windowsHide: true,
      });
      let out = "";
      let err = "";
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        if (out.length < maxBytes) out += chunk.toString("utf8");
        if (out.length >= maxBytes) child.kill();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (err.length < 2000) err += chunk.toString("utf8");
      });
      child.on("error", (e) => finish(() => reject(e)));
      const timer = setTimeout(() => {
        child.kill();
        finish(() => {
          const error = new Error(`模板命令超时（${String(timeoutMs)}ms）：${cmd.slice(0, 120)}`);
          (error as unknown as { code: string }).code = "PROMPT_SHELL_FAILED";
          reject(error);
        });
      }, timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(() => {
          if (code !== 0) {
            const error = new Error(
              `模板命令退出码 ${String(code)}：${cmd.slice(0, 120)}${err.trim() !== "" ? `\nstderr：${err.trim().slice(0, 2000)}` : ""}`,
            );
            (error as unknown as { code: string }).code = "PROMPT_SHELL_FAILED";
            reject(error);
            return;
          }
          resolve(out.trimEnd());
        });
      });
    });
  const outputs = await Promise.all(matches.map((m) => runOne(m[1]!)));
  let result = content;
  for (const [i, m] of matches.entries()) {
    result = result.replace(m[0]!, outputs[i]!);
  }
  return result;
}

/**
 * `@path` 文件注入（opencode resolvePromptParts 同题的文本内联版）：命中
 * 文件读入（≤256KB/个、≤8 个、按解析路径去重），以 `<file>` 块追加到展开
 * 文本尾部；`~/` 展开、相对工作区根解析；未命中/读失败保留原文（不是错误
 * ——@token 可能只是普通文本或目录，模型可见原文自行判断）。
 */
export async function expandFileReferences(
  content: string,
  opts?: { workspaceRoot?: string; homeDir?: string },
): Promise<string> {
  const matches = [...content.matchAll(/(?<![\w`])@([^\s`,]+)/g)];
  if (matches.length === 0) return content;
  const { readFile, stat } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const home = opts?.homeDir ?? homedir();
  const base = opts?.workspaceRoot ?? process.cwd();
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (blocks.length >= 8) break;
    let token = m[1]!;
    if (token.length >= 2 && (token.startsWith('"') || token.endsWith('"'))) token = token.replaceAll('"', "");
    const resolved = path.isAbsolute(token)
      ? token
      : token.startsWith("~")
        ? path.join(home, token.slice(1))
        : path.resolve(base, token);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      const s = await stat(resolved);
      if (!s.isFile() || s.size > 256 * 1024) continue;
      const text = await readFile(resolved, "utf8");
      blocks.push(`<file path="${token}">\n${text}\n</file>`);
    } catch {
      // 未命中保留原文（语义见上）
    }
  }
  return blocks.length > 0 ? `${content}\n\n${blocks.join("\n\n")}` : content;
}
