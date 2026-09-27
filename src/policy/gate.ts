/**
 * 策略闸门（C9）——挂洋葱链 toolCall 点位的权限层，求值在工具执行前。
 *
 * 自研卡（无上游参考）：形状由 T-3-01 链与不变量 2/3 推出。层在 next()
 * **之前**完成全部策略求值——注入文本（场景⑦）作为消息数据进入模型
 * 上下文、甚至成为工具参数，但求值时机由链形固定，永远先于执行，参数
 * 内容改变不了"先求值后执行"这个顺序。deny / 审批拒绝时不调 next：
 * 截断跨层传播，链底（registry.dispatch）不发生——**不执行、不产生
 * 工具输出**，isError 结果回喂模型保 call/result 配平。
 *
 * 装配次序（本层内部，全部在 next 前，经 evaluateToolPolicy 统一承载）：
 *   1. stripProposedAmendments（C48：剥模型捎带的规则提案字段）；
 *   2. 策略链权威求值（规则/危险库/批准历史等模块，T-5-13 起陆续挂入）；
 *   3. enforceProtectedPaths（C46 硬拦）+ enforceSelfGuard（C35 防线，
 *      agentInitiated 恒 true——经工具循环的调用都是 agent 发起）；
 *   4. enforcePlanMode（G7 plan 硬关，T-P1-11——写/执行类出口不可授权）；
 *   5. ask / abstain → broker：abstain 按不变量 3 默认落 ask（C3，
 *      "无规则默认询问"），ask 走审批出口（缺省 DenyPermissionBroker，
 *      无人应答即拒绝）；超时（C50）落类型化 isError 不炸轮次。
 *
 * C19 dry-run（T-P1-75）：1-4 的求值管道提取为独立导出函数
 * evaluateToolPolicy——本层与 dry-run 入口（协议 policy/check）消费同一
 * 函数，结构性保证"runs the same chain and executes nothing"：dry-run
 * 在 ask/abstain 处原样返回裁决（不进 broker、不挂起、不执行）。
 *
 * 与 T-5-11 registry guard 的边界：gate 是 P0 规范执行面（toolCall 点位），
 * registry guard 留给无 gate 的旁路装配（如恢复路径）；两者同时启用时
 * once 批准无法过第二次重算——需要组合的部署只用 gate。
 *
 * P0 会话级批准：broker 放行仅对本调用生效（once）；scope=session 的
 * 记录由 owner 通道/CLI 用 T-5-08 的 ApprovalScopeCache 在转达答复时
 * 完成，链上的会话批准历史模块据此在后续调用免问。
 */

import type { ChainLayer } from "../kernel/chain.js";
import type {
  LoopContext,
  ToolCallPayload,
  ToolExecutionResult,
} from "../kernel/loop.js";
import type { JsonRecord } from "../kernel/events.js";
import type { PolicyCall, PolicyChain } from "./chain.js";
import type { Verdict } from "./decision.js";
import { enforceProtectedPaths } from "./protected-paths.js";
import { enforcePlanMode } from "./plan-guard.js";
import { enforceTrustGate } from "./project-trust.js";
import { enforceCeiling, type CeilingProfile } from "./intersect.js";
import { enforceSelfGuard } from "./self-guard.js";
import { stripProposedAmendments } from "./review-decision.js";
import type { PermissionBrokerPort } from "./broker.js";
import { PermissionTimeout } from "./pending.js";
import { isToolActiveComposed, type ToolActivationLayers } from "./tool-activation.js";

/** gate 级拒绝的错误码（deny 或审批拒绝）；审批超时另见 PERMISSION_TIMEOUT。 */
export const TOOL_POLICY_DENIED = "TOOL_POLICY_DENIED";

/** C25 激活失败错误码：不可达 ≠ 策略拒绝（不产生 Verdict、不进批准层）。 */
export const TOOL_NOT_ACTIVE = "TOOL_NOT_ACTIVE";

/**
 * 求值面选项（C19/T-P1-75）：gate 选项中"执行前判定"需要的部分——
 * dry-run 入口与 gate 层共用同一形状（broker 不在求值面内）。
 */
export interface ToolPolicyEvalOptions {
  /** 权威策略链（模块组装：规则集、危险库、会话批准历史……）。 */
  readonly chain: PolicyChain;
  /** 会话权威标识（C57：装配处取当前值）。 */
  readonly sessionId: string;
  /** 调用来源，缺省 model。 */
  readonly source?: string;
  /** C49 来源上限（多来源交集折叠结果；缺省无上限——单来源装配零行为变化）。 */
  readonly ceiling?: CeilingProfile;
  /**
   * G7 plan 模式活查询（T-P1-11）：激活时写/执行类工具出口硬关（规则
   * 不得授权）。每调用活查询（plan 服务内存态）；缺省 = 未启用，零行为
   * 变化。
   */
  readonly planMode?: () => boolean;
  /**
   * C11 项目信任活查询（T-P1-69）：false 时写/执行类工具出口降权 deny
   * （规则不得授权）。每调用活查询（ProjectTrustService.isTrusted——
   * 每次决策读当前信任）；缺省 = 未启用，零行为变化。
   */
  readonly trustState?: () => boolean | undefined;
}

export interface ToolGateOptions extends ToolPolicyEvalOptions {
  /** 审批出口（C51：缺省语义是拒绝——装配方不给 Manual 就没人能放行 ask）。 */
  readonly broker: PermissionBrokerPort;
  /** C48 剥出的提案夹带与 C11 降权警告去向；缺省丢弃（记录面随 T-8）。 */
  readonly onWarning?: (warning: string) => void;
  /**
   * C25 工具激活四层（T-P1-76）：任一层禁用/白名单不含 → 工具不可达，
   * 类型化 TOOL_NOT_ACTIVE（独立错误码——不是策略裁决，连 ask 都不进）。
   * 缺省 undefined = 无激活面，零行为变化。
   */
  readonly activation?: ToolActivationLayers;
  /**
   * C33 无人值守活查询（T-P1-77）：true 时 ask/abstain 在进 broker 之前
   * 转为 deny（保留检测只改结局——agentscope DONT_ASK 语义；deny/allow
   * 规则照常）。每调用活查询；缺省 undefined = 零行为变化。
   */
  readonly unattended?: () => boolean;
}

/** 一次 dry-run 求值的产物：剥提案后的参数、整链裁决与全程警告。 */
export interface ToolPolicyEvaluation {
  /** C48 剥除提案字段后的参数（allow 放行 / broker 决定用的就是它）。 */
  readonly args: JsonRecord;
  /** 求值管道终裁（含五出口族）——ask/abstain 原样返回，不进 broker。 */
  readonly verdict: Verdict;
  /** 全程警告（C48 提案夹带 + C11 信任降权）——去向由调用方决定。 */
  readonly warnings: readonly string[];
}

/**
 * C19 dry-run 求值管道：可跑完整判定链而不执行工具（同 gate 层 1-4 步，
 * 不进 broker 分支）。参数解析失败返回 null——gate 层据此交 registry 报
 * TOOL_ARGUMENTS_INVALID（坏参数不属于权限判定，dry-run 亦然）。
 */
export async function evaluateToolPolicy(
  toolName: string,
  rawArguments: string,
  options: ToolPolicyEvalOptions,
): Promise<ToolPolicyEvaluation | null> {
  let rawArgs: JsonRecord;
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    rawArgs = parsed as JsonRecord;
  } catch {
    return null;
  }
  const warnings: string[] = [];
  const { args, warnings: proposalWarnings } = stripProposedAmendments(rawArgs);
  warnings.push(...proposalWarnings);

  const call: PolicyCall = {
    tool: toolName,
    args,
    sessionId: options.sessionId,
    source: options.source ?? "model",
  };
  let verdict = await options.chain.evaluate(call);
  verdict = enforceProtectedPaths(verdict, call);
  verdict = enforceCeiling(verdict, call, options.ceiling);
  verdict = enforceSelfGuard(verdict, call, { agentInitiated: true });
  verdict = enforcePlanMode(verdict, call, options.planMode?.() ?? false);
  const trusted = options.trustState?.();
  verdict = enforceTrustGate(verdict, call, trusted);
  if (verdict.action === "deny" && trusted === false) {
    // C11 降权 deny 落可检索警告（出口降权不是常规策略裁决）
    warnings.push(`trust-gate: ${call.tool} 因项目未信任被降权拒绝（C11 出口级）`);
  }
  return { args, verdict, warnings };
}

function deniedResult(verdict: Verdict, code: string): ToolExecutionResult {
  return {
    content: `被权限策略拒绝：${verdict.reason}`,
    isError: true,
    error: { name: "PolicyGate", code, reason: verdict.reason },
  };
}

/**
 * 构造 toolCall 点位的权限层。层签名与 loop 的 deps.layers.toolCall 元素
 * 同形——装配处放进数组即可，loop 零改动。
 */
export function createToolGateLayer(
  options: ToolGateOptions,
): ChainLayer<LoopContext, ToolCallPayload, ToolExecutionResult> {
  return async (_$, e, next) => {
    // C25 激活检查是层内首步（参数解析前）：未激活 = 不可达，独立错误码
    // 不产生 Verdict——批准层（求值管道/broker）根本不被触达
    if (
      options.activation !== undefined &&
      !isToolActiveComposed(options.activation, e.name)
    ) {
      return {
        content: `工具 ${e.name} 未激活（C25 激活层禁用——不可达与权限裁决分离）`,
        isError: true,
        error: {
          name: "PolicyGate",
          code: TOOL_NOT_ACTIVE,
          reason: `工具 ${e.name} 被激活层禁用（workspace/profile/global/session 四层 AND）`,
        },
      };
    }
    // 求值管道与 dry-run 共用 evaluateToolPolicy（C19 同链保证）：参数
    // 解析失败返回 null → 交 registry 报 TOOL_ARGUMENTS_INVALID
    const evaluation = await evaluateToolPolicy(e.name, e.arguments, options);
    if (evaluation === null) return next(e);
    const { args, verdict, warnings } = evaluation;
    for (const warning of warnings) options.onWarning?.(warning);

    if (verdict.action === "allow") {
      return next({ ...e, arguments: JSON.stringify(args) });
    }
    if (verdict.action === "deny") {
      return deniedResult(verdict, TOOL_POLICY_DENIED);
    }
    // C33 无人值守：ask/abstain 在进 broker 之前转 deny（保留检测只改
    // 结局）——broker 零调用（不挂起不超时），deny/allow 规则不受影响
    if (options.unattended?.() === true) {
      return {
        content: `无人值守模式：${e.name} 的询问已转为拒绝（原询问：${verdict.reason}）`,
        isError: true,
        error: {
          name: "PolicyGate",
          code: TOOL_POLICY_DENIED,
          reason: `无人值守：询问转为拒绝（原询问：${verdict.reason}）`,
        },
      };
    }
    // ask / abstain：abstain 按不变量 3 默认落 ask（C3 无规则默认询问）
    try {
      const answer = await options.broker.decide({
        id: e.callId,
        sessionId: options.sessionId,
        tool: e.name,
        args,
        // C54：gate 是工具审批发起面（task 派发经 gate 亦归此类——记档）
        category: "tool",
      });
      if (answer.action === "allow") {
        return next({ ...e, arguments: JSON.stringify(args) });
      }
      const askReason = verdict.reason ?? "默认询问（无匹配策略，不变量 3）";
      return deniedResult(
        {
          action: "deny",
          reason: answer.reason
            ? `审批拒绝：${answer.reason}（原询问：${askReason}）`
            : `审批未通过（原询问：${askReason}）`,
        },
        TOOL_POLICY_DENIED,
      );
    } catch (error) {
      if (error instanceof PermissionTimeout) {
        return {
          content: `审批超时（${error.timeoutMs}ms）：${error.message}`,
          isError: true,
          error: {
            name: "PolicyGate",
            code: error.code,
            reason: error.message,
          },
        };
      }
      throw error; // 其余崩溃交 loop 兜底 TOOL_EXECUTE_FAILED（配平不变）
    }
  };
}
