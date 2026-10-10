/**
 * 超时原语的 promise 包装与看门狗（M7 统一后：原语家在 ./deadline.ts——
 * TimeoutError / TOOL_TIMEOUT / J24 守卫随原语集中迁移，本文件 re-export
 * 保持既有导入面零变动）。
 *
 * 本文件保留三件超时设施：
 * - clampTimeout：超时参数三档合并（B18）；
 * - withTimeout：总时长预算的 promise 包装（薄壳——内部消费 deadline
 *   原语，超时逻辑集中不再各写一份 setTimeout）；
 * - IdleWatchdog：空闲 / 可重臂空闲看门狗（J23）。
 *
 * 三种超时语义的分工：withTimeout/deadline 是**总时长**（从起点计，不管
 * 活动）；IdleWatchdog 是**空闲**（无活动才计时）；可重臂是空闲的续期
 * 用法（pulse）。
 *
 * J22 超时错误码作用域纪律（注释本体随家迁至 deadline.ts）：嵌套的多层
 * 超时靠 code 判定归属——内层先到时 TimeoutError{code: 内层} 作为普通
 * rejection 透传给外层，外层不得把它误读成自己的超时。
 */

import { assertTimerDelayMs, Deadline, withDeadline, TimeoutError } from "./deadline.js";

export {
    TOOL_TIMEOUT,
    MAX_TIMER_DELAY_MS,
    assertTimerDelayMs,
    TimeoutError,
} from "./deadline.js";

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

/**
 * 给 promise 套上 ms 毫秒预算：超时 reject TimeoutError{code, timeoutMs}；
 * 未超时正常结算并清除定时器。M7 起为 deadline 原语的薄壳
 * （fromTimeoutMs 换算绝对截止 + withDeadline 武装——校验、错误形状与
 * "内层 promise 绝不被抛弃"纪律全部收敛到原语层，本函数只保留既有
 * 调用面）。内层完成晚于超时不会产生 unhandled rejection（withDeadline
 * 纪律）。
 */
export function withTimeout<T>(code: string, ms: number, promise: Promise<T>): Promise<T> {
    return withDeadline(Deadline.fromTimeoutMs(code, ms), promise);
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
