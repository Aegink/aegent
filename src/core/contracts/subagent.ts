/**
 * 子代理端口契约（T2-6 自 src/kernel/subagent.ts 下沉类型面——EP-4 子会话
 * 注册/发现与 W9 resume 的词汇源；实现面（createSubagentRunner/
 * SubagentRunnerDeps 装配参数）留 kernel/subagent.ts，T4-3 随 ext-builtin
 * 外置，消费面经本契约）。
 */

/** 委托状态闭集（task_list/wait 的数据面词汇，冻结只追加）。 */
export type DelegationStatus = "running" | "completed" | "failed" | "cancelled" | "stopped";

export type SubagentStopReason = "completed" | "failed" | "cancelled";

export interface SubagentRunResult {
  /** 子会话 id（父会话可见的 lineage——经 tool result meta 回喂）。 */
  readonly sessionId: string;
  readonly stopReason: SubagentStopReason;
  /** 子代理最终 assistant 文本（成功时即产出；失败时可能是残段或空）。 */
  readonly output: string;
  /** 失败/取消时的可读详情（isError 回喂模型可自修）。 */
  readonly error?: string;
}

/** 后台启动回执（task 工具 run_in_background 的返回形状）。 */
export interface SubagentBackgroundStart {
  readonly kind: "background";
  readonly delegationId: string;
  readonly childSessionId: string;
}

/** runSubagent 的返回：前台 = 完整结算（既有语义）；后台 = 启动收执。 */
export type SubagentRunOutcome = { kind: "foreground"; result: SubagentRunResult } | SubagentBackgroundStart;

/** 委托快照（task_list / task_wait 的数据面）。 */
export interface DelegationSnapshot {
  readonly id: string;
  readonly childSessionId: string;
  /** 子代理预设名（通用子代理 = "general"）。 */
  readonly agentName: string;
  readonly description: string;
  readonly status: DelegationStatus;
  readonly startedAt: number;
  readonly settledAt?: number;
  /** 最终报告（结算后；12K 头尾截断）。 */
  readonly report?: string;
  readonly error?: string;
}

/** 注册表面（task_wait/task_list/task_stop 与主 loop 收敛钩子共用）。 */
export interface DelegationsApi {
  list(): DelegationSnapshot[];
  hasRunning(): boolean;
  /**
   * 等待收敛（task_wait 执行体）：ids 缺省 = 全部在途；mode "any" = 任一
   * 终态即返 / "all"（缺省）= 目标全部终态；min_completed 为 any 的加强
   * 条件；timeoutMs 兜底（超时返回当前快照——不杀委托）。
   */
  wait(opts?: {
    ids?: readonly string[];
    mode?: "any" | "all";
    minCompleted?: number;
    timeoutMs?: number;
  }): Promise<DelegationSnapshot[]>;
  /** 停止指定委托（cancel 子 loop → 结算 stopped）；未知 id 返回 false。 */
  stop(id: string): boolean;
}

/**
 * 子代理 runner 端口（createSubagentRunner 产物的契约形状——session 域的
 * SubagentBackend 包装面经此依赖，不 import 实现域）。
 */
export interface SubagentRunner {
  run(
    prompt: string,
    description: string,
    opts?: {
      signal?: AbortSignal;
      backend?: string;
      subagentType?: string;
      background?: boolean;
    },
  ): Promise<SubagentRunOutcome>;
  delegations: DelegationsApi;
}
