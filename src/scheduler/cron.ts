/**
 * S1 定时任务（T-P2-401）——cron/星期定义 + 持久存储 + 被动轮询派发。
 *
 * 锚点：codex·ScheduledTaskWeekday.ts（星期闭集 MO..SU）；kimi·cron-store.ts
 * （调度定义持久化 + lastFiredAt 游标——fire 即推进，同一分钟重入不重复）。
 * 取"调度定义持久化 + 到期派发"行为；kimi 的 wire 记录式持久化不取（我方
 * sqlite 运维账本 v5 先例同款）；其 8-hex/ULID id 校验不取（单机规模
 * randomUUID 足够）。
 *
 * cron 解析器自写最小面（node 零依赖）：分/时/日/月/星期五字段，`*`、
 * 列表 `,`、步进 `/` 三形态；区间语法 `a-b` 不做（YAGNI 记档——需要时在
 * parseField 扩一项，闭集形态见卡）。dom 与 dow **同时**受限时的 OR 语义
 * 对齐 vixie cron（两者任一命中即当日触发；仅一个受限时 AND 语义）。
 *
 * 触发语义（被动轮询的最小面）：tick 判"当前本地时间分钟匹配 + 本分钟
 * 未 fire 过"→ fire 并推进游标。tick 间隔不要求精确；错过整个匹配分钟
 * （进程停机跨过）不补触发（记档——补触发需要 next-fire 扫描，当前诉求
 * 只有"准点跑一次"）。
 */

import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { JobRegistry } from "../kernel/jobs.js";

/** 星期闭集（codex·ScheduledTaskWeekday 同款）→ cron 数字（0=周日）。 */
export const CRON_WEEKDAY_ALIASES = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 } as const;
export type CronWeekday = keyof typeof CRON_WEEKDAY_ALIASES;

export class InvalidCronExpressionError extends Error {
    readonly code = "CRON_EXPRESSION_INVALID";
    constructor(readonly expr: string, reason: string) {
        super(`cron 表达式不合法：${expr}（${reason}）`);
        this.name = "InvalidCronExpressionError";
    }
}

/** 解析产物：各字段命中位图（闭集形状——matchesCron 只读它）。 */
export interface CronExpression {
    readonly minute: readonly boolean[]; // [60]
    readonly hour: readonly boolean[]; // [24]
    readonly dayOfMonth: readonly boolean[]; // [32]，index 0 弃用（日期从 1 起）
    readonly month: readonly boolean[]; // [13]，index 0 弃用（月份从 1 起）
    readonly dayOfWeek: readonly boolean[]; // [8]，0=周日；数字 7 归一为 0
    readonly domRestricted: boolean; // dom 是否写明了具体值（vixie OR 判据）
    readonly dowRestricted: boolean;
}

/**
 * 单字段解析：星号、星号斜杠数字（步进）、值列表（值=数字或别名）三形态；区间不收。
 * restricted = 写明了具体约束（值/列表/步进）——纯星号不算（vixie OR 语义的判据）。
 */
function parseField(
    field: string,
    min: number,
    max: number,
    aliases: Readonly<Record<string, number>> = {},
): { bits: boolean[]; restricted: boolean } {
    const bits = new Array<boolean>(max + 1).fill(false);
    let restricted = false;
    const aliasNames = Object.keys(aliases);
    const aliasHint = aliasNames.length > 0 ? ` 或 ${aliasNames.join("/")}` : "";
    const setValue = (token: string): number => {
        const value = aliases[token] ?? Number(token);
        if (!Number.isInteger(value) || value < min || value > max) {
            throw new InvalidCronExpressionError(token, `值越界（允许 ${min}-${max}${aliasHint}）`);
        }
        return value;
    };
    for (const part of field.split(",")) {
        if (part === "*") continue; // 纯星号：全命中但不构成 restricted
        restricted = true;
        if (part.startsWith("*/")) {
            const step = Number(part.slice(2));
            if (!Number.isInteger(step) || step < 1) {
                throw new InvalidCronExpressionError(part, "步进必须 ≥ 1");
            }
            for (let i = min; i <= max; i += step) bits[i] = true;
            continue;
        }
        bits[setValue(part)] = true;
    }
    if (!restricted) for (let i = min; i <= max; i++) bits[i] = true;
    return { bits, restricted };
}

export function parseCron(expr: string): CronExpression {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) {
        throw new InvalidCronExpressionError(expr, "必须恰好 5 个字段（分 时 日 月 星期）");
    }
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
        string,
        string,
        string,
        string,
        string,
    ];
    const minuteBits = parseField(minute, 0, 59);
    const hourBits = parseField(hour, 0, 23);
    const domBits = parseField(dayOfMonth, 1, 31);
    const monthBits = parseField(month, 1, 12);
    const dowBits = parseField(dayOfWeek, 0, 7, CRON_WEEKDAY_ALIASES);
    if (dowBits.bits[7]) {
        // 标准 cron 语义：7 与 0 都是周日
        dowBits.bits[7] = false;
        dowBits.bits[0] = true;
    }
    return {
        minute: minuteBits.bits,
        hour: hourBits.bits,
        dayOfMonth: domBits.bits,
        month: monthBits.bits,
        dayOfWeek: dowBits.bits,
        domRestricted: domBits.restricted,
        dowRestricted: dowBits.restricted,
    };
}

/** 是否命中 at（本地时间）这一分钟——vixie 语义：dom/dow 都受限取 OR。 */
export function matchesCron(cron: CronExpression, at: Date): boolean {
    if (!cron.month[at.getMonth() + 1]) return false;
    if (!cron.hour[at.getHours()] || !cron.minute[at.getMinutes()]) return false;
    const domOk = cron.dayOfMonth[at.getDate()] === true;
    const dowOk = cron.dayOfWeek[at.getDay()] === true;
    if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
    if (cron.domRestricted) return domOk;
    if (cron.dowRestricted) return dowOk;
    return true;
}

// ---------------------------------------------------------------------------
// 持久存储（sqlite 运维账本第三张——v5 迁移建表，SCHEMA_V5_CRON_DDL）
// ---------------------------------------------------------------------------

export interface CronTaskRecord {
    readonly id: string;
    readonly expr: string;
    readonly prompt: string;
    readonly createdAt: number;
    /** 上次触发分钟的起始毫秒（游标——防同分钟重复；null = 从未触发）。 */
    readonly lastFiredAt: number | null;
}

/** 调度器的消费面（SqliteCronStore 实现；测试可内存 fake）。 */
export interface CronStoreReader {
    list(): CronTaskRecord[];
    markFired(id: string, firedAt: number): void;
}

export class SqliteCronStore implements CronStoreReader {
    private readonly insert: Database.Statement;
    private readonly deleteById: Database.Statement;
    private readonly selectAll: Database.Statement;
    private readonly updateFired: Database.Statement;

    /** db 必须已过迁移链（SqliteEventStorage.open——v5 已建表）。 */
    constructor(private readonly db: Database.Database) {
        this.insert = db.prepare(
            "INSERT INTO cron_tasks (id, expr, prompt, created_at, last_fired_at) VALUES (?, ?, ?, ?, NULL)",
        );
        this.deleteById = db.prepare("DELETE FROM cron_tasks WHERE id = ?");
        this.selectAll = db.prepare(
            "SELECT id, expr, prompt, created_at, last_fired_at FROM cron_tasks ORDER BY created_at ASC",
        );
        this.updateFired = db.prepare("UPDATE cron_tasks SET last_fired_at = ? WHERE id = ?");
    }

    /** 入库前校验表达式（坏表达式进不了库——tick 的轮询面无需容错分支）。 */
    add(input: { expr: string; prompt: string; createdAt: number }): CronTaskRecord {
        parseCron(input.expr);
        const record: CronTaskRecord = {
            id: randomUUID(),
            expr: input.expr,
            prompt: input.prompt,
            createdAt: input.createdAt,
            lastFiredAt: null,
        };
        this.insert.run(record.id, record.expr, record.prompt, record.createdAt);
        return record;
    }

    remove(id: string): boolean {
        return this.deleteById.run(id).changes > 0;
    }

    list(): CronTaskRecord[] {
        return (this.selectAll.all() as Array<{
            id: string;
            expr: string;
            prompt: string;
            created_at: number;
            last_fired_at: number | null;
        }>).map((row) => ({
            id: row.id,
            expr: row.expr,
            prompt: row.prompt,
            createdAt: row.created_at,
            lastFiredAt: row.last_fired_at,
        }));
    }

    markFired(id: string, firedAt: number): void {
        this.updateFired.run(firedAt, id);
    }
}

// ---------------------------------------------------------------------------
// 被动轮询调度器（到期 → job 派发，M1/M2 底座复用）
// ---------------------------------------------------------------------------

export interface CronFiring {
    readonly task: CronTaskRecord;
    /** jobs 提供时的派发产物（prompt 在 job 的 log ring——消费方 read 取用）。 */
    readonly jobId?: string;
}

export interface CronSchedulerOptions {
    store: CronStoreReader;
    /** 提供时每个到期任务派发一个 cron job（kind="cron"）；缺省只推进游标。 */
    jobs?: Pick<JobRegistry, "start">;
    now?: () => number;
    /** 手工改库等来源的坏表达式行（add 已挡住正常来源）——缺省静默跳过。 */
    onParseError?: (task: CronTaskRecord, error: InvalidCronExpressionError) => void;
}

export class CronScheduler {
    private readonly now: () => number;

    constructor(private readonly options: CronSchedulerOptions) {
        this.now = options.now ?? (() => Date.now());
    }

    /**
     * 到期检查（每 tick 调一次——host server 面消费）：返回本 tick 触发的
     * 任务。游标在 fire 前推进（同分钟重入幂等）；jobs.start 同步返回 id。
     */
    tick(): CronFiring[] {
        const nowMs = this.now();
        const at = new Date(nowMs);
        const minuteStart = Math.floor(nowMs / 60_000) * 60_000;
        const firings: CronFiring[] = [];
        for (const task of this.options.store.list()) {
            let cron: CronExpression;
            try {
                cron = parseCron(task.expr);
            } catch (error) {
                this.options.onParseError?.(
                    task,
                    error instanceof InvalidCronExpressionError
                        ? error
                        : new InvalidCronExpressionError(task.expr, String(error)),
                );
                continue;
            }
            if (!matchesCron(cron, at)) continue;
            if (task.lastFiredAt !== null && task.lastFiredAt >= minuteStart) continue;
            this.options.store.markFired(task.id, minuteStart);
            const settled: CronTaskRecord = { ...task, lastFiredAt: minuteStart };
            const jobId = this.options.jobs?.start({
                kind: "cron",
                run: async (ctx) => {
                    ctx.emit("log", settled.prompt);
                },
            });
            firings.push({ task: settled, ...(jobId !== undefined ? { jobId } : {}) });
        }
        return firings;
    }
}
