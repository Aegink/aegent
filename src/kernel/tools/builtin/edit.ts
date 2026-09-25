/**
 * edit 工具（B3）——"旧串→新串"最小语义（卡面裁定：fuzzy 匹配不做）：
 * oldText 必须在文件中**恰好出现一次**（0 次 → not found、≥2 次 → not
 * unique，都落 isError 提示模型补上下文），替换一次后写回。单条替换
 * （pi 的批量 edits[] 与 legacy 兼容形状不取——P0 最小闭环）。
 *
 * 不做换行规范化（pi 的 normalizeToLF/restoreLineEndings 不取）：按字节面
 * 精确匹配，CRLF 文件需模型给出的 oldText 含同样的 CRLF——方言/风险已记
 * 卡面。写回动作与 write 同款：T-4-04 队列落地后经队列执行（头注释声明
 * 接入点）。路径边界同 read（阶段 5/6 负责）。
 */

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";

export interface EditArgs {
  path: string;
  oldText: string;
  newText: string;
}

/** 统计 oldText 的出现次数（要求调用方先确认非空）。 */
function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let at = text.indexOf(needle);
  while (at !== -1) {
    count++;
    at = text.indexOf(needle, at + needle.length);
  }
  return count;
}

export function createEditTool(): ToolDef {
  return {
    name: "edit",
    async execute(args) {
      const { path: filePath, oldText, newText } = args as Partial<EditArgs>;
      if (typeof filePath !== "string" || filePath === "") {
        return toolError("EditError", "INVALID_ARGUMENTS", "edit 需要 path（非空字符串）");
      }
      if (typeof oldText !== "string" || oldText === "") {
        return toolError("EditError", "INVALID_ARGUMENTS", "edit 需要 oldText（非空字符串）");
      }
      if (typeof newText !== "string") {
        return toolError("EditError", "INVALID_ARGUMENTS", "edit 需要 newText（字符串）");
      }
      const abs = path.resolve(filePath);
      let text: string;
      try {
        text = await readFile(abs, "utf8");
      } catch (e) {
        return toolError(
          "EditError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `读取 ${filePath} 失败：${(e as Error).message}`,
        );
      }
      const occurrences = countOccurrences(text, oldText);
      if (occurrences === 0) {
        return toolError(
          "EditError",
          "OLD_TEXT_NOT_FOUND",
          `oldText 在 ${filePath} 中未找到——请核对原文（含空白与换行）后重试`,
        );
      }
      if (occurrences > 1) {
        return toolError(
          "EditError",
          "OLD_TEXT_NOT_UNIQUE",
          `oldText 在 ${filePath} 中出现 ${String(occurrences)} 次——请加入更多上下文使其唯一`,
        );
      }
      // 函数形式的替换串不经 $& 等 special pattern 解释（newText 原样落盘）
      const next = text.replace(oldText, () => newText);
      try {
        await writeFile(abs, next, "utf8");
      } catch (e) {
        return toolError(
          "EditError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `写回 ${filePath} 失败：${(e as Error).message}`,
        );
      }
      return {
        content: `Edited ${filePath} (1 replacement, ${String(Buffer.byteLength(next, "utf8"))} bytes written)`,
      };
    },
  };
}
