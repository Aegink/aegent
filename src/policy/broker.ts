/**
 * 权限审批出口（C51）——默认实现是拒绝。
 *
 * Port 形状取 zcode·broker.ts：审批出口是一个端口（PermissionBrokerPort），
 * DenyPermissionBroker 是**缺省实现**——未配置任何审批客户端时，一切
 * ask 请求直接落 deny（fail closed：没有人在场就什么都不批）。显式换
 * Manual/CLI 实现才会问人。
 *
 * ManualPermissionBroker 是 CLI 端骨架：挂起/超时/宣告机制**复用
 * T-5-04 的 PendingApprovals**（不重造第二套挂起语义）；真正的 CLI
 * 交互面（显示请求、收 owner 命令）由 T-8 接线，owner 通道见 T-5-15。
 */

import type { Verdict } from "./decision.js";
import { PendingApprovals, type ApprovalRequest } from "./pending.js";

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface PermissionBrokerPort {
  readonly name: string;
  /** 对一次待审批请求给出最终裁决。deny 是合法结果（resolve），不是异常。 */
  decide(request: ApprovalRequest): Promise<Verdict>;
  /** 会话关闭时释放未决请求。缺省无操作。 */
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// Deny 实现（C51 缺省）
// ---------------------------------------------------------------------------

/** C51 缺省拒绝的机器码（拒绝原因可审计、可路由）。 */
export const PERMISSION_BROKER_DENIED = "PERMISSION_BROKER_DENIED";

export interface BrokerDeniedVerdict extends Verdict {
  readonly action: "deny";
  readonly code: typeof PERMISSION_BROKER_DENIED;
}

export class DenyPermissionBroker implements PermissionBrokerPort {
  readonly name = "deny";

  async decide(request: ApprovalRequest): Promise<BrokerDeniedVerdict> {
    return {
      action: "deny",
      code: PERMISSION_BROKER_DENIED,
      reason:
        `未配置审批客户端，工具 ${request.tool} 的审批请求 ${request.id} ` +
        "默认拒绝（C51：显式换 Manual/CLI 审批出口才会问人）",
    };
  }
}

// ---------------------------------------------------------------------------
// Manual 骨架（CLI 端）
// ---------------------------------------------------------------------------

export class ManualPermissionBroker implements PermissionBrokerPort {
  readonly name = "manual";

  /**
   * timeoutMs 必填（C50 同款纪律）：等待人的上界是装配方的显式决策。
   * PendingApprovals 承担挂起/唤醒/超时/宣告，本类只做路由。
   */
  constructor(
    private readonly pending: PendingApprovals,
    private readonly timeoutMs: number,
  ) {}

  decide(request: ApprovalRequest): Promise<Verdict> {
    return this.pending.ask(request, { timeoutMs: this.timeoutMs });
  }

  dispose(): void {
    this.pending.dispose();
  }
}
