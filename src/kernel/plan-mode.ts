/**
 * plan 模式（G1/G7，T-P1-11）——Q21 裁决"混合"：状态是同一个 agent（不
 * 另起子代理、读不限），该状态下**写/执行权限硬关**（出口级，规则不得
 * 授权——policy/plan-guard.ts 消费 WRITE_EXECUTE_TOOLS）。
 *
 * 进出是显式动作：plan_enter / plan_exit 工具（opencode 同款双工具）。
 * 不变量 1：进出动作的流内事实 = 这两个工具的 tool/call + tool/result
 * （不扩词汇表——批次全局约束 2 只给 T-P1-06/10/12 预留扩展；tool 事件
 * 天然落流，本文件提供按流重建的读取面）。退出需用户批准：plan_exit 不
 * 在任何放行面（meta-ops 白名单不含）——默认 ask，用户批准才结算，
 * opencode plan_exit 的 question.ask 同语义；plan 模式下两工具仍可调
 * （不在 WRITE_EXECUTE_TOOLS——进出通道必须在硬关期间保持开放）。
 *
 * 服务是进程内存态（即时生效）；重启恢复走 planModeFromEvents 按流重建
 * （T-P1-13 计划落盘依赖此读取面）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SessionEvent } from "./events.js";

export interface PlanModeService {
  /** plan 模式是否激活（gate/revalidate 出口每调用活查询）。 */
  readonly isActive: boolean;
  /** 进入 plan 模式（幂等：已激活时 no-op）。 */
  enter(): void;
  /** 退出 plan 模式（幂等：未激活时 no-op）。 */
  exit(): void;
}

export function createPlanModeService(): PlanModeService {
  let active = false;
  return {
    get isActive(): boolean {
      return active;
    },
    enter(): void {
      active = true;
    },
    exit(): void {
      active = false;
    },
  };
}

const PLAN_MODE_TOOLS = new Set(["plan_enter", "plan_exit"]);

/**
 * 从事件流重建 plan 模式状态（G1 验收④"可投影"的读取面；重启恢复）：
 * 扫描 plan_enter / plan_exit 的 tool 调用，**成功结算**（tool/result 且
 * 非 isError）的最新一次决定状态——被拒绝/超时的进出申请（isError 结果）
 * 不改变状态。流即事实：无需额外标记事件。
 */
export function planModeFromEvents(events: readonly SessionEvent[]): boolean {
  let active = false;
  const pending = new Map<string, string>();
  for (const e of events) {
    if (e.type === "tool/call" && PLAN_MODE_TOOLS.has(e.name)) {
      pending.set(e.callId, e.name);
    } else if (e.type === "tool/result") {
      const name = pending.get(e.callId);
      if (name === undefined) continue;
      pending.delete(e.callId);
      if (e.message.isError) continue;
      active = name === "plan_enter";
    }
  }
  return active;
}

/**
 * 计划 artifact 落盘（G4，T-P1-13）——"计划是持久 artifact"（pi-desktop
 * ADR 0053 纪律）：plan_exit 批准结算时把计划文本写入会话目录（plan.md）。
 * 只写文件不落事件；checkpoint{provider:"plan"} 事件由装配闭包在落盘成功
 * 后 append（路径进 ref，事件与文件一个事务方向：文件失败则不记 checkpoint，
 * 绝不产生指向不存在文件的引用）。
 *
 * 与代码 checkpoint（E11）互不干扰的结构保证：artifact 是 untracked 新
 * 文件——`git stash create` 不含 untracked（git-checkpoint.ts 头注释的
 * pi 同款边界），/revert 的代码回退不动它。
 */
export function savePlanArtifact(
  dir: string,
  sessionId: string,
  plan: string,
): { path: string } {
  const sessionDir = path.join(dir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, "plan.md");
  writeFileSync(filePath, plan, "utf8");
  return { path: filePath };
}

/**
 * 流内最新 plan checkpoint 的 artifact 路径（G4 重启恢复读取面：重启后
 * 计划可见——按流找 ref.path 再读文件；"不续跑"由 Q5 启动对账闭合，
 * 本函数只管"计划还在哪里"）。
 */
export function planArtifactFromEvents(
  events: readonly SessionEvent[],
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "checkpoint" || e.provider !== "plan") continue;
    const ref = e.ref;
    if (
      ref !== null &&
      typeof ref === "object" &&
      !Array.isArray(ref) &&
      typeof (ref as { path?: unknown }).path === "string"
    ) {
      return (ref as { path: string }).path;
    }
  }
  return null;
}
