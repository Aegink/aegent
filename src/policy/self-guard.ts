/**
 * 自我修改防线（C35）——agent 不得修改自身权限配置与项目指令文件。
 *
 * C35 的 bypass 语义（qwen·classifier-prompts 原文）："即使这次编辑是
 * 用户要求的，也不得顺带加入用户没要求的 allow 规则"——我方落法更硬：
 * agent 发起的对受保护文件的写**一律拒绝**（用户要改自己动手改，不经
 * agent）。这与 T-5-06 的元数据硬拦（C46）同构，但清单不同：
 *   - C46 管"版本控制/agent 元数据目录"（.git/.agents/.codex）；
 *   - 本文件管"权限配置与指令文件"（permissions.json / AGENTS.md，
 *     qwen 清单同位项；只能追加不能替换——C36 纪律）。
 *
 * "agent 发起 vs 用户手动"的边界（卡面风险栏）：P0 单端 CLI 里是调用
 * 上下文标志（经 loop 工具循环的调用恒为 agent 发起，进程内可信）；
 * 用户手改文件根本不进工具循环，天然不受限。多端化后此标志的伪造面
 * 是 P1 权限降级（H3）的事。已知边界：bash 写操作经 T-5-14 虚拟操作
 * 接入本防线，P0 尚不在拦面。
 */

import type { PolicyCall } from "./chain.js";
import type { Verdict } from "./decision.js";
import { isWritePathTool } from "./protected-paths.js";

/**
 * 受保护文件名（C35 清单；只能追加不能替换——C36 纪律）。大小写不敏感
 * 保守向（Windows 盘 AGENTS.md 与 agents.md 同物）。
 */
export const SELF_EDIT_PROTECTED_NAMES = [
  "agents.md",
  "permissions.json",
] as const;

/** 路径任一段命中受保护文件名则返回该段原文；否则 undefined。 */
export function findSelfEditProtectedSegment(
  path: string,
): string | undefined {
  for (const segment of path.split(/[\\/]+/)) {
    if (
      (SELF_EDIT_PROTECTED_NAMES as readonly string[]).includes(
        segment.toLowerCase(),
      )
    ) {
      return segment;
    }
  }
  return undefined;
}

export interface SelfGuardContext {
  /**
   * 本次调用是否 agent 发起。P0：经 loop 工具循环恒为 true；false 仅
   * 用于显式的用户代操作路径（P0 无此路径，测试与 P1 预留）。
   */
  readonly agentInitiated: boolean;
}

/**
 * 自我修改防线：agent 发起的写触及受保护文件 → 无条件 deny（规则不得
 * 授权，同 C46），拒绝理由含"用户可手动修改"提示；非 agent 发起或
 * 非写类调用原样透传。
 */
export function enforceSelfGuard(
  verdict: Verdict,
  call: PolicyCall,
  ctx: SelfGuardContext,
): Verdict {
  if (!ctx.agentInitiated) return verdict;
  if (!isWritePathTool(call.tool)) return verdict;
  const path = call.args.path;
  if (typeof path !== "string") return verdict;
  const segment = findSelfEditProtectedSegment(path);
  if (segment === undefined) return verdict;
  return {
    action: "deny",
    reason:
      `路径 "${path}" 含受保护文件 "${segment}"（权限配置/项目指令文件），` +
      "agent 不得修改自身权限配置与指令上下文（C35）；该文件用户可手动修改",
  };
}
