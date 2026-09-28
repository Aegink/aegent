/**
 * M11 闲时任务（T-P2-402）——长任务取号、闲时窗口核销执行（择时省钱）。
 *
 * 锚点：zcode·offPeakDispatchSettlement.ts（取号 → 窗口判定 → 核销 → 幂等
 * 四步行为；其注释点名的纪律一并取：确定性失败不得无限退避重试——只有
 * transient 才允许回队列）。桌面端服务集成不抄（我方 host 面消费）。
 *
 * 行为四步：①取号 offer（job 带 offPeak 语义入闲时队列，返回 ticket——
 * 不真正 start）；②窗口判定 drain（被动轮询，isOffPeakWindow 命中才派发）；
 * ③核销（派发即核销在途，job onSettled 自动结算：completed → settled、
 * failed → attempts+1 未超限回 queued〔transient 重试〕超限 failed 终态
 * 〔确定性失败不无限重试——zcode 纪律〕、killed → cancelled）；
 * ④不重复执行（drain 只取 queued，取出即置 dispatched——重放零重复；
 * 状态机单向，settle 重放天然幂等）。
 *
 * 零事件定形（#24 候选关闭）：闲时核销是进程内 job 生命周期事实（重启即
 * 失），走 onSettled 订阅回调承载——jobs.ts / M4 onReap 同款"进程内事实 +
 * 回调"纪律，不进事件词汇表（落流会留下 job 消失后的孤儿事实，与"状态是
 * 事件的投影"漂移）。
 *
 * 窗口判定按**本地时间**（缺省窗口 23:00–07:00 跨午夜；Asia/Shanghai 是
 * 缺省部署时区——进程本地时区即业务时区，Intl 时区换算 YAGNI 记档）。
 */

import type { JobRegistry, JobSpec } from "../kernel/jobs.js";

/** 闲时窗口（分钟数自 00:00 起；start > end 表示跨午夜段）。 */
export interface OffPeakWindow {
    readonly startMinute: number;
    readonly endMinute: number;
}

/** 缺省闲时窗口：23:00–07:00（跨午夜）。 */
export const DEFAULT_OFF_PEAK_WINDOWS: readonly OffPeakWindow[] = [
    { startMinute: 23 * 60, endMinute: 7 * 60 },
];

/** at 的本地时刻是否落在任一窗口（左闭右开——23:00 在、07:00 不在）。 */
export function isOffPeakWindow(
    at: Date,
    windows: readonly OffPeakWindow[] = DEFAULT_OFF_PEAK_WINDOWS,
): boolean {
    const minute = at.getHours() * 60 + at.getMinutes();
    return windows.some((w) =>
        w.startMinute <= w.endMinute
            ? minute >= w.startMinute && minute < w.endMinute
            : minute >= w.startMinute || minute < w.endMinute,
    );
}

export type OffPeakState = "queued" | "dispatched" | "settled" | "failed" | "cancelled";

export interface OffPeakEntry {
    readonly ticketId: string;
    readonly label: string;
    readonly state: OffPeakState;
    readonly attempts: number;
    readonly queuedAt: number;
    readonly settledAt?: number;
    /** 终态详情（failed 的最后错误 / cancelled 的原因）。 */
    readonly detail?: string;
}

export interface OffPeakTicket {
    readonly ticketId: string;
}

export interface OffPeakSettlement {
    readonly ticketId: string;
    /** 派发产物（闲时窗口内的真实 job——结算经 onSettled 自动回流）。 */
    readonly jobId: string;
}

export interface OffPeakQueueOptions {
    jobs: Pick<JobRegistry, "start" | "onSettled">;
    /** 窗口判定（缺省 isOffPeakWindow 缺省窗口——测试注入显式判定）。 */
    isOffPeak?: (now: Date) => boolean;
    now?: () => number;
    /** transient 失败重试上限（超限 failed 终态——确定性失败不无限重试）。 */
    maxAttempts?: number;
    /** 取号 id 生成器（缺省单调计数——进程内唯一即可，跨重启不存续）。 */
    nextTicketId?: () => string;
}

interface OffPeakRecord {
    label: string;
    spec: JobSpec;
    state: OffPeakState;
    attempts: number;
    queuedAt: number;
    settledAt?: number;
    detail?: string;
}

export class OffPeakQueue {
    private readonly records = new Map<string, OffPeakRecord>();
    private readonly isOffPeak: (now: Date) => boolean;
    private readonly now: () => number;
    private readonly maxAttempts: number;
    private readonly nextTicketId: () => string;
    private counter = 0;

    constructor(private readonly options: OffPeakQueueOptions) {
        this.isOffPeak = options.isOffPeak ?? ((at) => isOffPeakWindow(at));
        this.now = options.now ?? (() => Date.now());
        this.maxAttempts = options.maxAttempts ?? 3;
        this.nextTicketId =
            options.nextTicketId ?? (() => `offpeak-${++this.counter}`);
    }

    /** ①取号：入闲时队列并返回 ticket（不真正执行——等闲时窗口）。 */
    offer(label: string, spec: JobSpec): OffPeakTicket {
        const ticketId = this.nextTicketId();
        this.records.set(ticketId, {
            label,
            spec,
            state: "queued",
            attempts: 0,
            queuedAt: this.now(),
        });
        return { ticketId };
    }

    /**
     * ②窗口判定 + 派发（被动轮询——与 cron 同款 tick 语义）：闲时窗口内把
     * 所有 queued 派发为真实 job（③核销在途），非窗口零派发。重放幂等：
     * 取出即置 dispatched，重入 drain 无 queued 可取。
     */
    drain(now: Date = new Date(this.now())): OffPeakSettlement[] {
        if (!this.isOffPeak(now)) return [];
        const settlements: OffPeakSettlement[] = [];
        for (const [ticketId, record] of this.records) {
            if (record.state !== "queued") continue;
            record.state = "dispatched";
            const jobId = this.options.jobs.start({
                kind: `offpeak:${record.label}`,
                run: record.spec.run,
            });
            this.watchSettlement(ticketId, jobId);
            settlements.push({ ticketId, jobId });
        }
        return settlements;
    }

    /** ③结算回流：job 终态 → 核销状态机（单向，重放幂等）。 */
    private watchSettlement(ticketId: string, jobId: string): void {
        this.options.jobs.onSettled(jobId, (view) => {
            const record = this.records.get(ticketId);
            // ticket 已不在 queued/dispatched（被 drain 后再 cancelled 等）——不覆盖
            if (record === undefined || record.state !== "dispatched") return;
            if (view.status === "completed") {
                record.state = "settled";
                record.settledAt = this.now();
                return;
            }
            if (view.status === "killed") {
                record.state = "cancelled";
                record.settledAt = this.now();
                record.detail = view.detail;
                return;
            }
            // failed：transient 回队列（下个闲时窗口重试）；超限 failed 终态
            record.attempts += 1;
            record.detail = view.detail;
            if (record.attempts >= this.maxAttempts) {
                record.state = "failed";
                record.settledAt = this.now();
                return;
            }
            record.state = "queued";
        });
    }

    /** ④重放核销（显式查询面）：状态机单向，重复调用返回现状不重复执行。 */
    get(ticketId: string): OffPeakEntry | undefined {
        const record = this.records.get(ticketId);
        if (record === undefined) return undefined;
        return {
            ticketId,
            label: record.label,
            state: record.state,
            attempts: record.attempts,
            queuedAt: record.queuedAt,
            ...(record.settledAt !== undefined ? { settledAt: record.settledAt } : {}),
            ...(record.detail !== undefined ? { detail: record.detail } : {}),
        };
    }

    list(): OffPeakEntry[] {
        return [...this.records.keys()].map((id) => this.get(id)!);
    }
}
