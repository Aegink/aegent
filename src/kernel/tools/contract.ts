/**
 * 声明式输出契约（B12）——执行期富值 ≠ 会话格式。
 *
 * 形状取 dsh·canonical-tool-output："one typed value during execution and
 * an explicit projection into the existing durable/model-facing content"：
 * 工具执行产出一个类型化富值（`value`，可以是任意东西——类实例、函数、
 * 大对象），`render(args, value)` 是它进入事件流的**唯一通道**。持久化
 * 只存投影产物 content + error + meta（词汇表 ToolResultEvent 的既有形状），
 * 富值本身绝不落盘（C14 由 append 的 assertJsonSafe 兜底拦截函数等运行时
 * 对象，但本契约的要求更早：dispatch 投影后富值已经不在返回值里）。
 *
 * 与 E12 的边界（防止混用，events.ts 头注释同款提醒）：
 *   - tool/result 按 B12 投影——执行期富值不落盘，只落 render 产物；
 *   - 状态类事件（message/usage/…）按 E12 整值——完整值直落。
 *
 * 工具返回两种形状均可：纯投影值（ToolExecutionResult）或契约富值
 * （ContractResult）；registry.dispatch 统一识别并投影。
 */

import type { JsonRecord, JsonValue } from "../events.js";
import type { ToolExecutionResult } from "../loop.js";

/** 执行期富值契约：value 是工具的真实产物，render 是唯一入流通道。 */
export interface ContractResult<V = unknown> {
  value: V;
  /**
   * 显式投影：把富值渲染成模型可见、可持久化的 content 字符串。
   * 只见 args 与 value——不暴露 ctx / store / 进程对象。
   */
  render(args: JsonRecord, value: V): string | Promise<string>;
  /** 工具私有展示载荷（与 ToolExecutionResult.meta 同形状）。 */
  meta?: JsonValue;
  isError?: boolean;
  error?: { name: string; code: string; reason?: string };
}

/** 结构识别：返回值是契约富值还是已投影的 ToolExecutionResult。 */
export function isContractResult(r: unknown): r is ContractResult {
  return (
    typeof r === "object" &&
    r !== null &&
    "value" in r &&
    "render" in r &&
    typeof (r as ContractResult).render === "function"
  );
}

/**
 * B12 投影：契约富值 → 落盘形状。产出的对象只含 content/isError/error/meta
 * ——没有 value 键、没有函数（验收的断言面）。
 */
export async function projectResult(
  args: JsonRecord,
  result: ContractResult,
): Promise<ToolExecutionResult> {
  const content = await result.render(args, result.value);
  return {
    content,
    ...(result.isError ? { isError: true as const } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
    ...(result.meta !== undefined ? { meta: result.meta } : {}),
  };
}
