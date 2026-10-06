/**
 * 协作运行时装配（C10/U27 收官——CollaborationService 生产实例化 + executor
 * 跨会话执行体 + settings op 分发）。装配位 = host 进程（server.ts start()），
 * 分发经模块级句柄（scheduler-ops 同款模式——bridge 构造先于 collab 装配，
 * onSettings 闭包经 tryCollabSettingsOp 间接消费）。
 *
 * 三条事实通道（与 emitRoster 同构——镜像 + 权威 + 广播三面一致）：
 *   - 镜像：store.append（host 内存投影——端上 query 即时可见）；
 *   - 权威：sessionsLibrary.appendBatch（sqlite 落盘——重启可重建）；
 *   - 广播：bridge.broadcastEvent（所有端连接 event 通道——只读面板实时刷）。
 *
 * executor（U27 的"真实执行"缺口收口）：目标会话的执行 = bridge 的
 * host-owned 投递通道 sendSystemPrompt（不经租约——cron 同款授权语义），
 * 完成判定 = 目标会话下一枚 turn/end（监听先于投递挂载，防漏；时间戳
 * 下界滤掉投递前已在途的轮——粗粒度边界，同毫秒竞态记档）。结果文本 =
 * 目标流最近一条 assistant/message。
 */

import { randomUUID } from "node:crypto";
import type { CollabEvent } from "../kernel/events.js";
import { CollaborationService, type CollabExecutor } from "../session/collaboration.js";
import type { CollabKind, CollabPermissionCeiling } from "../kernel/events.js";
import type { SessionStore } from "../session/store.js";
import type { SqliteEventStorage } from "../session/db.js";
import type { HostBridge } from "./bridge.js";
import type { NotificationHub } from "./notify.js";
import type { SettingsCall } from "./protocol-settings.js";
import type { PermissionMode } from "../session/settings.js";

/** 协作权限档映射：五档 PermissionMode → 三值 ceiling（收敛到保守侧——
 * read-only/unattended 不给协作任务放权，落 ask 人审）。 */
export function permissionModeToCeiling(mode: PermissionMode | undefined): CollabPermissionCeiling {
  return mode === "accept-edits" || mode === "auto" ? mode : "ask";
}

export interface CollabRuntimeOptions {
  bridge: HostBridge;
  /** host 镜像读面（server 总建——必传）。 */
  store: SessionStore;
  /** 权威落流（生产 sqlite；缺省 = 仅镜像，测试内存面）。 */
  sessionsLibrary?: SqliteEventStorage;
  /** N5 完成通知（缺省不发）。 */
  notifyHub?: NotificationHub;
  /** 权限快照源（dispatch 时读当前 permission.mode 固化快照）。 */
  getPermissionMode?: () => Promise<PermissionMode | undefined>;
  /** 单次执行预算（缺省 10 分钟——目标会话挂死可回收）。 */
  executorTimeoutMs?: number;
}

export interface CollabRuntime {
  dispatch(request: {
    sourceSessionId: string;
    targetSessionId: string;
    kind: CollabKind;
    content: string;
    notifyOnCompletion?: boolean;
    /** 多会话编排（pi-desktop 同构）：true = 先创建真实新会话再派发——
     * 项目继承源会话、血统落 session_origins（任务栏"子会话"标志数据源）、
     * 标题秒级可读；targetSessionId 届时仅作占位被替换。 */
    createNew?: boolean;
  }): Promise<string>;
  cancel(collabId: string): boolean;
}

export function createCollabRuntime(options: CollabRuntimeOptions): CollabRuntime {
  const { bridge, store } = options;
  const timeoutMs = options.executorTimeoutMs ?? 600_000;
  /** dispatch 记账（collabId → 目标——executor 闭包的 target 来源；结算后清）。 */
  const targetOf = new Map<string, string>();

  const append = (sessionId: string, event: CollabEvent): void => {
    const committed = store.append(sessionId, [event]);
    if (options.sessionsLibrary !== undefined) options.sessionsLibrary.appendBatch(sessionId, committed);
    bridge.broadcastEvent(sessionId, committed);
  };

  const executor: CollabExecutor = async (task) => {
    const targetId = targetOf.get(task.collabId) ?? "";
    const promptText =
      `【协作${task.kind === "task" ? "任务" : "消息"} ${task.collabId}】（权限档快照：${task.permissionCeiling}）\n\n` +
      `${task.content}\n\n（来自另一会话的协作派发——请直接处理；你的最终结论将回投源会话。）`;
    const messageId = `${task.collabId}-prompt`;
    const startedAt = Date.now() - 1;
    let timer: NodeJS.Timeout | undefined;
    const settlement = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      let settled = false;
      const finish = (outcome: { ok: boolean; error?: string }): void => {
        if (settled) return;
        settled = true;
        off();
        if (timer !== undefined) clearTimeout(timer);
        resolve(outcome);
      };
      // 监听先于投递挂载（防漏——投递到受理到轮启的窗口不能丢 turn/end）
      const off = bridge.onEvent((sessionId, event) => {
        if (sessionId !== targetId) return;
        if (event.type === "turn/end" && event.ts >= startedAt) {
          finish(event.reason.kind === "error" ? { ok: false, error: "目标会话执行失败" } : { ok: true });
        }
      });
      timer = setTimeout(
        () => finish({ ok: false, error: `协作执行超时（${String(timeoutMs)}ms）——目标会话未收轮` }),
        timeoutMs,
      );
      void bridge
        .sendSystemPrompt(targetId, { type: "prompt", messageId, content: promptText })
        .then((receipt) => {
          // resolve = 受理（accepted）或投递链错误（__bridgeError——child
          // 不在/协议坏）；受理后继续等 turn/end 结算。
          if (
            receipt !== null &&
            typeof receipt === "object" &&
            "__bridgeError" in (receipt as Record<string, unknown>)
          ) {
            const err = (receipt as { __bridgeError: { message?: string } }).__bridgeError;
            finish({ ok: false, error: `协作投递失败：${err.message ?? "未知错误"}` });
          }
        })
        .catch((e: unknown) => finish({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    });
    // 结果提取：目标流最近一条 assistant/message（turn 结算后的最终结论）
    const events = store.load(targetId);
    const lastAssistant = [...events].reverse().find((e) => e.type === "assistant/message");
    const text =
      lastAssistant !== undefined
        ? ((lastAssistant as { message?: { content?: string } }).message?.content ?? "")
        : "";
    targetOf.delete(task.collabId);
    return settlement.ok
      ? { status: "completed", result: text }
      : { status: "failed", error: settlement.error };
  };

  const service = new CollaborationService({
    append,
    sessionExists: (sessionId) =>
      options.sessionsLibrary !== undefined
        ? options.sessionsLibrary.readSessionIndex(sessionId) !== null
        : store.sessionIds().includes(sessionId),
    executor,
    notify:
      options.notifyHub === undefined
        ? undefined
        : (payload) => {
            options.notifyHub!.publish("job_settled", { name: "collab_settled", ...payload });
          },
  });

  const pump = async (targetSessionId: string): Promise<void> => {
    // runNext 自带 per-target 串行防重入（并发泵调用空转返回 null）
    while ((await service.runNext(targetSessionId)) !== null) {
      /* 队列消费完为止 */
    }
  };

  return {
    dispatch: async (request) => {
      // 多会话编排创建（先于 service.dispatch——COLLAB_TARGET_MISSING 纪律
      // 不破：service 继续只认已存在目标，"因协作而创建"是装配层的有意例外）。
      let targetSessionId = request.targetSessionId;
      if (request.createNew === true) {
        targetSessionId = createOrchestrationSession(options, request.sourceSessionId, request.content);
      }
      const mode = options.getPermissionMode !== undefined ? await options.getPermissionMode() : undefined;
      const collabId = service.dispatch({
        ...request,
        targetSessionId,
        permissionCeiling: permissionModeToCeiling(mode),
      });
      targetOf.set(collabId, targetSessionId);
      void pump(targetSessionId);
      return collabId;
    },
    cancel: (collabId) => service.cancel(collabId),
  };
}

/** 编排子会话创建（pi-desktop 多会话编排的"真实独立 Session"语义）：
 * 空会话即落库（task-create 同款毫秒级可见）+ 项目继承源会话 + 血统标记 +
 * 秒级标题（首行截断——清单立即可读，不等自动命名）。 */
function createOrchestrationSession(
  options: CollabRuntimeOptions,
  sourceSessionId: string,
  content: string,
): string {
  const db = options.sessionsLibrary;
  if (db === undefined) {
    throw new Error("编排创建需要权威会话库（sessionsLibrary 未装配）");
  }
  const sessionId = randomUUID();
  db.createSession(sessionId);
  const projectId = db.getSessionProject(sourceSessionId);
  if (projectId !== undefined) db.setSessionProject(sessionId, projectId);
  db.setSessionOrigin(sessionId, sourceSessionId);
  db.setTitle(sessionId, `协作：${content.split("\n")[0]?.slice(0, 40) ?? ""}`, "generated");
  return sessionId;
}

// ---------------------------------------------------------------------------
// 模块级句柄（scheduler-ops 同款——bridge 的 onSettings 闭包消费入口）
// ---------------------------------------------------------------------------

let runtime: CollabRuntime | undefined;

export function setCollabRuntime(instance: CollabRuntime | undefined): void {
  runtime = instance;
}

/** settings op 分发（collab-dispatch / collab-cancel）——未装配返回 undefined
 * （分发层继续走；未装配但 op 命中 = 类型化"未启用"报错）。 */
export async function tryCollabSettingsOp(call: SettingsCall): Promise<unknown> {
  if (call.op === "collab-dispatch") {
    if (runtime === undefined) throw collabUnavailable();
    const collabId = await runtime.dispatch({
      sourceSessionId: call.sourceSessionId!,
      targetSessionId: call.targetSessionId!,
      kind: call.kind as CollabKind,
      content: call.content!,
      ...(call.createNew === true ? { createNew: true } : {}),
    });
    return { collabId };
  }
  if (call.op === "collab-cancel") {
    if (runtime === undefined) throw collabUnavailable();
    return { cancelled: runtime.cancel(call.collabId!) };
  }
  return undefined;
}

function collabUnavailable(): Error {
  const error = new Error("协作运行时未装配（host 缺少 bridge/store——collab 面不可用）");
  (error as unknown as { code: string }).code = "COLLAB_UNAVAILABLE";
  return error;
}
