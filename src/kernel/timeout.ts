/**
 * 超时错误码作用域（J22）——超时是带 code 的结构化错误，不是裸 signal
 * （形状取 dsh·timeout-policy：TOOL_TIMEOUT 常量同时作 deadline 分类码与
 * 结构化错误 code，"without racing or abandoning the tool promise"）。
 *
 * 作用域纪律（J22 的验收本体）：嵌套的多层超时靠 **code 判定归属**——
 * 内层先到时 TimeoutError{code: 内层} 作为普通 rejection 透传给外层，
 * 外层不得把它误读成自己的超时；反之外层先到时内层 promise 不受影响、
 * 继续执行到自然结算。这与 DSH 的 `timeoutOf(signal, code)` 判定同构。
 *
 * DSH 的"signal 换回/恢复"是其洋葱链 exec 形状的机制（dispatch 期间临时
 * 换派生 signal、finally 恢复上游）——我方 P0 是 promise 风格，无 exec 可换；
 * 等价纪律即"错误带 code，调用方按 code 路由"，链上的 signal 接线在
 * 阶段 3/4（T-3-04 取消、T-4-05 ToolContext）定形时照本注释落实。
 *
 * C14 提醒：TimeoutError 是 Error 实例，不得直接落事件载荷；落盘时转
 * JsonRecord（如 {code, timeoutMs, message}）。
 */

/** DSH 同款：本模块拥有的默认码（模型调用/工具调用的超时归属判定）。 */
export const TOOL_TIMEOUT = "TOOL_TIMEOUT";

export class TimeoutError extends Error {
  /** 触发超时的作用域码（如 TOOL_TIMEOUT）——嵌套场景下的"谁超时"判据 */
  readonly code: string;
  readonly timeoutMs: number;

  constructor(code: string, timeoutMs: number) {
    super(`操作在 ${timeoutMs}ms 内未完成（code=${code}）`);
    this.name = "TimeoutError";
    this.code = code;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 给 promise 套上 ms 毫秒预算：超时 reject TimeoutError{code, timeoutMs}；
 * 未超时正常结算并清除定时器。
 *
 * 内层 promise 绝不被抛弃：无论它最终成功还是失败，.then 都挂着 handler
 * （超时后内层的结果只是 no-op），因此"内层完成晚于超时"不会产生
 * unhandled rejection——这是验收的第二条，也是 Promise.race 裸写法
 * （内层 rejection 无人接）会踩的坑。
 */
export function withTimeout<T>(code: string, ms: number, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(code, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}
