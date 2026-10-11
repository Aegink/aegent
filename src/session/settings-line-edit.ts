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

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
 */
export function diffRecords(before: string, after: string): RecordDiff {
  let parsedBefore: Record<string, unknown>;
  let parsedAfter: Record<string, unknown>;
  try {
    parsedBefore = JSON.parse(before) as Record<string, unknown>;
    parsedAfter = JSON.parse(after) as Record<string, unknown>;
  } catch (e) {
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

/** 定位顶层键的行区间（1 基、含两端——brace 深度扫描；字符串字面量内
 * 的括号不计数）。未找到 = null。 */
function locateKeyRange(content: string, key: string): { start: number; end: number } | null {
  const lines = splitLines(content);
  const pattern = new RegExp(`^\\s{2}"${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\s*:`);
  let start = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (start === -1 && pattern.test(line)) {
      start = i + 1;
      depth = 0;
    }
    if (start !== -1) {
      let inString = false;
      for (let c = 0; c < line.length; c++) {
        const ch = line[c]!;
        if (ch === '"' && line[c - 1] !== "\\\\") inString = !inString;
        if (inString) continue;
        if (ch === "{" || ch === "[") depth += 1;
        else if (ch === "}" || ch === "]") depth -= 1;
      }
      // 顶层键行结束：深度归零且本行以逗号或收括号结尾
      if (depth <= 0 && /[,\]}]\s*$/.test(line)) {
        return { start, end: i + 1 };
      }
    }
  }
  return start === -1 ? null : { start, end: lines.length };
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
      throw new TypeError(`段定位失败（stale 基线）：键 "${key}" 不在原文件中`);
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
      throw new TypeError(`段定位失败（stale 基线）：键 "${key}" 不在原文件中`);
    }
    edits.push({ kind: "remove", startLine: range.start, endLine: range.end });
    // 删的是最后一个顶层键时，前一键的收尾逗号成了悬挂逗号——剥掉
    //（前一键的区间末行即本键首行的上一行）
    if (range.end >= originalLines.length && range.start >= 2) {
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

export function createSettingsLineEditWriteback(options: {
  settingsPath: string;
  /** 写后校验回调（缺省 = 基线语义：原文件是合法 JSON 则写后必须仍合法
   * ——非 JSON 文件（含注释的 JSONC 等）只要求保真不坏。schema 校验挂点。 */
  validate?: (content: string) => void;
}): SettingsLineEditWriteback {
  const path = options.settingsPath;
  let validate = options.validate;
  if (validate === undefined) {
    let beforeValid: boolean | undefined;
    validate = (content: string) => {
      if (beforeValid === undefined) {
        let original = "";
        try {
          original = readFileSync(path, "utf-8");
        } catch {
          /* 缺文件 = 空基线 */
        }
        beforeValid = isValidJson(original) || original.trim() === "";
      }
      if (beforeValid) JSON.parse(content);
    };
  }
  return {
    async applyEdits(edits) {
      const run = editChain.then(async () => {
        let original: string;
        try {
          original = readFileSync(path, "utf-8");
        } catch {
          original = "";
        }
        const result = applyLineEdits(original, edits);
        // 写后校验（不合法 = 类型化拒绝零落盘——半态防线）
        validate(result.content);
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        try {
          writeFileSync(tmp, result.content, "utf-8");
          renameSync(tmp, path);
        } catch (e) {
          throw new Error(
            `配置行级写回失败：${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return { applied: result.applied, warnings: result.warnings };
      });
      editChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async applyRecordDiff(after) {
      let before: string;
      try {
        before = readFileSync(path, "utf-8");
      } catch {
        before = "";
      }
      const edits = planEditsForRecords(before, before, after);
      return this.applyEdits(edits);
    },
  };
}
