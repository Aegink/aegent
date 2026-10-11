/**
 * 编排投影（W15b/T9-7——pi-desktop SessionCollaborationSummary 同构，
 * 最优评估 §15）：把分散在 session_origins 表 + session/collab 事件流的
 * 编排事实聚合成一个统一投影——
 *   - createdBySession：本会话因谁而创建（session_origins 逆查）；
 *   - createdSessions：本会话派生了谁（session_origins 正查）；
 *   - currentTask：最近一条仍在途的协作任务（queued/running——事件流投影）；
 *   - result：最近一条已结算协作的结果（completed/failed/cancelled）。
 * 事件是唯一真相（G4 双流四向不动）——本投影只读重组，不养第二份状态。
 */

import type { SessionEvent, SessionStore } from "../core/index.js";
import { collaborationsFromEvents, type CollaborationRecord } from "./collaboration.js";

/** 编排投影（pi-desktop SessionCollaborationSummary 的字段对位）。 */
export interface CollaborationProjection {
  /** 本会话的创建者（非编排派生 = undefined）。 */
  readonly createdBySession?: string;
  /** 本会话派生的子会话（无 = 空数组）。 */
  readonly createdSessions: readonly string[];
  /** 最近在途协作（queued/running——含目标/内容/快照权限）。 */
  readonly currentTask?: {
    readonly collabId: string;
    readonly kind: string;
    readonly peerSessionId: string;
    readonly status: string;
    readonly content: string;
  };
  /** 最近已结算协作的结果（completed/failed/cancelled）。 */
  readonly result?: {
    readonly collabId: string;
    readonly status: string;
    readonly result?: string;
    readonly error?: string;
  };
}

/** 从单条事件流提取源视角协作记录（与往来面板同源——collaborationsFromEvents）。 */
function outgoingCollabs(events: readonly SessionEvent[]): CollaborationRecord[] {
  return collaborationsFromEvents(events).filter((r) => r.direction === "outgoing");
}

/**
 * 编排投影（db 血统 + 流投影两源聚合）。originOf/childrenOf 为宿主注入
 * 面（session_origins 读写对偶——SqliteEventStorage.getSessionOrigin/
 * listSessionOrigins 的闭包投影；缺省 undefined = 两字段留空）。
 */
export function collaborationProjection(options: {
  sessionId: string;
  store: SessionStore;
  originOf?: (sessionId: string) => string | undefined;
  childrenOf?: (sessionId: string) => readonly string[];
}): CollaborationProjection {
  const records = outgoingCollabs(options.store.load(options.sessionId));
  const active = records.filter((r) => r.status === "queued" || r.status === "running");
  const settled = records.filter((r) => r.status !== "queued" && r.status !== "running");
  const lastActive = active[active.length - 1];
  const lastSettled = settled[settled.length - 1];
  return {
    ...(options.originOf !== undefined
      ? (() => {
          const origin = options.originOf!(options.sessionId);
          return origin !== undefined ? { createdBySession: origin } : {};
        })()
      : {}),
    ...(options.childrenOf !== undefined
      ? { createdSessions: [...options.childrenOf(options.sessionId)] }
      : { createdSessions: [] }),
    ...(lastActive !== undefined
      ? {
          currentTask: {
            collabId: lastActive.collabId,
            kind: lastActive.kind,
            peerSessionId: lastActive.peerSessionId,
            status: lastActive.status,
            content: lastActive.content,
          },
        }
      : {}),
    ...(lastSettled !== undefined
      ? {
          result: {
            collabId: lastSettled.collabId,
            status: lastSettled.status,
            ...(lastSettled.result !== undefined ? { result: lastSettled.result } : {}),
            ...(lastSettled.error !== undefined ? { error: lastSettled.error } : {}),
          },
        }
      : {}),
  };
}
