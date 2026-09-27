/** 内置工具共用的小件：可预期失败的统一落法。 */

import { createHash } from "node:crypto";
import type { ToolExecutionResult } from "../../loop.js";

/**
 * 内置工具的可预期失败（路径不存在、参数坏等）一律返回 isError 结果回喂
 * 模型（模型读到说明可自修），不上抛——上抛留给基础设施崩溃，由
 * loop.dispatchTool 兜底（注册表头注释的分层）。code 取稳定的机器码
 * （Node errno 如 ENOENT，或本文件的 INVALID_ARGUMENTS 等自定义码）。
 */
export function toolError(
  name: string,
  code: string,
  content: string,
  reason?: string,
): ToolExecutionResult {
  return {
    content,
    isError: true,
    error: { name, code, ...(reason !== undefined ? { reason } : {}) },
  };
}

/**
 * 内容哈希（C12 读记账的新鲜度基线，T-P1-71）：sha256 hex。工具在真实
 * 读写时顺带计算传给 ReadGateService——策略层自身不做 I/O。
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
