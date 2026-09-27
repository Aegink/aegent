/**
 * 审计字段（L2）——审批请求/裁决的发起端（surface）与审批人（approver），
 * 场景⑥"可追溯到谁在哪个端发起"的落点。
 *
 * 载荷形状取 opencode·permission 的 pending info（请求侧载荷）思路，接入
 * 点是 T-5-04 PendingApprovals 的宣告通道（C31 三事实）与 T-5-15 owner
 * 通道的答复路径：owner 回复经 pending.reply 落 settled 宣告，审计转换器
 * 原样消费——一条流，不另造第二套审批事件（l0-events 词汇表无审批事件，
 * P0 审计轨迹走宣告通道，持久化随 T-8）。
 *
 * 审批人判定：settled（人经通道答复）→ user；timed-out → timeout。
 * broker 兜底拒绝（C51 无人应答）不产生 settled 宣告——它在 gate 层，
 * 不经过挂起注册表，审计面为空是诚实的（没有"审批"发生过）。
 */

import type { ApprovalAnnouncement } from "./pending.js";

// ---------------------------------------------------------------------------
// 字段闭集（P0 单端；多端随 N7 追加——只追加不替换）
// ---------------------------------------------------------------------------

/** 审批发起的界面端。P0 只有 CLI。 */
export const APPROVAL_SURFACES = ["cli"] as const;
export type ApprovalSurface = (typeof APPROVAL_SURFACES)[number];

/** 审批人：人（经 owner 通道）/ 审批超时（C50）。 */
export const APPROVAL_APPROVERS = ["user", "timeout"] as const;
export type ApprovalApprover = (typeof APPROVAL_APPROVERS)[number];

// ---------------------------------------------------------------------------
// 审计记录
// ---------------------------------------------------------------------------

export interface ApprovalAuditRecord {
  readonly kind: "approval";
  readonly phase: "asked" | "settled" | "timed-out";
  readonly requestId: string;
  readonly tool: string;
  /** 发起端（L2 必填，无默认值）。 */
  readonly surface: ApprovalSurface;
  /** 审批人（L2 必填）：asked 阶段同样必填，取值 "user" 表示等人的审批面。 */
  readonly approver: ApprovalApprover;
  readonly at: number;
  /** C24 审批反馈：答复人可选填写，settled 且有 feedback 时存在。 */
  readonly feedback?: string;
  /** C6 答复端标识（T-P1-82）：settled 且答复带 source 时存在——"哪个端
   * 答的"（发起端 surface 是本端固定值，答复端可跨端回转）。 */
  readonly replySource?: string;
}

/** 唯一构造入口：surface/approver 缺一不可（缺字段构造即类型报错——L2）。 */
export function approvalAuditRecord(fields: {
  readonly phase: ApprovalAuditRecord["phase"];
  readonly requestId: string;
  readonly tool: string;
  readonly surface: ApprovalSurface;
  readonly approver: ApprovalApprover;
  readonly at: number;
  readonly feedback?: string;
  readonly replySource?: string;
}): ApprovalAuditRecord {
  return { kind: "approval", ...fields };
}

// ---------------------------------------------------------------------------
// 宣告 → 审计记录 转换器（T-5-04 announce 回调的包装）
// ---------------------------------------------------------------------------

export interface ApprovalAuditSinkOptions {
  /** 发起端（装配处给出本端的 surface，P0 = "cli"）。 */
  readonly surface: ApprovalSurface;
  /** 审计记录去向（T-8 持久化/显示面；测试收集进数组）。 */
  readonly sink: (record: ApprovalAuditRecord) => void;
  /** 时间源（测试注入；缺省 Date.now）。 */
  readonly now?: () => number;
}

/**
 * 把 PendingApprovals 的宣告流转成带 L2 字段的审计记录：
 * asked → surface + approver:"user"（挂起等人的审批面）；settled →
 * approver:"user"；timed-out → approver:"timeout"。
 */
export function createApprovalAuditSink(
  options: ApprovalAuditSinkOptions,
): (announcement: ApprovalAnnouncement) => void {
  const { surface, sink } = options;
  const now = options.now ?? Date.now;
  return (announcement: ApprovalAnnouncement): void => {
    const at = now();
    switch (announcement.kind) {
      case "asked":
        sink(
          approvalAuditRecord({
            phase: "asked",
            requestId: announcement.request.id,
            tool: announcement.request.tool,
            surface,
            approver: "user",
            at,
          }),
        );
        return;
      case "settled":
        sink(
          approvalAuditRecord({
            phase: "settled",
            requestId: announcement.id,
            tool: announcement.tool,
            surface,
            approver: "user",
            at,
            ...(announcement.feedback !== undefined
              ? { feedback: announcement.feedback }
              : {}),
            ...(announcement.source !== undefined
              ? { replySource: announcement.source }
              : {}),
          }),
        );
        return;
      case "timed-out":
        sink(
          approvalAuditRecord({
            phase: "timed-out",
            requestId: announcement.id,
            tool: announcement.tool,
            surface,
            approver: "timeout",
            at,
          }),
        );
        return;
    }
  };
}
