/**
 * bash 重试守卫（T-6-06 · D15）——幂等边界："重试只对'未启动'安全"
 * （行为取 pi-desktop ADR 0041：started commands are never automatically
 * retried；spawn 资源类瞬时失败可退避重试，超时子进程先回收再释放许可——
 * 🔴 LGPL 只学行为）。
 *
 * 机制：bash 工具的执行结果带 `started: true` 标记（meta，与 T-4-05 的
 * exitCode 同一通道，不造第二套词汇）——**一旦 env.exec 已把进程 spawn
 * 出去，无论后续成功/非零退出/超时/未知失败，结果一律标记**；任何自动
 * 重试层（现在的或将来加的）在重发前必须过 `assertRetryAllowed`，见到
 * 标记即拒绝。错误信息含"命令已启动，不自动重试"——模型要重复执行必须
 * **显式再次调用**（由模型/用户为新的一次执行担责）。
 *
 * 分界（isSpawnFailure）：spawn 本身失败（ENOENT/EACCES/EMFILE 等资源与
 * 找不到可执行文件类）= 命令**未启动**，无标记，重试安全（ADR 的
 * "transient spawn failures receive bounded backoff"）；**未知失败保守按
 * 已启动处理**（fail-closed：判断不了就不重试）。
 */

import type { JsonRecord } from "../events.js";
import type { ToolExecutionResult } from "../loop.js";

/** "已启动"标记的 meta 键（tool/result.meta 既有形状）。 */
export const STARTED_MARKER_KEY = "started";

/** 拒绝自动重试的固定文案（D15 验收要点：错误信息含此句）。 */
export const RETRY_REFUSED_MESSAGE = "命令已启动，不自动重试";

export const RETRY_REFUSED_STARTED = "RETRY_REFUSED_STARTED";

export class RetryRefusedError extends Error {
  override readonly name = "RetryRefusedError";
  readonly code = RETRY_REFUSED_STARTED;
  constructor(message: string = RETRY_REFUSED_MESSAGE) {
    super(message);
  }
}

/** 给执行结果打"已启动"标记（meta 合并，防御非对象 meta）。 */
export function markStarted(result: ToolExecutionResult): ToolExecutionResult {
  const meta: JsonRecord =
    typeof result.meta === "object" &&
    result.meta !== null &&
    !Array.isArray(result.meta)
      ? { ...(result.meta as JsonRecord) }
      : {};
  meta[STARTED_MARKER_KEY] = true;
  return { ...result, meta };
}

function hasStartedMarker(result: ToolExecutionResult): boolean {
  return (
    typeof result.meta === "object" &&
    result.meta !== null &&
    (result.meta as Record<string, unknown>)[STARTED_MARKER_KEY] === true
  );
}

/**
 * 自动重试层的检查点：重发一个工具执行前必须调用。结果带"已启动"标记
 * （成功或失败）即抛 RetryRefusedError——重试只对未启动的命令安全。
 */
export function assertRetryAllowed(result: ToolExecutionResult): void {
  if (hasStartedMarker(result)) {
    throw new RetryRefusedError(
      `${RETRY_REFUSED_MESSAGE}（D15：该命令的进程已经 spawn 过，自动重发会产生重复副作用；需要重复执行请显式再次调用）`,
    );
  }
}

/**
 * spawn 本身失败的判据：命令**未启动**，重试安全（bounded backoff 是重试
 * 层的职责）。不在此清单内的失败保守按"已启动"处理（D15 fail-closed）。
 */
const SPAWN_FAILURE_CODES: ReadonlySet<string> = new Set([
  "ENOENT", // 可执行文件不存在
  "EACCES", // 无执行权限
  "EAGAIN", // 资源暂时不可用（进程数受限）
  "EMFILE", // 打开的文件过多
  "ENFILE", // 系统级文件表满
  "ENOEXEC", // 不是可执行格式
  "E2BIG", // 参数/环境超长
  "ENAMETOOLONG", // 路径超长
]);

export function isSpawnFailure(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && SPAWN_FAILURE_CODES.has(code);
}
