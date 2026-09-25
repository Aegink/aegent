/**
 * read 工具（B3）——读文本文件。参数形状取 pi harness/tools/read.ts：
 * `{ path, offset?（1 起行号）, limit?（最大行数）}`，limit 用尽且后面还有
 * 行时附 pi 同款导航提示（Use offset=N to continue）。输出为文件原文，不带
 * 行号前缀（编辑引用由 T-4-03 edit 的"旧串→新串"语义自足）。
 *
 * P0 边界：路径相对进程 cwd 解析；工作区边界（D8/D9）由阶段 6 沙箱负责、
 * 执行前审批由阶段 5 的 toolCall 链负责——工具本体不做路径校验。
 * 不做图片/二进制检测（pi 的 imageProcessor 分支，P1）；超限截断
 * （B5/B10/B11）由 T-4-06 在工具出口统一接入。
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export function createReadTool(): ToolDef {
  return {
    name: "read",
    async execute(args) {
      const { path: filePath, offset, limit } = args as Partial<ReadArgs>;
      if (typeof filePath !== "string" || filePath === "") {
        return toolError("ReadError", "INVALID_ARGUMENTS", "read 需要 path（非空字符串）");
      }
      if (offset !== undefined && (!Number.isInteger(offset) || offset < 1)) {
        return toolError(
          "ReadError",
          "INVALID_ARGUMENTS",
          `offset 必须是 ≥1 的整数（1 起行号），收到 ${String(offset)}`,
        );
      }
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        return toolError(
          "ReadError",
          "INVALID_ARGUMENTS",
          `limit 必须是 ≥1 的整数（最大行数），收到 ${String(limit)}`,
        );
      }
      let text: string;
      try {
        text = await readFile(path.resolve(filePath), "utf8");
      } catch (e) {
        return toolError(
          "ReadError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `读取 ${filePath} 失败：${(e as Error).message}`,
        );
      }
      const lines = text.split("\n");
      // 以换行结尾的文件 split 出尾空串，按编辑器惯例不算一行
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const start = offset !== undefined ? offset - 1 : 0;
      if (start >= lines.length) {
        return toolError(
          "ReadError",
          "OFFSET_BEYOND_EOF",
          `offset ${String(offset)} 超出文件末尾（共 ${String(lines.length)} 行）`,
        );
      }
      const end = limit !== undefined ? Math.min(start + limit, lines.length) : lines.length;
      let content = lines.slice(start, end).join("\n");
      if (end < lines.length) {
        content += `\n\n[Showing lines ${String(start + 1)}-${String(end)} of ${String(lines.length)}. Use offset=${String(end + 1)} to continue.]`;
      }
      return { content };
    },
  };
}
