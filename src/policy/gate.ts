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

import type { ChainLayer } from "../core/index.js";
import type { LoopContext, ToolCallPayload, ToolExecutionResult } from "../core/index.js";
import type { JsonRecord } from "../core/index.js";
import type { PolicyCall, PolicyChain } from "./chain.js";
import type { Verdict } from "./decision.js";
import { buildDenial, renderDenial } from "./denial.js";
import { enforceProtectedPaths } from "./protected-paths.js";
import { enforcePlanMode } from "./plan-guard.js";
import { enforceTrustGate } from "./project-trust.js";
import { enforceCeiling, type CeilingProfile } from "./intersect.js";
import { enforceSelfGuard } from "./self-guard.js";
import { stripProposedAmendments } from "./review-decision.js";
import type { PermissionBrokerPort } from "./broker.js";
import { PermissionTimeout } from "./pending.js";
import { isToolActiveComposed, type ToolActivationLayers } from "./tool-activation.js";
import {
  JudgeUnavailableError,
  JUDGE_REVIEW_TIMEOUT_MS,
  JudgeBudgetTracker,
  type JudgePort,
  type JudgeRequest,
} from "./judge-port.js";

/** gate 级拒绝的错误码（deny 或审批拒绝）；审批超时另见 PERMISSION_TIMEOUT。 */
export const TOOL_POLICY_DENIED = "TOOL_POLICY_DENIED";

/**
 * 工具分类（T-P3-137 八轮 A——审批模式映射的依据，pi-desktop accept-edits
 * 与 agentscope EXPLORE 的只读/编辑分类同构）：
 * - 编辑类（accept-edits 模式自动放行）：直接改写文件的工具；
 * - 写类（read-only 模式拒绝）：能修改文件系统/状态/委派的一切工具——
 *   bash/pwsh 可间接写、task 委派子代理行为不可静态判定，均从严。
 * 其余工具视为只读（read-only 模式放行）。
 */
export const EDIT_CLASS_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "apply_patch"]);
export const WRITE_CLASS_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "pwsh",
  "edit",
  "write",
  "apply_patch",
  "task",
]);

/** C25 激活失败错误码：不可达 ≠ 策略拒绝（不产生 Verdict、不进批准层）。 */
export const TOOL_NOT_ACTIVE = "TOOL_NOT_ACTIVE";

/**
 * 求值面选项（C19/T-P1-75）：gate 选项中"执行前判定"需要的部分——
 * dry-run 入口与 gate 层共用同一形状（broker 不在求值面内）。
 */
export interface ToolPolicyEvalOptions {
  /** 权威策略链（模块组装：规则集、危险库、会话批准历史……）。 */
  readonly chain: PolicyChain;
  /**
   * W5/T3-6 工具契约元数据查询（装配注入 registry.metadataOf——gate 在
   * policy 域不 import registry）。**fail-closed 双读**：声明优先，缺声明
   * 按名兜底回落现闭集——绝不默认放行。缺省 undefined = 全部走按名兜底
   * （零行为变化）。
   */
  readonly toolMetadata?: (name: string) => import("../core/index.js").ToolMetadata | undefined;
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
  /**
   * T-P3-137 八轮 A：审批模式活查询（SessionConfigStore.approvalMode——
   * config/refresh 会话内切换即生效）。ask/abstain 进 broker 前按模式映射：
   * auto → 放行（全自动，仍拦 deny 规则与内置保护——它们在链上先于本门）；
   * read-only + 写类工具 → deny；accept-edits + 编辑类工具 → 放行；
   * ask-all / undefined → 落 broker（零行为变化）。unattended 优先于本值。
   */
  readonly approvalMode?: () => string | undefined;
  /**
   * C56 判官端口（T-P1-80）：ask 复核——allow 假阳性免挂起、deny 确定性
   * 拒绝、abstain 落回 broker ask（**落回人，不隐式放行**）。预算由
   * judgeBudget 记账（耗尽判官不被调直接落回 ask）。缺省 undefined =
   * 无判官（零行为变化——P2 C42 本体落位前的端口位）。
   */
  readonly judge?: JudgePort;
  /** C56 判官预算记账（judge 在位时配套；缺省每次调用新建临时记账）。 */
  readonly judgeBudget?: JudgeBudgetTracker;
  /** C56 受管强制位：true 且判官 abstain → 类型化失败（非静默落回人）。 */
  readonly requireJudge?: boolean;
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
 * 出口族串联（T-P1-79 提取）：C46 → C49 → C35 → G7 → C11 五出口依序
 * 施加（批次 8 盘点①次序终局清单——先后仅影响 deny reason 归属措辞，
 * 任一出口 deny 即终局）。evaluateToolPolicy 与 modifiedInput 重跑共用。
 */
function enforceExitFamily(
  verdict: Verdict,
  call: PolicyCall,
  options: ToolPolicyEvalOptions,
): { verdict: Verdict; trustWarning?: string } {
  let v = enforceProtectedPaths(verdict, call);
  v = enforceCeiling(v, call, options.ceiling);
  v = enforceSelfGuard(v, call, { agentInitiated: true });
  v = enforcePlanMode(v, call, options.planMode?.() ?? false);
  const trusted = options.trustState?.();
  v = enforceTrustGate(v, call, trusted);
  if (v.action === "deny" && trusted === false) {
    return {
      verdict: v,
      trustWarning: `trust-gate: ${call.tool} 因项目未信任被降权拒绝（C11 出口级）`,
    };
  }
  return { verdict: v };
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
  const exited = enforceExitFamily(verdict, call, options);
  verdict = exited.verdict;
  if (exited.trustWarning !== undefined) warnings.push(exited.trustWarning);
  return { args, verdict, warnings };
}

function deniedResult(verdict: Verdict, code: string): ToolExecutionResult {
  // C55（T-P2-202）：命中规则声明了 justification/alternatives 时渲染
  // 结构化拒绝（主因 + 规则理由 + 编号替代清单——"拒绝要能告诉用户怎么
  // 办"）；无声明数据维持既有单行文本（既有拒绝零变化）。
  const denial = buildDenial(verdict.reason, verdict.denial);
  return {
    content:
      denial !== undefined
        ? renderDenial(denial)
        : `被权限策略拒绝：${verdict.reason}`,
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
    // T-P3-137 八轮 A：审批模式映射（unattended 优先于本值——无人值守时
    // ask 全转 deny；auto/read-only/accept-edits 在进 judge/broker 前分流）。
    const approvalMode = options.approvalMode?.();
    if (approvalMode === "auto") {
      return next({ ...e, arguments: JSON.stringify(args) }); // 全自动放行
    }
    // W5/T3-6 fail-closed 双读：声明 sideEffectScope 非 none = 写面（workspace/
    // system 都拒）；缺声明按名兜底现闭集（绝不因缺声明而放行）。
    const meta = options.toolMetadata?.(e.name);
    const isWriteLike = meta?.sideEffectScope !== undefined
      ? meta.sideEffectScope !== "none"
      : WRITE_CLASS_TOOLS.has(e.name);
    if (approvalMode === "read-only" && isWriteLike) {
      return {
        content: `只读模式：${e.name} 的写类调用已拒绝`,
        isError: true,
        error: {
          name: "PolicyGate",
          code: TOOL_POLICY_DENIED,
          reason: `只读模式：写类调用拒绝（原询问：${verdict.reason}）`,
        },
      };
    }
    // W5/T3-6：编辑类自动放行——声明 sideEffectScope=workspace 优先；
    // 缺声明按名兜底 EDIT_CLASS 闭集。声明 sideEffectScope=system 不放行
    // （accept-edits 只豁免工作区写，不豁免系统面——从严）。
    const isEditLike = meta?.sideEffectScope !== undefined
      ? meta.sideEffectScope === "workspace"
      : EDIT_CLASS_TOOLS.has(e.name);
    if (approvalMode === "accept-edits" && isEditLike) {
      return next({ ...e, arguments: JSON.stringify(args) }); // 编辑类自动放行
    }
    // C56 判官复核（T-P1-80，ask 分支内——C42"贵路径修正便宜路径"的
    // 接口面）：allow → 放行（假阳性免挂起，broker 零调用）/ deny →
    // 类型化拒 / abstain → 落回 broker ask（**落回人，不隐式放行不隐式
    // 拒绝**；requireJudge 强制位下类型化失败非静默）。预算耗尽 → 判官
    // 不被调直接落回 ask（预算耗尽不放行）。判官本体在 P2 C42。
    if (options.judge !== undefined) {
      const judge = options.judge;
      const budget = options.judgeBudget ?? new JudgeBudgetTracker();
      if (budget.hasBudget()) {
        const judgeRequest: JudgeRequest = {
          tool: e.name,
          args,
          sessionId: options.sessionId,
          askReason: verdict.reason,
        };
        budget.expend(JSON.stringify(judgeRequest).length);
        let judgeOutcome: "allow" | "deny" | "abstain";
        let judgeReason: string;
        try {
          const judgeVerdict = await Promise.race([
            judge.review(judgeRequest),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("判官复核超时")),
                JUDGE_REVIEW_TIMEOUT_MS,
              ),
            ),
          ]);
          judgeOutcome = judgeVerdict.outcome;
          judgeReason = judgeVerdict.reason;
        } catch (error) {
          // 超时/判官崩溃 = 不可用——按 abstain 语义处理（不隐式放行）
          judgeOutcome = "abstain";
          judgeReason =
            error instanceof Error ? `判官不可用：${error.message}` : "判官不可用";
        }
        if (judgeOutcome === "allow") {
          return next({ ...e, arguments: JSON.stringify(args) });
        }
        if (judgeOutcome === "deny") {
          return deniedResult(
            { action: "deny", reason: `判官拒绝：${judgeReason}` },
            TOOL_POLICY_DENIED,
          );
        }
        if (options.requireJudge === true) {
          // 受管强制：判官 abstain/不可用 = 类型化失败，绝不静默落回
          const unavailable = new JudgeUnavailableError(e.name);
          return {
            content: unavailable.message,
            isError: true,
            error: { name: "PolicyGate", code: unavailable.code, reason: judgeReason },
          };
        }
      }
      // 预算耗尽 / abstain（非强制）→ 落回 broker ask（人兜底）
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
        // C52（T-P1-79）：批准可携带修改后的参数（zcode turn-machine
        // resolvePermission 同语义：`input: modifiedInput ?? tc.input`）。
        // 改后参数**重跑五出口族**（硬拦面——批准不可越硬拦出口）；
        // 规则面不重跑——人的显式批准是权威（C47 批准语义）。
        let effectiveArgs = args;
        if (answer.modifiedInput !== undefined) {
          effectiveArgs = answer.modifiedInput;
          const modifiedCall: PolicyCall = {
            tool: e.name,
            args: effectiveArgs,
            sessionId: options.sessionId,
            source: options.source ?? "model",
          };
          const exited = enforceExitFamily(
            { action: "allow", reason: "审批人放行（修改后参数）" },
            modifiedCall,
            options,
          );
          if (exited.trustWarning !== undefined) options.onWarning?.(exited.trustWarning);
          if (exited.verdict.action === "deny") {
            return deniedResult(
              {
                action: "deny",
                reason: `修改后参数被出口族拒绝：${exited.verdict.reason}`,
              },
              TOOL_POLICY_DENIED,
            );
          }
        }
        return next({ ...e, arguments: JSON.stringify(effectiveArgs) });
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
