/**
 * W15b/T9-7 跨会话 trace 家族工具（§15——dsh 五只读工具的 trace 三件，
 * 最优评估锚点 tool-session-query/src/index.ts:66-109）：
 *   - session_trace：授权会话的血统（祖先链 + 派生子会话 + 编排投影）；
 *   - session_event_trace：某事件的直接关系（sessionRefs 引用者 +
 *     revert/compaction 覆盖标记）；
 *   - session_event_read：一个完整事件 + 前后原始事件摘要。
 *
 * 授权边界与 session_query 同面（EP-3——dsh workspace-access 同构：目标
 * cwd 与调用者一致才授权，SQL IN 下推）。只读类——零落流。
 */
import type { ToolDef, ToolExecutionResult } from "../../src/core/index.js";
import { SqliteEventStorage } from "../../src/session/db.js";
import { getSessionEvents, MAX_QUERY_LIMIT } from "../../src/session/query.js";
import { toolError } from "./util.js";

export interface SessionTraceDeps {
  /** 库路径（提供时才注册——无持久库的装配无历史面）。 */
  readonly dbPath: string;
  /** T5-3/EP-3 跨会话只读授权（与 session_query 同源注入）。 */
  authorizeRead?: (caller: { sessionId: string; cwd?: string; targetSessionId?: string }) => {
    allowed: boolean;
    allowedSessionIds?: readonly string[];
    reason?: string;
  };
  /** 调用者身份（child 会话 id + cwd——装配注入）。 */
  caller?: { sessionId: string; cwd?: string };
}

/** 授权下推（denied → 类型化工具错误；allowed → 白名单集合）。 */
function authorize(
  deps: SessionTraceDeps,
  targetSessionId: string,
): { ok: true } | { ok: false; result: ToolExecutionResult } {
  if (deps.authorizeRead === undefined) return { ok: true };
  const verdict = deps.authorizeRead({
    sessionId: deps.caller?.sessionId ?? "",
    ...(deps.caller?.cwd !== undefined ? { cwd: deps.caller.cwd } : {}),
    targetSessionId,
  });
  if (!verdict.allowed) {
    return {
      ok: false,
      result: toolError(
        "SessionTraceError",
        "SESSION_READ_DENIED",
        `[SESSION_READ_DENIED] 跨会话读被拒绝：${verdict.reason ?? "授权边界（EP-3——目标 cwd 与调用者一致才授权）"}`,
      ),
    };
  }
  return { ok: true };
}

/** 事件单行摘要（前后文视图——与 session_get 的截断面同风格）。 */
function eventSummary(row: { seq: number; type: string; ts: number; event: unknown }): string {
  const payload = JSON.stringify(row.event);
  const preview = payload.length > 160 ? `${payload.slice(0, 160)}…` : payload;
  return `seq=${row.seq} ${row.type} ts=${row.ts} ${preview}`;
}

export function createSessionTraceTools(deps: SessionTraceDeps): ToolDef[] {
  return [
    {
      name: "session_trace",
      sideEffectScope: "none",
      readOnly: true,
      parallel: true,
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "目标会话 id（授权边界内）" },
        },
        required: ["sessionId"],
      },
      execute: async (args) => {
        const sessionId = args["sessionId"];
        if (typeof sessionId !== "string" || sessionId === "") {
          return toolError("SessionTraceError", "INVALID_ARGUMENTS", "[INVALID_ARGUMENTS] sessionId 须为非空字符串");
        }
        const auth = authorize(deps, sessionId);
        if (!auth.ok) return auth.result;
        const storage = SqliteEventStorage.open({ path: deps.dbPath });
        try {
          const origin = storage.getSessionOrigin(sessionId);
          const children = storage
            .listSessionOrigins()
            .filter((row) => row.parentSessionId === sessionId)
            .map((row) => row.sessionId);
          // fork 血统（子流头部的 session/fork lineage 事件——本会话的 fork 父）
          const firstEvents = getSessionEvents(deps.dbPath, sessionId, { fromSeq: 1, limit: 5 });
          const forkEvent = firstEvents.events.find((row) => row.type === "session/fork");
          const forkParent =
            forkEvent !== undefined
              ? ((forkEvent.event as { sessionId?: string }).sessionId as string | undefined)
              : undefined;
          return {
            content: JSON.stringify({
              sessionId,
              ...(origin !== undefined ? { createdBySession: origin } : {}),
              ...(forkParent !== undefined ? { forkedFrom: forkParent } : {}),
              createdSessions: children,
            }),
          };
        } catch (e) {
          const code = (e as { code?: string }).code ?? "SESSION_TRACE_FAILED";
          const message = e instanceof Error ? e.message : String(e);
          return toolError("SessionTraceError", code, `[${code}] ${message}`);
        } finally {
          storage.close();
        }
      },
    },
    {
      name: "session_event_trace",
      sideEffectScope: "none",
      readOnly: true,
      parallel: true,
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "目标会话 id" },
          seq: { type: "number", description: "目标事件 seq（≥1）" },
        },
        required: ["sessionId", "seq"],
      },
      execute: async (args) => {
        const sessionId = args["sessionId"];
        const seq = args["seq"];
        if (typeof sessionId !== "string" || sessionId === "") {
          return toolError("SessionTraceError", "INVALID_ARGUMENTS", "[INVALID_ARGUMENTS] sessionId 须为非空字符串");
        }
        if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
          return toolError("SessionTraceError", "INVALID_ARGUMENTS", "[INVALID_ARGUMENTS] seq 须为正整数");
        }
        const auth = authorize(deps, sessionId);
        if (!auth.ok) return auth.result;
        try {
          const all = getSessionEvents(deps.dbPath, sessionId, { fromSeq: 1, limit: MAX_QUERY_LIMIT });
          const target = all.events.find((row) => row.seq === seq);
          if (target === undefined) {
            return toolError("SessionTraceError", "SESSION_NOT_FOUND", `[SESSION_NOT_FOUND] 事件不存在：${sessionId}#${String(seq)}`);
          }
          // 引用者：本会话内带 sessionRefs 且指向 (sessionId, seq) 的事件
          const referencedBy = all.events
            .filter((row) => {
              const refs = (row.event as { sessionRefs?: readonly { sessionId?: string; seq?: number }[] })
                .sessionRefs;
              return (
                refs !== undefined &&
                refs.some((r) => r.sessionId === sessionId && r.seq === seq)
              );
            })
            .map((row) => ({ seq: row.seq, type: row.type }));
          // 覆盖标记：目标之后的首个 revert/compaction（语义覆盖关系）
          const override = all.events.find(
            (row) =>
              row.seq > seq && (row.type === "session/revert" || row.type === "compaction"),
          );
          return {
            content: JSON.stringify({
              sessionId,
              seq,
              type: target.type,
              ts: target.ts,
              event: target.event,
              referencedBy,
              ...(override !== undefined
                ? { overriddenBy: { seq: override.seq, type: override.type } }
                : {}),
            }),
          };
        } catch (e) {
          const code = (e as { code?: string }).code ?? "SESSION_TRACE_FAILED";
          const message = e instanceof Error ? e.message : String(e);
          return toolError("SessionTraceError", code, `[${code}] ${message}`);
        }
      },
    },
    {
      name: "session_event_read",
      sideEffectScope: "none",
      readOnly: true,
      parallel: true,
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "目标会话 id" },
          seq: { type: "number", description: "目标事件 seq（≥1）" },
          context: { type: "number", description: "前后各取几条摘要（缺省 3，上限 10）" },
        },
        required: ["sessionId", "seq"],
      },
      execute: async (args) => {
        const sessionId = args["sessionId"];
        const seq = args["seq"];
        const context =
          typeof args["context"] === "number" && Number.isFinite(args["context"])
            ? Math.min(Math.max(Math.floor(args["context"]), 0), 10)
            : 3;
        if (typeof sessionId !== "string" || sessionId === "") {
          return toolError("SessionTraceError", "INVALID_ARGUMENTS", "[INVALID_ARGUMENTS] sessionId 须为非空字符串");
        }
        if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
          return toolError("SessionTraceError", "INVALID_ARGUMENTS", "[INVALID_ARGUMENTS] seq 须为正整数");
        }
        const auth = authorize(deps, sessionId);
        if (!auth.ok) return auth.result;
        try {
          const from = Math.max(1, seq - context);
          const read = getSessionEvents(deps.dbPath, sessionId, {
            fromSeq: from,
            limit: context * 2 + 1,
          });
          const target = read.events.find((row) => row.seq === seq);
          if (target === undefined) {
            return toolError("SessionTraceError", "SESSION_NOT_FOUND", `[SESSION_NOT_FOUND] 事件不存在：${sessionId}#${String(seq)}`);
          }
          return {
            content: JSON.stringify({
              sessionId,
              event: target.event,
              before: read.events
                .filter((row) => row.seq < seq)
                .map((row) => eventSummary(row)),
              after: read.events
                .filter((row) => row.seq > seq)
                .map((row) => eventSummary(row)),
            }),
          };
        } catch (e) {
          const code = (e as { code?: string }).code ?? "SESSION_TRACE_FAILED";
          const message = e instanceof Error ? e.message : String(e);
          return toolError("SessionTraceError", code, `[${code}] ${message}`);
        }
      },
    },
  ];
}
