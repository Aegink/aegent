/**
 * session_query / session_get 工具（Q2，T-P2-105）——把会话检索作为
 * **agent 工具**暴露（dsh·tool-session-query 的"模型可检索历史会话"
 * 行为；最小面两工具，其五工具全集不取）。
 *
 * - `session_query`：条件检索（会话 id 前缀 / 时间区间 / 事件类型 / 内容
 *   子串 / 分页）——只返回摘要行与摘录（模型据此再定点读取）。
 * - `session_get`：读一个会话的事件（seq 升序，分页 + 单条截断）——这是
 *   "读历史会话原文"的定点面。
 *
 * 权限面：两者都是**只读类**（不入 WRITE_EXECUTE_TOOLS——plan 模式可用、
 * M9 类级准入计读类；无策略规则时按不变量 3 默认 ask——查询历史会话是
 * 读用户数据，不似 todo_write 那样"零工作区副作用"，不加入 meta-ops
 * 白名单）。工具执行零落流（查询是读面——事件流不被工具调用污染）。
 *
 * 输出纪律：模型可见输出有界（行数 = limit；单条 JSON 截断 2000 字符）——
 * 详情面（无截断全文）由 E7 transcript/导出承担。
 */

import type { ToolDef } from "../registry.js";
import {
  MAX_QUERY_LIMIT,
  SessionQueryError,
  getSessionEvents,
  querySessions,
  type SessionQueryRow,
} from "../../../session/query.js";
import { SessionArchivedError } from "../../../session/db.js";
import { EVENT_TYPES } from "../../events.js";
import { toolError } from "./util.js";

/** 单条事件 JSON 在工具输出里的截断上限（模型可见输出有界）。 */
const MAX_EVENT_JSON_CHARS = 2000;

export interface SessionQueryToolDeps {
  /** 会话库路径（装配注入；缺省不注册——无库无查询面）。 */
  dbPath: string;
  /** 工具面分页上限（缺省 MAX_QUERY_LIMIT；调试面可收窄）。 */
  maxLimit?: number;
  /**
   * T5-3/EP-3 跨会话只读授权（宿主装配注入——dsh §15：目标 cwd 与调用者
   * 完全一致才授权；调用者无 cwd 只能读自身）。**授权下推为 SQL 过滤**
   * （allowedSessionIds 集合进 WHERE IN——非读后过滤）。缺省 undefined =
   * 未装配授权面（既有行为零变化，记档）。
   */
  authorizeRead?: (caller: { sessionId: string; cwd?: string; targetSessionId?: string }) => {
    allowed: boolean;
    allowedSessionIds?: readonly string[];
    reason?: string;
  };
  /** 调用者身份（child 会话 id + cwd——装配注入）。 */
  caller?: { sessionId: string; cwd?: string };
}

function formatRow(row: SessionQueryRow): string {
  const iso = new Date(row.ts).toISOString();
  const lines = [`[${row.sessionId}] seq=${row.seq} type=${row.type} ts=${iso}`];
  if (row.excerpt !== undefined) lines.push(`  摘录：${row.excerpt}`);
  return lines.join("\n");
}

function queryFailure(error: unknown): ReturnType<typeof toolError> {
  if (error instanceof SessionQueryError) {
    return toolError("SessionQueryError", error.code, error.message);
  }
  if (error instanceof SessionArchivedError) {
    return toolError(
      "SessionArchivedError",
      error.code,
      `${error.message}——用 readArchivedSession（归档档）读取，或省略该会话条件`,
    );
  }
  return toolError(
    "SessionQueryError",
    "QUERY_FAILED",
    `查询失败：${error instanceof Error ? error.message : String(error)}`,
  );
}

export function createSessionQueryTool(deps: SessionQueryToolDeps): ToolDef {
  const maxLimit = deps.maxLimit ?? MAX_QUERY_LIMIT;
  return {
    name: "session_query",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parallel: true, // B17：纯读，声明可并行（parallel 模式持读锁）
    parameters: {
      type: "object",
      properties: {
        sessionIdPrefix: { type: "string", description: "会话 id 前缀（缺省全库检索）" },
        types: {
          type: "array",
          description: "事件类型过滤（词汇表闭集，OR 语义）",
          items: { type: "string", enum: [...EVENT_TYPES] },
        },
        fromTs: { type: "number", description: "事件时间下界（epoch 毫秒，含界）" },
        toTs: { type: "number", description: "事件时间上界（epoch 毫秒，含界）" },
        content: { type: "string", description: "内容子串（对事件载荷做 SQL LIKE 子串匹配）" },
        limit: { type: "number", description: `返回条数（1..${maxLimit}，缺省 50）` },
        offset: { type: "number", description: "分页偏移（缺省 0）" },
      },
    },
    async execute(args) {
      if (args.sessionIdPrefix !== undefined && typeof args.sessionIdPrefix !== "string") {
        return toolError("SessionQueryError", "INVALID_ARGUMENTS", "sessionIdPrefix 须为字符串");
      }
      if (args.content !== undefined && typeof args.content !== "string") {
        return toolError("SessionQueryError", "INVALID_ARGUMENTS", "content 须为字符串");
      }
      if (args.types !== undefined && !Array.isArray(args.types)) {
        return toolError("SessionQueryError", "INVALID_ARGUMENTS", "types 须为字符串数组");
      }
      try {
        // T5-3/EP-3：授权下推（宿主 authorize 产物 → SQL IN 白名单；未装配
        // 授权面 = 既有行为零变化）
        let allowedSessionIds: readonly string[] | undefined;
        if (deps.authorizeRead !== undefined && deps.caller !== undefined) {
          const verdict = deps.authorizeRead(deps.caller);
          if (!verdict.allowed) {
            return toolError("SessionQueryError", "SESSION_READ_DENIED", verdict.reason ?? "跨会话读取未授权");
          }
          allowedSessionIds = verdict.allowedSessionIds;
        }
        const result = querySessions(deps.dbPath, {
          ...(allowedSessionIds !== undefined ? { sessionIds: allowedSessionIds } : {}),
          ...(args.sessionIdPrefix !== undefined
            ? { sessionIdPrefix: args.sessionIdPrefix as string }
            : {}),
          ...(args.types !== undefined ? { types: args.types as never } : {}),
          ...(typeof args.fromTs === "number" ? { fromTs: args.fromTs } : {}),
          ...(typeof args.toTs === "number" ? { toTs: args.toTs } : {}),
          ...(args.content !== undefined ? { contentLike: args.content as string } : {}),
          ...(typeof args.limit === "number"
            ? { limit: Math.min(Math.trunc(args.limit), maxLimit) }
            : {}),
          ...(typeof args.offset === "number" ? { offset: Math.max(0, Math.trunc(args.offset)) } : {}),
        });
        const lines = [
          `命中 ${result.total} 条（limit=${result.limit} offset=${result.offset} hasMore=${result.hasMore}）`,
        ];
        for (const row of result.rows) lines.push(formatRow(row));
        if (result.archivedSessions.length > 0) {
          lines.push(
            `另有 ${result.archivedSessions.length} 个已归档会话命中 id 条件：${result.archivedSessions.join(", ")}（数据在归档档，主库已移出）`,
          );
        }
        return { content: lines.join("\n") };
      } catch (error) {
        return queryFailure(error);
      }
    },
  };
}

export function createSessionGetTool(deps: SessionQueryToolDeps): ToolDef {
  const maxLimit = deps.maxLimit ?? MAX_QUERY_LIMIT;
  return {
    name: "session_get",
    parallel: true, // B17：纯读，声明可并行（parallel 模式持读锁）
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "要读取的会话 id" },
        fromSeq: { type: "number", description: "起始事件序号（含，缺省 1）" },
        limit: { type: "number", description: `返回条数（1..${maxLimit}，缺省 50）` },
      },
      required: ["sessionId"],
    },
    async execute(args) {
      const sessionId = args.sessionId;
      if (typeof sessionId !== "string" || sessionId === "") {
        return toolError("SessionQueryError", "INVALID_ARGUMENTS", "session_get 需要 sessionId 非空字符串");
      }
      // T5-3/EP-3：单点授权（宿主 authorize——目标 cwd 与调用者一致才放行；
      // 未装配授权面 = 既有行为零变化）
      if (deps.authorizeRead !== undefined && deps.caller !== undefined) {
        const verdict = deps.authorizeRead({ ...deps.caller, targetSessionId: sessionId });
        if (!verdict.allowed) {
          return toolError("SessionQueryError", "SESSION_READ_DENIED", verdict.reason ?? `会话 ${sessionId} 读取未授权`);
        }
      }
      try {
        const read = getSessionEvents(deps.dbPath, sessionId, {
          ...(typeof args.fromSeq === "number" ? { fromSeq: Math.trunc(args.fromSeq) } : {}),
          ...(typeof args.limit === "number"
            ? { limit: Math.min(Math.trunc(args.limit), maxLimit) }
            : {}),
        });
        const lines = [
          `会话 ${read.sessionId}：共 ${read.total} 条事件，本次从 seq=${read.fromSeq} 起 ${read.events.length} 条（hasMore=${read.hasMore}）`,
        ];
        for (const row of read.events) {
          const json = JSON.stringify(row.event);
          lines.push(
            json.length > MAX_EVENT_JSON_CHARS
              ? `seq=${row.seq} ${json.slice(0, MAX_EVENT_JSON_CHARS)}…（截断）`
              : `seq=${row.seq} ${json}`,
          );
        }
        return { content: lines.join("\n") };
      } catch (error) {
        return queryFailure(error);
      }
    },
  };
}
