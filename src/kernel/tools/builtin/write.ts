/**
 * write 工具（B3）——写文件（UTF-8，原样内容不转换换行）。参数形状取
 * pi harness/tools/write.ts：`{ path, content }`；父目录不存在自动创建
 * （pi 同款）。成功返回写入字节数。
 *
 * 写串行化（B4）：T-4-04 的写队列落地后，本工具的落盘动作经队列执行
 * （同路径 FIFO）；本卡先直写（依赖顺序：队列卡依赖本卡）。
 * 路径边界同 read：工具本体不做校验（阶段 5/6 的链层与沙箱负责）。
 */

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { ToolExecutionResult } from "../../loop.js";
import type { ToolDef } from "../registry.js";
import type { WriteQueue } from "../write-queue.js";
import { toolError } from "./util.js";

export interface WriteArgs {
  path: string;
  content: string;
}

export function createWriteTool(options?: { writeQueue?: WriteQueue }): ToolDef {
  const queue = options?.writeQueue;
  return {
    name: "write",
    async execute(args) {
      const { path: filePath, content } = args as Partial<WriteArgs>;
      if (typeof filePath !== "string" || filePath === "") {
        return toolError("WriteError", "INVALID_ARGUMENTS", "write 需要 path（非空字符串）");
      }
      if (typeof content !== "string") {
        return toolError("WriteError", "INVALID_ARGUMENTS", "write 需要 content（字符串）");
      }
      const abs = path.resolve(filePath);
      const doWrite = async (): Promise<ToolExecutionResult> => {
        try {
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, content, "utf8");
        } catch (e) {
          return toolError(
            "WriteError",
            (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
            `写入 ${filePath} 失败：${(e as Error).message}`,
          );
        }
        return {
          content: `Successfully wrote to ${filePath} (${String(Buffer.byteLength(content, "utf8"))} bytes)`,
        };
      };
      // B4：落盘动作经写队列串行化（同路径 FIFO）；未接队列时直写（仅测试）
      return queue ? queue.run(abs, doWrite) : doWrite();
    },
  };
}
