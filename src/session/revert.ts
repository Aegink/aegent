/**
 * revert 回退到任意事件点（E4）——接口形状取自 opencode `session/revert.ts`：
 * revert 是会话级服务接口，且必须带 unrevert 逆操作。代码状态回退在 E11（T-8-02），
 * 本服务只做对话态。
 *
 * 实现纪律：append-only 流不可截断（不变量 1）——revert/unrevert 都以追加
 * `session/revert` 标记事件落流，投影按"最新标记生效"解释，绝不删改历史。
 */

import type { SessionProjection } from "./project.js";
import { project } from "./project.js";
import type { SessionStore } from "./store.js";

export class RevertService {
  constructor(private readonly store: SessionStore) {}

  /** 回退到 targetSeq：追加 revert 标记并重算有效投影。targetSeq 之后的效果对消费方隐藏。 */
  revert(sessionId: string, targetSeq: number): SessionProjection {
    const events = this.store.load(sessionId);
    if (events.length === 0) throw new Error(`revert(${sessionId})：空会话无可回退`);
    if (!Number.isInteger(targetSeq) || targetSeq < 0 || targetSeq > events.length) {
      throw new Error(`revert 目标 seq=${targetSeq} 越界（合法范围 0..${events.length}）`);
    }
    // 标记挂在当前最后一个 turn 的上下文上（元事件不做开合要求，见 events.ts）
    const turn = events[events.length - 1]!.turn;
    this.store.append(sessionId, [{ type: "session/revert", turn, targetSeq, phase: "revert" }]);
    return project(this.store.load(sessionId));
  }

  /** 撤销当前 revert：追加 undo 标记并重算有效投影。无 revert 在身时是幂等 no-op。 */
  unrevert(sessionId: string): SessionProjection {
    const events = this.store.load(sessionId);
    if (events.length === 0) return project(events);
    const lastMarker = [...events].reverse().find((e) => e.type === "session/revert");
    if (!lastMarker || lastMarker.phase === "undo") return project(events); // 没有生效的 revert
    const turn = events[events.length - 1]!.turn;
    this.store.append(sessionId, [{ type: "session/revert", turn, targetSeq: 0, phase: "undo" }]);
    return project(this.store.load(sessionId));
  }
}
