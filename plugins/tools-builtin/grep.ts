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
import type { ToolDef } from "../../src/core/index.js";
import type { ToolContext } from "../../src/core/index.js";
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

/**
 * rg 快路径的 stdout 缓冲上限（pi-desktop RG_STDOUT_CAP 同款 8MB）：病态
 * 大树在解析前不吃满内存；超限报错 → 回退内置搜索器（结果正确只是慢）。
 */
const RG_STDOUT_CAP = 8 * 1024 * 1024;

/**
 * rg 探测缓存（进程级）：`rg --version` 一次成功/失败后不再重复探测。
 * 测试隔离面 resetGrepRgProbeForTests（O25 显式重置纪律）。
 */
let rgProbeResult: boolean | undefined;

export function resetGrepRgProbeForTests(): void {
  rgProbeResult = undefined;
}

/**
 * JS RegExp 独有构造（rg 的 Rust regex 不支持——回退内置实现而非输出
 * 假结果）：lookahead/lookbehind。`\d` 等共享转义两边方言一致，不拦。
 */
const JS_ONLY_REGEX_CONSTRUCTS = /\(\?[=!<]/;

async function trySystemRg(
  pattern: string,
  root: string,
  include: string | undefined,
  ctx: ToolContext,
): Promise<{ content: string; truncated: boolean } | "fallback"> {
  const env = ctx.env;
  if (env === undefined || env.execFile === undefined) return "fallback";
  if (JS_ONLY_REGEX_CONSTRUCTS.test(pattern)) return "fallback";
  // 探测（进程级缓存）：rg 不在 PATH → 永久走内置（本进程内）
  if (rgProbeResult === undefined) {
    try {
      await env.execFile("rg", ["--version"], { timeoutMs: 5000 });
      rgProbeResult = true;
    } catch {
      rgProbeResult = false;
    }
  }
  if (rgProbeResult === false) return "fallback";
  const args = ["--json", "--no-config", "-e", pattern, "--", root];
  if (include !== undefined) args.splice(2, 0, "--glob", include);
  let result;
  try {
    result = await env.execFile("rg", args, { maxBufferBytes: RG_STDOUT_CAP });
  } catch {
    // spawn 失败（ENOENT）/超时/缓冲超限：回退内置（不改变工具公共形状）
    return "fallback";
  }
  // rg 退出码语义：0 = 有匹配，1 = 无匹配；其余 = rg 自身出错 → 回退
  if (result.exitCode !== 0 && result.exitCode !== 1) return "fallback";
  if (result.exitCode === 1) return { content: "No matches found", truncated: false };
  const lines: string[] = [];
  let truncated = false;
  for (const raw of result.stdout.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    let parsed: {
      type?: string;
      data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
    };
    try {
      parsed = JSON.parse(trimmed) as typeof parsed;
    } catch {
      continue; // 非 JSON 行（噪声）跳过
    }
    if (parsed.type !== "match" || parsed.data === undefined) continue;
    const file = parsed.data.path?.text;
    const lineNo = parsed.data.line_number;
    const text = parsed.data.lines?.text ?? "";
    if (file === undefined || lineNo === undefined) continue;
    if (lines.length >= MAX_GREP_MATCHES) {
      truncated = true;
      break;
    }
    const clean = text.replace(/\r?\n$/, "");
    const display = clean.length > MAX_LINE_DISPLAY ? `${clean.slice(0, MAX_LINE_DISPLAY)}…` : clean;
    lines.push(`${file}:${String(lineNo)}: ${display}`);
  }
  if (lines.length === 0) return { content: "No matches found", truncated: false };
  let content = lines.join("\n");
  if (truncated) {
    content += `\n\n[${String(MAX_GREP_MATCHES)}+ matches, output truncated. Refine the pattern or narrow the path.]`;
  }
  return { content, truncated };
}

export function createGrepTool(): ToolDef {
  return {
    name: "grep",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text (case-insensitive) or /regex/ to search inside files" },
        path: { type: "string", description: "Search root directory (optional, defaults to the workspace root)" },
        include: { type: "string", description: "Glob filter for file names, e.g. *.ts (optional)" },
      },
      required: ["pattern"],
    },
    parallel: true, // B17：纯读，声明可并行（parallel 模式持读锁）
    async execute(args, ctx) {
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
      // T-P3-174 批次 1：系统 rg 快路径（pi-desktop grep_rg 同构——spawn
      // 失败/退出码非 0/1 一律无缝回退内置搜索器，工具公共形状不变）。
      // 注意：rg 尊重 .gitignore（内置遍历不尊重）——结果面差异记档。
      {
        const fast = await trySystemRg(pattern, root, include, ctx);
        if (fast !== "fallback") {
          return { content: fast.content, ...(fast.truncated ? { meta: { truncated: true } } : {}) };
        }
      }
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
