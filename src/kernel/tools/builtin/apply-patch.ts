/**
 * apply_patch 工具（B8 残余/T-P1-56）——V4A patch 语法的多文件编辑。
 * 语法与"先全量验证、后执行"的两阶段纪律取 opencode apply_patch.ts +
 * patch/index.ts（:185 parsePatch / :307 deriveNewContentsFromChunks /
 * 工具层验证先行）。
 *
 * V4A 语法（*** Begin/End Patch 信封）：
 *   *** Add File: <path>      后续 + 行为初始内容
 *   *** Delete File: <path>   删除既有文件
 *   *** Update File: <path>   原地修改（可选 *** Move to: <path> 重命名）
 *   @@ <context>              chunk 定位提示（首个匹配处起前进）
 *   空格开头 = 保留行（old+new 共有）；- = 删行；+ = 加行
 *   *** End of File           chunk 的 EOF 锚（从文件尾先试匹配）
 *
 * 匹配语义（opencode seekSequence 同构）：old_lines 序列按**首个**匹配
 * （从上一 chunk 结束处前进，行级游标防重叠），四级容错逐步放宽——
 * 精确 → rstrip → trim；Unicode 标点归一化级不落（中文场景引号/破折号
 * 归一化有误伤风险，LIMITATIONS 记档）。纯加 chunk（old_lines 空）恒插
 * 文件尾（opencode 同款语义——中间插入必须给 context + 前置保留行）。
 *
 * 安全面（T-P1-01 出口级硬拦的覆盖义务）：patch 目标路径藏在 patchText
 * 里，C46 保护路径与 C35 自我修改防线在 policy 出口对 patchText 做前缀
 * 扫描（protected-paths.extractPatchWritePaths）——扫描器认的前缀集与
 * 本文件解析器一致，由 apply-patch.test.ts 钉死。
 *
 * BOM/换行：不做特殊处理（edit.ts 同款纪律——按字节面处理，CRLF 文件
 * 需 patch 行含同样换行风格）。
 */

import * as path from "node:path";
import { PathGuard, PathGuardError } from "../../../sandbox/path-guard.js";
import type { ToolExecutionResult } from "../../loop.js";
import type { ToolDef } from "../registry.js";
import type { WriteQueue } from "../write-queue.js";
import { toolError } from "./util.js";

export interface ApplyPatchArgs {
  patchText: string;
}

/** 一个文件级变更（opencode Hunk 同构三型）。 */
export type PatchHunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | {
      type: "update";
      path: string;
      movePath?: string;
      chunks: UpdateChunk[];
    };

export interface UpdateChunk {
  oldLines: string[];
  newLines: string[];
  changeContext?: string;
  isEndOfFile?: boolean;
}

export class PatchParseError extends Error {
  override readonly name = "PatchParseError";
}

const ADD_HEADER = "*** Add File:";
const DELETE_HEADER = "*** Delete File:";
const UPDATE_HEADER = "*** Update File:";
const MOVE_HEADER = "*** Move to:";
const BEGIN_MARKER = "*** Begin Patch";
const END_MARKER = "*** End Patch";
const EOF_ANCHOR = "*** End of File";

/** 解析 V4A patch 文本为文件级变更序列（语法错误抛 PatchParseError）。 */
export function parsePatchText(patchText: string): PatchHunk[] {
  const lines = patchText.trim().split("\n");
  const beginIdx = lines.findIndex((line) => line.trim() === BEGIN_MARKER);
  const endIdx = lines.findIndex((line) => line.trim() === END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    throw new PatchParseError("patch 缺少 *** Begin Patch / *** End Patch 标记或次序颠倒");
  }

  const hunks: PatchHunk[] = [];
  let i = beginIdx + 1;
  while (i < endIdx) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.startsWith(ADD_HEADER)) {
      const target = line.slice(ADD_HEADER.length).trim();
      if (target === "") throw new PatchParseError(`${ADD_HEADER} 缺少路径`);
      const { contents, nextIdx } = parseAddContent(lines, i + 1, endIdx);
      hunks.push({ type: "add", path: target, contents });
      i = nextIdx;
      continue;
    }
    if (line.startsWith(DELETE_HEADER)) {
      const target = line.slice(DELETE_HEADER.length).trim();
      if (target === "") throw new PatchParseError(`${DELETE_HEADER} 缺少路径`);
      hunks.push({ type: "delete", path: target });
      i++;
      continue;
    }
    if (line.startsWith(UPDATE_HEADER)) {
      const target = line.slice(UPDATE_HEADER.length).trim();
      if (target === "") throw new PatchParseError(`${UPDATE_HEADER} 缺少路径`);
      let movePath: string | undefined;
      i++;
      if (i < endIdx && lines[i]?.startsWith(MOVE_HEADER)) {
        movePath = lines[i]?.slice(MOVE_HEADER.length).trim();
        if (movePath === "") throw new PatchParseError(`${MOVE_HEADER} 缺少路径`);
        i++;
      }
      const { chunks, nextIdx } = parseUpdateChunks(lines, i, endIdx);
      if (chunks.length === 0) {
        throw new PatchParseError(
          `${UPDATE_HEADER} ${target} 没有任何 @@ chunk——纯重命名也要给出空上下文（@@ 后跟保留行）或改用 Add/Delete`,
        );
      }
      hunks.push({ type: "update", path: target, ...(movePath ? { movePath } : {}), chunks });
      i = nextIdx;
      continue;
    }
    if (line.startsWith("***")) {
      throw new PatchParseError(`无法识别的 patch 指令行：${line}`);
    }
    i++;
  }
  if (hunks.length === 0) throw new PatchParseError("patch 中没有任何文件操作");
  return hunks;
}

/** Add File 的 + 行收集（非 + 行停在下一个指令头前）。 */
function parseAddContent(
  lines: string[],
  start: number,
  endIdx: number,
): { contents: string; nextIdx: number } {
  const collected: string[] = [];
  let i = start;
  while (i < endIdx && !lines[i]?.startsWith("***")) {
    const current = lines[i];
    if (current === undefined) break;
    if (current.startsWith("+")) {
      collected.push(current.slice(1));
    } else {
      throw new PatchParseError(
        `Add File 内容行必须以 + 开头，收到：${current}`,
      );
    }
    i++;
  }
  return { contents: collected.join("\n"), nextIdx: i };
}

/** Update File 的 @@ chunk 序列（V4A：@@ 行定位 chunk；无 @@ 的变更行构成
 * 隐式 chunk——从文件头找起，opencode parseUpdateFileChunks 同域语义）。 */
function parseUpdateChunks(
  lines: string[],
  start: number,
  endIdx: number,
): { chunks: UpdateChunk[]; nextIdx: number } {
  const chunks: UpdateChunk[] = [];
  let current: UpdateChunk | undefined;
  const flush = (): void => {
    if (current !== undefined) chunks.push(current);
    current = undefined;
  };
  const openWithoutContext = (): UpdateChunk => {
    flush();
    current = { oldLines: [], newLines: [] };
    return current;
  };
  const pushChangeLine = (chunk: UpdateChunk, changeLine: string): void => {
    if (changeLine.startsWith(" ")) {
      chunk.oldLines.push(changeLine.slice(1));
      chunk.newLines.push(changeLine.slice(1));
    } else if (changeLine.startsWith("+")) {
      chunk.newLines.push(changeLine.slice(1));
    } else if (changeLine.startsWith("-")) {
      chunk.oldLines.push(changeLine.slice(1));
    } else {
      throw new PatchParseError(
        `chunk 行必须以空格 / + / - 开头，收到：${changeLine}`,
      );
    }
  };
  let i = start;
  while (i < endIdx && !lines[i]?.startsWith("***")) {
    const head = lines[i];
    if (head === undefined) break;
    if (head.startsWith("@@")) {
      flush();
      current = { oldLines: [], newLines: [] };
      const contextLine = head.slice(2).trim();
      if (contextLine !== "") current.changeContext = contextLine;
      i++;
      continue;
    }
    if (head === EOF_ANCHOR) {
      if (current === undefined) current = { oldLines: [], newLines: [] };
      current.isEndOfFile = true;
      flush();
      i++;
      continue;
    }
    const chunk = current ?? openWithoutContext();
    pushChangeLine(chunk, head);
    i++;
  }
  flush();
  return { chunks, nextIdx: i };
}

/** 一个 hunk 触及的全部目标路径（add/update 的 path 与 movePath、delete 的 path）。 */
export function patchHunkPaths(hunk: PatchHunk): string[] {
  switch (hunk.type) {
    case "add":
    case "delete":
      return [hunk.path];
    case "update":
      return hunk.movePath !== undefined ? [hunk.path, hunk.movePath] : [hunk.path];
  }
}

type Comparator = (a: string, b: string) => boolean;

/** 从 startIndex 起按 comparator 匹配 pattern 序列（EOF 锚从尾先试）。 */
function tryMatch(
  lines: string[],
  pattern: string[],
  startIndex: number,
  compare: Comparator,
  eof: boolean,
): number {
  if (eof) {
    const fromEnd = lines.length - pattern.length;
    if (fromEnd >= startIndex) {
      let matches = true;
      for (let j = 0; j < pattern.length; j++) {
        const line = lines[fromEnd + j];
        const expected = pattern[j];
        if (line === undefined || expected === undefined || !compare(line, expected)) {
          matches = false;
          break;
        }
      }
      if (matches) return fromEnd;
    }
  }
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matches = true;
    for (let j = 0; j < pattern.length; j++) {
      const line = lines[i + j];
      const expected = pattern[j];
      if (line === undefined || expected === undefined || !compare(line, expected)) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return -1;
}

/** 四级容错的序列匹配（opencode seekSequence 同构，归一化级不落）。 */
function seekSequence(
  lines: string[],
  pattern: string[],
  startIndex: number,
  eof = false,
): number {
  if (pattern.length === 0) return -1;
  const exact = tryMatch(lines, pattern, startIndex, (a, b) => a === b, eof);
  if (exact !== -1) return exact;
  const rstrip = tryMatch(
    lines,
    pattern,
    startIndex,
    (a, b) => a.trimEnd() === b.trimEnd(),
    eof,
  );
  if (rstrip !== -1) return rstrip;
  return tryMatch(lines, pattern, startIndex, (a, b) => a.trim() === b.trim(), eof);
}

/**
 * update hunk 的求新内容（纯函数——验证阶段调用，失败抛错不落任何盘）。
 * opencode computeReplacements + applyReplacements 同构：chunk 顺序前进
 * 游标、replacements 逆序应用（防索引位移）。
 */
export function deriveUpdatedLines(
  filePath: string,
  chunks: UpdateChunk[],
  originalText: string,
): string {
  const originalLines = originalText.split("\n");
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
    originalLines.pop();
  }

  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;
  for (const chunk of chunks) {
    if (chunk.changeContext !== undefined) {
      const contextIdx = seekSequence(originalLines, [chunk.changeContext], lineIndex);
      if (contextIdx === -1) {
        throw new Error(`在 ${filePath} 中找不到 chunk 定位上下文 "${chunk.changeContext}"`);
      }
      lineIndex = contextIdx + 1;
    }
    // 纯加 chunk：恒插文件尾（opencode 同款语义——LIMITATIONS）
    if (chunk.oldLines.length === 0) {
      const insertionIdx =
        originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
          ? originalLines.length - 1
          : originalLines.length;
      replacements.push([insertionIdx, 0, chunk.newLines]);
      continue;
    }
    let pattern = chunk.oldLines;
    let newSlice = chunk.newLines;
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile === true);
    if (found === -1 && pattern.length > 0 && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1);
      }
      found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile === true);
    }
    if (found === -1) {
      throw new Error(
        `在 ${filePath} 中找不到 chunk 期望的行序列：\n${chunk.oldLines.join("\n")}`,
      );
    }
    replacements.push([found, pattern.length, newSlice]);
    lineIndex = found + pattern.length;
  }

  const result = [...originalLines];
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i];
    if (replacement === undefined) continue;
    const [startIdx, oldLen, newSegment] = replacement;
    result.splice(startIdx, oldLen, ...newSegment);
  }
  // 保证尾换行（opencode 同款）
  if (result.length === 0 || result[result.length - 1] !== "") {
    result.push("");
  }
  return result.join("\n");
}

export function createApplyPatchTool(options: {
  writeQueue?: WriteQueue;
  pathGuard: PathGuard;
}): ToolDef {
  const queue = options.writeQueue;
  const guard = options.pathGuard;
  return {
    name: "apply_patch",
    async execute(args) {
      const { patchText } = args as Partial<ApplyPatchArgs>;
      if (typeof patchText !== "string" || patchText.trim() === "") {
        return toolError("ApplyPatchError", "INVALID_ARGUMENTS", "apply_patch 需要 patchText（非空字符串）");
      }

      // ---------- 阶段一：解析 + 全量验证（不动任何文件） ----------
      let hunks: PatchHunk[];
      try {
        hunks = parsePatchText(patchText);
      } catch (e) {
        if (e instanceof PatchParseError) {
          return toolError("ApplyPatchError", "PATCH_PARSE_FAILED", `patch 解析失败：${e.message}`);
        }
        throw e;
      }

      const changes: Array<
        | { kind: "add"; path: string; abs: string; content: string }
        | {
            kind: "update";
            path: string;
            abs: string;
            movePath?: string;
            moveAbs?: string;
            content: string;
          }
        | { kind: "delete"; abs: string; path: string }
      > = [];
      for (const hunk of hunks) {
        for (const target of patchHunkPaths(hunk)) {
          const abs = path.resolve(target);
          try {
            await guard.assertWritable(abs);
          } catch (e) {
            if (e instanceof PathGuardError) {
              return toolError("ApplyPatchError", e.code, e.message);
            }
            throw e;
          }
        }
        if (hunk.type === "add") {
          // opencode 同款：add 内容保证尾换行（contents 非空且不带尾 \n 时补上）
          const contents =
            hunk.contents === "" || hunk.contents.endsWith("\n")
              ? hunk.contents
              : `${hunk.contents}\n`;
          changes.push({ kind: "add", path: hunk.path, abs: path.resolve(hunk.path), content: contents });
          continue;
        }
        if (hunk.type === "delete") {
          changes.push({ kind: "delete", path: hunk.path, abs: path.resolve(hunk.path) });
          continue;
        }
        // update：读原文派生新内容（读不到/匹配失败 → 整个 patch 拒绝）。
        // 目标不存在是验证失败（opencode "Failed to read file to update"
        // 同构）——与 hunk 匹配失败同一码面，模型可自修。
        let text: string;
        try {
          text = await guard.read(path.resolve(hunk.path));
        } catch (e) {
          if (e instanceof PathGuardError) {
            return toolError("ApplyPatchError", e.code, e.message);
          }
          if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            return {
              ...toolError(
                "ApplyPatchError",
                "HUNK_NOT_APPLIED",
                `Failed to read file to update: ${hunk.path}（文件不存在——Add File 才能创建新文件）`,
              ),
              // B13/T-P1-57：验证失败声明目标路径（loop 的 mutation 预算按此计账）
              meta: { mutationPaths: patchHunkPaths(hunk) },
            };
          }
          return toolError(
            "ApplyPatchError",
            (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
            `读取 ${hunk.path} 失败：${(e as Error).message}`,
          );
        }
        let content: string;
        try {
          content = deriveUpdatedLines(hunk.path, hunk.chunks, text);
        } catch (e) {
          return {
            ...toolError("ApplyPatchError", "HUNK_NOT_APPLIED", (e as Error).message),
            meta: { mutationPaths: patchHunkPaths(hunk) },
          };
        }
        changes.push({
          kind: "update",
          path: hunk.path,
          abs: path.resolve(hunk.path),
          ...(hunk.movePath !== undefined
            ? { movePath: hunk.movePath, moveAbs: path.resolve(hunk.movePath) }
            : {}),
          content,
        });
      }

      // ---------- 阶段二：执行（验证已全通过；每文件经写队列串行） ----------
      const applyChange = async (
        change: (typeof changes)[number],
      ): Promise<{ label: string; relative: string }> => {
        try {
          if (change.kind === "add") {
            await guard.write(change.abs, change.content);
            return { label: "A", relative: change.path };
          }
          if (change.kind === "update") {
            const target = change.moveAbs ?? change.abs;
            await guard.write(target, change.content);
            if (change.moveAbs !== undefined) {
              await guard.remove(change.abs);
            }
            return {
              label: "M",
              relative: change.movePath !== undefined ? change.movePath : change.path,
            };
          }
          await guard.remove(change.abs);
          return { label: "D", relative: change.path };
        } catch (e) {
          if (e instanceof PathGuardError) {
            throw new Error(`${e.code}: ${e.message}`);
          }
          throw e;
        }
      };
      const applied: Array<{ label: string; relative: string }> = [];
      try {
        for (const change of changes) {
          // B4：同一路径的变更动作经写队列串行（异路径并行不互斥）
          const action = change.kind === "update" && change.moveAbs !== undefined
            ? change.moveAbs
            : change.abs;
          applied.push(
            queue ? await queue.run(action, () => applyChange(change)) : await applyChange(change),
          );
        }
      } catch (e) {
        return toolError(
          "ApplyPatchError",
          "APPLY_FAILED",
          `patch 应用失败（此前已应用的文件不回滚，请检查后重新提交剩余变更）：${(e as Error).message}`,
        );
      }

      const summary = applied.map((a) => `${a.label} ${a.relative}`).join("\n");
        // B13/T-P1-57：成功结果声明全部涉及路径（loop 的预算清历史面——
        // ADR "a successful mutation clears that path's failure history"）
        return {
          content: `Success. Updated the following files:\n${summary}`,
          meta: {
            mutationPaths: changes.flatMap((c) =>
              c.kind === "update" && c.movePath !== undefined ? [c.path, c.movePath] : [c.path],
            ),
          },
        };
    },
  };
}
