/**
 * 执行点重算（C57）——限制性判定在执行点用权威标识重算，不信任捎带。
 *
 * 纪律取 zcode·turn-loop.ts 的修 bug 注释："provider 请求边界必须按
 * queryId 再硬过滤"——入口/消息里携带的判定元数据可能缺失、过期或被
 * 伪造，执行边界只认**当前会话权威标识**（sessionId + 调用来源）下的
 * 权威重算结果。
 *
 * 本文件两件事：
 *   - stripDecisionMarkers：把模型工具调用参数里捎带的"已批准"类字段
 *     剥除（closed list 是已知局限——结构保证是重算器从不读它们；
 *     剥除让伪造痕迹可观测，且执行收到的参数干净）；
 *   - createRevalidator：剥标记 → 用 sessionId/source 权威重跑策略链 →
 *     链裁决后再过 C46 出口级硬拦（T-P1-01）→ 只有 allow 放行。
 *     ask/deny/abstain 一律拦——执行点是最后一道闸，
 *     fail closed（C51 同款）；ask 的问人流程在 T-5-12 gate 更上游，
 *     批准经批准历史/会话缓存使重算收敛为 allow 后才可能放行。
 *
 * registry（T-4-05 产物）的 dispatch 在执行前调用本守卫——拒绝即返回
 * isError 结果，不执行、不产生工具输出（与权限层截断语义一致）。
 */

import type { JsonRecord } from "../kernel/events.js";
import type { PolicyChain } from "./chain.js";
import type { Verdict } from "./decision.js";
import { enforceProtectedPaths } from "./protected-paths.js";

/** 决策标记保留键（大小写不敏感剥除；闭集局限同 review-decision.ts）。 */
const DECISION_MARKER_KEYS: ReadonlySet<string> = new Set([
  "approved",
  "preapproved",
  "approvedby",
  "approvedfor",
  "verdict",
  "decision",
  "permissiondecision",
]);

export interface StripMarkersResult {
  readonly args: JsonRecord;
  readonly strippedKeys: readonly string[];
}

/** 剥除参数里捎带的"已批准"类决策标记（只扫顶层键，不深挖值）。 */
export function stripDecisionMarkers(args: JsonRecord): StripMarkersResult {
  const strippedKeys: string[] = [];
  const cleaned: JsonRecord = {};
  let touched = false;
  for (const [key, value] of Object.entries(args)) {
    if (DECISION_MARKER_KEYS.has(key.toLowerCase())) {
      strippedKeys.push(key);
      touched = true;
      continue;
    }
    cleaned[key] = value;
  }
  return touched ? { args: cleaned, strippedKeys } : { args, strippedKeys };
}

export interface RevalidateOutcome {
  /** 仅当权威重算为 allow 才 true。 */
  readonly allowed: boolean;
  /** 权威重算裁决（ask/deny/abstain 也带出，供拦截说明引用）。 */
  readonly verdict: Verdict;
  readonly strippedKeys: readonly string[];
  /** 剥除后的参数——放行时执行用这份，不带标记。 */
  readonly args: JsonRecord;
}

export interface Revalidator {
  (tool: string, args: JsonRecord): Promise<RevalidateOutcome>;
}

/**
 * 构造执行点重算器：绑定当前会话权威标识（sessionId + source），每次
 * 调用对参数剥标记后重跑策略链。标识在装配期取**当前值**——事件流或
 * 消息里捎带的旧标识一概不进这里。
 */
export function createRevalidator(options: {
  readonly chain: PolicyChain;
  readonly sessionId: string;
  readonly source: string;
}): Revalidator {
  const { chain, sessionId, source } = options;
  return async (tool, args) => {
    const { args: clean, strippedKeys } = stripDecisionMarkers(args);
    const call = { tool, args: clean, sessionId, source };
    let verdict = await chain.evaluate(call);
    // C46 出口级硬拦与 gate 同位：执行点是最后一道闸，硬拦不依赖装配
    // 方是否记得用 withProtectedPaths 包链（T-P1-01）。
    verdict = enforceProtectedPaths(verdict, call);
    return {
      allowed: verdict.action === "allow",
      verdict,
      strippedKeys,
      args: clean,
    };
  };
}
