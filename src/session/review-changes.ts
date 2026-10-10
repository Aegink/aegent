/**
 * 工作面板·变更评审提取纯函数（U15/T-P3-117）——从事件流算 agent 改了
 * 哪些文件与子代理委派一览（pi-desktop·ReviewTab 的 reviewChangesFrom
 * Messages + summarizeReviewChanges 行为映射：变更从消息流提取 + 汇总
 * 统计，委派状态/耗时/失败收集）。
 *
 * 纪律（卡面明示）：**纯函数从流提取，不另建状态**——每次打开/每轮结算
 * 重算，流是唯一事实源（不变量 1）；工具执行时不写任何"review 载荷"
 * （pi-desktop 的 toolResult.details.review 结构化面不取——我方工具
 * result 无此载荷，从 call arguments 提取是卡面规定的路线）。
 *
 * 提取面定形（卡内记档）：
 * - write/edit：arguments 的 path 参数（结构化事实，可靠）；
 * - apply-patch：patchText 的 `*** Add/Delete/Update File:` 头（自包含
 *   提取——不 import kernel 解析器：本面只需文件清单，完整 V4A 解析
 *   语义在 kernel/tools/builtin/apply-patch.ts，双实现由各自测试钉住）；
 * - bash/pwsh：启发式提取 rm 目标（删除）与重定向目标（写入）——
 *   mv/cp/tee/sed -i 等其余写命令不提取（启发式扩张误报面，YAGNI 记档；
 *   via 字段标注 bash 供 UI 区分推断面）；
 * - 失败调用（tool/result isError）不计入变更——"改了哪些文件"只认
 *   落地事实（pi-desktop 的 toolStatus==="success" 过滤同构）；
 * - call 无配对 result（在途）不进变更清单；task 在途进委派清单标
 *   running（监控面关心在途委派）。
 *
 * 路径归一：反斜杠 → posix（Windows 流内 args.path 可能是 win 路径），
 * 按归一路径聚合，末次操作决定文件态（写入/修改/删除三态——write 的
 * "新增或覆盖"从流不可分，统称写入，记档）。
 */

import type { SessionEvent } from "../core/index.js";
import { collaborationsFromEvents, type CollaborationRecord } from "./collaboration.js";

/** 文件级变更条目（按路径聚合后的末态）。 */
export interface ReviewFileChange {
  /** posix 归一路径（相对/绝对照录流内事实——只归一分隔符）。 */
  readonly path: string;
  readonly op: "write" | "edit" | "delete";
  /** 末次操作的来源工具（write/edit/apply-patch/bash/pwsh）。 */
  readonly via: string;
  /** 末次操作所在 tool/call 事件 seq（UI 排序面）。 */
  readonly lastSeq: number;
}

/** 操作级流水条目（summarize 与 UI 展开的输入）。 */
export interface ReviewOperation {
  readonly path: string;
  readonly op: "write" | "edit" | "delete";
  readonly via: string;
  readonly seq: number;
}

/** 子代理委派一览条目（task 工具调用——H1 面的流内事实）。 */
export interface ReviewDelegation {
  readonly callSeq: number;
  readonly turn: number;
  readonly description: string;
  /** 子会话 id（result meta.subagent——H2 结算面的 lineage）。 */
  readonly subagentSessionId?: string;
  /** call 无配对 result = 在途 running。 */
  readonly status: "running" | "completed" | "failed" | "cancelled";
  /** call→result 时间差（毫秒；在途无）。 */
  readonly durationMs?: number;
  /** 失败/取消时的错误码（result.error.code）。 */
  readonly errorCode?: string;
}

/** 汇总统计（summarizeReviewChanges 产物）。 */
export interface ReviewChangesSummary {
  /** 去重路径数。 */
  readonly files: number;
  readonly writes: number;
  readonly edits: number;
  readonly deletes: number;
}

export interface ReviewReport {
  /** 文件级聚合清单（末态）——变更评审 Tab 主表。 */
  readonly changes: ReviewFileChange[];
  /** 操作级流水（同文件多操作可见）。 */
  readonly operations: ReviewOperation[];
  /** 子代理委派一览——子代理监控 Tab 主表。 */
  readonly delegations: ReviewDelegation[];
  /** 会话间协作往来——协作 Tab 主表（U27 流投影）。 */
  readonly collaborations: CollaborationRecord[];
}

const PATCH_FILE_HEADERS =
  /^\s*\*\*\* (Add File|Delete File|Update File): (.+)$/gm;
/** 命令分段（; && || | 与换行）——rm/重定向逐段匹配，防"cat a | rm b"整串误配。 */
const COMMAND_SPLIT = /(?:&&|\|\||[;|\n])/;

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function parseCallArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // arguments 是模型产出的原始 JSON 串——坏 JSON 无文件事实可提取
  }
  return {};
}

/** bash 命令段的 rm 目标（首个非旗标参数；引号剥除）。 */
function extractRmTargets(segment: string): string[] {
  const m = segment.match(/(?:^|\s)rm\s+(.*)$/);
  const body = m?.[1];
  if (body === undefined) return [];
  return body
    .split(/\s+/)
    .filter((tok) => tok !== "" && !tok.startsWith("-"))
    .map((tok) => tok.replaceAll(/^"|"$/g, ""))
    .filter((tok) => tok !== "" && tok !== ".");
}

/** bash 命令段的重定向写目标（> 与 >> 同为写入面；fd 重定向 2>/dev/null 排除）。 */
function extractRedirectTargets(segment: string): string[] {
  const targets: string[] = [];
  const re = /(?:^|[\s;])\d*>{1,2}\s*([^\s;|&>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const captured = m[1];
    if (captured === undefined) continue;
    const tok = captured.replaceAll(/^"|"$/g, "");
    if (tok !== "" && tok !== "/dev/null") targets.push(tok);
  }
  return targets;
}

/** 单工具调用的文件操作提取（name + 已解析 arguments → 操作流水）。 */
function extractOperations(
  name: string,
  args: Record<string, unknown>,
  seq: number,
): ReviewOperation[] {
  const ops: ReviewOperation[] = [];
  const push = (path: string, op: ReviewOperation["op"], via = name): void => {
    const normalized = toPosix(path).trim();
    if (normalized !== "") ops.push({ path: normalized, op, via, seq });
  };
  if (name === "write" || name === "edit") {
    const p = args["path"];
    if (typeof p === "string") push(p, name === "write" ? "write" : "edit");
  } else if (name === "apply-patch" || name === "apply_patch") {
    const patchText = args["patchText"];
    if (typeof patchText === "string") {
      PATCH_FILE_HEADERS.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PATCH_FILE_HEADERS.exec(patchText)) !== null) {
        const kind = m[1];
        const file = m[2];
        if (kind === undefined || file === undefined) continue;
        const op = kind === "Add File" ? "write" : kind === "Delete File" ? "delete" : "edit";
        push(file, op);
      }
    }
  } else if (name === "bash" || name === "pwsh") {
    const command = args["command"];
    if (typeof command === "string") {
      for (const segment of command.split(COMMAND_SPLIT)) {
        for (const t of extractRmTargets(segment)) push(t, "delete", name);
        for (const t of extractRedirectTargets(segment)) push(t, "write", name);
      }
    }
  }
  return ops;
}

/**
 * 从事件流提取变更流水与委派一览（纯函数——流进、报告出，零状态）。
 * callId 成对（tool/call → tool/result）；同 callId 重复以首对为准
 * （store 保证流内 callId 唯一，此处防御性不重算）。
 */
export function reviewChangesFromEvents(events: readonly SessionEvent[]): ReviewReport {
  const operations: ReviewOperation[] = [];
  const delegations: ReviewDelegation[] = [];
  interface OpenCall {
    seq: number;
    ts: number;
    turn: number;
    name: string;
    args: Record<string, unknown>;
  }
  const open = new Map<string, OpenCall>();
  const collabEvents: SessionEvent[] = [];

  for (const e of events) {
    if (e.type === "session/collab") {
      collabEvents.push(e);
      continue;
    }
    if (e.type === "tool/call") {
      open.set(e.callId, { seq: e.seq, ts: e.ts, turn: e.turn, name: e.name, args: parseCallArgs(e.arguments) });
    } else if (e.type === "tool/result") {
      const call = open.get(e.callId);
      if (call === undefined) continue;
      open.delete(e.callId);
      if (call.name === "task") {
        const meta = (e.meta ?? {}) as {
          subagent?: { sessionId?: unknown; stopReason?: unknown };
        };
        const sub = meta.subagent ?? {};
        const stop = sub.stopReason;
        const status =
          e.message.isError === true
            ? stop === "cancelled"
              ? "cancelled"
              : "failed"
            : "completed";
        const durationMs = Math.max(0, e.ts - call.ts);
        delegations.push({
          callSeq: call.seq,
          turn: call.turn,
          description: typeof call.args["description"] === "string" ? (call.args["description"] as string) : "",
          ...(typeof sub.sessionId === "string" ? { subagentSessionId: sub.sessionId } : {}),
          status,
          // 同毫秒结算耗时为 0——真实值照报（running 才无耗时）
          durationMs,
          ...(e.error?.code !== undefined ? { errorCode: e.error.code } : {}),
        });
        continue;
      }
      if (e.message.isError !== true) {
        operations.push(...extractOperations(call.name, call.args, call.seq));
      }
    }
  }
  // 在途 task（call 未结算）→ running（无耗时/子会话 id）
  for (const call of open.values()) {
    if (call.name !== "task") continue;
    delegations.push({
      callSeq: call.seq,
      turn: call.turn,
      description: typeof call.args["description"] === "string" ? (call.args["description"] as string) : "",
      status: "running",
    });
  }
  delegations.sort((a, b) => a.callSeq - b.callSeq);
  return {
    changes: aggregateByPath(operations),
    operations,
    delegations,
    collaborations: collaborationsFromEvents(collabEvents),
  };
}

/** 按归一路径聚合，末次操作决定文件态（流内 seq 序）。 */
function aggregateByPath(operations: readonly ReviewOperation[]): ReviewFileChange[] {
  const byPath = new Map<string, ReviewFileChange>();
  for (const op of [...operations].sort((a, b) => a.seq - b.seq)) {
    byPath.set(op.path, { path: op.path, op: op.op, via: op.via, lastSeq: op.seq });
  }
  return [...byPath.values()].sort((a, b) => a.lastSeq - b.lastSeq);
}

/** 汇总统计（pi-desktop summarizeReviewChanges 行为映射：计数面）。 */
export function summarizeReviewChanges(operations: readonly ReviewOperation[]): ReviewChangesSummary {
  const writes = operations.filter((o) => o.op === "write").length;
  const edits = operations.filter((o) => o.op === "edit").length;
  const deletes = operations.filter((o) => o.op === "delete").length;
  return { files: new Set(operations.map((o) => o.path)).size, writes, edits, deletes };
}
