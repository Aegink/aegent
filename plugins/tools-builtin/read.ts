/**
 * read 工具（B3）——读文本文件。参数形状取 pi harness/tools/read.ts：
 * `{ path, offset?（1 起行号）, limit?（最大行数）}`，limit 用尽且后面还有
 * 行时附 pi 同款导航提示（Use offset=N to continue）。输出为文件原文，不带
 * 行号前缀（编辑引用由 T-4-03 edit 的"旧串→新串"语义自足）。
 *
 * 路径边界（T-6-01/C7/D1）：本工具不直接接触文件系统——读取经沙箱守卫
 * 的唯一入口（先校验后 I/O）。P0 读面不限（与 C46 出口 read 不拦一致），
 * 读断言按装配配置生效；执行前审批仍由阶段 5 的 toolCall 链负责。
 * 不做图片/二进制检测（pi 的 imageProcessor 分支，P1）；超限截断
 * （B5/B10/B11）由 T-4-06 在工具出口统一接入。
 */

import * as path from "node:path";
import { PathGuard, PathGuardError } from "../../src/sandbox/path-guard.js";
import type { ToolDef } from "../../src/core/index.js";
import { contentHash, toolError } from "./util.js";

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export function createReadTool(options: { pathGuard: PathGuard }): ToolDef {
  return {
    name: "read",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path of the file to read" },
        offset: { type: "number", description: "Start line (1-based, optional)" },
        limit: { type: "number", description: "Max lines to read (optional)" },
      },
      required: ["path"],
    },
    parallel: true, // B17：纯读，声明可并行（parallel 模式持读锁）
    async execute(args, ctx) {
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
        text = await options.pathGuard.read(path.resolve(filePath));
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("ReadError", e.code, e.message);
        }
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
      // C12 读记账（可选装配）：记全文件内容哈希（窗口读也算观察——
      // version 语义，dsh 同款）
      ctx?.readGate?.recordRead(path.resolve(filePath), contentHash(text));
      return { content };
    },
  };
}
