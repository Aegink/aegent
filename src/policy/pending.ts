/**
 * 待审批挂起注册表（C5/C50/C31）——审批请求的 suspend / reply / 超时。
 *
 * 形状取 opencode·permission：Deferred（Promise.withResolvers）+ pending
 * Map + reply 唤醒；超时取 zcode·broker 的纪律——**必须 reject 类型化错误**
 * （PermissionTimeout），绝不静默结算（C31：超时静默结算是 bug）。
 *
 * C31 的两条 hermes 事故教训落为本方规则：
 *   - 迟到的 reply 不影响现状：已结算（含超时）的请求留 tombstone，迟到
 *     reply 命中 tombstone 时抛明确的 stale 错误，绝不改写活轮次的状态
 *    （hermes `_run_still_current` 检查的进程内对应物）；
 *   - 主动宣告：asked / settled / timed-out 三个事实经 announce 回调向
 *     所有界面广播（P0 单端一个回调，多端消费方各自扇出），超时同样
 *     宣告——不宣告的超时与静默放行同罪。
 */

import type { JsonRecord } from "../kernel/events.js";
import type { Verdict } from "./decision.js";

// ---------------------------------------------------------------------------
// 请求 / 答复 / 宣告
// ---------------------------------------------------------------------------

/** 一次待审批请求。id 由调用方提供（自然取工具调用的 callId——D15 语义下
 * 重试即新调用新 id，id 相撞属编程错误，注册即败）。 */
export interface ApprovalRequest {
  readonly id: string;
  readonly sessionId: string;
  readonly tool: string;
  readonly args: JsonRecord;
}

/**
 * 审批人的答复。人已经答了，allow/deny 之外没有第三种合法答复。
 * C24 扩展（T-P1-02）：批准可带作用域（scope=session 由答复路径落
 * ApprovalScopeCache，同会话同规则免再问）与 feedback（落 L2 审计）；
 * deny 无物可记，scope 无意义。
 */
export interface ApprovalReply {
  readonly action: "allow" | "deny";
  readonly reason?: string;
  readonly scope?: "once" | "session";
  readonly feedback?: string;
}

/** C31 主动宣告：三类事实，凡能显示审批的界面都应消费。settled 的
 * feedback 是 C24 审批反馈的透传（答复人可选填写，审计面消费）。 */
export type ApprovalAnnouncement =
  | { kind: "asked"; request: ApprovalRequest; timeoutMs: number }
  | { kind: "settled"; id: string; verdict: Verdict; tool: string; feedback?: string }
  | { kind: "timed-out"; id: string; timeoutMs: number; tool: string };

// ---------------------------------------------------------------------------
// 类型化错误（C50：超时带类型失败；迟到 reply 带 stale 错误）
// ---------------------------------------------------------------------------

export const PERMISSION_TIMEOUT = "PERMISSION_TIMEOUT";
export const PERMISSION_REPLY_STALE = "PERMISSION_REPLY_STALE";
export const PERMISSION_REQUEST_UNKNOWN = "PERMISSION_REQUEST_UNKNOWN";
export const PERMISSION_REQUEST_DUPLICATE = "PERMISSION_REQUEST_DUPLICATE";

/** 超时错误（C50）：调用方按 code 路由（J22/T-2-04 同款纪律），不是泛 Error。 */
export class PermissionTimeout extends Error {
  readonly code = PERMISSION_TIMEOUT;
  constructor(
    readonly requestId: string,
    readonly timeoutMs: number,
  ) {
    super(`审批请求 ${requestId} 超时（${timeoutMs}ms）未获答复`);
  }
}

/** 迟到答复：请求已结算（超时或已有人答过），本次 reply 被拒绝。 */
export class StaleApprovalError extends Error {
  readonly code = PERMISSION_REPLY_STALE;
  constructor(
    readonly requestId: string,
    readonly settledWith: "timeout" | "reply",
  ) {
    super(
      `审批请求 ${requestId} 已结算（${settledWith}），答复迟到被拒——` +
        "如需重新决策请发起新的审批（hermes 迟到通知教训）",
    );
  }
}

/** 答复指向一个从未存在的请求 id。 */
export class UnknownApprovalError extends Error {
  readonly code = PERMISSION_REQUEST_UNKNOWN;
  constructor(readonly requestId: string) {
    super(`审批请求 ${requestId} 不存在`);
  }
}

/** 发起审批时 id 已在挂起中或已结算（调用方应换新 id，见 D15 纪律）。 */
export class DuplicateApprovalError extends Error {
  readonly code = PERMISSION_REQUEST_DUPLICATE;
  constructor(readonly requestId: string) {
    super(`审批请求 ${requestId} 已存在（挂起中或已结算）——重试须用新调用 id`);
  }
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

/**
 * Deferred（opencode·permission 同款形状）。不用 Promise.withResolvers：
 * 项目 ts lib 未到 ES2024，不为单卡升全局脚手架（T-1-00 产物）。
 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PendingEntry {
  readonly request: ApprovalRequest;
  readonly timeoutMs: number;
  readonly settle: (verdict: Verdict) => void;
  readonly fail: (error: PermissionTimeout) => void;
  readonly timer: NodeJS.Timeout;
}

interface SettledTombstone {
  readonly settledWith: "timeout" | "reply";
}

export class PendingApprovals {
  private readonly pending = new Map<string, PendingEntry>();
  /** 已结算请求的墓碑：迟到 reply 的 stale 判定依据（C31）。 */
  private readonly settled = new Map<string, SettledTombstone>();

  constructor(
    private readonly announce?: (announcement: ApprovalAnnouncement) => void,
  ) {}

  /**
   * 发起审批：挂起发起端，返回人答复后 resolve 的裁决 Promise。
   * timeoutMs **必填**（无默认值）——超时上界是调用方对本轮交互的显式
   * 决策，静默永挂或隐式超时都是 C50 要防的事故。
   * id 重复（挂起中或已结算）同步抛 DuplicateApprovalError——调用方
   * 编程错误当场暴露，不走 promise 通道。
   */
  ask(
    req: ApprovalRequest,
    options: { timeoutMs: number },
  ): Promise<Verdict> {
    const { timeoutMs } = options;
    if (this.pending.has(req.id) || this.settled.has(req.id)) {
      throw new DuplicateApprovalError(req.id);
    }
    const { promise, resolve, reject } = deferred<Verdict>();
    const entry: PendingEntry = {
      request: req,
      timeoutMs,
      settle: resolve,
      fail: reject,
      timer: setTimeout(() => this.expire(req.id, timeoutMs), timeoutMs),
    };
    this.pending.set(req.id, entry);
    this.announce?.({ kind: "asked", request: req, timeoutMs });
    return promise;
  }

  /**
   * 审批人答复：唤醒挂起的发起端。请求已结算时抛 StaleApprovalError
   * （C31 迟到通知纪律），从未存在时抛 UnknownApprovalError。
   */
  async reply(id: string, reply: ApprovalReply): Promise<void> {
    const entry = this.pending.get(id);
    if (entry === undefined) {
      const tombstone = this.settled.get(id);
      if (tombstone !== undefined) {
        throw new StaleApprovalError(id, tombstone.settledWith);
      }
      throw new UnknownApprovalError(id);
    }
    this.pending.delete(id);
    this.settled.set(id, { settledWith: "reply" });
    clearTimeout(entry.timer);
    const verdict: Verdict =
      reply.action === "allow"
        ? { action: "allow", reason: reply.reason ?? "审批人放行" }
        : { action: "deny", reason: reply.reason ?? "审批人拒绝" };
    this.announce?.({
      kind: "settled",
      id,
      verdict,
      tool: entry.request.tool,
      ...(reply.feedback !== undefined ? { feedback: reply.feedback } : {}),
    });
    entry.settle(verdict);
  }

  /** 供消费方查询挂起中的请求（界面重建 / owner 通道列举用）。 */
  listPending(): readonly ApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  /** 释放未决请求（会话关闭等）：全部按超时语义拒绝，不悬挂 promise。 */
  dispose(): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      this.settled.set(id, { settledWith: "timeout" });
      clearTimeout(entry.timer);
      this.announce?.({
        kind: "timed-out",
        id,
        timeoutMs: entry.timeoutMs,
        tool: entry.request.tool,
      });
      entry.fail(new PermissionTimeout(id, entry.timeoutMs));
    }
  }

  private expire(id: string, timeoutMs: number): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return; // 已被 reply 结算，计时器迟到无害
    this.pending.delete(id);
    this.settled.set(id, { settledWith: "timeout" });
    this.announce?.({
      kind: "timed-out",
      id,
      timeoutMs,
      tool: entry.request.tool,
    });
    entry.fail(new PermissionTimeout(id, timeoutMs));
  }
}
