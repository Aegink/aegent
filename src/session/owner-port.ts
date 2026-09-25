/**
 * Owner 命令通道（N6）——审批 / elicitation / hook 复核**共用一条命令
 * 通道**，命令是闭集，结果回传。形状取 zcode·sessionRealtimePort.ts 的
 * TaskOwnerCommandRequest 闭集与 TaskRunLease*。
 *
 * P0 单端：CLI 即 owner。lease 语义做最小版——acquire/release + 只有
 * 持有者能发命令（会话级互斥的种子：多端 host/roster 是 N7 P1，届时
 * lease 加投递方式与租约过期，命令闭集不变）。elicitation / hook 复核
 * 的命令变体随对应功能加入本联合——穷尽 switch（assertNever）会在漏
 * 分支时编译失败，闭集是类型面强制，不是文档约定。
 *
 * 结果回传：requestOwnerCommand 的 promise 就是命令的回传通道——handler
 * 的成功/失败（如 C5 挂起唤醒、Stale/Unknown 类型化错误）原样上抛给
 * owner，不在端口层吞掉或改写。
 */

import { assertNever } from "../kernel/events.js";
import type { ModelIdentity } from "../models/identity.js";
import type { ApprovalReply } from "../policy/pending.js";

// ---------------------------------------------------------------------------
// 命令闭集（N6）
// ---------------------------------------------------------------------------

/** owner 可发的全部命令。新增交互面 = 在这里加变体 + 加 handler 分支。 */
export type OwnerCommand =
  | {
      /** 审批答复：转达给 C5 挂起注册表（pending.reply 的封装，不重造挂起）。 */
      readonly type: "respond_permission";
      readonly requestId: string;
      readonly reply: ApprovalReply;
    }
  | {
      /** 停止当前生成（A7 取消的 owner 入口；handler 由 loop 装配注入）。 */
      readonly type: "stop_generation";
      readonly reason?: string;
    }
  | {
      /** J6 运行时换模（T-P1-04）：换模请求立即受理、生效点在新 turn；
       * handler 由装配的 ModelSwitchService 承接（未注册模型类型化错误）。 */
      readonly type: "model/switch";
      readonly identity: ModelIdentity;
    };

// ---------------------------------------------------------------------------
// lease（最小版）
// ---------------------------------------------------------------------------

export const OWNER_LEASE_BUSY = "OWNER_LEASE_BUSY";
export const OWNER_NOT_LEASE_HOLDER = "OWNER_NOT_LEASE_HOLDER";

export class LeaseBusyError extends Error {
  readonly code = OWNER_LEASE_BUSY;
  constructor(readonly heldBy: string) {
    super(`租约已被 ${heldBy} 持有——同一会话同时只允许一个 owner（N6/N7）`);
  }
}

export class NotLeaseHolderError extends Error {
  readonly code = OWNER_NOT_LEASE_HOLDER;
  constructor(readonly ownerId: string) {
    super(`${ownerId} 不持有当前租约，命令被拒（N6：持有者才能发命令）`);
  }
}

export interface LeaseHandle {
  readonly ownerId: string;
  /** 租约序号令牌：旧句柄在租约被释放并重新获取后即失效（进程内校验）。 */
  readonly id: number;
  /** 释放租约。句柄过期（已被重新 acquire）时释放是 no-op 并返回 false。 */
  release(): boolean;
}

// ---------------------------------------------------------------------------
// 端口
// ---------------------------------------------------------------------------

export interface OwnerPortHandlers {
  readonly respondPermission: (
    requestId: string,
    reply: ApprovalReply,
  ) => Promise<void>;
  readonly stopGeneration?: (reason?: string) => Promise<void>;
  /** J6 换模处理（T-P1-04 装配注入；未启用换模的装配可不提供）。 */
  readonly modelSwitch?: (identity: ModelIdentity) => Promise<void> | void;
}

export class OwnerCommandPort {
  private leaseOwnerId: string | undefined;
  private leaseId = 0;

  constructor(private readonly handlers: OwnerPortHandlers) {}

  /** 获取 owner 租约；已有人持有时抛 LeaseBusyError。 */
  acquireLease(ownerId: string): LeaseHandle {
    if (this.leaseOwnerId !== undefined) {
      throw new LeaseBusyError(this.leaseOwnerId);
    }
    const leaseId = ++this.leaseId;
    this.leaseOwnerId = ownerId;
    return {
      ownerId,
      id: leaseId,
      release: () => {
        if (this.leaseId !== leaseId || this.leaseOwnerId !== ownerId) {
          return false; // 句柄过期：租约已被释放并被他人重新获取
        }
        this.leaseOwnerId = undefined;
        return true;
      },
    };
  }

  currentHolder(): string | undefined {
    return this.leaseOwnerId;
  }

  /**
   * owner 发一条命令：校验租约 → 按**闭集**分发 → handler 结果原样回传
   * （成功与类型化错误都不经改写）。
   */
  async requestOwnerCommand(
    lease: LeaseHandle,
    command: OwnerCommand,
  ): Promise<void> {
    if (this.leaseId !== lease.id || this.leaseOwnerId !== lease.ownerId) {
      throw new NotLeaseHolderError(lease.ownerId);
    }
    switch (command.type) {
      case "respond_permission":
        return this.handlers.respondPermission(command.requestId, command.reply);
      case "stop_generation":
        return this.handlers.stopGeneration?.(command.reason);
      case "model/switch":
        return this.handlers.modelSwitch?.(command.identity);
      default:
        return assertNever(command, "owner 命令闭集出现未知变体");
    }
  }
}
