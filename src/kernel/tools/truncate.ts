/**
 * 输出截断 + 落盘 + 上限（B5/B10/B11）——工具出口的统一防线，防单个工具
 * 输出淹没模型上下文。形状取 pi truncated-tool：**50KB 与 2000 行，先到
 * 先算**；截断时完整输出写 spill 文件、结果尾部告知模型完整输出路径；
 * 工具描述向模型声明上限（B11，descriptions/*.txt 的统一句子）。
 *
 * Q13 归属标记（B10）：spill 文件**首行是可解析的 JSON 标记**（属于哪个
 * 会话、何时可删、为何生成）——清理策略本身 P1，届时只读首行即可安全删除。
 * 落盘/读取约定：首行标记 + 空行 + 完整原文。
 *
 * 截断语义（P0 明确化并记录）：行超限先截行；截后仍超字节再截字节；
 * truncatedBy 记**最后生效**的上限。spill 文件永远落完整原文。
 * 落盘失败上抛（基础设施错误，由 loop.dispatchTool 兜底 isError）——
 * 不静默吞掉"完整输出已丢失"这个事实。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** pi truncated-tool 同款：50KB（约 1 万 token）。 */
export const DEFAULT_MAX_BYTES = 51_200;
/** pi truncated-tool 同款：2000 行。 */
export const DEFAULT_MAX_LINES = 2000;

/**
 * spill 目录缺省值（Q3 单一权威）：生产者（boundedOutput）与消费者
 * （spill-gc 的会话清理）必须指同一处，缺省装配不改此值。
 */
export const DEFAULT_SPILL_DIR = path.join(tmpdir(), "aegent-tool-spill");

/** Q13 归属标记：spill 文件首行（可解析 JSON）。 */
export interface SpillMarker {
  kind: "aegent/tool-output-spill";
  sessionId: string;
  tool: string;
  callId: string;
  /** ISO 时间。 */
  createdAt: string;
  /**
   * Q13 的"何时可删"声明，spill-gc（T-P1-14）按此执行：
   * - "after-session-end"：会话关闭即可删——boundedOutput 的缺省（spill 的
   *   消费者就是活会话，会话结束即失效；超量驱逐也只碰这一类）；
   * - "manual"：只有人工决定才能删，GC 永不碰（T-4-06 偏离④预留的扩展点）。
   */
  deletable: "manual" | "after-session-end";
  /** 最后生效的截断触发点。 */
  truncatedBy: "bytes" | "lines";
}

export interface SpillInfo {
  path: string;
  marker: SpillMarker;
}

export interface BoundedOutputOptions {
  sessionId: string;
  tool: string;
  callId: string;
  /** spill 文件目录；缺省系统临时目录下的 aegent-tool-spill。 */
  spillDir?: string;
  maxBytes?: number;
  maxLines?: number;
}

export interface BoundedOutput {
  /** 给模型的内容：未截断 = 原文；截断 = 保留头 + 尾部提示（含完整输出路径）。 */
  text: string;
  truncated: boolean;
  truncatedBy?: "bytes" | "lines";
  spilled?: SpillInfo;
}

export async function boundedOutput(
  raw: string,
  options: BoundedOutputOptions,
): Promise<BoundedOutput> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;

  const lines = raw.split("\n");
  let kept = raw;
  let truncatedBy: "bytes" | "lines" | undefined;
  if (lines.length > maxLines) {
    kept = lines.slice(0, maxLines).join("\n");
    truncatedBy = "lines";
  }
  const keptBytes = Buffer.byteLength(kept, "utf8");
  if (keptBytes > maxBytes) {
    kept = truncateUtf8(kept, maxBytes);
    truncatedBy = "bytes";
  }
  if (truncatedBy === undefined) return { text: raw, truncated: false };
  return await spill(raw, kept, truncatedBy, options, { maxBytes, maxLines });
}

/**
 * 按字节截断且不切断 UTF-8 多字节序列：从 maxBytes 处向前回退续字节
 * （10xxxxxx），保证截点落在字符边界。
 */
function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) return s;
  let cut = maxBytes;
  // 从截点向前跳过 UTF-8 续字节（10xxxxxx），保证落在字符边界
  while (cut > 0) {
    const byte = buf[cut] ?? 0;
    if ((byte & 0xc0) !== 0x80) break;
    cut--;
  }
  return buf.subarray(0, cut).toString("utf8");
}

async function spill(
  raw: string,
  kept: string,
  truncatedBy: "bytes" | "lines",
  options: BoundedOutputOptions,
  limits: { maxBytes: number; maxLines: number },
): Promise<BoundedOutput> {
  const spillDir = options.spillDir ?? DEFAULT_SPILL_DIR;
  const marker: SpillMarker = {
    kind: "aegent/tool-output-spill",
    sessionId: options.sessionId,
    tool: options.tool,
    callId: options.callId,
    createdAt: new Date().toISOString(),
    deletable: "after-session-end",
    truncatedBy,
  };
  const fileName = `spill-${String(Date.now())}-${String(process.pid)}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const filePath = path.join(spillDir, fileName);
  await mkdir(spillDir, { recursive: true });
  const content = `${JSON.stringify(marker)}\n\n${raw}`;
  await writeFile(filePath, content, "utf8");
  const reason =
    truncatedBy === "lines"
      ? `${String(limits.maxLines)} lines`
      : `${String(limits.maxBytes)} bytes`;
  const text = `${kept}\n\n[Output truncated (${reason}). 完整输出在 ${filePath}]`;
  return {
    text,
    truncated: true,
    truncatedBy,
    spilled: { path: filePath, marker },
  };
}
