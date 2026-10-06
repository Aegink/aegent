/**
 * 调度域装配（C1 补口——核对发现 cron/JobRegistry 库面零生产装配，定时任务
 * 产品形态不可达）：把 P2 落地的 SqliteCronStore + CronScheduler + JobRegistry
 * 真实装配进 host 进程——每分钟 tick 检查到期任务，触发时把任务 prompt 以
 * host 内部调度通道投递主会话执行（事件照常落流，可回退可审计）。
 *
 * 授权语义：定时任务是用户在任务定义时（cron-add）预先授权的 host-owned
 * 自动化——bridge.sendSystemPrompt 不经租约（租约 N7 管的是"多个实时端之间
 * 谁在驱动"，host 自身调度不在其上；pi-desktop ADR 0041 host-owned runtime
 * 同构）。投递走与用户 prompt 完全相同的执行链：权限/审批/预算照常生效。
 *
 * op 面（cron-list/cron-add/cron-remove）：管理闭集经 DOMAIN_OPS 校验、
 * 表达式在入库前经 parseCron 校验（坏表达式进不了库——CronStore.add 语义）。
 * off-peak/webhook 的装配缺口单独记档（无任务来源/待路由挂载——见核对文档
 * C 级清单），本文件不假装已装。
 */

import { CronScheduler, SqliteCronStore, type CronFiring } from "../scheduler/cron.js";
import { JobRegistry } from "../kernel/jobs.js";
import type Database from "better-sqlite3";
import { channelLogger } from "./logging-ops.js";

/** 一个已装配的调度运行时（host 进程级单例；无库 = 不装配）。 */
export interface SchedulerRuntime {
  store: SqliteCronStore;
  scheduler: CronScheduler;
  jobs: JobRegistry;
  /** 手动驱动一次到期检查（生产 = setInterval 节拍；测试直接调）。 */
  tickOnce(): CronFiring[];
  /** 最近一次 tick 的触发清单（观测面）。 */
  readonly lastTickFired: () => CronFiring[];
  /** 停止 tick 定时器（host stop 收束）。 */
  stop(): void;
}

export interface SchedulerRuntimeOptions {
  /** host 面事件库（sessionsLibrary.db——cron_tasks 表由 v5 迁移建好）。 */
  db: Database.Database;
  /** 投递目标会话（主会话 id）。 */
  sessionId: string;
  /** host 内部调度通道（bridge.sendSystemPrompt——绕租约的投递面）。 */
  sendPrompt: (sessionId: string, prompt: string) => Promise<unknown>;
  now?: () => number;
  /** tick 间隔毫秒（缺省 60s——cron 分钟粒度的轮询节拍）。 */
  tickIntervalMs?: number;
  /** 测试注入：立即触发一次 tick 后 resolve（生产不传——由 setInterval 驱动）。 */
  onTick?: (fired: CronFiring[]) => void;
}

export function createSchedulerRuntime(options: SchedulerRuntimeOptions): SchedulerRuntime {
  const store = new SqliteCronStore(options.db);
  const jobs = new JobRegistry({ epoch: "host" });
  // jobs 不传给 CronScheduler（它的可选 job 派发只 emit prompt 到 ring）——
  // 触发审计与投递统一在本包装层（tickOnce）负责，单一职责不双记账。
  const scheduler = new CronScheduler({ store, ...(options.now !== undefined ? { now: options.now } : {}) });
  let lastFired: CronFiring[] = [];
  const tickOnce = (): CronFiring[] => {
    const firings = scheduler.tick();
    lastFired = firings;
    for (const firing of firings) {
      // M1 语义：job 承载触发审计（ring 记 prompt 与投递结果）；真实执行 =
      // 投递主会话（完整对话链）。投递失败不炸 tick（下个 tick 不重试——
      // lastFiredAt 游标已推进，防重复副作用与 D15 同向）。
      const jobId = jobs.start({
        kind: "cron-dispatch",
        run: async (ctx) => {
          ctx.emit("log", firing.task.prompt);
          try {
            await options.sendPrompt(options.sessionId, firing.task.prompt);
            ctx.emit("log", `[dispatched → ${options.sessionId}]`);
          } catch (e) {
            ctx.emit("stderr", `投递失败：${e instanceof Error ? e.message : String(e)}`);
            throw e;
          }
        },
      });
      channelLogger("host").info(`cron 触发：${firing.task.expr} → job ${jobId}`, { category: "session" });
    }
    options.onTick?.(firings);
    return firings;
  };
  const timer = setInterval(tickOnce, options.tickIntervalMs ?? 60_000);
  // 允许进程自然退出（Node 14+：unref 后 timer 不阻止 event loop 排空）
  timer.unref?.();
  return {
    store,
    scheduler,
    jobs,
    tickOnce,
    lastTickFired: () => lastFired,
    stop: () => clearInterval(timer),
  };
}

// ---------------------------------------------------------------------------
// 模块级运行时句柄（terminal-ops 的 setNotifier 先例——分发链经域文件取）
// ---------------------------------------------------------------------------

let runtime: SchedulerRuntime | undefined;

/** server 装配后注入；stop 时传 undefined 摘除。 */
export function setSchedulerRuntime(next: SchedulerRuntime | undefined): void {
  runtime = next;
}

export function schedulerRuntime(): SchedulerRuntime | undefined {
  return runtime;
}

/** 分发面：cron 族三 op（非本族返回 undefined——bridge 零增量串联）。 */
export function trySchedulerSettingsOp(call: { op: string; expr?: unknown; prompt?: unknown; id?: unknown }): unknown | undefined {
  const rt = runtime;
  if (rt === undefined) {
    // 运行时缺席（无 --host-db）：三类 op 类型化报错而非静默空
    if (call.op === "cron-list" || call.op === "cron-add" || call.op === "cron-remove") {
      throw new Error("调度器未启用（--host-db 缺失）——定时任务不可用");
    }
    return undefined;
  }
  switch (call.op) {
    case "cron-list":
      return { tasks: rt.store.list() };
    case "cron-add": {
      const record = rt.store.add({
        expr: String(call.expr ?? ""),
        prompt: String(call.prompt ?? ""),
        createdAt: Date.now(),
      });
      return { task: record };
    }
    case "cron-remove":
      return { removed: rt.store.remove(String(call.id ?? "")) };
    default:
      return undefined;
  }
}
