/**
 * glob 工具（B3）——按 glob 模式列文件。参数形状取 opencode tool/glob.ts：
 * `{ pattern, path?（搜索根，缺省进程 cwd）}`。输出**绝对路径**（自包含——
 * 模型拿去 read 时不受 cwd 与搜索根错位影响），字母序，超过上限截断并提示。
 * 方言见 patterns.ts 头注释；大目录性能优化（rg --files 集成）随 T-4-05 的
 * ExecutionEnv 走（spawn 属 env 实现层，D4）。
 */

import { stat } from "node:fs/promises";
import * as path from "node:path";
import type { ToolDef } from "../../src/core/index.js";
import { globToRegExp, walkFiles } from "../../src/kernel/tools/builtin/patterns.js";
import { toolError } from "../../src/kernel/tools/builtin/util.js";

export interface GlobArgs {
  pattern: string;
  path?: string;
}

/** 输出条数上限（opencode glob 的 limit 100 同款）。 */
export const MAX_GLOB_RESULTS = 100;

export function createGlobTool(): ToolDef {
  return {
    name: "glob",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match files, e.g. src/**/*.ts" },
        path: { type: "string", description: "Search root directory (optional, defaults to the workspace root)" },
      },
      required: ["pattern"],
    },
    parallel: true, // B17：纯读，声明可并行（parallel 模式持读锁）
    async execute(args) {
      const { pattern, path: base } = args as Partial<GlobArgs>;
      if (typeof pattern !== "string" || pattern === "") {
        return toolError("GlobError", "INVALID_ARGUMENTS", "glob 需要 pattern（非空字符串）");
      }
      if (base !== undefined && typeof base !== "string") {
        return toolError("GlobError", "INVALID_ARGUMENTS", "path 必须是字符串（可选）");
      }
      const root = path.resolve(base ?? process.cwd());
      try {
        const info = await stat(root);
        if (!info.isDirectory()) {
          return toolError("GlobError", "NOT_A_DIRECTORY", `搜索根必须是目录：${root}`);
        }
      } catch (e) {
        return toolError(
          "GlobError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `访问搜索根失败：${(e as Error).message}`,
        );
      }
      let rels: string[];
      try {
        rels = await walkFiles(root);
      } catch (e) {
        return toolError(
          "GlobError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `遍历 ${root} 失败：${(e as Error).message}`,
        );
      }
      const re = globToRegExp(pattern);
      const matched = rels.filter((rel) => re.test(rel)).map((rel) => path.join(root, rel));
      if (matched.length === 0) return { content: "No files found" };
      let content = matched.slice(0, MAX_GLOB_RESULTS).join("\n");
      if (matched.length > MAX_GLOB_RESULTS) {
        content += `\n\n[${String(matched.length)} files matched, showing first ${String(MAX_GLOB_RESULTS)}. Refine the pattern to narrow down.]`;
      }
      return { content };
    },
  };
}
