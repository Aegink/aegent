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

/**
 * Node setTimeout 的最大可靠延迟（J24）：超过 2^31-1 毫秒的 delay 会被
 * Node **静默钳到 1ms**——超时立刻误触发。本模块所有定时器武装点必须过
 * assertTimerDelayMs 显式抛错（dsh assertTimerDelay 同款：主动暴露坏输入，
 * 不是模仿静默钳）。
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** J24 武装点过闸：非正 / 非有限 / 超 2^31-1 一律抛错。 */
export function assertTimerDelayMs(ms: number, name = "timeoutMs"): number {
    if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_TIMER_DELAY_MS) {
        throw new Error(
            `${name} 必须是不超过 ${String(MAX_TIMER_DELAY_MS)} 的正有限毫秒数，收到 ${String(ms)}`,
        );
    }
    return ms;
}

/**
 * 超时参数三档合并（B18，dsh clampTimeout 同构）：提示（requested）缺省时用
 * 默认档（def），结果恒被上限（max）收口——**上限不可经任何输入关闭**。
 * 非法提示值（非正 / 非有限）抛错：0 不是"禁用超时"的哨兵（dsh 同款纪律，
 * 禁用语义由调用方显式不武装表达，不藏在 0 里）。
 */
export function clampTimeout(
    requested: number | undefined,
    def: number,
    max: number,
    name = "timeoutMs",
): number {
    if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
        throw new Error(`${name} 必须是正的有限数值，收到 ${String(requested)}`);
    }
    return Math.min(requested ?? def, max);
}

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
    assertTimerDelayMs(ms);
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

/**
 * 空闲看门狗（J23 的空闲 / 可重臂空闲两面，dsh IdleWatchdog 同构）：
 * arm() 开一个等待窗口，窗口内 ms 毫秒无续期则触发 onExpire（IdleTimeout
 * 到期）；touch() 有活动即重置（**空闲超时**用法——不调 pulse 的看门狗就
 * 是纯空闲超时）；pulse() 仅在等待窗口内续期（**可重臂空闲**用法——
 * dsh "transport activity that yields no iterator value" 的续期语义：
 * 有传输活动但等待尚未结算时才重臂，无窗口时 no-op）。
 *
 * 与 withTimeout 的分工：withTimeout 是**总时长**（从起点计，不管活动）；
 * 本类是**空闲**（无活动才计时，操作总寿命可远超单次 ms）——三种超时
 * 区分到此闭合。onExpire 只触发一次；dispose 后 touch/pulse 均为 no-op。
 */
export class IdleWatchdog {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private outstanding = false;
    private disposed = false;
    private fired = false;

    constructor(
        private readonly code: string,
        private readonly ms: number,
        private readonly onExpire: (error: TimeoutError) => void,
    ) {
        assertTimerDelayMs(ms, "idleMs");
    }

    /** 开一个等待窗口（重复调用 = 重置计时，dsh arm() 同款 clear 后再武装）。 */
    arm(): void {
        if (this.disposed || this.fired) return;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.outstanding = true;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.outstanding = false;
            this.fired = true;
            this.onExpire(new TimeoutError(this.code, this.ms));
        }, this.ms);
    }

    /** 结束当前等待窗口（本次等待自然结算——清定时器但看门狗可再次 arm）。 */
    disarm(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.outstanding = false;
    }

    /** 有活动：重置计时。等待窗口内外均生效（空闲超时的续期面）。 */
    touch(): void {
        if (this.disposed || this.fired || !this.outstanding) return;
        this.arm();
    }

    /** 可重臂续期：仅等待窗口内生效（dsh pulse 同构——无窗口时 no-op）。 */
    pulse(): void {
        this.touch();
    }

    /** 终结看门狗（幂等）：清理定时器，此后一切方法 no-op。 */
    dispose(): void {
        this.disarm();
        this.disposed = true;
    }
}
