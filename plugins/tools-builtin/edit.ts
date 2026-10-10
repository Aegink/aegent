/**
 * edit 工具（B3）——"旧串→新串"最小语义（卡面裁定：fuzzy 匹配不做）：
 * oldText 必须在文件中**恰好出现一次**（0 次 → not found、≥2 次 → not
 * unique，都落 isError 提示模型补上下文），替换一次后写回。单条替换
 * （pi 的批量 edits[] 与 legacy 兼容形状不取——P0 最小闭环）。
 *
 * 不做换行规范化（pi 的 normalizeToLF/restoreLineEndings 不取）：按字节面
 * 精确匹配，CRLF 文件需模型给出的 oldText 含同样的 CRLF——方言/风险已记
 * 卡面。写回动作与 write 同款：整个"读-校验-替换-写回"进 T-4-04 队列，
 * 读与落盘都经沙箱守卫唯一入口（T-6-01/C7/D1，本文件不含裸 fs 写）。
 */

import * as path from "node:path";
import { PathGuard, PathGuardError } from "../../src/sandbox/path-guard.js";
import { ReadGateError } from "../../src/core/index.js";
import type { JsonValue } from "../../src/kernel/events.js";
import type { ToolExecutionResult } from "../../src/kernel/loop.js";
import type { ToolDef } from "../../src/core/index.js";
import type { WriteQueue } from "../../src/core/index.js";
import { contentHash, toolError } from "./util.js";

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

export function createEditTool(options: {
  writeQueue?: WriteQueue;
  pathGuard: PathGuard;
}): ToolDef {
  const queue = options.writeQueue;
  const guard = options.pathGuard;
  return {
    name: "edit",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "workspace",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path of the file to edit" },
        oldText: { type: "string", description: "Exact existing text to replace (must appear exactly once unless replaceAll)" },
        newText: { type: "string", description: "Replacement text" },
      },
      required: ["path", "oldText", "newText"],
    },
    async execute(args, ctx) {
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
      // T-6-01：写断言前置（fail fast）——越界目标在读之前就被拒，模型拿到
      // 边界错误而非"文件不存在"（guard.write 内会再断言一次，双保险）
      try {
        await guard.assertWritable(abs);
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("EditError", e.code, e.message);
        }
        throw e;
      }
      // B4：整个"读-校验-替换-写回"进队列（读改写必须原子，防并发写交错）
      const doEdit = async (): Promise<ToolExecutionResult> => {
        let text: string;
        try {
          text = await guard.read(abs);
        } catch (e) {
          if (e instanceof PathGuardError) {
            return toolError("EditError", e.code, e.message);
          }
          return toolError(
            "EditError",
            (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
            `读取 ${filePath} 失败：${(e as Error).message}`,
          );
        }
        // C12 编辑前必须先读（可选装配，T-P1-71）：未读 → EDIT_WITHOUT_READ、
        // 读后外部修改（哈希失配）→ EDIT_STALE_READ；oldText 精确匹配是
        // "基于已读版本"的第二半边保证（失配 = OLD_TEXT_NOT_FOUND）
        try {
          ctx?.readGate?.requireRead(abs, contentHash(text));
        } catch (e) {
          if (e instanceof ReadGateError) {
            return toolError("ReadGateError", e.code, e.message);
          }
          throw e;
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
          await guard.write(abs, next);
        } catch (e) {
          if (e instanceof PathGuardError) {
            return toolError("EditError", e.code, e.message);
          }
          return toolError(
            "EditError",
            (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
            `写回 ${filePath} 失败：${(e as Error).message}`,
          );
        }
        // 写后记账更新为新版本（dsh 同款：edit-then-edit 无需中间读）
        ctx?.readGate?.recordRead(abs, contentHash(next));
        return {
          content: `Edited ${filePath} (1 replacement, ${String(Buffer.byteLength(next, "utf8"))} bytes written)`,
        };
      };
      const raw = await (queue ? queue.run(abs, doEdit) : doEdit());
      // B13/T-P1-57：结果声明目标路径（loop 的 mutation 预算按此计账与清
      // 历史——成败都带，成功才触发 ADR 的"成功清空该路径失败历史"）；
      // 参数坏（INVALID_ARGUMENTS）不是一次真实的修改尝试，不计。
      if (raw.error?.code !== "INVALID_ARGUMENTS") {
        const baseMeta =
          typeof raw.meta === "object" && raw.meta !== null && !Array.isArray(raw.meta)
            ? (raw.meta as { [key: string]: JsonValue })
            : {};
        return { ...raw, meta: { ...baseMeta, mutationPaths: [filePath] } };
      }
      return raw;
    },
  };
}
