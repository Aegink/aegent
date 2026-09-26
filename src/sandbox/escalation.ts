/**
 * 沙箱升级执行期校验（B15/T-P1-58）——"每次调用不同的约束不得进工具
 * schema"（语义取 dsh·escalation.ts："Checked at EXECUTION, never baked
 * into a tool schema — the schema's enum is ESCALATION_TARGETS, because
 * schemas are registry-global while the effective mode is per-call truth"）。
 *
 * 三条纪律：
 *   1. schema 只 advertise **封闭目标词汇**（ESCALATION_TARGETS）——不
 *      advertise 当前有效模式（那是每调用真相，schema 是全局的）；
 *   2. 升级目标必须**严格更宽**于本调用的有效模式（WIDER_MODES 阶梯表，
 *      执行期校验）——narrower / 平级跳不出"重复请求当前模式不需要审批"
 *      的直返，更宽才走审批；
 *   3. fail-closed：非更宽目标 / 缺 justification / 无审批通道 / 非授予
 *      答复，一律在执行前类型化拒绝——升级失败绝不降级为不受限运行。
 *
 * 与 PathGuard（C7 出口级硬拦）的分界：升级放宽的是**沙箱模式**（命令
 * 允许的文件效果档位，SandboxBackend 管辖面），**工作区边界不可被升级
 * 放宽**（PathGuard 是出口级硬拦，"任何批准都绕不过它"——P0 红线）。
 * 配对校验取 dsh validateEscalationArgs：sandboxPermissions 与 justification
 * 同行（无理由的升级申请或无所指的理由都是畸形 ask）。
 */

import type { SandboxMode } from "./backend.js";

/**
 * 严格更宽阶梯表（dsh WIDER_MODES 同构）：键 = 当前有效模式，值 = 可升级
 * 到的目标集合。read-only 是地板——没有升级到它的路径。
 */
export const WIDER_MODES: Record<string, readonly SandboxMode[]> = {
  "read-only": ["workspace-write", "danger-full-access"],
  "workspace-write": ["danger-full-access"],
};

/**
 * 封闭升级目标词汇（schema enum 的唯一合法来源；dsh ESCALATION_TARGETS
 * 同构——advertise 全部"可能升到"的模式，与装配默认无关，防止默认宽的
 * 会话收窄后失去杠杆）。冻结只追加（C10 先例）。
 */
export const ESCALATION_TARGETS: readonly SandboxMode[] = [
  "workspace-write",
  "danger-full-access",
];

export const SANDBOX_ESCALATION_INVALID = "SANDBOX_ESCALATION_INVALID";
export const SANDBOX_ESCALATION_DENIED = "SANDBOX_ESCALATION_DENIED";

export class SandboxEscalationError extends Error {
  override readonly name = "SandboxEscalationError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 配对校验（dsh validateEscalationArgs 同构）：sandboxPermissions 与
 * justification 同行，justification 必须是非空句——审批提示人要看到
 * 理由，无所指的理由是畸形 ask。
 */
export function validateEscalationArgs(
  sandboxPermissions: string | undefined,
  justification: string | undefined,
): void {
  if (sandboxPermissions !== undefined && justification === undefined) {
    throw new SandboxEscalationError(
      SANDBOX_ESCALATION_INVALID,
      "invalid escalation: sandboxPermissions requires a justification",
    );
  }
  if (justification !== undefined && sandboxPermissions === undefined) {
    throw new SandboxEscalationError(
      SANDBOX_ESCALATION_INVALID,
      "invalid escalation: justification is only valid together with sandboxPermissions",
    );
  }
  if (justification !== undefined && justification.trim().length === 0) {
    throw new SandboxEscalationError(
      SANDBOX_ESCALATION_INVALID,
      "invalid justification: expected a non-empty sentence",
    );
  }
}

/**
 * 执行期校验：requested 是否是 currentMode 的严格更宽目标。合法 → 返回
 * 目标模式（调用方接着走审批）；非法 → 类型化拒绝（fail-closed）。
 */
export function resolveEscalatedMode(
  requested: string,
  currentMode: SandboxMode,
): SandboxMode {
  if (requested === currentMode) {
    throw new SandboxEscalationError(
      SANDBOX_ESCALATION_INVALID,
      `sandbox escalation to "${requested}" equals the call's current "${currentMode}" mode——重复当前模式不需要升级`,
    );
  }
  const wider = WIDER_MODES[currentMode] ?? [];
  if (!wider.includes(requested as SandboxMode)) {
    throw new SandboxEscalationError(
      SANDBOX_ESCALATION_INVALID,
      `sandbox escalation to "${requested}" is not strictly wider than this call's current "${currentMode}" mode`,
    );
  }
  return requested as SandboxMode;
}
