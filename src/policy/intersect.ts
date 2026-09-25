/**
 * 多来源权限交集合成（C49）——两个来源的权限上限取交集，绝不变宽松。
 *
 * 语义取 codex·permission_profile_intersection.rs："A policy cannot be
 * intersected without weakening either input"——无法精确交集的形状必须
 * fail closed 报错（PermissionIntersectionError），不许用近似结果悄悄
 * 替代；可交集部分取两侧更严者（其网络档即 AND 语义）。codex 的具体
 * 路径归一/符号链接处理属阶段 6 沙箱面，本卡不涉。
 *
 * 我方 P0 形状：
 *   - 可交集来源 = CeilingProfile：每工具一个 Decision 上限 + 未列出
 *     工具的默认上限（abstain 不是约束值，上限只用三维动作）；交集 =
 *     maxDecision 逐工具合成（复用 T-5-06 全序，单调性保证加来源不变
 *     宽松）。
 *   - 不可交集来源 = OpaqueProfile（外部强管/规则集形态等无法表达为
 *     上限的来源）——相遇即抛错，错误信息含两来源名。
 *
 * P0 实际只有 CLI 单端 + 配置默认在跑，本卡以纯函数 + 测试交付；接线
 * 等多端（N 系）落地。
 */

import { maxDecision } from "./aggregate.js";
import type { Decision, } from "./decision.js";
import type { PolicyAction, PolicyCall } from "./chain.js";
import type { Verdict } from "./decision.js";

// ---------------------------------------------------------------------------
// 来源画像
// ---------------------------------------------------------------------------

/** 可交集来源：每工具权限上限。abstain 不是约束值，上限只用三维动作。 */
export interface CeilingProfile {
  readonly kind: "ceilings";
  readonly source: string;
  /** 工具名（注册表名）→ 该来源允许的最宽动作。 */
  readonly ceilings: Readonly<Record<string, PolicyAction>>;
  /** 未列出工具的上限；缺省 allow（该来源不约束未列出工具）。 */
  readonly defaultCeiling?: PolicyAction;
}

/** 不可交集来源：无法表达为上限的形态（外部强管、规则集等）。 */
export interface OpaqueProfile {
  readonly kind: "opaque";
  readonly source: string;
  /** 为何不可交集（原样进错误信息）。 */
  readonly reason: string;
}

export type PermissionSourceProfile = CeilingProfile | OpaqueProfile;

export class PermissionIntersectionError extends Error {
  constructor(
    readonly sources: readonly [string, string],
    reason: string,
  ) {
    super(
      `权限来源 "${sources[0]}" 与 "${sources[1]}" 无法安全交集（${reason}）——` +
        "交集必然放宽其中一方，拒绝合成（C49 fail-closed）",
    );
  }
}

// ---------------------------------------------------------------------------
// 交集
// ---------------------------------------------------------------------------

function effectiveCeiling(
  profile: CeilingProfile,
  tool: string,
): Decision {
  return profile.ceilings[tool] ?? profile.defaultCeiling ?? "allow";
}

/**
 * 两来源权限交集：逐工具取更严上限（含双方默认上限参与合成）。
 * 任一方为 opaque → 抛 PermissionIntersectionError（含两来源名）。
 * 结果来源名标注两方，可继续与下一来源链式合成。
 */
export function intersectPermissionProfiles(
  a: PermissionSourceProfile,
  b: PermissionSourceProfile,
): CeilingProfile {
  if (a.kind === "opaque") {
    throw new PermissionIntersectionError([a.source, b.source], a.reason);
  }
  if (b.kind === "opaque") {
    throw new PermissionIntersectionError([a.source, b.source], b.reason);
  }
  const tools = new Set([...Object.keys(a.ceilings), ...Object.keys(b.ceilings)]);
  const ceilings: Record<string, PolicyAction> = {};
  for (const tool of tools) {
    const merged = maxDecision([
      effectiveCeiling(a, tool),
      effectiveCeiling(b, tool),
    ]);
    if (merged === "abstain") continue; // 双方均无约束时不出键
    ceilings[tool] = merged as PolicyAction;
  }
  const defaultCeiling = maxDecision([
    a.defaultCeiling ?? "allow",
    b.defaultCeiling ?? "allow",
  ]);
  return {
    kind: "ceilings",
    source: `intersect(${a.source},${b.source})`,
    ceilings,
    ...(defaultCeiling === "abstain" ? {} : { defaultCeiling: defaultCeiling as PolicyAction }),
  };
}

/**
 * 多来源链式折叠（装配面入口）：逐个并入有效上限集，opaque 相遇即抛
 * PermissionIntersectionError（拒绝启动，错误含来源名）。空数组返回
 * undefined（无约束 = 单来源装配零行为变化）。
 */
export function intersectAllProfiles(
  profiles: readonly PermissionSourceProfile[],
): CeilingProfile | undefined {
  let acc: CeilingProfile | undefined;
  for (const p of profiles) {
    if (p.kind === "opaque") {
      throw new PermissionIntersectionError(
        [acc?.source ?? p.source, p.source],
        p.reason,
      );
    }
    acc = acc === undefined ? p : intersectPermissionProfiles(acc, p);
  }
  return acc;
}

/**
 * 出口级来源上限（C49 的执行面，T-P1-03 装配接线）：链裁决之后再 max
 * 一次来源上限——与 enforceProtectedPaths（C46）同位（gate 出口与
 * revalidator），上限不依赖链层序、规则不得放宽它。上限为 allow 时不
 * 约束；上限不产生 rule 证据（它不是规则来源），但保留链裁决的 rule
 * 以维持 C18 可解释性（"哪条规则想放行、被哪个来源的上限压住"）。
 */
export function enforceCeiling(
  verdict: Verdict,
  call: PolicyCall,
  profile: CeilingProfile | undefined,
): Verdict {
  if (profile === undefined) return verdict;
  const ceiling = effectiveCeiling(profile, call.tool);
  if (ceiling === "allow") return verdict;
  const action = maxDecision([verdict.action, ceiling]);
  if (action === verdict.action) return verdict;
  return {
    action,
    ...(verdict.rule !== undefined ? { rule: verdict.rule } : {}),
    reason: `来源 "${profile.source}" 的权限上限为 ${ceiling}，压过 ${verdict.action}（C49 交集有效集）`,
  };
}
