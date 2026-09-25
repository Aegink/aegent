/**
 * 权限链（C58/C20/Q15）——权限权威是链本身，规则集只是链中一环。
 *
 * 形状取 kimi·permissionPolicyService.ts：策略模块按固定顺序排成数组，
 * 逐个求值，首个给出结果（非 undefined）者胜；顺序集中在一处可审（C20）。
 * 与 kernel/chain.ts 的洋葱链是两个结构：洋葱链管"干预时机"（toolCall/
 * modelRequest/turnEnd 三点位），本文件管"谁有裁决权"——T-5-12 的 gate
 * 把本链挂进 toolCall 点位，C9 的"求值在工具执行前"由链形保证。
 *
 * 层序（C58，Q15）：托管 > 用户 > 项目 > 核心。唯一权威定义处是
 * POLICY_LAYERS 常量，任何装配都经它展开，禁止在别处手写层顺序。
 * 规则匹配只产出证据不是终审：命中哪条规则只是"证据"，权威性由规则
 * 所在的链位置决定——同一条规则放托管层与核心层结果不同（chain.test①）。
 *
 * 失败纪律：策略模块求值抛错原样上抛，绝不当作弃权跳过——权限链
 * fail-open（崩一个模块就全放行）是不可接受的，宁可让调用方拿到错误。
 */

import type { JsonRecord } from "../kernel/events.js";
import { abstainVerdict, verdictFromOutcome, type Verdict } from "./decision.js";

// ---------------------------------------------------------------------------
// 层序（C58 的唯一权威定义处）
// ---------------------------------------------------------------------------

/** 层序：托管 > 用户 > 项目 > 核心（C58/Q15）。 */
export const POLICY_LAYERS = ["managed", "user", "project", "core"] as const;

export type PolicyLayer = (typeof POLICY_LAYERS)[number];

// ---------------------------------------------------------------------------
// 调用 / 裁决 / 模块
// ---------------------------------------------------------------------------

/** 一次策略求值的输入。最小面起步，后续卡按需扩展（sessionId、来源等）。 */
export interface PolicyCall {
  readonly tool: string;
  readonly args: JsonRecord;
}

/** 规则动作三维（C1）。四值决策（C32 的 abstain）随 T-5-03 在链级扩展。 */
export type PolicyAction = "allow" | "ask" | "deny";

/** 模块裁决。C18 的 rule/reason 证据由模块可选附带（规则集命中时附 rule）。 */
export interface PolicyOutcome {
  readonly action: PolicyAction;
  /** 规则原文证据（C18）；非规则来源的模块裁决缺席。 */
  readonly rule?: string;
  /** 模块自述理由（C18）；缺席时由链以模块名合成。 */
  readonly reason?: string;
}

export interface PolicyModule {
  readonly name: string;
  /** undefined = 本模块弃权，交下一模块（"首个非 undefined 者胜"）。 */
  evaluate(call: PolicyCall): Promise<PolicyOutcome | undefined>;
}

export interface PolicyChain {
  /** 装配后的实际模块顺序（审计面：托管层在前，核心层在后）。 */
  readonly modules: readonly PolicyModule[];
  /**
   * 求值一次：首个应答模块的裁决经 C18 证据合成后返回；全链无人应答
   * 返回 abstain（C32——"没意见"是显式出口，不是 ask，也不是 undefined）。
   */
  evaluate(call: PolicyCall): Promise<Verdict>;
}

/**
 * 组装权限链。各层模块按 POLICY_LAYERS 顺序展平成一条求值序列；
 * 求值逐模块走，首个非 undefined 结果即终审，无人应答则整链弃权。
 */
export function assemblePolicyChain(
  layers: Partial<Record<PolicyLayer, readonly PolicyModule[]>>,
): PolicyChain {
  const modules = Object.freeze(
    POLICY_LAYERS.flatMap((layer) => [...(layers[layer] ?? [])]),
  );
  return {
    modules,
    async evaluate(call: PolicyCall): Promise<Verdict> {
      for (const module of modules) {
        const outcome = await module.evaluate(call);
        if (outcome !== undefined) {
          return verdictFromOutcome(module.name, outcome);
        }
      }
      return abstainVerdict();
    },
  };
}
