/**
 * S1 定时任务测试（T-P2-401）——解析表驱动 + 星期闭集 + vixie OR + 存储
 * 往返（真实内存库走迁移链）+ 调度器触发语义（fire/幂等/游标推进）。
 */

import { describe, expect, it } from "vitest";

import { SqliteEventStorage } from "../session/db.js";
import {
    CRON_WEEKDAY_ALIASES,
    CronScheduler,
    InvalidCronExpressionError,
    matchesCron,
    parseCron,
    SqliteCronStore,
    type CronStoreReader,
    type CronTaskRecord,
} from "./cron.js";

/** 本地时间构造（cron 语义按本地时区判定——测试不用 UTC 换算）。 */
function localDate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
): Date {
    return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("parseCron", () => {
    it("`* * * * *` 全字段全命中", () => {
        const cron = parseCron("* * * * *");
        expect(cron.minute.every(Boolean)).toBe(true);
        expect(cron.hour.every(Boolean)).toBe(true);
        expect(cron.month.slice(1).every(Boolean)).toBe(true);
        expect(cron.domRestricted).toBe(false);
        expect(cron.dowRestricted).toBe(false);
    });

    it("步进 `*/15` 命中 0/15/30/45", () => {
        const cron = parseCron("*/15 * * * *");
        const hitMinutes: number[] = [];
        cron.minute.forEach((hit, i) => {
            if (hit) hitMinutes.push(i);
        });
        expect(hitMinutes).toEqual([0, 15, 30, 45]);
    });

    it("列表 `0,30 9 * * 1` 只命中列出的分", () => {
        const cron = parseCron("0,30 9 * * 1");
        expect(cron.minute[0]).toBe(true);
        expect(cron.minute[30]).toBe(true);
        expect(cron.minute[15]).toBe(false);
        expect(cron.hour[9]).toBe(true);
        expect(cron.hour[8]).toBe(false);
    });

    it("星期闭集对齐 codex·ScheduledTaskWeekday（MO..SU → 1..6/0）", () => {
        expect(Object.keys(CRON_WEEKDAY_ALIASES)).toEqual(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
        const cron = parseCron("* * * * MO,WE,SU");
        expect(cron.dayOfWeek[1]).toBe(true);
        expect(cron.dayOfWeek[3]).toBe(true);
        expect(cron.dayOfWeek[0]).toBe(true);
        expect(cron.dayOfWeek[2]).toBe(false);
        expect(cron.dowRestricted).toBe(true);
    });

    it("数字 7 与 0 都是周日（标准 cron 语义）", () => {
        expect(parseCron("* * * * 7").dayOfWeek[0]).toBe(true);
        expect(parseCron("* * * * 0").dayOfWeek[0]).toBe(true);
    });

    const badCases: Array<[string, string]> = [
        ["60 * * * *", "分越界"],
        ["* 24 * * *", "时越界"],
        ["* * 32 * *", "日越界"],
        ["* * * 13 *", "月越界"],
        ["* * * * 8", "星期数字越界"],
        ["* * * * XX", "未知星期别名"],
        ["* * * *", "字段数不足"],
        ["* * * * * *", "字段数超出"],
        ["1-5 * * * *", "区间语法不收（YAGNI 记档）"],
        ["*/0 * * * *", "零步进"],
        ["abc * * * *", "非数字 token"],
    ];
    for (const [expr, reason] of badCases) {
        it(`拒绝：${reason}（${expr}）`, () => {
            expect(() => parseCron(expr)).toThrow(InvalidCronExpressionError);
        });
    }
});

describe("matchesCron", () => {
    const cases: Array<{ expr: string; at: Date; want: boolean; note: string }> = [
        { expr: "30 9 * * *", at: localDate(2026, 9, 28, 9, 30), want: true, note: "准时命中" },
        { expr: "30 9 * * *", at: localDate(2026, 9, 28, 9, 31), want: false, note: "分钟未中" },
        { expr: "30 9 * * *", at: localDate(2026, 9, 28, 10, 30), want: false, note: "小时未中" },
        { expr: "0 12 1 * *", at: localDate(2026, 9, 1, 12, 0), want: true, note: "每月 1 日" },
        { expr: "0 12 1 * *", at: localDate(2026, 9, 2, 12, 0), want: false, note: "非 1 日" },
        { expr: "0 8 * * 1", at: localDate(2026, 9, 28, 8, 0), want: true, note: "2026-09-28 是周一" },
        { expr: "0 8 * * 1", at: localDate(2026, 9, 27, 8, 0), want: false, note: "周日不中" },
        { expr: "0 8 * * MO", at: localDate(2026, 9, 28, 8, 0), want: true, note: "星期别名等价数字" },
        { expr: "*/15 * * * *", at: localDate(2026, 9, 28, 10, 45), want: true, note: "步进命中" },
        { expr: "*/15 * * * *", at: localDate(2026, 9, 28, 10, 50), want: false, note: "步进未中" },
        { expr: "0 9 1 * 1", at: localDate(2026, 9, 1, 9, 0), want: true, note: "vixie OR：1 日是周二?命中 dom" },
        { expr: "0 9 1 * 1", at: localDate(2026, 9, 7, 9, 0), want: true, note: "vixie OR：周一命中 dow" },
        { expr: "0 9 1 * 1", at: localDate(2026, 9, 8, 9, 0), want: false, note: "既非 1 日也非周一" },
    ];
    for (const { expr, at, want, note } of cases) {
        it(`${expr} @ ${at.toString()} → ${want}（${note}）`, () => {
            expect(matchesCron(parseCron(expr), at)).toBe(want);
        });
    }

    it("dom 与 dow 仅一个受限时 AND 语义", () => {
        // dom=1 受限、dow=* 未受限：只在 1 日命中（不受星期影响）
        expect(matchesCron(parseCron("0 9 1 * *"), localDate(2026, 9, 7, 9, 0))).toBe(false);
        expect(matchesCron(parseCron("0 9 * * 1"), localDate(2026, 9, 7, 9, 0))).toBe(true);
    });
});

describe("SqliteCronStore", () => {
    it("真实内存库往返（v5 迁移建表）：add/list/markFired/remove", () => {
        const storage = SqliteEventStorage.open({ path: ":memory:" });
        try {
            const store = new SqliteCronStore(storage.db);
            const task = store.add({ expr: "30 9 * * *", prompt: "早报", createdAt: 1000 });
            expect(task.id).not.toBe("");
            expect(task.lastFiredAt).toBeNull();
            store.add({ expr: "0 12 * * *", prompt: "午报", createdAt: 2000 });
            // list 按创建序（kimi 同款）
            expect(store.list().map((t) => t.prompt)).toEqual(["早报", "午报"]);
            store.markFired(task.id, 60_000);
            const [fired] = store.list();
            expect(fired?.lastFiredAt).toBe(60_000);
            expect(store.remove(task.id)).toBe(true);
            expect(store.remove(task.id)).toBe(false);
            expect(store.list().map((t) => t.prompt)).toEqual(["午报"]);
        } finally {
            storage.close();
        }
    });

    it("坏表达式在 add 时类型化拒绝（进不了库）", () => {
        const storage = SqliteEventStorage.open({ path: ":memory:" });
        try {
            const store = new SqliteCronStore(storage.db);
            expect(() => store.add({ expr: "60 * * * *", prompt: "x", createdAt: 0 })).toThrow(
                InvalidCronExpressionError,
            );
            expect(store.list()).toEqual([]);
        } finally {
            storage.close();
        }
    });

    it("重开同一库（迁移链幂等）：任务与游标保持", () => {
        const storage = SqliteEventStorage.open({ path: ":memory:" });
        let id: string;
        try {
            const store = new SqliteCronStore(storage.db);
            id = store.add({ expr: "* * * * *", prompt: "p", createdAt: 1 }).id;
            store.markFired(id, 120_000);
        } finally {
            // 不 close——用同一连接模拟"重开查询"（内存库 close 即失）；
            // 幂等性由迁移链 IF NOT EXISTS 保证（db.test 覆盖二次打开）。
        }
        const store = new SqliteCronStore(storage.db);
        const tasks = store.list();
        expect(tasks).toHaveLength(1);
        expect(tasks[0]?.id).toBe(id);
        expect(tasks[0]?.lastFiredAt).toBe(120_000);
        storage.close();
    });
});

/** 内存 fake（调度器只依赖 CronStoreReader 两条原语）。 */
class FakeCronStore implements CronStoreReader {
    readonly tasks: CronTaskRecord[];
    fired: Array<{ id: string; at: number }> = [];

    constructor(tasks: Array<Partial<CronTaskRecord> & Pick<CronTaskRecord, "expr">>) {
        this.tasks = tasks.map((t, i) => ({
            id: t.id ?? `task-${i}`,
            expr: t.expr,
            prompt: t.prompt ?? "p",
            createdAt: t.createdAt ?? 0,
            lastFiredAt: t.lastFiredAt ?? null,
        }));
    }

    list(): CronTaskRecord[] {
        return this.tasks.map((t) => ({ ...t }));
    }

    markFired(id: string, at: number): void {
        this.fired.push({ id, at });
        const task = this.tasks.find((t) => t.id === id);
        if (task) (task as { lastFiredAt: number | null }).lastFiredAt = at;
    }
}

describe("CronScheduler", () => {
    // 2026-09-28 09:30:00 本地时间的毫秒值（任取一个"整分钟"时点）
    const NOW = localDate(2026, 9, 28, 9, 30).getTime();

    it("到期任务 fire 并派发 job（prompt 进 log ring）", () => {
        const store = new FakeCronStore([{ expr: "30 9 * * *", prompt: "早报" }]);
        const started: string[] = [];
        const scheduler = new CronScheduler({
            store,
            jobs: { start: (spec) => (started.push(spec.kind), `job-1`) },
            now: () => NOW,
        });
        const firings = scheduler.tick();
        expect(firings).toHaveLength(1);
        expect(firings[0]?.task.prompt).toBe("早报");
        expect(firings[0]?.jobId).toBe("job-1");
        expect(started).toEqual(["cron"]);
        expect(store.fired).toEqual([{ id: "task-0", at: Math.floor(NOW / 60_000) * 60_000 }]);
    });

    it("同一分钟重入 tick 幂等（游标防重复——kimi cron.cursor 行为）", () => {
        const store = new FakeCronStore([{ expr: "30 9 * * *" }]);
        const scheduler = new CronScheduler({ store, now: () => NOW });
        expect(scheduler.tick()).toHaveLength(1);
        // 30 秒后重入（同分钟）
        expect(scheduler.tick()).toHaveLength(0);
        expect(store.fired).toHaveLength(1);
    });

    it("下一匹配分钟再 fire（游标只挡本分钟）", () => {
        const store = new FakeCronStore([{ expr: "* * * * *" }]);
        let now = NOW;
        const scheduler = new CronScheduler({ store, now: () => now });
        expect(scheduler.tick()).toHaveLength(1);
        now += 60_000;
        expect(scheduler.tick()).toHaveLength(1);
        now += 30_000; // 同分钟
        expect(scheduler.tick()).toHaveLength(0);
    });

    it("不匹配的分钟零触发", () => {
        const store = new FakeCronStore([{ expr: "0 0 * * *" }]);
        const scheduler = new CronScheduler({ store, now: () => NOW });
        expect(scheduler.tick()).toHaveLength(0);
    });

    it("坏表达式行跳过不毒化轮询（onParseError 可观测）", () => {
        const store = new FakeCronStore([{ expr: "60 * * * *" }, { expr: "30 9 * * *" }]);
        const errors: string[] = [];
        const scheduler = new CronScheduler({
            store,
            now: () => NOW,
            onParseError: (_task, error) => errors.push(error.code),
        });
        const firings = scheduler.tick();
        expect(firings).toHaveLength(1);
        expect(errors).toEqual(["CRON_EXPRESSION_INVALID"]);
    });

    it("无 jobs 时只推进游标（firings 无 jobId）", () => {
        const store = new FakeCronStore([{ expr: "30 9 * * *" }]);
        const scheduler = new CronScheduler({ store, now: () => NOW });
        const firings = scheduler.tick();
        expect(firings).toHaveLength(1);
        expect(firings[0]?.jobId).toBeUndefined();
    });
});
