/**
 * 技能 ZIP 导入（T-P3-174 批次 4——skill-import-op 的 zip 源扩展）：
 * UI 选择 .zip 文件（base64 上送）→ extractZip 安全解包（zip-read.ts 的
 * 穿越/大小/条目数/CRC 四道检查）→ 识别 SKILL.md 形状 → 校验 frontmatter
 * → 复制进 workspace 技能主目录。
 *
 * 形状识别（与 skill-import-op 目录扫描同语义）：
 *  - zip 根直下 SKILL.md = 单技能（name 来自 frontmatter 或 UI 传入文件名
 *    回退）；zip 根直下单层技能目录集合 = 多候选（<dir>/SKILL.md）；
 *  - 单文件 .md（kimi 平面形态）转 <name>/SKILL.md 目录形状。
 * 护栏：name slug 白名单、同名绝不覆盖（zcode sameNameExists 语义）、缺
 * description 提示装配剔除（warning 不阻断——与 scan 候选同语义）。
 * 解包只复制不链接（skill-import-op 同决策——我方技能根即唯一消费根）。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseSkillFrontmatter, skillBody, SKILL_FILENAME } from "../kernel/skills.js";
import { extractZip, ZipFormatError, ZipUnsafeError, type ZipEntry } from "./zip-read.js";

export interface SkillZipImportResult {
  imported: { name: string; path: string; warning?: string }[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; error: string }[];
  /** 参与识别的技能候选数（导入报告展示面）。 */
  totalCandidates: number;
}

/** ZIP 上限（UI 提示与 extractZip limits 同源——技能包不是数据归档）。 */
export const SKILL_ZIP_MAX_BYTES = 20 * 1024 * 1024; // zip 压缩体 20MB
export const SKILL_ZIP_ENTRY_MAX = 5 * 1024 * 1024; // 单条解压 5MB（技能文件远小于此）
export const SKILL_ZIP_TOTAL_MAX = 30 * 1024 * 1024;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 从 zip 条目集合识别技能候选（根技能 或 单层目录集合）。 */
function identifySkillRoots(entries: ZipEntry[]): { root: string; files: ZipEntry[] }[] {
  const bySafeName = new Map(entries.map((e) => [e.safeName, e]));
  // 形状 A：根直下 SKILL.md（单技能——全部条目同属一个根）
  if (bySafeName.has(SKILL_FILENAME)) {
    return [{ root: "", files: entries }];
  }
  // 形状 B：单层 <dir>/SKILL.md 集合（或单个 dir）
  const roots = new Map<string, ZipEntry[]>();
  for (const e of entries) {
    const i = e.safeName.indexOf("/");
    if (i <= 0) continue; // 根级散文件（非形状 A 时忽略）
    const dir = e.safeName.slice(0, i);
    if (e.safeName.slice(i + 1).includes("/")) continue; // 超过单层深度的文件不挂候选（下方按根过滤）
    if (!roots.has(dir)) roots.set(dir, []);
    roots.get(dir)!.push(e);
  }
  const out: { root: string; files: ZipEntry[] }[] = [];
  for (const [dir, files] of roots) {
    if (files.some((f) => f.safeName === `${dir}/${SKILL_FILENAME}`)) {
      out.push({ root: dir, files: files.filter((f) => f.safeName.startsWith(`${dir}/`)) });
    }
  }
  return out;
}

type SkillRootOutcome =
  | { result: "imported"; name: string; path: string; warning?: string }
  | { result: "skipped"; name: string; reason: string }
  | { result: "failed"; name: string; error: string };

/** zip 内单技能根 → 导入判定与落盘（护栏三道：slug / 同名绝不覆盖 / frontmatter）。 */
function importSkillFromRoot(root: { root: string; files: ZipEntry[] }, targetRoot: string, fallbackName: string): SkillRootOutcome {
  const mdEntry = root.files.find((f) => f.safeName === (root.root === "" ? SKILL_FILENAME : `${root.root}/${SKILL_FILENAME}`));
  const mdFile = root.files.find((f) => !f.isDirectory && f.safeName.endsWith(".md") && !f.safeName.endsWith(`/${SKILL_FILENAME}`));
  const isFlatFile = mdEntry === undefined && mdFile !== undefined; // kimi 平面形态
  const md = mdEntry ?? mdFile;
  const fallback = root.root === "" ? fallbackName : root.root;
  if (md === undefined) {
    return { result: "failed", name: fallback, error: "缺 SKILL.md（不是技能目录形状）" };
  }
  const raw = md.data.toString("utf8");
  if (skillBody(raw).trim() === "") {
    return { result: "skipped", name: fallback, reason: "SKILL.md 正文为空" };
  }
  const parsed = parseSkillFrontmatter(raw);
  let name = parsed.fields.get("name") ?? fallback;
  // frontmatter name 非法 → 回退名同样非法时 fail，不静默改写用户技能名
  if (!SKILL_NAME_RE.test(name) || name.includes("..")) {
    name = fallback;
    if (!SKILL_NAME_RE.test(name) || name.includes("..")) {
      return { result: "failed", name: fallback, error: `名称非 slug 形状：${name}` };
    }
  }
  const target = path.join(targetRoot, name);
  if (existsSync(target)) {
    return { result: "skipped", name, reason: "同名技能已存在（绝不覆盖）" };
  }
  const missingDescription =
    parsed.fields.get("description") === undefined || parsed.fields.get("description")!.trim() === "";
  // 落盘：目录形状复制根内全部文件（保持相对结构）；平面 .md 转
  // <name>/SKILL.md + 无 frontmatter 时自动补齐（skillImportApply 单文件
  // 分支同语义）
  const content = isFlatFile && parsed.fields.size === 0 && !/^---/.test(raw.trim())
    ? `---\nname: ${name}\ndescription: ${name}（导入时自动补——请编辑描述）\n---\n\n${raw}`
    : raw;
  try {
    if (isFlatFile) {
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, SKILL_FILENAME), content, "utf8");
    } else {
      const prefix = root.root === "" ? "" : `${root.root}/`;
      for (const f of root.files) {
        if (!f.safeName.startsWith(prefix)) continue;
        const rel = f.safeName.slice(prefix.length);
        const dest = path.join(targetRoot, name, rel);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, f.data);
      }
    }
  } catch (e) {
    return { result: "failed", name, error: e instanceof Error ? e.message : String(e) };
  }
  return {
    result: "imported",
    name,
    path: isFlatFile ? path.join(target, SKILL_FILENAME) : target,
    ...(missingDescription ? { warning: "缺 description——导入后清单不可见（装配剔除），建议补" } : {}),
  };
}

/** ZIP 技能导入入口（op 消费面——content = zip 字节的 base64）。 */
export async function skillZipImportOp(
  deps: { workspaceRoot: string },
  content: string,
  fallbackName = "zip-skill",
): Promise<SkillZipImportResult> {
  const result: SkillZipImportResult = { imported: [], skipped: [], failed: [], totalCandidates: 0 };
  const targetRoot = path.join(path.resolve(deps.workspaceRoot), ".zcode", "skills");
  let entries: ZipEntry[];
  try {
    const buf = Buffer.from(content, "base64");
    if (buf.length === 0) throw new ZipFormatError("zip 内容为空");
    if (buf.length > SKILL_ZIP_MAX_BYTES) {
      throw new ZipUnsafeError(`zip 超大小上限（${buf.length} > ${SKILL_ZIP_MAX_BYTES} 字节）`);
    }
    entries = extractZip(buf, {
      maxEntryBytes: SKILL_ZIP_ENTRY_MAX,
      maxTotalBytes: SKILL_ZIP_TOTAL_MAX,
      maxEntries: 500,
    });
  } catch (e) {
    const message = e instanceof ZipUnsafeError || e instanceof ZipFormatError ? e.message : `zip 解析失败：${e instanceof Error ? e.message : String(e)}`;
    result.failed.push({ name: fallbackName, error: message });
    return result;
  }
  const roots = identifySkillRoots(entries);
  result.totalCandidates = roots.length;
  if (roots.length === 0) {
    result.failed.push({ name: fallbackName, error: "zip 内未识别到技能（须含 SKILL.md——根直下或单层目录内）" });
    return result;
  }
  for (const root of roots) {
    const r = importSkillFromRoot(root, targetRoot, root.root === "" ? fallbackName : root.root);
    if (r.result === "imported") {
      result.imported.push({ name: r.name, path: r.path, ...(r.warning !== undefined ? { warning: r.warning } : {}) });
    } else if (r.result === "skipped") {
      result.skipped.push({ name: r.name, reason: r.reason });
    } else {
      result.failed.push({ name: r.name, error: r.error });
    }
  }
  return result;
}
