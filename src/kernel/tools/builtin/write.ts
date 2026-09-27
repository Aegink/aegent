/**
 * write 工具（B3）——写文件（UTF-8，原样内容不转换换行）。参数形状取
 * pi harness/tools/write.ts：`{ path, content }`；父目录不存在自动创建
 * （pi 同款）。成功返回写入字节数。
 *
 * 写串行化（B4）：落盘动作经 T-4-04 写队列执行（同路径 FIFO）。
 * 路径边界（T-6-01/C7/D1）：落盘经沙箱守卫的唯一入口（先断言后 I/O，
 * 父目录创建也在守卫内）——本文件不含任何裸 fs 写；工厂类型上必收守卫
 * 实例，无旁路由构造保证。执行前审批由阶段 5 的 toolCall 链负责。
 */

import * as path from "node:path";
import { PathGuard, PathGuardError } from "../../../sandbox/path-guard.js";
import { ReadGateError } from "../../../policy/read-gate.js";
import type { ToolExecutionResult } from "../../loop.js";
import type { ToolDef } from "../registry.js";
import type { WriteQueue } from "../write-queue.js";
import { contentHash, toolError } from "./util.js";

export interface WriteArgs {
  path: string;
  content: string;
}

export function createWriteTool(options: {
  writeQueue?: WriteQueue;
  pathGuard: PathGuard;
}): ToolDef {
  const queue = options.writeQueue;
  const guard = options.pathGuard;
  return {
    name: "write",
    async execute(args, ctx) {
      const { path: filePath, content } = args as Partial<WriteArgs>;
      if (typeof filePath !== "string" || filePath === "") {
        return toolError("WriteError", "INVALID_ARGUMENTS", "write 需要 path（非空字符串）");
      }
      if (typeof content !== "string") {
        return toolError("WriteError", "INVALID_ARGUMENTS", "write 需要 content（字符串）");
      }
      const abs = path.resolve(filePath);
      const doWrite = async (): Promise<ToolExecutionResult> => {
        // C12 覆盖已有文件须基于已读版本（可选装配，T-P1-71）；create 新
        // 文件豁免（不存在 = 无"旧版本"可言，dsh createIfAbsent 同构）。
        // 探测经守卫唯一入口：read 命中 ENOENT 即新文件；越界/IO 错误在
        // 探测面就落（不吞——落盘路径会重复同样的错误，提前返回更可读）。
        if (ctx?.readGate !== undefined) {
          let currentText: string | undefined;
          try {
            currentText = await guard.read(abs);
          } catch (e) {
            if (e instanceof PathGuardError) {
              return toolError("WriteError", e.code, e.message);
            }
            const code = (e as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") {
              return toolError(
                "WriteError",
                code ?? "IO_ERROR",
                `读取 ${filePath} 失败：${(e as Error).message}`,
              );
            }
            // ENOENT = 新文件（豁免）
          }
          if (currentText !== undefined) {
            try {
              ctx.readGate.requireRead(abs, contentHash(currentText));
            } catch (e) {
              if (e instanceof ReadGateError) {
                return toolError("ReadGateError", e.code, e.message);
              }
              throw e;
            }
          }
        }
        try {
          await guard.write(abs, content);
        } catch (e) {
          if (e instanceof PathGuardError) {
            return toolError("WriteError", e.code, e.message);
          }
          return toolError(
            "WriteError",
            (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
            `写入 ${filePath} 失败：${(e as Error).message}`,
          );
        }
        // 写后记账 = 新版本（后续覆盖/编辑的合法基线）
        ctx?.readGate?.recordRead(abs, contentHash(content));
        return {
          content: `Successfully wrote to ${filePath} (${String(Buffer.byteLength(content, "utf8"))} bytes)`,
        };
      };
      // B4：落盘动作经写队列串行化（同路径 FIFO）；未接队列时直写（仅测试）
      return queue ? queue.run(abs, doWrite) : doWrite();
    },
  };
}
