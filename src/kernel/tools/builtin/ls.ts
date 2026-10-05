/**
 * ls 工具（T-P3-172 需求 1 补齐面——pi ls/qwen list_directory 同款）：
 * 单目录条目列举（目录在前、名称排序），glob/grep 覆盖"找文件"而这是
 * "看目录"的高频形态——模型不再需要为 ls 一个目录去跑 shell。
 * 输出绝对路径（与 glob 同纪律——自包含，拿去 read 不受 cwd 错位影响）。
 * 只读（B17 parallel）。
 */

import { readdir } from "node:fs/promises";
import * as path from "node:path";

import { toolError } from "./util.js";
import type { ToolDef } from "../registry.js";

/** 条目数上限（pi ls 同款双保险的条数半边）。 */
const MAX_ENTRIES = 500;

export interface LsArgs {
  path?: string;
}

export function createLsTool(): ToolDef {
  return {
    name: "ls",
    parallel: true, // B17：纯读
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要列举的目录（绝对路径；缺省 = 工作区根）" },
      },
    },
    async execute(args) {
      const base = (args as Partial<LsArgs>).path;
      if (base !== undefined && (typeof base !== "string" || base.trim() === "")) {
        return toolError("LsError", "INVALID_ARGUMENTS", "path 必须是非空字符串（可省略）");
      }
      const root = path.resolve(base ?? process.cwd());
      let dirents: import("node:fs").Dirent[];
      try {
        dirents = await readdir(root, { withFileTypes: true });
      } catch (e) {
        const code = String((e as NodeJS.ErrnoException).code ?? "IO_ERROR");
        return toolError("LsError", code === "ENOENT" ? "NOT_FOUND" : code, `无法读取目录 ${root}：${e instanceof Error ? e.message : String(e)}`);
      }
      let dirs = 0;
      let files = 0;
      const labels: string[] = [];
      dirents.sort((a, b) => a.name.localeCompare(b.name));
      for (const d of dirents) {
        if (d.isDirectory()) {
          dirs++;
          labels.push(`${d.name}/`);
        } else {
          files++;
          labels.push(d.name);
        }
      }
      let content = labels.slice(0, MAX_ENTRIES).join("\n");
      if (labels.length > MAX_ENTRIES) {
        content += `\n\n[${String(labels.length)} 个条目，显示前 ${String(MAX_ENTRIES)}——用更具体的子目录或 glob 缩小范围]`;
      }
      if (labels.length === 0) content = "(空目录)";
      return { content: `${content}\n\n共 ${String(dirs)} 个目录、${String(files)} 个文件` };
    },
  };
}
