/**
 * shell 输出双层预算格式化器（T-P3-174 批次 1，pi-desktop host-core
 * tools/mod.rs 的 capture/spill 同构）——bash/pwsh/后台任务共用的结果层：
 *
 *   - 第一层（capture，env.ts 的 BackgroundProcessImpl / exec 缓冲）：进程
 *     输出在内存里最多保留 512KB/流（CAPTURE_MAX_BYTES）；
 *   - 第二层（本模块，结果预算）：stdout **保头** 96KB/4000 行（命令输出
 *     就是调用的目的，pi-desktop BUDGET_SHELL 同款）；stderr **保尾**
 *     96KB/4000 行（失败时可行动的错误是最后打印的，pi-desktop
 *     BUDGET_SHELL_ERR 同款）；单行 16384 字符上限（minified one-liner
 *     不刷屏，普通日志行不误伤）。
 *
 * 超预算时**先 spill 全量副本再截断**（pi-desktop truncate_with_spill 同
 * 序——截断标记能指向一个真的可以 grep/read 的文件）：落盘
 * `<workspace>/.aegent/scratch/tool-output/<label>-stdout|stderr-<stamp>-
 * <seq>.log`，首行是 Q13 可解析归属标记（与 truncate.ts 的 spill 同纪律），
 * 结果尾部告知模型"完整输出已存至 X（N KB）"。spill 失败 best-effort：
 * 只丢提示，不打断结果。
 *
 * **与 B5 通用出口的关系**：本模块产出的结果自带双层预算与 spill，registry
 * 的 boundOutput 通用截断（50KB/tmp spill）对这类结果跳过（meta.outputBounded
 * 标记）——否则 96KB 的 shell 预算会被 50KB 二次截断、spill 落两处。
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsonRecord, JsonValue } from "../events.js";
import { truncateUtf8 } from "./truncate.js";

/** 结果预算：stdout 保头 / stderr 保尾（pi-desktop BUDGET_SHELL 同款 96KB/4000 行）。 */
export const SHELL_BUDGET_BYTES = 96 * 1024;
export const SHELL_BUDGET_LINES = 4000;

/** 单行字符上限（pi-desktop MAX_LINE_CHARS 同款 16384）。 */
export const MAX_LINE_CHARS = 16_384;

/** spill 序号（进程内单调——同毫秒多文件不重名）。 */
let spillSeq = 0;

export interface ShellOutputSection {
  /** 原始流文本（capture 层输出——512KB 封顶后的完整副本）。 */
  raw: string;
  /** capture 层截断事实（超 512KB 丢弃的字节数，0 = 无截断）。 */
  omittedBytes?: number;
}

export interface ShellOutputMeta extends JsonRecord {
  /** registry boundOutput 跳过标记（本结果已自带双层预算 + spill）。 */
  outputBounded: true;
  /** spill 文件路径（本轮写出；无截断时缺省——动态赋值绕开可选属性索引签名）。 */
  spillPaths: JsonValue[];
}

export interface ShellOutputFormatted {
  text: string;
  truncated: boolean;
  meta: ShellOutputMeta;
}

export interface FormatShellOutputInput {
  stdout: ShellOutputSection | string;
  stderr?: ShellOutputSection | string;
  exitCode: number;
  /** spill 目录（装配传 `<workspace>/.aegent/scratch`）；缺省不落盘只截断。 */
  scratchDir?: string;
  /** spill 文件名标签（bash/pwsh/task-N——Q13 标记与文件名都用）。 */
  label: string;
  /** Q13 归属标记的会话身份。 */
  sessionId: string;
  tool: string;
  callId: string;
}

function asSection(s: ShellOutputSection | string): ShellOutputSection {
  return typeof s === "string" ? { raw: s } : s;
}

/** 逐行 16384 字符上限（截断计数——诚实标注被切了多少行）。 */
function clipLongLines(text: string): { clipped: string; cutLines: number } {
  const lines = text.split("\n");
  let cutLines = 0;
  const out = lines.map((line) => {
    if (line.length <= MAX_LINE_CHARS) return line;
    cutLines++;
    return `${line.slice(0, MAX_LINE_CHARS)}…`;
  });
  return { clipped: out.join("\n"), cutLines };
}

/**
 * 方向性预算截断：先按行数取窗口（head 取前 N 行 / tail 取后 N 行），再在
 * 字节预算内逐行贪心（head 从前往后 / tail 从后往前）；单行比整个预算还长
 * 时退化为该行的字节级 head/tail 截断（UTF-8 边界安全）。
 */
function budgetTruncate(
  text: string,
  direction: "head" | "tail",
): { kept: string; truncated: boolean; singleLineClip?: number } {
  const lines = text.split("\n");
  const window =
    direction === "head"
      ? lines.slice(0, SHELL_BUDGET_LINES)
      : lines.slice(Math.max(0, lines.length - SHELL_BUDGET_LINES));
  const keptLines: string[] = [];
  let bytes = 0;
  const step = direction === "head" ? 1 : -1;
  for (
    let i = direction === "head" ? 0 : window.length - 1;
    direction === "head" ? i < window.length : i >= 0;
    i += step
  ) {
    const line = window[i] ?? "";
    const size = Buffer.byteLength(line, "utf8") + (keptLines.length > 0 ? 1 : 0);
    if (bytes + size > SHELL_BUDGET_BYTES) break;
    if (direction === "head") keptLines.push(line);
    else keptLines.unshift(line);
    bytes += size;
  }
  if (keptLines.length === 0 && window.length > 0) {
    // 单行比整个预算还长（minified bundle / tr 式一次性输出）：保留该行的
    // 方向性前缀/后缀比返回空更好（pi-desktop 同款退化）。
    const line = direction === "head" ? (window[0] ?? "") : (window[window.length - 1] ?? "");
    const clipped =
      direction === "head"
        ? truncateUtf8(line, SHELL_BUDGET_BYTES)
        : truncateUtf8Tail(line, SHELL_BUDGET_BYTES);
    return { kept: clipped, truncated: true, singleLineClip: Buffer.byteLength(line, "utf8") };
  }
  const kept = keptLines.join("\n");
  return { kept, truncated: kept.length < text.length || window.length < lines.length };
}

/** 尾向字节截断（保尾丢头，UTF-8 边界安全——truncateUtf8 的镜像）。 */
function truncateUtf8Tail(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) return s;
  let start = buf.length - maxBytes;
  while (start < buf.length) {
    const byte = buf[start] ?? 0;
    if ((byte & 0xc0) !== 0x80) break;
    start++;
  }
  return buf.subarray(start).toString("utf8");
}

async function spillFull(
  scratchDir: string | undefined,
  label: string,
  stream: "stdout" | "stderr",
  raw: string,
  sessionId: string,
  tool: string,
  callId: string,
): Promise<{ path: string; kb: number } | null> {
  if (scratchDir === undefined) return null;
  const dir = path.join(scratchDir, "tool-output");
  const stamp = Date.now();
  const seq = spillSeq++;
  const filePath = path.join(dir, `${label}-${stream}-${String(stamp)}-${String(seq)}.log`);
  const marker = {
    kind: "aegent/tool-output-spill",
    sessionId,
    tool,
    callId,
    createdAt: new Date().toISOString(),
    deletable: "manual" as const,
    truncatedBy: "bytes" as const,
  };
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, `${JSON.stringify(marker)}\n\n${raw}`, "utf8");
    return { path: filePath, kb: Math.max(1, Math.round(Buffer.byteLength(raw, "utf8") / 1024)) };
  } catch {
    // best-effort：spill 失败只丢提示，不打断结果（pi-desktop 同纪律）
    return null;
  }
}

export async function formatShellOutput(
  input: FormatShellOutputInput,
): Promise<ShellOutputFormatted> {
  const stdout = asSection(input.stdout);
  const stderr = input.stderr !== undefined ? asSection(input.stderr) : undefined;

  const stdoutClip = clipLongLines(stdout.raw);
  const stderrClip = stderr !== undefined ? clipLongLines(stderr.raw) : undefined;

  const stdoutBudget = budgetTruncate(stdoutClip.clipped, "head");
  const stderrBudget =
    stderrClip !== undefined ? budgetTruncate(stderrClip.clipped, "tail") : undefined;

  const truncated = stdoutBudget.truncated || (stderrBudget?.truncated ?? false);
  const spillPaths: string[] = [];
  if (truncated) {
    const stdoutSpill = await spillFull(
      input.scratchDir,
      input.label,
      "stdout",
      stdout.raw,
      input.sessionId,
      input.tool,
      input.callId,
    );
    if (stdoutSpill !== null) spillPaths.push(stdoutSpill.path);
    if (stderr !== undefined && stderrBudget?.truncated === true) {
      const stderrSpill = await spillFull(
        input.scratchDir,
        input.label,
        "stderr",
        stderr.raw,
        input.sessionId,
        input.tool,
        input.callId,
      );
      if (stderrSpill !== null) spillPaths.push(stderrSpill.path);
    }
  }

  const parts: string[] = [];
  // stdout 正文（head 方向：正文在前、截断标记在后）
  let stdoutText = stdoutBudget.kept;
  if (stdoutBudget.truncated) {
    stdoutText += `\n[Output truncated: kept the first ${String(SHELL_BUDGET_LINES)} lines / ${String(Math.round(SHELL_BUDGET_BYTES / 1024))}KB${
      stdoutBudget.singleLineClip !== undefined
        ? `; single ${String(stdoutBudget.singleLineClip)}-byte line clipped`
        : ""
    }.`;
    stdoutText += spillPaths[0] !== undefined
      ? ` 完整输出已存至 ${spillPaths[0]}（${String(Math.round(Buffer.byteLength(stdout.raw, "utf8") / 1024))} KB）— 可 grep 或 read。]`
      : " 缩小请求范围可看更多。]";
  } else if (stdoutClip.cutLines > 0) {
    stdoutText += `\n[${String(stdoutClip.cutLines)} 超长行（>${String(MAX_LINE_CHARS)} 字符）被截断。]`;
  }
  if (stdout.omittedBytes !== undefined && stdout.omittedBytes > 0) {
    stdoutText += `\n[后台 capture 层超限：stdout 另有 ${String(stdout.omittedBytes)} 字节未保留。]`;
  }
  if (stdoutText !== "") parts.push(stdoutText);

  // stderr 正文（tail 方向：截断标记在前、正文在后——尾部的错误先被看到）
  if (stderr !== undefined && stderrClip !== undefined && stderrBudget !== undefined) {
    let stderrText = stderrBudget.kept;
    if (stderrBudget.truncated) {
      const prefix = `[stderr truncated: kept the last ${String(SHELL_BUDGET_LINES)} lines / ${String(Math.round(SHELL_BUDGET_BYTES / 1024))}KB.`;
      const hint =
        spillPaths[1] !== undefined
          ? ` 完整输出已存至 ${spillPaths[1]}（${String(Math.round(Buffer.byteLength(stderr.raw, "utf8") / 1024))} KB）。]`
          : " 缩小请求范围可看更多。]";
      stderrText = `${prefix}${hint}\n${stderrText}`;
    } else if (stderrClip.cutLines > 0) {
      stderrText = `[${String(stderrClip.cutLines)} 超长行（>${String(MAX_LINE_CHARS)} 字符）被截断。]\n${stderrText}`;
    }
    if (stderr.omittedBytes !== undefined && stderr.omittedBytes > 0) {
      stderrText += `\n[后台 capture 层超限：stderr 另有 ${String(stderr.omittedBytes)} 字节未保留。]`;
    }
    if (stderrText !== "") parts.push(stderrText);
  }

  const failed = input.exitCode !== 0;
  let text = parts.filter((s) => s !== "").join("\n");
  if (text === "") text = "(no output)";
  if (failed) text += `\n[exit code ${String(input.exitCode)}]`;

  const meta: ShellOutputMeta = { outputBounded: true, spillPaths: [] };
  if (spillPaths.length > 0) meta.spillPaths = spillPaths;
  return { text, truncated, meta };
}
