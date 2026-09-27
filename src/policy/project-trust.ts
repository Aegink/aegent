/**
 * 项目信任（C11）+ trustGated 门控（C34，T-P1-69）。
 *
 * C11：未信任项目降权——首次打开陌生项目时限制写与执行，用户显式信任
 * 后放开。信任状态是**每次决策读的当前状态**（qwen isTrustedFolder 同款：
 * `activeSessionAllowRules` 每次决策重读，撤销即刻暂停、恢复即还原），
 * 不是快照记账。降权在**出口级**（enforceTrustGate，链裁决之后）——
 * 规则不得授权信任降权（C46 同款出口语义：任何 allow/ask 压不过）。
 *
 * 状态机取 pi·project-trust.ts 的三值语义（trusted yes/no/undecided，
 * "undecided 让内建流程决定"——我方初始值，陌生项目未表态即降权）。
 * 显式信任的**持久化**（pi 的 remember: true）属 Q 域预留 API——本批落
 * 内存会话面，isTrusted() 的调用方无感知（状态从哪来是装配的事）。
 *
 * C34：仓库自带配置授予的规则用 trustGated 标记门控（承载位 =
 * ApprovalScopeCache 的 session 批准规则，T-P1-02 session-runtime 层），
 * 信任变化时**不移除规则而读当前信任**（qwen trustGated 同款——过滤
 * 不记账，cache 里的记录保留，恢复信任即还原生效）。
 */

import type { PolicyCall } from "./chain.js";
import type { Verdict } from "./decision.js";
import { isWriteExecuteTool } from "./protected-paths.js";

/** 信任状态三值（pi project_trust 的 yes/no/undecided 同构）。 */
export type TrustState = "trusted" | "untrusted" | "undecided";

/**
 * 项目信任服务（内存会话面）。isTrusted() **每次调用读当前状态**——
 * 调用方（出口 gate / trustGated 过滤）不做任何本地快照，降权与放开
 * 都在下一次决策即刻生效。
 */
export class ProjectTrustService {
  private state: TrustState = "undecided";

  /** 当前是否已信任（每次调用读当前状态，不是快照）。 */
  isTrusted(): boolean {
    return this.state === "trusted";
  }

  getState(): TrustState {
    return this.state;
  }

  /** 用户显式信任（pi "Trust this session" 同位；持久化属 Q 域预留）。 */
  declareTrusted(): void {
    this.state = "trusted";
  }

  /** 用户显式不信任（pi "Do not trust this session" 同位）。 */
  declareUntrusted(): void {
    this.state = "untrusted";
  }

  /** 回到未决态（重新走信任流程用）。 */
  reset(): void {
    this.state = "undecided";
  }
}

/**
 * 信任降权出口：trusted === false 且调用是写/执行类（WRITE_EXECUTE_TOOLS
 * 唯一权威）→ 无条件 deny（规则不得授权，C46 出口同构）；trusted !==
 * false（含 undefined = 装配未启用）原样透传——缺省装配零行为变化。
 * trusted 由装配方每调用活查询（ProjectTrustService.isTrusted）。
 */
export function enforceTrustGate(
  verdict: Verdict,
  call: PolicyCall,
  trusted: boolean | undefined,
): Verdict {
  if (trusted !== false || !isWriteExecuteTool(call.tool)) return verdict;
  return {
    action: "deny",
    reason: `项目未信任：写/执行类工具 ${call.tool} 降权拒绝（C11 出口级，规则不得授权）；用户显式信任本项目后放开`,
  };
}
