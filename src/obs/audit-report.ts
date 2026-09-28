/**
 * 审计报表（L6/T-P2-515）——汇总危险操作与审批（hermes·gateway 的报表
 * 维度面；网关形态不取——我方本地审计记录流，known-diffs.md 记档）。
 *
 * 输入 = L2 审计记录流（approvalAuditRecord / JudgeAuditRecord 的结构化
 * 最小面——本地形状声明避免 obs→policy 静态依赖，记录对象运行时传入）。
 * 三维度：①危险操作计数（按 tool 分组的审批升级 asked——危险操作被拦截
 * 升级的事实）；②审批率（approved/denied/timed-out/无答复——比例，空窗
 * 返回 null 不除零）；③判官介入率（C42 判官记录数 / 审批请求数）。
 * 零落流零词汇表扩展（报表是读面）。
 */

/** 审计记录的结构化最小面（approval / judge 两类记录的公共形状）。 */
export interface AuditRecordLike {
  readonly kind?: string;
  readonly phase?: string;
  readonly tool?: string;
  readonly at?: number;
  readonly outcome?: string;
}

export interface AuditReportWindow {
  /** 起止时间戳（epoch ms，含界）——缺省全量。 */
  fromTs?: number;
  toTs?: number;
}

/** 按 tool 分组的聚合行。 */
export interface AuditToolRow {
  tool: string;
  /** 审批升级次数（asked——危险操作被拦截升级）。 */
  escalations: number;
  approved: number;
  denied: number;
  timedOut: number;
}

export interface AuditReport {
  /** 窗口内审批请求数（asked 记录数）。 */
  approvalRequests: number;
  /** 窗口内人答复数（settled 记录数）。 */
  approvalsSettled: number;
  approved: number;
  denied: number;
  timedOut: number;
  /** 审批完成率 = (approved+denied+timedOut) / approvalRequests；空窗 null（不除零）。 */
  approvalRate: number | null;
  /** 判官介入率 = judge reviewed 记录数 / approvalRequests；无审批请求或未启用判官时 null。 */
  judgeInvolvementRate: number | null;
  judgeRecords: number;
  /** 按 tool 分组（escalations 降序——最危险的工具排前面）。 */
  byTool: AuditToolRow[];
}

function inWindow(record: AuditRecordLike, window: AuditReportWindow): boolean {
  const at = record.at ?? 0;
  if (window.fromTs !== undefined && at < window.fromTs) return false;
  if (window.toTs !== undefined && at > window.toTs) return false;
  return true;
}

/** 审计报表聚合（纯函数——记录流是输入，报表是投影）。 */
export function auditReport(records: readonly AuditRecordLike[], window: AuditReportWindow = {}): AuditReport {
  const scoped = records.filter((r) => inWindow(r, window));

  const approval = scoped.filter((r) => r.kind === "approval" || (r.kind === undefined && r.phase !== undefined));
  const asked = approval.filter((r) => r.phase === "asked");
  const settled = approval.filter((r) => r.phase === "settled");
  const timedOut = approval.filter((r) => r.phase === "timed-out");
  const approved = settled.filter((r) => r.outcome === "approved");
  const denied = settled.filter((r) => r.outcome === "denied");
  const judge = scoped.filter((r) => r.kind === "judge" && r.phase === "reviewed");

  const settledResolved = settled.length + timedOut.length;
  const approvalRate = asked.length > 0 ? settledResolved / asked.length : null;
  const judgeInvolvementRate = asked.length > 0 ? judge.length / asked.length : null;

  const byTool = new Map<string, AuditToolRow>();
  const rowOf = (tool: string): AuditToolRow => {
    let row = byTool.get(tool);
    if (!row) {
      row = { tool, escalations: 0, approved: 0, denied: 0, timedOut: 0 };
      byTool.set(tool, row);
    }
    return row;
  };
  for (const r of asked) rowOf(r.tool ?? "unknown").escalations += 1;
  for (const r of approved) rowOf(r.tool ?? "unknown").approved += 1;
  for (const r of denied) rowOf(r.tool ?? "unknown").denied += 1;
  for (const r of timedOut) rowOf(r.tool ?? "unknown").timedOut += 1;

  return {
    approvalRequests: asked.length,
    approvalsSettled: settled.length,
    approved: approved.length,
    denied: denied.length,
    timedOut: timedOut.length,
    approvalRate,
    judgeInvolvementRate,
    judgeRecords: judge.length,
    byTool: [...byTool.values()].sort((a, b) => b.escalations - a.escalations),
  };
}
