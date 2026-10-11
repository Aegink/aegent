/**
 * 配置行级写回（W13b/T9-4——kimi tomlWriteback/sectionDiff 最优评估 §19
 * 同构，JSON/文本通用）：只改动目标行、保留原文件其余部分（格式与注释
 * 原字节不动），原子 + 锁 + 写后校验。
 *
 * 三件：
 *   - `applyLineEdits`——LineEdit 执行器（replace/insert/remove，1 基行号，
 *     从后往前应用防行号漂移）；
 *   - `diffRecords` + `planEditsForRecords`——段级差异（kimi diffRecords
 *     added/removed/changed 同形状）→ 定位原文件中各段的行区间并产出
 *     最小行编辑（其余行零接触）；
 *   - `createSettingsLineEditWriteback`——写回服务（写后 JSON.parse 校验
 *     可挂 schema 回调 + tmp→rename 原子 + 进程内 promise 链锁）。
 *
 * 消费位：设置面后续"段级定向保存"的指定写路径（整文件 saveSettings 行为
 * 冻结不动——本模块是 kimi 形状的行级通道，验收 = 本文件测试面）。
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** 行级编辑（1 基行号；replace/remove 的区间含两端）。 */
export type SettingsLineEdit =
  | { kind: "replace"; startLine: number; endLine: number; text: string }
  | { kind: "insert"; afterLine: number; text: string }
  | { kind: "remove"; startLine: number; endLine: number };

export interface ApplyEditsResult {
  readonly content: string;
  readonly applied: number;
  readonly warnings: readonly string[];
}

/** 行切分（保留语义：末尾无换行 = 最后一行不完整仍是一行）。 */
function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * LineEdit 执行器：按 startLine 降序应用（后面的编辑先做——前面的行号
 * 不漂移）。越界区间截断到文件边界（warning 记录，不抛——行级编辑的
 * 容错面，调用方以 warnings 呈现）。
 */
export function applyLineEdits(
  content: string,
  edits: readonly SettingsLineEdit[],
): ApplyEditsResult {
  const warnings: string[] = [];
  let lines = splitLines(content);
  const total = () => lines.length;
  const ordered = [...edits].sort(
    (a, b) => (b.kind === "insert" ? b.afterLine : b.startLine) - (a.kind === "insert" ? a.afterLine : a.startLine),
  );
  let applied = 0;
  for (const edit of ordered) {
    if (edit.kind === "insert") {
      const at = Math.max(0, Math.min(edit.afterLine, total()));
      lines.splice(at, 0, ...edit.text.split("\n"));
      applied += 1;
      continue;
    }
    const start = Math.max(1, Math.min(edit.startLine, total() + 1)) - 1;
    const end = Math.max(start, Math.min(edit.endLine, total())) - 1;
    if (edit.endLine > total() || edit.startLine > total() + 1 || edit.endLine < 1) {
      warnings.push(`编辑区间越界被截断：${edit.startLine}-${edit.endLine}（文件 ${total()} 行）`);
    }
    if (edit.kind === "remove") {
      lines.splice(start, end - start + 1);
      applied += 1;
    } else {
      lines.splice(start, end - start + 1, ...edit.text.split("\n"));
      applied += 1;
    }
  }
  return { content: lines.join("\n"), applied, warnings };
}

/** 段级差异（kimi diffRecords 同形状——顶层键维度）。 */
export interface RecordDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

/**
 * 顶层 JSON 对象段级差异（两侧都必须可解析为对象——否则类型化拒绝，
 * 不做半猜diff）。嵌套值整体比较（JSON.stringify 等价即 unchanged）。
 * W16 排查 G（P1 修复）：before 含重复顶层键时拒绝——JSON.parse 语义取
 * 后值，行级编辑按首处行号替换 → 写盘后语义值不变（静默错写且通过校验）。
 */
export function diffRecords(before: string, after: string): RecordDiff {
  let parsedBefore: Record<string, unknown>;
  let parsedAfter: Record<string, unknown>;
  try {
    assertNoDuplicateTopKeys(before);
    parsedBefore = JSON.parse(before) as Record<string, unknown>;
    parsedAfter = JSON.parse(after) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof SettingsLineEditError) throw e;
    throw new TypeError(
      `diffRecords 要求两侧都是合法 JSON 对象：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const key of Object.keys(parsedAfter)) {
    if (!(key in parsedBefore)) added.push(key);
    else if (JSON.stringify(parsedBefore[key]) !== JSON.stringify(parsedAfter[key])) changed.push(key);
  }
  for (const key of Object.keys(parsedBefore)) {
    if (!(key in parsedAfter)) removed.push(key);
  }
  return { added, removed, changed };
}

/** 类型化拒绝面（stale 基线 / 重复键 / 结构坏——调用方按 message 呈现）。 */
export class SettingsLineEditError extends TypeError {}

/** 重复顶层键检测（W16 排查 G——JSON.parse 取后值 vs 行编辑改首处的静默
 * 错写防线；2 空格顶层键形状扫描）。 */
function assertNoDuplicateTopKeys(text: string): void {
  const seen = new Set<string>();
  const re = /^[ \t]{2}"([^"]+)"\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1]!;
    if (seen.has(key)) {
      throw new SettingsLineEditError(
        `配置含重复顶层键 "${key}"——行级写回拒绝（语义歧义：解析取后值、行编辑改首处，请整文件保存）`,
      );
    }
    seen.add(key);
  }
}

/** 行内括号深度净变化（字符串字面量内的括号不计数——与区间扫描同一
 * inString 语义）。 */
function lineDepthDelta(line: string): number {
  let depth = 0;
  let inString = false;
  for (let c = 0; c < line.length; c++) {
    const ch = line[c]!;
    if (ch === '"' && line[c - 1] !== "\\") inString = !inString;
    if (inString) continue;
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return depth;
}

/**
 * 定位顶层键的行区间（1 基、含两端——2 空格顶层形状 + brace 深度扫描；
 * 字符串字面量内的括号不计数）。未找到 = null。
 *
 * W16 排查 G（P1 修复）：区间尾由 start 行的值型决定——对象/数组值（start
 * 行深度净变化 > 0）向后找深度归零行收口；标量值单行即收口。旧实现统一
 * 用"深度归零 + 行尾 [,\]}]"判定，标量末键（无尾逗号）不满足 → 扫描吞进
 * 根收括号行（替换丢根 }、删除坏 JSON、added 锚点插到根括号外）。
 */
function locateKeyRange(content: string, key: string): { start: number; end: number } | null {
  const lines = splitLines(content);
  const pattern = new RegExp(`^\\s{2}"${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\s*:`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const delta = lineDepthDelta(lines[start - 1]!);
  if (delta <= 0) return { start, end: start }; // 标量值 / 单行空对象 {}
  let depth = delta;
  for (let i = start; i < lines.length; i++) {
    depth += lineDepthDelta(lines[i]!);
    if (depth <= 0) return { start, end: i + 1 };
  }
  return { start, end: lines.length };
}

/** 段序列化（2 空格缩进——settings.json 同款；单键包装为对象再剥壳）。 */
function serializeRecord(key: string, value: unknown): string {
  const wrapped = JSON.stringify({ [key]: value }, null, 2);
  // 剥掉首行 `{"key":` 与尾行 `}`，剩余行缩进已是 2 空格基准
  const lines = wrapped.split("\n");
  return lines.slice(1, -1).join("\n");
}

/**
 * 段级差异 → 行编辑计划：对 changed/added/removed 各键定位原文件行区间，
 * 产出最小编辑（未涉及行零接触——格式与注释保留的机制保证）。键定位
 * 失败（原文件与 before 不符）= 类型化拒绝（stale 基线防错写）。
 */
export function planEditsForRecords(
  original: string,
  before: string,
  after: string,
): readonly SettingsLineEdit[] {
  const diff = diffRecords(before, after);
  const edits: SettingsLineEdit[] = [];
  const originalLines = splitLines(original);
  for (const key of diff.changed) {
    const range = locateKeyRange(original, key);
    if (range === null) {
      throw new SettingsLineEditError(`段定位失败（stale 基线）：键 "${key}" 不在原文件中`);
    }
    const value = (JSON.parse(after) as Record<string, unknown>)[key];
    // 尾逗号后缀保留（中段键行以逗号收尾——序列化段不带逗号，补齐）
    const lastLine = originalLines[range.end - 1] ?? "";
    const suffix = /,\s*$/.test(lastLine) ? "," : "";
    edits.push({
      kind: "replace",
      startLine: range.start,
      endLine: range.end,
      text: `${serializeRecord(key, value)}${suffix}`,
    });
  }
  for (const key of diff.removed) {
    const range = locateKeyRange(original, key);
    if (range === null) {
      throw new SettingsLineEditError(`段定位失败（stale 基线）：键 "${key}" 不在原文件中`);
    }
    edits.push({ kind: "remove", startLine: range.start, endLine: range.end });
    // 删的是最后一个顶层键时，前一键的收尾逗号成了悬挂逗号——剥掉
    // （W16 排查 G（P1 修复）：判定改为"区间之后只剩根收括号/空"——旧
    // 条件 range.end >= lines.length 恒假（根 } 恒为最后一行），删除最后
    // 一个顶层键必然产出悬挂逗号坏 JSON 被校验拦死、功能整体失效）
    const rest = originalLines.slice(range.end).join("\n").trim();
    if ((rest === "}" || rest === "") && range.start >= 2) {
      const prevLine = originalLines[range.start - 2] ?? "";
      if (/,\s*$/.test(prevLine)) {
        edits.push({
          kind: "replace",
          startLine: range.start - 1,
          endLine: range.start - 1,
          text: prevLine.replace(/,\s*$/, ""),
        });
      }
    }
  }
  // added：给最后一个顶层键的收尾行补逗号，再插入新段（JSON 逗号语义
  // ——锚行原字节保留，只追加逗号符）
  if (diff.added.length > 0) {
    const beforeKeys = Object.keys(JSON.parse(before) as Record<string, unknown>);
    const lines = splitLines(original);
    if (beforeKeys.length === 0) {
      // 空基线（空文件/{}）：整体替换为 after 的标准序列化
      edits.push({
        kind: "replace",
        startLine: 1,
        endLine: Math.max(1, lines.length),
        text: JSON.stringify(JSON.parse(after), null, 2),
      });
    } else {
      let anchorEnd = 1;
      let anchorLine = "";
      for (const key of beforeKeys) {
        const range = locateKeyRange(original, key);
        if (range !== null && range.end >= anchorEnd) {
          anchorEnd = range.end;
          anchorLine = lines[range.end - 1] ?? "";
        }
      }
      if (!/,\s*$/.test(anchorLine)) {
        edits.push({
          kind: "replace",
          startLine: anchorEnd,
          endLine: anchorEnd,
          text: `${anchorLine},`,
        });
      }
      const addedText = diff.added
        .map((key) => serializeRecord(key, (JSON.parse(after) as Record<string, unknown>)[key]))
        .join(",\n");
      edits.push({ kind: "insert", afterLine: anchorEnd, text: addedText });
    }
  }
  return edits;
}

export interface SettingsLineEditWriteback {
  /** 应用行编辑并原子落盘（写后 JSON 校验——不合法即拒且零落盘）。 */
  applyEdits(edits: readonly SettingsLineEdit[]): Promise<{ applied: number; warnings: readonly string[] }>;
  /** 段级便捷面：diff + 定位 + 应用一气呵成（before = 磁盘现状）。 */
  applyRecordDiff(after: string): Promise<{ applied: number; warnings: readonly string[] }>;
}

let editChain: Promise<unknown> = Promise.resolve();

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * JSONC 结构完整性检查（W16 排查 G（P0 修复）——非 JSON 基线（含注释的
 * JSONC）的默认校验从"空操作"升级为最小结构防线）：括号配平（深度不为
 * 负、结尾归零）+ 非字符串/注释上下文的尾逗号拒绝。语义面（schema 往返）
 * 无 JSONC 解析器不可行——记档；本检查拦截的是行编辑最常见坏形状（丢根
 * 收括号、悬挂逗号、删键残缺），配平即坏的编辑零落盘。
 */
function assertStructurallySoundJsonc(content: string): void {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    const prev = i > 0 ? content[i - 1] : undefined;
    if (inString) {
      if (ch === '"' && prev !== "\\") inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "/" && content[i + 1] === "/") {
      while (i < content.length && content[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      // 尾逗号检查：回溯跳过空白与行注释看前一有效字符
      let j = i - 1;
      while (j >= 0) {
        const c = content[j]!;
        if (/\s/.test(c)) {
          j -= 1;
          continue;
        }
        if (c === "/" && content[j - 1] === "/") {
          j -= 2;
          while (j >= 0 && content[j] !== "\n") j -= 1;
          continue;
        }
        break;
      }
      if (content[j] === ",") {
        throw new SettingsLineEditError(
          "写后结构校验失败：收括号前悬挂逗号（JSONC 行级编辑坏形状——零落盘）",
        );
      }
      depth -= 1;
      if (depth < 0) {
        throw new SettingsLineEditError("写后结构校验失败：括号深度为负（多余的收括号——零落盘）");
      }
    }
  }
  if (inString || depth !== 0) {
    throw new SettingsLineEditError("写后结构校验失败：括号不配平或字符串未闭合（零落盘）");
  }
}

function readSettingsFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

export function createSettingsLineEditWriteback(options: {
  settingsPath: string;
  /** 写后校验回调（缺省 = 基线语义：原文件是合法 JSON 则写后必须仍可
   * JSON.parse——非 JSON 基线（含注释的 JSONC）跑结构完整性检查（配平 +
   * 尾逗号拒绝）。schema 校验挂点。 */
  validate?: (content: string) => void;
}): SettingsLineEditWriteback {
  const path = options.settingsPath;
  let validate = options.validate;
  if (validate === undefined) {
    validate = (content: string) => {
      // 基线判定每次现读（W16 排查 G（P2 顺手修）——旧实现首调永久缓存，
      // 文件从缺失/非法变合法后永不再校验）
      const original = readSettingsFile(path);
      const beforeValid = isValidJson(original) || original.trim() === "";
      if (beforeValid) JSON.parse(content);
      else assertStructurallySoundJsonc(content);
    };
  }
  /** 锁内执行体（TOCTOU 消除——读盘/校验/落盘同段；applyRecordDiff 的
   * 读+plan 也在同一锁段，外部编辑不再插进读-改-写窗口）。 */
  const runLocked = async (
    edits: readonly SettingsLineEdit[],
  ): Promise<{ applied: number; warnings: readonly string[] }> => {
    const original = readSettingsFile(path);
    const result = applyLineEdits(original, edits);
    // 写后校验（不合法 = 类型化拒绝零落盘——半态防线）
    validate(result.content);
    mkdirSync(dirname(path), { recursive: true });
    // W16 排查 G（P1 修复）：tmp 名加进程号 + 随机段——固定 `${path}.tmp`
    // 在 host/cli 双进程并发行级写时互相覆盖（rename 竞速丢更新/ENOENT）
    const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    try {
      writeFileSync(tmp, result.content, "utf-8");
      renameSync(tmp, path);
    } catch (e) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        // 清理失败不掩盖主错误
      }
      throw new Error(
        `配置行级写回失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return { applied: result.applied, warnings: result.warnings };
  };
  return {
    async applyEdits(edits) {
      const run = editChain.then(() => runLocked(edits));
      editChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async applyRecordDiff(after) {
      const run = editChain.then(async () => {
        const before = readSettingsFile(path);
        const edits = planEditsForRecords(before, before, after);
        return runLocked(edits);
      });
      editChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
