/**
 * grep 工具（B3）——按正则搜文件内容。参数形状取 opencode tool/grep.ts：
 * `{ pattern, path?（目录或单文件，缺省 cwd）, include?（文件名 glob，
 * 如 "*.ts"，只对目录搜索生效）}`。输出经典 `path:lineNo: line` 格式
 * （行长 >200 截断），超上限截断并提示。
 *
 * P0 实现是纯 JS（fs 遍历 + 逐行 RegExp）：卡面设想的 ripgrep 主路径需要
 * spawn rg——spawn 属 T-4-05 的 ExecutionEnv 实现层（D4：工具本体不得含
 * 裸进程 API），rg 提速与 bash 执行同批经 env 回填。正则方言 = JS
 * RegExp（rg 集成时统一并记录）；include 复用 glob 方言（patterns.ts）。
 * 二进制文件（含 NUL 字节）与读取失败的文件跳过（rg 默认同款行为）。
 */

import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import type { ToolDef } from "../registry.js";
import { globToRegExp, walkFiles } from "./patterns.js";
import { toolError } from "./util.js";

export interface GrepArgs {
  pattern: string;
  path?: string;
  include?: string;
}

/** 输出匹配行数上限。 */
export const MAX_GREP_MATCHES = 200;

/** 超长匹配行的展示截断（防单行巨文件刷屏；B5 的输出截断在 T-4-06）。 */
const MAX_LINE_DISPLAY = 200;

export function createGrepTool(): ToolDef {
  return {
    name: "grep",
    parallel: true, // B17：纯读，声明可并行（parallel 模式持读锁）
    async execute(args) {
      const { pattern, path: base, include } = args as Partial<GrepArgs>;
      if (typeof pattern !== "string" || pattern === "") {
        return toolError("GrepError", "INVALID_ARGUMENTS", "grep 需要 pattern（非空字符串）");
      }
      if (base !== undefined && typeof base !== "string") {
        return toolError("GrepError", "INVALID_ARGUMENTS", "path 必须是字符串（可选）");
      }
      if (include !== undefined && typeof include !== "string") {
        return toolError("GrepError", "INVALID_ARGUMENTS", "include 必须是字符串（可选）");
      }
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch (e) {
        return toolError(
          "GrepError",
          "INVALID_PATTERN",
          `pattern 不是合法正则：${(e as Error).message}`,
        );
      }
      const root = path.resolve(base ?? process.cwd());
      let files: string[];
      try {
        const info = await stat(root);
        if (info.isFile()) {
          files = [root];
        } else {
        const includeRe = include !== undefined ? globToRegExp(include) : undefined;
        // rg 同款语义：include 不含路径分隔符时对文件名匹配（"*.ts" 命中
        // 任意深度的 ts 文件），含分隔符时对相对路径整体匹配
        const matchesInclude =
          includeRe === undefined
            ? () => true
            : include !== undefined && !include.includes("/")
              ? (rel: string) => includeRe.test(path.basename(rel))
              : (rel: string) => includeRe.test(rel);
        const rels = await walkFiles(root);
        files = rels.filter(matchesInclude).map((rel) => path.join(root, rel));
        }
      } catch (e) {
        return toolError(
          "GrepError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `访问搜索路径失败：${(e as Error).message}`,
        );
      }
      const lines: string[] = [];
      let truncated = false;
      for (const file of files) {
        if (truncated) break;
        let text: string;
        try {
          text = await readFile(file, "utf8");
        } catch {
          continue;
        }
        if (text.includes("\u0000")) continue;
        const fileLines = text.split("\n");
        for (let i = 0; i < fileLines.length; i++) {
          const raw = fileLines[i];
          if (raw === undefined) continue; // noUncheckedIndexedAccess 防御：i < length 恒真
          if (!re.test(raw)) continue;
          if (lines.length >= MAX_GREP_MATCHES) {
            truncated = true;
            break;
          }
          const display =
            raw.length > MAX_LINE_DISPLAY ? `${raw.slice(0, MAX_LINE_DISPLAY)}…` : raw;
          lines.push(`${file}:${String(i + 1)}: ${display}`);
        }
      }
      if (lines.length === 0) return { content: "No matches found" };
      let content = lines.join("\n");
      if (truncated) {
        content += `\n\n[${String(MAX_GREP_MATCHES)}+ matches, output truncated. Refine the pattern or narrow the path.]`;
      }
      return { content };
    },
  };
}
