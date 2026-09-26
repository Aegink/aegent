/**
 * plan 模式硬关（G7，T-P1-11）——出口级最终组合，与 C46 硬拦同构：
 * plan 激活时写/执行类工具（WRITE_EXECUTE_TOOLS 唯一权威，protected-paths
 * 同款结构）无条件 deny，链上任何 allow/ask 规则、meta-ops 白名单都压不过
 * ——G7 纪律"不靠提示词自律"，模式限制是出口属性（T-P1-01 结构复用）。
 *
 * 读类工具（read/glob/grep/skill_load）与 plan 进出工具（plan_enter/
 * plan_exit——硬关期间的进出通道必须开放）不在拦面。调用位与
 * enforceProtectedPaths 同位两处出口：gate（C9 规范执行面）+ revalidator
 * （C57 执行点重算）。
 */

import type { PolicyCall } from "./chain.js";
import type { Verdict } from "./decision.js";
import { isWriteExecuteTool } from "./protected-paths.js";

/**
 * plan 硬关出口：planActive 且调用是写/执行类 → 无条件 deny（规则不得
 * 授权）；否则原样透传。planActive 由装配方每调用活查询（服务内存态）。
 */
export function enforcePlanMode(
  verdict: Verdict,
  call: PolicyCall,
  planActive: boolean,
): Verdict {
  if (!planActive || !isWriteExecuteTool(call.tool)) return verdict;
  return {
    action: "deny",
    reason: `plan 模式硬关：${call.tool} 是写/执行类工具，计划模式下不可用（G7，不可被规则授权）；完成研究后经 plan_exit 退出（需用户批准）`,
  };
}
