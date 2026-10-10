/**
 * 定时任务契约（T2-5 / EP-7，纯类型不接线——W16/T7-4 落模型面工具
 * schedule_create/list/update/delete over SqliteCronStore + 投递语义升级）。
 */

/** 任务规格（创建/更新的载荷——cron 引擎留 src/scheduler/，本契约只声明面）。 */
export interface ScheduleSpec {
  /** cron 表达式（入站相对时间（"8分钟后"）由工具层归一化为绝对 cron，zcode 同款）。 */
  expr: string;
  /** 触发时投递的提示词。 */
  prompt: string;
  /** 目标会话（不存在 → 冷会话恢复 + 只补最近一次，T7-4 投递语义）。 */
  targetSessionId: string;
  /** 人读标签（list 面展示）。 */
  label?: string;
}

/** 任务条目（list 面投影——含运行态事实）。 */
export interface ScheduleEntry extends ScheduleSpec {
  id: string;
  /** 最近一次触发（epoch ms；未触发过 undefined）。 */
  lastRunAt?: number;
  /** 下次触发（epoch ms）。 */
  nextRunAt?: number;
}

/** 调度 API（EP-7 注册面——宿主实现，工具壳走模型面）。 */
export interface ScheduleApi {
  create(spec: ScheduleSpec): Promise<ScheduleEntry>;
  list(): Promise<ScheduleEntry[]>;
  update(id: string, patch: Partial<Omit<ScheduleSpec, "targetSessionId">>): Promise<ScheduleEntry>;
  delete(id: string): Promise<void>;
}
