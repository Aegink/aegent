/**
 * 统一 deadline 库（M7）——超时原语集中于此，不在各工具里重复实现。
 *
 * 取 dsh·util/timeout 的行为："deadline 是可查询的共享原语，不是每次
 * setTimeout"——相对时长的裸 setTimeout 给不了两件事：剩余时间查询
 * （remainingMs）与多 deadline 组合（combine 取最近）。跨层共享一个
 * deadline token（如外层会话预算 + 内层工具预算）后，内层按剩余时间
 * 武装定时器、到期错误按 code 判归属（J22），这是本库的存在理由。
 *
 * 被动查询式（卡内定形）：Deadline 本体零副作用、零后台定时器——
 * 定时器由消费方（withDeadline）按剩余时间武装，查询是显式动作。
 * 时钟经 now 参数注入（缺省 Date.now()——绝对截止抽象的固有需要），
 * 测试用显式时钟，不依赖 fake timers。
 *
 * J22 超时错误码作用域纪律（自 timeout.ts 迁来，原语家随 M7 集中）：
 * 超时是带 code 的结构化错误，不是裸 signal。嵌套的多层超时靠 code 判定
 * 归属——内层先到时 TimeoutError{code: 内层} 作为普通 rejection 透传给
 * 外层，外层不得把它误读成自己的超时；combine 组合的 deadline 继承
 * "最早到期者"的 code，到期错误报告的就是先到层的归属。dsh 的
 * `timeoutOf(signal, code)` 判定同构。
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
 * 可查询的绝对截止 token：相对时长一次性换算成绝对时点，之后任何持有者
 * 都能问"还剩多少 / 到期没有"，组合时取最近者。构造唯一入口是
 * fromTimeoutMs（构造器 private——绝对时点来源受控，杜绝拿不齐的
 * now 手搓出漂移的截止）。
 */
export class Deadline {
    private constructor(
        readonly code: string,
        /** 绝对截止时点（Date.now() 同一时钟系的毫秒值）。 */
        private readonly dueMs: number,
        /** 起算预算（fromTimeoutMs 的 timeoutMs 原值——到期错误如实报告起算预算）。 */
        private readonly budgetMs: number,
    ) {}

    /**
     * 从相对时长造绝对截止。timeoutMs 过 J24 闸（非正 / 非有限 / 超上限
     * 抛错）；now 可注入（测试显式时钟），缺省 Date.now()。
     */
    static fromTimeoutMs(code: string, timeoutMs: number, now: number = Date.now()): Deadline {
        assertTimerDelayMs(timeoutMs);
        return new Deadline(code, now + timeoutMs, timeoutMs);
    }

    /** 距截止的剩余毫秒（负值 = 已超期的量）。 */
    remainingMs(now: number = Date.now()): number {
        return this.dueMs - now;
    }

    /** 到期判定：到点即过期（剩余 ≤ 0）。 */
    expired(now: number = Date.now()): boolean {
        return this.remainingMs(now) <= 0;
    }

    /** 到期错误（J22：code 报归属、timeoutMs 报起算预算——"谁的超时、超了多少"）。 */
    expiredError(): TimeoutError {
        return new TimeoutError(this.code, this.budgetMs);
    }

    throwIfExpired(now: number = Date.now()): void {
        if (this.expired(now)) throw this.expiredError();
    }

    /**
     * 多 deadline 取最近（最早到期者胜，其 code 一并继承——先到层是到期
     * 错误的归属层）。undefined 输入被过滤（无该层约束）；全部无效时返回
     * undefined——如实表达"无约束"，调用方按需显式处理，本函数不虚构
     * "永不过期"的 deadline（与我方"0 不是禁用哨兵"纪律同源：禁用由
     * 不构造表达）。
     */
    static combine(...deadlines: (Deadline | undefined)[]): Deadline | undefined {
        let earliest: Deadline | undefined;
        for (const d of deadlines) {
            if (d === undefined) continue;
            if (earliest === undefined || d.dueMs < earliest.dueMs) earliest = d;
        }
        return earliest;
    }
}

/**
 * 给 promise 套上 deadline 预算（withTimeout 的原语化形态）：到期 reject
 * deadline.expiredError()；无 deadline 直接透传（不武装）。拿到手时已
 * 过期的 deadline（combine 出来的外层剩余耗尽是典型场景）立即 reject、
 * 不武装定时器。内层 promise 绝不被抛弃：无论它最终成功还是失败，.then
 * 都挂着 handler（超时后内层的结果只是 no-op），因此"内层完成晚于超时"
 * 不会产生 unhandled rejection——withTimeout 既有纪律原样保留。
 */
export function withDeadline<T>(deadline: Deadline | undefined, promise: Promise<T>): Promise<T> {
    if (deadline === undefined) return promise;
    const ms = deadline.remainingMs();
    return new Promise<T>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = () => reject(deadline.expiredError());
        if (ms <= 0) {
            settle();
        } else {
            timer = setTimeout(settle, ms);
        }
        promise.then(
            (value) => {
                if (timer !== undefined) clearTimeout(timer);
                resolve(value);
            },
            (reason: unknown) => {
                if (timer !== undefined) clearTimeout(timer);
                reject(reason);
            },
        );
    });
}
