/**
 * save_memory 工具（T-P3-174 批次 1，qwen save_memory 语义 + aegent C2
 * 记忆面）——把值得跨会话记住的事实追加进记忆索引文件（缺省
 * `~/.aegent/memory/MEMORY.md`，T-P3-151 C2 装配末层的挂点文件——系统
 * 提示「## 持久记忆」段读的就是它，下次装配即生效）。
 *
 * 追加语义（qwen writeContextFile 的 append 同构）：每条一行
 * `- [YYYY-MM-DD] <fact>`，文件不存在则建（含标题）；换行折叠成空格、
 * 长度上限 2000 字符（记忆是索引不是正文——大内容引导模型写文件再存
 * 路径）。零外部依赖常驻注册；写失败类型化报错（fail-visible 不静默）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";

/** 单条记忆的字符上限（索引行不是正文）。 */
export const MAX_MEMORY_FACT_CHARS = 2000;

const MEMORY_HEADER = "# 持久记忆\n\n";

export function createSaveMemoryTool(options: {
  /** 记忆索引文件路径（缺省 ~/.aegent/memory/MEMORY.md——C2 挂点）。 */
  memoryPath?: string;
  /** 测试时钟注入（缺省 Date.now）。 */
  now?: () => Date;
}): ToolDef {
  const memoryPath = options.memoryPath ?? path.join(homedir(), ".aegent", "memory", "MEMORY.md");
  const now = options.now ?? (() => new Date());
  return {
    name: "save_memory",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description:
            "The fact to remember across sessions (one line; specific and self-contained). " +
            "For large content, write a file first and save its path here.",
        },
      },
      required: ["fact"],
    },
    async execute(args) {
      const fact = args["fact"];
      if (typeof fact !== "string" || fact.trim() === "") {
        return toolError("SaveMemoryError", "INVALID_ARGUMENTS", "save_memory 需要 fact（非空字符串）");
      }
      const line = `- [${now().toISOString().slice(0, 10)}] ${fact.replace(/\s*\r?\n\s*/g, " ").trim()}`;
      if (line.length > MAX_MEMORY_FACT_CHARS + 12) {
        return toolError(
          "SaveMemoryError",
          "FACT_TOO_LONG",
          `fact 过长（上限 ${String(MAX_MEMORY_FACT_CHARS)} 字符）——写文件后把路径存为记忆`,
        );
      }
      try {
        await mkdir(path.dirname(memoryPath), { recursive: true });
        let existing = "";
        try {
          existing = await readFile(memoryPath, "utf8");
        } catch {
          existing = ""; // 文件不存在 = 从头建（含标题）
        }
        const body = existing === "" ? MEMORY_HEADER : existing.endsWith("\n") ? existing : `${existing}\n`;
        await writeFile(memoryPath, `${body}${line}\n`, "utf8");
        return {
          content: `已写入持久记忆（${memoryPath}）：\n${line}\n下次系统提示装配即生效。`,
          meta: { memoryPath: memoryPath },
        };
      } catch (e) {
        return toolError(
          "SaveMemoryError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `记忆写入失败：${(e as Error).message}`,
        );
      }
    },
  };
}
