/**
 * M11 闲时任务测试（T-P2-402）——取号/窗口/核销/幂等四用例 + 跨午夜窗口
 * 边界 + transient 重试上限（确定性失败不无限重试）。
 */

import { describe, expect, it } from "vitest";

import { JobRegistry } from "../kernel/jobs.js";
import {
    DEFAULT_OFF_PEAK_WINDOWS,
    isOffPeakWindow,
    OffPeakQueue,
    type OffPeakEntry,
} from "./offpeak.js";

/** 本地时间构造（窗口按本地时区判定）。 */
function localAt(hour: number, minute: number): Date {
    return new Date(2026, 8, 28, hour, minute, 0, 0);
}

describe("isOffPeakWindow", () => {
    it("缺省窗口 23:00–07:00 跨午夜（左闭右开）", () => {
        expect(isOffPeakWindow(localAt(22, 59))).toBe(false);
        expect(isOffPeakWindow(localAt(23, 0))).toBe(true);
        expect(isOffPeakWindow(localAt(0, 0))).toBe(true);
        expect(isOffPeakWindow(localAt(6, 59))).toBe(true);
        expect(isOffPeakWindow(localAt(7, 0))).toBe(false);
        expect(isOffPeakWindow(localAt(12, 0))).toBe(false);
    });

    it("不跨午夜窗口（09:00–12:00）左闭右开", () => {
        const windows = [{ startMinute: 9 * 60, endMinute: 12 * 60 }];
        expect(isOffPeakWindow(localAt(8, 59), windows)).toBe(false);
        expect(isOffPeakWindow(localAt(9, 0), windows)).toBe(true);
        expect(isOffPeakWindow(localAt(11, 59), windows)).toBe(true);
        expect(isOffPeakWindow(localAt(12, 0), windows)).toBe(false);
    });

    it("多窗口任一命中即闲时", () => {
        const windows = [
            { startMinute: 6 * 60, endMinute: 7 * 60 },
            { startMinute: 23 * 60, endMinute: 24 * 60 },
        ];
        expect(isOffPeakWindow(localAt(6, 30), windows)).toBe(true);
        expect(isOffPeakWindow(localAt(23, 30), windows)).toBe(true);
        expect(isOffPeakWindow(localAt(12, 0), windows)).toBe(false);
    });

    it("缺省窗口配置形状（Asia/Shanghai 缺省部署时区——本地时间判窗记档）", () => {
        expect(DEFAULT_OFF_PEAK_WINDOWS).toEqual([{ startMinute: 1380, endMinute: 420 }]);
    });
});

/** 真实 JobRegistry 装配：验证取号不执行、drain 派发真实 job 的行为。 */
function makeRealQueue(isOffPeak: (now: Date) => boolean): { queue: OffPeakQueue; jobs: JobRegistry } {
    const jobs = new JobRegistry();
    const queue = new OffPeakQueue({ jobs, isOffPeak });
    return { queue, jobs };
}

describe("OffPeakQueue（真实 JobRegistry 装配）", () => {
    it("取号不执行；非窗口 drain 零派发", () => {
        const { queue, jobs } = makeRealQueue(() => false);
        const ticket = queue.offer("index-docs", { kind: "x", run: async () => {} });
        expect(ticket.ticketId).toBe("offpeak-1");
        expect(queue.get(ticket.ticketId)?.state).toBe("queued");
        expect(queue.drain()).toEqual([]);
        expect(jobs.list()).toEqual([]);
    });

    it("窗口内 drain 派发为真实 job（kind=offpeak:<label>）", () => {
        const { queue, jobs } = makeRealQueue(() => true);
        const ticket = queue.offer("index-docs", { kind: "x", run: async () => {} });
        const settlements = queue.drain();
        expect(settlements).toEqual([{ ticketId: ticket.ticketId, jobId: expect.any(String) }]);
        expect(jobs.list().map((v) => v.kind)).toEqual(["offpeak:index-docs"]);
        expect(queue.get(ticket.ticketId)?.state).toBe("dispatched");
    });

    it("drain 重放零重复派发（取出即 dispatched——重放幂等）", () => {
        const { queue, jobs } = makeRealQueue(() => true);
        queue.offer("index-docs", { kind: "x", run: async () => {} });
        expect(queue.drain()).toHaveLength(1);
        expect(queue.drain()).toEqual([]);
        expect(jobs.list()).toHaveLength(1);
    });
});

/** fake job 面：精确控制结算路径（completed/failed/killed 三态）。 */
class FakeJobs {
    readonly started: string[] = [];
    private readonly listeners = new Map<string, (view: { status: string; detail?: string }) => void>();
    private counter = 0;

    start(spec: { kind: string; run: unknown }): string {
        const id = `job-${++this.counter}`;
        this.started.push(spec.kind);
        return id;
    }

    onSettled(id: string, callback: (view: { status: string; detail?: string }) => void): void {
        this.listeners.set(id, callback);
    }

    settleAs(jobId: string, status: "completed" | "failed" | "killed", detail?: string): void {
        this.listeners.get(jobId)?.({ status, detail });
    }
}

function makeFakeQueue(maxAttempts = 3): { queue: OffPeakQueue; jobs: FakeJobs } {
    const jobs = new FakeJobs();
    const queue = new OffPeakQueue({
        jobs: jobs as unknown as Pick<JobRegistry, "start" | "onSettled">,
        isOffPeak: () => true,
        maxAttempts,
    });
    return { queue, jobs };
}

describe("OffPeakQueue 核销状态机（FakeJobs 三态控制）", () => {
    it("completed → settled（执行后核销——重放 get 幂等）", () => {
        const { queue, jobs } = makeFakeQueue();
        queue.offer("work", { kind: "x", run: async () => {} });
        const first = queue.drain()[0]!;
        jobs.settleAs(first.jobId, "completed");
        const entry = queue.get(first.ticketId);
        expect(entry?.state).toBe("settled");
        expect(entry?.settledAt).toBeDefined();
        // 重放核销（重复 get / drain）零变化
        expect(queue.get(first.ticketId)?.state).toBe("settled");
        expect(queue.drain()).toEqual([]);
    });

    it("failed → 回 queued（transient 重试）；下轮 drain 再派发", () => {
        const { queue, jobs } = makeFakeQueue();
        queue.offer("work", { kind: "x", run: async () => {} });
        const first = queue.drain()[0]!;
        jobs.settleAs(first.jobId, "failed", "boom");
        expect(queue.get(first.ticketId)?.state).toBe("queued");
        expect(queue.get(first.ticketId)?.attempts).toBe(1);
        const second = queue.drain();
        expect(second).toHaveLength(1);
        expect(second[0]?.jobId).not.toBe(first.jobId);
    });

    it("failed 超过 maxAttempts → failed 终态（确定性失败不无限重试——zcode 纪律）", () => {
        const { queue, jobs } = makeFakeQueue(2);
        queue.offer("work", { kind: "x", run: async () => {} });
        const first = queue.drain()[0]!;
        jobs.settleAs(first.jobId, "failed", "no-credential");
        const second = queue.drain()[0]!;
        jobs.settleAs(second.jobId, "failed", "no-credential");
        const entry = queue.get(first.ticketId);
        expect(entry?.state).toBe("failed");
        expect(entry?.attempts).toBe(2);
        expect(entry?.detail).toBe("no-credential");
        expect(queue.drain()).toEqual([]); // 终态不再派发
    });

    it("killed → cancelled（人为取消不是失败，不重试）", () => {
        const { queue, jobs } = makeFakeQueue();
        queue.offer("work", { kind: "x", run: async () => {} });
        const first = queue.drain()[0]!;
        jobs.settleAs(first.jobId, "killed", "user-cancel");
        expect(queue.get(first.ticketId)?.state).toBe("cancelled");
        expect(queue.drain()).toEqual([]);
    });

    it("排队到终态全序：offer → drain ×N → settled（list 面形状）", () => {
        const { queue, jobs } = makeFakeQueue();
        queue.offer("a", { kind: "x", run: async () => {} });
        queue.offer("b", { kind: "y", run: async () => {} });
        const settlements = queue.drain();
        expect(settlements).toHaveLength(2);
        jobs.settleAs(settlements[0]!.jobId, "completed");
        const list = queue.list();
        expect(list.map((e: OffPeakEntry) => e.state)).toEqual(["settled", "dispatched"]);
        expect(list[0]?.label).toBe("a");
    });
});
