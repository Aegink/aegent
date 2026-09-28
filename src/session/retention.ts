/**
 * 保留策略常量（Q6，T-P2-101）——审计记录 90 天 / 任务运行记录 100 条。
 *
 * 数值锚点：pi-desktop·crates/host-core/src/db/migrations.rs:3-4
 * （`AUDIT_RETENTION_MS: i64 = 90 * 24 * 3600 * 1000` 与
 * `TASK_RUNS_KEEP: i64 = 100`——其 boot_maintenance 用这两个常量删
 * 过期审计、按 task 分区留最新 N 条运行记录）。🔴 只学数
 * 值与"常量集中单一来源"的行为，不摘其 SQL 与 Rust 框架。
 *
 * 单一来源纪律（验收原文"常量集中可查"）：消费方（Q4 cleanup）只从本模块
 * 取数值——清理动作里不得再出现裸 90 / 100。策略常量是**声明**，
 * 清理是**动作**：动作可以因参数覆盖（resolveRetentionPolicy）改变，
 * 但缺省值只有这一处。
 *
 * 本模块零依赖零 IO（纯常量 + 纯函数）：清理器 import 它，它不 import
 * 任何存储/内核面——方向单向（Q4 卡消费，不反向依赖）。
 */

/** 一天的毫秒数（cutoff 计算唯一来源，避免数值散落在两个文件）。 */
export const MS_PER_DAY = 24 * 3600 * 1000;

/** 保留策略声明（两条数值 = Q6 的全部内容）。 */
export interface RetentionPolicy {
  /** 审计记录保留天数：ts 早于 now - auditDays 天的审计记录可清理。 */
  readonly auditDays: number;
  /** 每条任务（task）保留的最新运行记录条数：更旧的运行记录可清理。 */
  readonly taskRunRecords: number;
}

/**
 * 缺省保留策略（冻结——消费方不得就地改写，覆盖走 resolveRetentionPolicy
 * 的显式参数面）。数值取 pi-desktop 同值：90 天 / 100 条。
 */
export const RETENTION_POLICY: RetentionPolicy = Object.freeze({
  auditDays: 90,
  taskRunRecords: 100,
});

/** 清理判据（retentionCutoff 的产物；Q4 消费面）。 */
export interface RetentionCutoff {
  /** 审计记录的保留下界（epoch 毫秒）：ts < auditBefore 的记录可清理。 */
  readonly auditBefore: number;
  /** 每条任务保留的最新运行记录条数（超出部分可清理）。 */
  readonly keepLatestTaskRuns: number;
}

function assertPolicyValue(field: keyof RetentionPolicy, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(
      `保留策略 ${String(field)} 须为非负整数（收到 ${String(value)}）——坏策略拒绝执行而不是按 0 清理`,
    );
  }
}

/** 以缺省策略为底合并显式覆盖（部分覆盖面；每次全字段校验，fail-closed）。 */
export function resolveRetentionPolicy(overrides?: Partial<RetentionPolicy>): RetentionPolicy {
  const merged: RetentionPolicy = {
    auditDays: overrides?.auditDays ?? RETENTION_POLICY.auditDays,
    taskRunRecords: overrides?.taskRunRecords ?? RETENTION_POLICY.taskRunRecords,
  };
  assertPolicyValue("auditDays", merged.auditDays);
  assertPolicyValue("taskRunRecords", merged.taskRunRecords);
  return merged;
}

/**
 * 计算清理判据（纯函数，时钟由调用方给——清理是显式动作，不在库内
 * 藏隐式 Date.now）。缺省策略 = RETENTION_POLICY。
 */
export function retentionCutoff(
  now: number,
  policy: RetentionPolicy = RETENTION_POLICY,
): RetentionCutoff {
  assertPolicyValue("auditDays", policy.auditDays);
  assertPolicyValue("taskRunRecords", policy.taskRunRecords);
  return {
    auditBefore: now - policy.auditDays * MS_PER_DAY,
    keepLatestTaskRuns: policy.taskRunRecords,
  };
}
