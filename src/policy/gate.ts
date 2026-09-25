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
 * 装配次序（本层内部，全部在 next 前）：
 *   1. stripProposedAmendments（C48：剥模型捎带的规则提案字段）；
 *   2. 策略链权威求值（规则/危险库/批准历史等模块，T-5-13 起陆续挂入）；
 *   3. enforceProtectedPaths（C46 硬拦）+ enforceSelfGuard（C35 防线，
 *      agentInitiated 恒 true——经工具循环的调用都是 agent 发起）；
 *   4. ask / abstain → broker：abstain 按不变量 3 默认落 ask（C3，
 *      "无规则默认询问"），ask 走审批出口（缺省 DenyPermissionBroker，
 *      无人应答即拒绝）；超时（C50）落类型化 isError 不炸轮次。
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
import { enforceCeiling, type CeilingProfile } from "./intersect.js";
import { enforceSelfGuard } from "./self-guard.js";
import { stripProposedAmendments } from "./review-decision.js";
import type { PermissionBrokerPort } from "./broker.js";
import { PermissionTimeout } from "./pending.js";

/** gate 级拒绝的错误码（deny 或审批拒绝）；审批超时另见 PERMISSION_TIMEOUT。 */
export const TOOL_POLICY_DENIED = "TOOL_POLICY_DENIED";

export interface ToolGateOptions {
  /** 权威策略链（模块组装：规则集、危险库、会话批准历史……）。 */
  readonly chain: PolicyChain;
  /** 审批出口（C51：缺省语义是拒绝——装配方不给 Manual 就没人能放行 ask）。 */
  readonly broker: PermissionBrokerPort;
  /** 会话权威标识（C57：装配处取当前值）。 */
  readonly sessionId: string;
  /** 调用来源，缺省 model。 */
  readonly source?: string;
  /** C48 剥出的提案夹带警告去向；缺省丢弃（记录面随 T-8）。 */
  readonly onWarning?: (warning: string) => void;
  /** C49 来源上限（多来源交集折叠结果；缺省无上限——单来源装配零行为变化）。 */
  readonly ceiling?: CeilingProfile;
}

function deniedResult(verdict: Verdict, code: string): ToolExecutionResult {
  return {
    content: `被权限策略拒绝：${verdict.reason}`,
    isError: true,
    error: { name: "PolicyGate", code, reason: verdict.reason },
  };
}

function policyCallOf(
  e: ToolCallPayload,
  args: JsonRecord,
  options: ToolGateOptions,
): PolicyCall {
  return {
    tool: e.name,
    args,
    sessionId: options.sessionId,
    source: options.source ?? "model",
  };
}

/**
 * 构造 toolCall 点位的权限层。层签名与 loop 的 deps.layers.toolCall 元素
 * 同形——装配处放进数组即可，loop 零改动。
 */
export function createToolGateLayer(
  options: ToolGateOptions,
): ChainLayer<LoopContext, ToolCallPayload, ToolExecutionResult> {
  const source = options.source ?? "model";
  return async (_$, e, next) => {
    // 参数先解析一次（坏参数直接交 registry 报 TOOL_ARGUMENTS_INVALID——
    // 未解析的参数永远到不了执行，求值无需掺和）
    let rawArgs: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(e.arguments);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return next(e);
      }
      rawArgs = parsed as JsonRecord;
    } catch {
      return next(e);
    }
    const { args, warnings } = stripProposedAmendments(rawArgs);
    for (const warning of warnings) options.onWarning?.(warning);

    const call = policyCallOf(e, args, options);
    let verdict = await options.chain.evaluate(call);
    verdict = enforceProtectedPaths(verdict, call);
    verdict = enforceCeiling(verdict, call, options.ceiling);
    verdict = enforceSelfGuard(verdict, call, { agentInitiated: true });

    if (verdict.action === "allow") {
      return next({ ...e, arguments: JSON.stringify(args) });
    }
    if (verdict.action === "deny") {
      return deniedResult(verdict, TOOL_POLICY_DENIED);
    }
    // ask / abstain：abstain 按不变量 3 默认落 ask（C3 无规则默认询问）
    try {
      const answer = await options.broker.decide({
        id: e.callId,
        sessionId: options.sessionId,
        tool: e.name,
        args,
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
