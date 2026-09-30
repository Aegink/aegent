/**
 * 子代理运行面（H1/H4，T-P1-42）——"内核起子循环"的装配层封装。
 *
 * 展卡定形（plan-p1.md 批次 5 卡序头）：**子代理 = 进程内隔离 + 独立子
 * 会话**（opencode task 同款）。task 工具的执行体经本模块起的子循环：
 *   - 子会话是同一 SessionStore 下的新 sessionId（独立事件流）——H4 隔离
 *     语义由结构保证：父会话投影只读父流，子代理中间流结构上进不了父流；
 *   - 权限/审批**降级继承**（不是复制）：用户层规则经 deriveSubagentRules
 *     （H5/T-P1-41）只留 deny + 默认禁用清单；审批 broker 换 Deny
 *     （H3：子代理 ask 确定性拒绝——dsh approvalPolicy 'never' 同构）；
 *   - 模型继承父会话当前选择（dsh parentAgentOptionsForDelegation 同
 *     语义）：deps.modelForTurn 透传父装配的捕获闭包，子 turn 启动捕获
 *     configured 当前值；
 *   - 深度记账（dsh resolveChildDepth 同构）：childDepth = 父 depth + 1，
 *     超过 maxDepth（缺省 1 = 子代理不可再分）抛 SubagentDepthError。
 *
 * task 工具（tools/builtin/task.ts）只做参数校验与结算渲染；子循环的
 * 起停、子装配构造、结算提取都在这里——装配层职责，工具不触碰 store。
 */

import type { ModelIdentity } from "../models/identity.js";
import type { ModelProvider } from "../models/provider.js";
import { resolveSubagent } from "../session/subagents-config.js";
import { DenyPermissionBroker } from "../policy/broker.js";
import { deriveSubagentRules } from "../policy/subagent-rules.js";
import type { RuleSource } from "../policy/rule-loader.js";
import { createChildAssembly, type ChildAssembly } from "./assembly.js";
import type { AgentLoopDeps } from "./loop.js";
import { AgentLoop } from "./loop.js";
import type { Logger } from "./logger.js";
import type { SessionStore } from "../session/store.js";
import { project } from "../session/project.js";
import { NodeExecutionEnv } from "./tools/env.js";
import { ToolRegistry } from "./tools/registry.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";
import type { TurnEndReason } from "./events.js";

/** 深度超限（dsh SubagentDepthError 同构）：attempted = childDepth。 */
export class SubagentDepthError extends Error {
  readonly code = "SUBAGENT_DEPTH_EXCEEDED";
  constructor(
    readonly attemptedDepth: number,
    readonly maxDepth: number,
  ) {
    super(
      `子代理深度超限：${attemptedDepth} > maxDepth ${maxDepth}（默认不可再分子代理）`,
    );
    this.name = "SubagentDepthError";
  }
}

/** 结算词汇（dsh run-settlement 的 runOutcome 同构映射，收敛三值）。 */
export type SubagentStopReason = "completed" | "failed" | "cancelled";

export interface SubagentRunResult {
  /** 子会话 id（父会话可见的 lineage——经 tool result meta 回喂）。 */
  readonly sessionId: string;
  readonly stopReason: SubagentStopReason;
  /** 子代理最终 assistant 文本（成功时即产出；失败时可能是残段或空）。 */
  readonly output: string;
  /** 失败/取消时的可读详情（isError 回喂模型可自修）。 */
  readonly error?: string;
}

export interface SubagentRunnerDeps {
  /** 发起派发的会话 id（子会话 id 从它派生，lineage 可读）。 */
  readonly parentSessionId: string;
  readonly store: SessionStore;
  readonly provider: ModelProvider;
  /** 缺省身份（modelForTurn 未提供时子代理用它）。 */
  readonly identity: ModelIdentity;
  readonly workspaceRoot: string;
  readonly contextWindow: number;
  /** 父会话的用户层规则源（降级算法的输入——装配 rules 选项原样）。 */
  readonly parentRules: readonly RuleSource[];
  /** 发起派发者的深度：顶层会话 0、子代理 1…… */
  readonly depth: number;
  /** 允许的最大子代理深度（含）；缺省 1 = 子代理不可再分。 */
  readonly maxDepth?: number;
  readonly logger?: Logger;
  readonly spillDir?: string;
  /** 审批上界透传（Deny broker 不消费——DenyPermissionBroker 不问超时）。 */
  readonly approvalTimeoutMs: number;
  /**
   * T-P3-140 批次 A：父会话的沙箱装配切片（模式路由后端 + 活 defaultMode
   * ——子代理 bash/pwsh 与父同档同强制面）。**不带审批通道**：子代理的
   * 升级申请类型化拒绝（fail-closed——审批是人的通道，子代理语境无人可问）。
   */
  readonly shellSandbox?: {
    readonly backend: import("../sandbox/backend.js").SandboxBackend;
    readonly defaultMode: import("../sandbox/backend.js").SandboxMode;
  };
  /** U22/T-P3-125：附加技能来源目录（父装配 skillsRoots 透传——skill_load 面一致）。 */
  readonly skillsRoots?: readonly string[];
  /** U22/T-P3-125：停用技能名单（父装配 skillsDisabled 透传——子代理同纪律）。 */
  readonly skillsDisabled?: readonly string[];
  /**
   * U23/T-P3-126：可用子代理预设（settings subagents 段——内置预设常量
   * 由 resolveSubagent 兜底；此处传用户覆盖/自定义清单）。缺省 undefined
   * = 仅内置预设（无自定义面）。
   */
  readonly subagentDefs?: import("../session/subagents-config.js").SubagentDefinition[];
  /**
   * U23/T-P3-126：预设独立模型解析闭包（装配面注入——agent-child 按
   * resolveSubagentModel 链解析为 RegisteredModel；未解析出 = 回退父模型）。
   */
  readonly resolveSubagentModel?: (
    subagent: import("../session/subagents-config.js").ResolvedSubagent,
  ) => { provider: ModelProvider; identity: ModelIdentity } | undefined;
  /**
   * J6/J7 捕获闭包透传（父装配的 modelForTurn）：子 turn 启动时捕获
   * configured 当前值——换模后派发的子代理用新模型（继承父当前选择）。
   */
  readonly modelForTurn?: AgentLoopDeps["modelForTurn"];
}

/**
 * 构造子代理 runner（每个持有者一个实例；counter 保证同进程内子会话 id
 * 唯一，Date.now 后缀防跨进程重启撞名）。返回的 run 是 task 工具 deps
 * 的 runSubagent——深度检查在入口（先于任何状态创建），拒绝是纯函数式
 * 的：不产生半态子会话。
 *
 * 第三个参数 opts.signal（T-P1-43 取消联动）：父 turn 的取消信号——
 *   - 已 abort（父取消先于派发）：不起子轮，直接 cancelled 结算
 *     （零子会话零模型调用——"迟到的取消不武装后续工作"的子代理面）；
 *   - 运行中 abort：联动 subLoop.cancel({kind: "parent"})（CancelCause
 *     "parent"——"子代理被父级取消"槽位的真用），子 loop 在 await 边界
 *     收轮 aborted，结算 cancelled（dsh activation stop 传播 /
 *     opencode ctx.abort.addEventListener 同构）。
 */
export function createSubagentRunner(
  deps: SubagentRunnerDeps,
): (
  prompt: string,
  description: string,
  opts?: { signal?: AbortSignal; backend?: string; subagentType?: string },
) => Promise<SubagentRunResult> {
  let counter = 0;
  const maxDepth = deps.maxDepth ?? 1;

  const run = async (
    prompt: string,
    description: string,
    opts?: { signal?: AbortSignal; backend?: string; subagentType?: string },
  ): Promise<SubagentRunResult> => {
    const childDepth = deps.depth + 1;
    if (!Number.isSafeInteger(childDepth) || childDepth > maxDepth) {
      throw new SubagentDepthError(childDepth, maxDepth);
    }
    // U23/T-P3-126：预设解析（未知/停用同为类型化拒绝——停用名单不进
    // 可用清单，模型可见可自修）。缺省 undefined = 通用子代理（既有行为）。
    const preset =
      opts?.subagentType !== undefined
        ? resolveSubagent(opts.subagentType, deps.subagentDefs)
        : undefined;
    if (opts?.subagentType !== undefined && preset === undefined) {
      return {
        sessionId: "",
        stopReason: "failed",
        output: "",
        error:
          `未知或已停用的子代理预设：${opts.subagentType}` +
          `（可用见设置页子智能体分节）`,
      };
    }
    // 取消先于派发：不起子轮（无半态——深度检查与取消检查同位）
    if (opts?.signal?.aborted) {
      return {
        sessionId: "",
        stopReason: "cancelled",
        output: "",
        error: "父轮在派发前已取消——子代理未启动",
      };
    }

    const childSessionId =
      `${deps.parentSessionId}::task-${++counter}-${Date.now()}`;

    // —— 子装配：降级规则（H5）+ Deny broker（H3）+ 全套上下文/压缩层复用。
    // 默认禁用 task 的双保险按深度分工：childDepth >= maxDepth（不可再派）
    // 时 deny task 规则留在子规则集（gate 拒绝 = H5 最强面）；childDepth <
    // maxDepth（maxDepth>1 允许递归委派）时放开 task 的默认 deny——深度
    // 检查仍是最终权威（孙代入口拒绝，maxDepth=1 下被 deny 抢先只是快路径）。
    // U23：预设工具集 = C25 activation 的 session 层白名单（声明面收窄——
    // H3/H5 降级面之上的预设声明）；预设身份段 = extraPrompt（系统提示追加）。
    const canDelegateFurther = childDepth < maxDepth;
    const subAssembly: ChildAssembly = createChildAssembly({
      sessionId: childSessionId,
      store: deps.store,
      workspaceRoot: deps.workspaceRoot,
      contextWindow: deps.contextWindow,
      approvalTimeoutMs: deps.approvalTimeoutMs,
      rules: deriveSubagentRules(deps.parentRules, {
        ...(canDelegateFurther ? { allowTools: ["task"] } : {}),
      }),
      broker: new DenyPermissionBroker(),
      delegation: true,
      ...(preset?.tools !== undefined && preset.tools.length > 0
        ? { activation: { session: { enabled: preset.tools } } }
        : {}),
      ...(preset?.prompt !== undefined ? { extraPrompt: preset.prompt } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
    });

    // —— 子注册表：工具面继承但权限收窄——不传 todoEmit（todo_write 不
    // 注册，H5 默认禁用）、不传 question（子代理无答复通道，挂起只能
    // 超时）；task 总注册（deps 是 depth+1 的递归 runner——深度检查在
    // runner 入口拒绝，模型可见可自修，opencode 深度拒绝同款）。
    const subRegistry = new ToolRegistry({
      env: new NodeExecutionEnv(),
      sessionId: childSessionId,
      ...(deps.spillDir !== undefined ? { spillDir: deps.spillDir } : {}),
    });
    // T-P3-140 批次 A：沙箱切片捕获（非空收窄进 getter 闭包——const 收窄
    // 对后建闭包持续生效）。
    const shellSandbox = deps.shellSandbox;
    registerBuiltinTools(subRegistry, {
      pathGuard: subAssembly.pathGuard,
      skillsRoot: deps.workspaceRoot,
      ...(deps.skillsRoots !== undefined ? { skillsRoots: deps.skillsRoots } : {}),
      ...(deps.skillsDisabled !== undefined ? { skillsDisabled: deps.skillsDisabled } : {}),
      // T-P3-140 批次 A：子代理与父同档同强制面（getter 保活读父
      // configStore——派发后切档对本子代理同样生效）；无 approvals——
      // 升级申请类型化拒绝（fail-closed：审批是人的通道，子代理语境无人可问）
      ...(shellSandbox !== undefined
        ? {
            bashSandbox: {
              backend: shellSandbox.backend,
              get defaultMode() {
                return shellSandbox.defaultMode;
              },
            },
            pwshSandbox: {
              backend: shellSandbox.backend,
              get defaultMode() {
                return shellSandbox.defaultMode;
              },
            },
          }
        : {}),
      task: {
        runSubagent: createSubagentRunner({
          ...deps,
          parentSessionId: childSessionId,
          depth: childDepth,
        }),
      },
    });

    const decideTurnBase: AgentLoopDeps["decideTurn"] = (record) =>
      record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" };
    // U23：预设独立模型（resolveSubagentModel 解析产物——装配闭包按名取
    // RegisteredModel）。在位时恒捕获该模型（J7 捕获语义）——父会话换模
    // 不影响本子代理（"独立配置"语义）；不在位 = 继承父当前选择（既有）。
    const presetModel =
      preset !== undefined ? deps.resolveSubagentModel?.(preset) : undefined;
    const subLoop = new AgentLoop({
      sessionId: childSessionId,
      store: deps.store,
      provider: presetModel?.provider ?? deps.provider,
      identity: presetModel?.identity ?? deps.identity,
      toolsProvider: () => subRegistry.toChatTools(),
      executeTool: (call) => subRegistry.dispatch(call),
      decideTurn: subAssembly.wrapDecideTurn(decideTurnBase),
      layers: subAssembly.layers,
      beforeFirstModelRequest: (turn) => subAssembly.beforeFirstModelRequest(turn),
      onToolStepCompleted: (turn, step) => subAssembly.onToolStepCompleted(turn, step),
      ...(presetModel !== undefined
        ? { modelForTurn: () => ({ provider: presetModel.provider, identity: presetModel.identity }) }
        : deps.modelForTurn
          ? { modelForTurn: deps.modelForTurn }
          : {}),
    });

    // T-P1-43 取消联动：父 turn 取消 → 子 loop 取消（CancelCause "parent"）。
    // listener 随 signal 生命周期回收（per-turn controller 被 loop 替换后
    // 不可达）——turn 活动期间取消在子 loop 的 await 边界收轮。
    if (opts?.signal) {
      const onAbort = () => subLoop.cancel({ kind: "parent" });
      opts.signal.addEventListener("abort", onAbort, { once: true });
      if (opts.signal.aborted) onAbort();
    }

    let reason: TurnEndReason;
    try {
      // 子代理 = 一次普通 prompt 轮（opencode runTask = ops.prompt 同构）；
      // 单轮语义——decideTurn 无工具调用即 end，无队列不续轮。
      reason = await subLoop.runTurn(prompt);
    } catch (err) {
      // 工具执行崩溃等基础设施异常（trusted 轨上抛路径）：结算为 failed，
      // 绝不让子代理异常炸掉父 step 的结算通道。
      reason = {
        kind: "error",
        error: {
          code: "SUBAGENT_CRASHED",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    // 结算前子流 flush（E10 纪律：结算指向的子会话事实已落库）。
    await deps.store.flush(childSessionId);

    const messages = project(deps.store.load(childSessionId)).messages;
    const finalAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const output = finalAssistant?.content ?? "";
    const { stopReason, error } = settleFromTurnEnd(reason);
    deps.logger?.info("subagent-settled", {
      sessionId: childSessionId,
      stopReason,
      description,
    });
    return {
      sessionId: childSessionId,
      stopReason,
      output,
      ...(error !== undefined ? { error } : {}),
    };
  };

  return run;
}

/** TurnEndReason → 结算三值 + 可读详情（dsh runOutcome 的收敛映射）。 */
export function settleFromTurnEnd(reason: TurnEndReason): {
  stopReason: SubagentStopReason;
  error?: string;
} {
  switch (reason.kind) {
    case "completed":
      return { stopReason: "completed" };
    case "aborted":
      return {
        stopReason: "cancelled",
        error: `子代理轮被取消（${reason.cause.kind}）`,
      };
    case "blocked":
      return { stopReason: "failed", error: "子代理轮被策略拒绝（blocked）" };
    case "error":
      return {
        stopReason: "failed",
        error: `子代理模型调用失败：${reason.error.code} ${reason.error.message}`,
      };
    case "max-tokens":
      return { stopReason: "failed", error: "子代理轮因 token 上限终止" };
    case "interrupted":
      return { stopReason: "failed", error: "子代理轮被中断（崩溃孤儿闭合）" };
  }
}
