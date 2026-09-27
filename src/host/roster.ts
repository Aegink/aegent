/**
 * surface roster 投影（N8/T-P1-114）——"多端 = surface roster，attach/detach
 * 由事件维护"的读面：从事件流重建当前在册端清单（surface/attach 入册、
 * surface/detach 出册）。
 *
 * 恢复恒等（流即状态——T-P1-99 先例）：同流两次推导逐字段相等，重启后
 * roster 可见、不需要显式恢复调用。重复 attach 同 surfaceId 幂等（roster
 * 是集合——不重复入册，最新 deliveryKind 生效）；未 attach 的 detach 出册
 * 是 no-op（删除收敛语义，不报错）。
 *
 * 会话级事实源分域记档：会话流承载**会话级** roster（本模块）；host 进程
 * 级跨会话清单由 HostRegistry 内存面承载（registry 是进程内架构面——
 * N8 卡风险栏定形）。
 */

import type { SessionEvent } from "../kernel/events.js";

export interface RosterEntry {
  readonly surfaceId: string;
  readonly deliveryKind: "push" | "poll" | undefined;
}

/**
 * 当前在册端清单：按流序应用 surface/attach（入册）/ surface/detach（出册）。
 * 输入是有效视窗事件（session/revert 生效后由调用方给 effectiveEvents——
 * revert 掉 attach 即出册，与窗口身份 T-P1-99 同口径）。
 */
export function activeRoster(events: readonly SessionEvent[]): RosterEntry[] {
  const roster = new Map<string, RosterEntry>();
  for (const event of events) {
    if (event.type === "surface/attach") {
      roster.set(event.surfaceId, {
        surfaceId: event.surfaceId,
        deliveryKind: event.deliveryKind,
      });
    } else if (event.type === "surface/detach") {
      roster.delete(event.surfaceId);
    }
  }
  return [...roster.values()];
}
