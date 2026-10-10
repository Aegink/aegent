/**
 * 工具调度器（T3-7 / W6，zcode 形状——最优评估 §7）：拓扑排序 → 并行分组
 * → 环检测，纯元数据判定 + 并发上限 + generator 逐组产出批次边界。
 *
 * 纪律：
 * - **调度器不认识工具名，只读声明**（canRunInParallel 五级判定链）；
 * - **destructive 永不并行**（fail-closed）；成环 fail-closed 拒绝；
 * - **结果保模型序**（dsh 正确性要求："results and result context remain
 *   model-ordered"——执行可交错完成，回填按 call 输入序）；
 * - abort 停止补员、已启动调用排空（与 loop 迟到闸门/合成结算协同）。
 */

import type { ToolExecutionResult } from "../../index.js";

export const DEFAULT_MAX_CONCURRENCY = 10;

/** 可调度调用（loop 的 dispatch 序列投影；dependsOn 可选——内置工具无依赖）。 */
export interface SchedulableCall {
  callId: string;
  toolName: string;
  arguments: string;
  /** 显式依赖（拓扑边——callId 引用；缺省无依赖）。 */
  dependsOn?: readonly string[];
}

/** 调度判定的元数据快照（registry.metadataOf / 旧 parallel 声明合并后的视图）。 */
export interface SchedulableMeta {
  destructive?: boolean;
  concurrentSafe?: boolean;
  readOnly?: boolean;
  sideEffectScope?: "none" | "workspace" | "system";
  /** B17 旧调度声明（ToolDef.parallel——映射为 concurrentSafe 的别名输入）。 */
  parallel?: boolean;
}

export interface ParallelGroup {
  readonly batchIndex: number;
  readonly calls: readonly SchedulableCall[];
}

export interface ScheduleResult {
  /** 拓扑序的全部调用（执行顺序）。 */
  readonly items: readonly SchedulableCall[];
  /** 可并行分组（组间串行、组内并发上限内；观测面用）。 */
  readonly parallelGroups: readonly ParallelGroup[];
  /** 顺序执行（不可并行）的调用子序（观测面用）。 */
  readonly sequentialCalls: readonly SchedulableCall[];
  readonly executionOrder: readonly string[];
  /**
   * **有序执行计划**（T3-7 修正：拓扑序内顺序项与并行组穿插——执行严格按
   * 本计划走；"全部并行组先行"会破坏拓扑相对顺序）。
   */
  readonly plan: readonly ({ kind: "single"; call: SchedulableCall } | { kind: "parallel"; batch: ParallelGroup })[];
}

/** 调度环（fail-closed——成环即拒绝执行，不猜测打破边）。 */
export class ScheduleCycleError extends Error {
  constructor(readonly cycle: readonly string[]) {
    super(`工具调度依赖成环：${cycle.join(" -> ")}`);
    this.name = "ScheduleCycleError";
  }
}

/**
 * 并行判定链（zcode canRunInParallel 同构，五级）：destructive → false；
 * concurrentSafe 显式 true/false 优先；旧 parallel 声明（B17）照真值采纳；
 * readOnly → true；sideEffectScope === "none" → true；**无任何声明 → false**
 * （未声明即不可并行，fail-closed——与 gate 同一从严纪律）。
 */
export function canRunInParallel(meta: SchedulableMeta | undefined): boolean {
  if (meta === undefined) return false;
  if (meta.destructive === true) return false;
  if (meta.concurrentSafe !== undefined) return meta.concurrentSafe;
  if (meta.parallel !== undefined) return meta.parallel;
  if (meta.readOnly === true) return true;
  return meta.sideEffectScope === "none";
}

/** 拓扑排序（Kahn）：返回拓扑序；步骤中入度无法归零的剩余节点即成环。 */
function topologicalSort(calls: readonly SchedulableCall[]): SchedulableCall[] {
  const byId = new Map(calls.map((c) => [c.callId, c]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const c of calls) {
    indegree.set(c.callId, indegree.get(c.callId) ?? 0);
    for (const dep of c.dependsOn ?? []) {
      if (!byId.has(dep)) continue; // 依赖不在本批（前置 step 的结果）= 无边
      indegree.set(c.callId, (indegree.get(c.callId) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), c.callId]);
    }
  }
  const order: SchedulableCall[] = [];
  const ready = calls.filter((c) => (indegree.get(c.callId) ?? 0) === 0).map((c) => c.callId);
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(byId.get(id)!);
    for (const next of dependents.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }
  if (order.length < calls.length) {
    // 成环：从剩余节点回溯出一个具体环（fail-closed 报告用）
    const remaining = calls.filter((c) => !order.some((o) => o.callId === c.callId));
    const cycle: string[] = [remaining[0]!.callId];
    let cur = remaining[0]!;
    while (true) {
      const dep = (cur.dependsOn ?? []).find((d) => remaining.some((r) => r.callId === d));
      if (dep === undefined || cycle.includes(dep)) {
        if (dep !== undefined && !cycle.includes(dep)) cycle.push(dep);
        break;
      }
      cycle.push(dep);
      cur = byId.get(dep)!;
    }
    throw new ScheduleCycleError(cycle);
  }
  return order;
}

/**
 * 调度（zcode schedule 三步同构）：拓扑排序 → 并行分组 → 环检测。
 * 组内 = 判定可并行的连续段（保持拓扑序内的相对顺序）；组间串行。
 */
export function schedule(
  calls: readonly SchedulableCall[],
  metaOf: (toolName: string) => SchedulableMeta | undefined,
): ScheduleResult {
  const sorted = topologicalSort(calls);
  const parallelGroups: ParallelGroup[] = [];
  const sequentialCalls: SchedulableCall[] = [];
  const plan: ({ kind: "single"; call: SchedulableCall } | { kind: "parallel"; batch: ParallelGroup })[] = [];
  let batchIndex = 0;
  let currentGroup: SchedulableCall[] = [];
  const flushGroup = () => {
    if (currentGroup.length > 0) {
      const batch: ParallelGroup = { batchIndex: batchIndex++, calls: currentGroup };
      parallelGroups.push(batch);
      plan.push({ kind: "parallel", batch });
      currentGroup = [];
    }
  };
  for (const call of sorted) {
    if (canRunInParallel(metaOf(call.toolName))) {
      currentGroup.push(call);
    } else {
      flushGroup();
      sequentialCalls.push(call);
      plan.push({ kind: "single", call });
    }
  }
  flushGroup();
  return {
    items: sorted,
    parallelGroups,
    sequentialCalls,
    executionOrder: sorted.map((c) => c.callId),
    plan,
  };
}

/** 单调用执行面（loop 注入——含 tool/call 落流与 dispatchTool 全链）。 */
export type RunOne = (call: SchedulableCall) => Promise<ToolExecutionResult>;

/** 批次边界观察面（loop 落 tool/batch_* 事件——可观测；缺省 no-op）。 */
export interface BatchObserver {
  onBatchStart?(batch: ParallelGroup): void;
  onBatchComplete?(batch: ParallelGroup, results: readonly ToolExecutionResult[]): void;
}

export interface ExecuteScheduleOptions {
  /** 并发上限（缺省 10——zcode DEFAULT_MAX_CONCURRENCY 同值）。 */
  maxConcurrency?: number;
  runOne: RunOne;
  observer?: BatchObserver;
}

/**
 * 执行侧 generator（zcode batch-runner 同构）：按调度结果逐组产出——
 * 顺序调用逐个执行；并行组内并发（上限裁剪）、组间 barrier。
 * **结果保模型序**：返回数组按**输入 calls 序**回填（dsh 不变量），
 * 执行完成序与回填序解耦。
 */
export async function executeSchedule(
  calls: readonly SchedulableCall[],
  metaOf: (toolName: string) => SchedulableMeta | undefined,
  options: ExecuteScheduleOptions,
): Promise<ToolExecutionResult[]> {
  const plan = schedule(calls, metaOf);
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const byCallId = new Map<string, ToolExecutionResult>();

  for (const step of plan.plan) {
    if (step.kind === "single") {
      byCallId.set(step.call.callId, await options.runOne(step.call));
      continue;
    }
    const group = step.batch;
    options.observer?.onBatchStart?.(group);
    const results = new Map<string, ToolExecutionResult>();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(maxConcurrency, group.calls.length) }, async () => {
      while (cursor < group.calls.length) {
        const call = group.calls[cursor++]!;
        results.set(call.callId, await options.runOne(call));
      }
    });
    await Promise.all(workers);
    options.observer?.onBatchComplete?.(group, group.calls.map((c) => results.get(c.callId)!));
    for (const r of results) byCallId.set(r[0], r[1]);
  }
  // 保模型序回填：缺结果（abort 未结算——loop 合成结算兜底）给空 isError 占位
  return calls.map(
    (c) =>
      byCallId.get(c.callId) ?? {
        content: "",
        isError: true,
        error: { name: "SchedulerError", code: "TOOL_ABORTED" },
      },
  );
}
