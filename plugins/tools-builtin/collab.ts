/**
 * W2/T9-1 编排方向盘（pi-desktop ADR 0237 形状）：collab 模型工具——动作集
 * spawn/send/status/wait/result/cancel/list，走 registry + policy chain
 * （needsApproval 声明 + 无 allow 规则时 gate 缺省 ask——编排是昂贵且
 * 跨会话的动作，缺省人审）。
 *
 * 依赖（CollabToolPort）由装配注入（本地协作运行时 collab-local——账本
 * CollaborationService + 进程内子代理执行体）；**缺省不注册**（无运行时
 * 的装配零新工具——"可裁剪插件"纪律，与 task/schedule 同款）。
 *
 * 安全模型（ADR 0239）：调用者身份 = deps.sessionId（装配注入的会话 id
 * ——**永不接受模型提供的源**）；send 只认运行时记录的 worker；权限上限
 * dispatch 时固化（快照语义，双向不变——G4）。
 */
import type { ToolDef, ToolExecutionResult } from "../../src/core/index.js";
import type { CollaborationRecord } from "../../src/session/collaboration.js";
import { toolError } from "./util.js";

/** 工具 → 运行时端口（collab-local 的装配切片——测试可注假件）。 */
export interface CollabToolPort {
  dispatch(request: {
    action: "spawn" | "send";
    targetSessionId?: string;
    content: string;
    kind?: "task" | "message";
    notifyOnCompletion?: boolean;
  }): Promise<{ collabId: string; targetSessionId: string; permissionCeiling: string }>;
  cancel(collabId: string): boolean;
  list(): CollaborationRecord[];
  status(collabId: string): CollaborationRecord | undefined;
  wait(collabId: string, timeoutMs: number): Promise<CollaborationRecord | undefined>;
}

export interface CollabToolDeps {
  /** 调用者会话 id（装配注入——host 认证的发送方身份，模型不可伪造）。 */
  readonly sessionId: string;
  readonly port: CollabToolPort;
}

const ACTIONS = ["spawn", "send", "status", "wait", "result", "cancel", "list"] as const;
type CollabAction = (typeof ACTIONS)[number];

/** list 输出上限（投影全量截断——防事件流大库时结果爆上下文）。 */
const LIST_LIMIT = 50;

/** wait 缺省预算（毫秒）——与子代理 task_wait 同量级。 */
const DEFAULT_WAIT_MS = 300_000;
const MAX_WAIT_MS = 600_000;

/** 记录 → 模型可读 JSON（去掉 undefined 字段——投影部分字段可选）。 */
function recordJson(r: CollaborationRecord): string {
  return JSON.stringify({
    collabId: r.collabId,
    kind: r.kind,
    direction: r.direction,
    status: r.status,
    peerSessionId: r.peerSessionId,
    content: r.content,
    ...(r.permissionCeiling !== undefined ? { permissionCeiling: r.permissionCeiling } : {}),
    ...(r.result !== undefined ? { result: r.result } : {}),
    ...(r.error !== undefined ? { error: r.error } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

/** 工具错误统一落法：机器码进 content 文本（模型可见可自修——§11 纪律），
 * 同时保留 error.code 结构化面。 */
function collabError(code: string, message: string): ToolExecutionResult {
  return toolError("CollabError", code, `[${code}] ${message}`);
}

export function createCollabTool(deps: CollabToolDeps): ToolDef {
  return {
    name: "collab",
    sideEffectScope: "system",
    needsApproval: true,
    parallel: false,
    timeoutMs: 660_000,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...ACTIONS],
          description: "spawn|send|status|wait|result|cancel|list",
        },
        content: { type: "string", description: "spawn/send 必填——派发给协作会话的任务/消息内容" },
        targetSessionId: {
          type: "string",
          description: "send 必填——目标协作会话 id（须为 spawn 出的会话）",
        },
        collabId: {
          type: "string",
          description: "status/wait/result/cancel 必填——协作消息 id（collab-N）",
        },
        kind: { type: "string", enum: ["task", "message"], description: "缺省 task" },
        timeoutMs: {
          type: "number",
          description: `wait 的最长等待毫秒数（缺省 ${DEFAULT_WAIT_MS}，上限 ${MAX_WAIT_MS}）`,
        },
        notifyOnCompletion: {
          type: "boolean",
          description: "完成是否回投本会话（缺省 true——回投至多一条，不回环）",
        },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const action = args["action"];
      if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
        return collabError("INVALID_ARGUMENTS", `action 非法：${String(action)}（合法：${ACTIONS.join("|")}）`,
        );
      }
      const collabId = args["collabId"];
      const targetSessionId = args["targetSessionId"];
      const content = args["content"];
      const kind = args["kind"];
      const needsCollabId: readonly string[] = ["status", "wait", "result", "cancel"];
      if (needsCollabId.includes(action) && (typeof collabId !== "string" || collabId === "")) {
        return collabError("INVALID_ARGUMENTS", `${action} 需要 collabId（collab-N）`);
      }
      try {
        if (action === "spawn" || action === "send") {
          if (typeof content !== "string" || content === "") {
            return collabError("INVALID_ARGUMENTS", `${action} 需要非空 content`);
          }
          if (action === "send" && (typeof targetSessionId !== "string" || targetSessionId === "")) {
            return collabError("INVALID_ARGUMENTS", "send 需要 targetSessionId");
          }
          const outcome = await deps.port.dispatch({
            action,
            ...(typeof targetSessionId === "string"
              ? { targetSessionId } // spawn 带目标也透传——运行时类型化拒绝（fail-visible）
              : {}),
            content,
            ...(kind === "task" || kind === "message" ? { kind } : {}),
            ...(args["notifyOnCompletion"] === false ? { notifyOnCompletion: false } : {}),
          });
          return {
            content: JSON.stringify({
              ...outcome,
              caller: deps.sessionId,
              hint: "完成结果将自动回投本会话（至多一条）；status/wait/result 可主动查询",
            }),
          };
        }
        if (action === "status") {
          const record = deps.port.status(collabId as string);
          if (record === undefined) {
            return collabError("COLLAB_UNKNOWN", `未知协作 id：${collabId}（collab_list 可列出本会话全部协作）`,
            );
          }
          return { content: recordJson(record) };
        }
        if (action === "wait") {
          const raw = args["timeoutMs"];
          const timeoutMs =
            typeof raw === "number" && Number.isFinite(raw) && raw > 0
              ? Math.min(Math.floor(raw), MAX_WAIT_MS)
              : DEFAULT_WAIT_MS;
          const record = await deps.port.wait(collabId as string, timeoutMs);
          if (record === undefined) {
            return collabError("COLLAB_UNKNOWN", `未知协作 id：${collabId}（collab_list 可列出本会话全部协作）`,
            );
          }
          if (!["completed", "failed", "cancelled"].includes(record.status)) {
            return {
              content:
                recordJson(record) +
                `\n（等待超时（${String(timeoutMs)}ms）——协作仍在途，稍后可再 wait 或先做别的事）`,
              isError: false,
            };
          }
          return { content: recordJson(record) };
        }
        if (action === "result") {
          const record = deps.port.status(collabId as string);
          if (record === undefined) {
            return collabError("COLLAB_UNKNOWN", `未知协作 id：${collabId}`);
          }
          if (record.status === "queued" || record.status === "running") {
            return collabError("COLLAB_NOT_SETTLED", `协作 ${collabId} 仍在 ${record.status}——用 wait 等待结算后再取结果`,
            );
          }
          return {
            content: JSON.stringify({
              collabId: record.collabId,
              status: record.status,
              ...(record.result !== undefined ? { result: record.result } : {}),
              ...(record.error !== undefined ? { error: record.error } : {}),
            }),
          };
        }
        if (action === "cancel") {
          const cancelled = deps.port.cancel(collabId as string);
          return {
            content: cancelled
              ? JSON.stringify({ collabId, cancelled: true })
              : `协作 ${collabId} 无法取消（不存在或已在执行/已结算——status 可查证）`,
          };
        }
        // list
        const all = deps.port.list();
        return {
          content: JSON.stringify({
            total: all.length,
            records: all.slice(0, LIST_LIMIT).map(recordJson),
          }),
        };
      } catch (e) {
        // 运行时类型化错误（COLLAB_LIMIT/未知目标/参数非法）——fail-visible
        // 回喂模型（§11 校验可见不抛纪律），不上抛炸轮。
        const message = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string }).code;
        return collabError(code ?? "COLLAB_FAILED", message);
      }
    },
  };
}
