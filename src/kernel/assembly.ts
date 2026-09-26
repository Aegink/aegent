/**
 * 子进程生产装配（T-8-01）——阶段 5/7 的模块级交付在此接进 loop：
 *
 *   toolCall      权限 gate（C9 求值先于执行；ask → Manual broker 挂起等
 *                 CLI /approve 转达答复，超时/拒绝落 isError 保配平）。
 *                 I1 hooks（T-P1-07）：registry 聚合层挂 gate 外层（hooks →
 *                 gate → terminal，hook 改载荷会被内层权限重新判定）。
 *   modelRequest  上下文装配层：系统提示首次落流（system/message 事件，F22
 *                 的重建消费面）→ startNewContextWindow 现算消息集（无压缩
 *                 退化为全量重建；压缩后的摘要/developer 注入在此生效）→
 *                 next 之后做 F10 调用后压力测量。
 *   turnEnd       压缩层：本 turn 任一压力记录越阈值 → CompactionEngine.run
 *                 （压缩事件先于 turn/end 落盘——T-7-04 的次序断言）。
 *   轮首          beforeFirstModelRequest（zcode PreRequest 同款）：本地溢出
 *                 判定 → PreTurn 相位压缩（loop 的 hook 在 try 内，失败走
 *                 failTurn 闭合，不悬挂 turn）。
 *   step 收尾     onToolStepCompleted → RapidRefillGuard 记账（干活解锁抖动
 *                 断路器）；断路器本体挂在 CompactionEngine 生命周期第 0 段。
 *   决策点        wrapDecideTurn：M10 预算记账（加权 token）+ 提醒注入
 *                 （落 user/message{source:"injected"} 写历史成功后才
 *                 markReminderDelivered——"写进历史才算送达"）；预算耗尽
 *                 → 显式 end（停止是显式决策，A1）。
 *
 * 权限链层序（C58）：用户规则集 > 核心层（shell 语义分析——内含危险库，
 * 装配其一即可，T-5-14）。scope=session 批准缓存不在此装配：CLI /approve
 * 是一次性放行（once），会话级缓存需要规则审批面提供 scope 输入（P1）。
 */

import type { Logger } from "./logger.js";
import type {
  AgentLoopDeps,
  DecideTurn,
  LoopContext,
  ModelRequestPayload,
  ModelStepOutput,
  ToolCallPayload,
  ToolExecutionResult,
  TurnEndPayload,
} from "./loop.js";
import {
  type ChainLayer,
  namedLayer,
} from "./chain.js";
import { type HookRegistry } from "./hooks.js";
import type { SessionEvent, LlmFailure } from "./events.js";
import type { SessionStore } from "../session/store.js";
import { RevertService } from "../session/revert.js";
import {
  GitCheckpointService,
  createGitRunner,
} from "../session/git-checkpoint.js";
import { effectiveEvents } from "../session/messages.js";
import {
  type Summarizer,
  CompactionEngine,
  type CompactionInvocation,
  type CompactionSettled,
  type PreCompactOutcome,
  phaseForCompletedSteps,
} from "../context/compaction.js";
import { PressureMonitor } from "../context/pressure.js";
import { detectLocalOverflow } from "../context/overflow.js";
import { startNewContextWindow } from "../context/new-window.js";
import { RapidRefillGuard } from "../context/rapid-refill.js";
import { type BudgetConfig, RolloutBudget } from "../context/budget.js";
import { assembleSystemPrompt } from "../context/system-prompt.js";
import { loadSkills } from "./skills.js";
import {
  type ApprovalAnnouncement,
  PendingApprovals,
} from "../policy/pending.js";
import { ManualPermissionBroker } from "../policy/broker.js";
import { assemblePolicyChain } from "../policy/chain.js";
import { createRuleSetModule } from "../policy/rules.js";
import { type RuleSource, loadRules, loadedRuleMatch, loadedRuleText } from "../policy/rule-loader.js";
import { builtinRuleMatchers } from "../policy/matchers.js";
import { createShellSemanticsModule } from "../policy/shell-semantics.js";
import {
  enforceCeiling,
  intersectAllProfiles,
  type CeilingProfile,
  type PermissionSourceProfile,
} from "../policy/intersect.js";
import { lintRules } from "../policy/linter.js";
import { BUILTIN_TOOL_NAMES } from "./tools/builtin/index.js";
import {
  ApprovalScopeCache,
  createSessionApprovalModule,
  proposeAmendment,
} from "../policy/review-decision.js";
import { createToolGateLayer } from "../policy/gate.js";
import { createApprovalAuditSink } from "../policy/audit-fields.js";
import { createMetaOpsModule } from "../policy/meta-ops.js";
import { PathGuard } from "../sandbox/path-guard.js";
import {
  ModelSwitchService,
  type RegisteredModel,
  type TurnModel,
} from "./model-switch.js";
import { createPlanModeService, savePlanArtifact, type PlanModeService } from "./plan-mode.js";
import {
  createGoalService,
  goalFromEvents,
  type GoalExpiryAction,
  type GoalService,
} from "./goal.js";
import type { ModelIdentity } from "../models/identity.js";
import { createLlmSummarizer, truncatingSummarizer } from "../context/llm-summarizer.js";

// truncatingSummarizer（P0 内置摘要器）随 F5/T-P1-18 移入 context/llm-
// summarizer.ts（context 不反向依赖 kernel/assembly）——此处 re-export
// 保持既有 import 面。
export { truncatingSummarizer } from "../context/llm-summarizer.js";

/**
 * G2 todo 落流出口（T-P1-10）：todo_write 工具的 todo/update 事件经此进
 * 流（ForwardingStore 自然转发为协议 event 行）。会话级元事件挂流内最后
 * 轮、空流兜 0（session/revert / model/switch emit 同款逻辑）；词汇表知识
 * 集中在装配文件，agent-process 一行接线。独立于 createChildAssembly——
 * 最小装配（无 options.assembly）也要能注册 todo 工具。
 */
export function createTodoUpdateEmitter(
  store: SessionStore,
  sessionId: string,
): (items: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>) => void {
  return (items) => {
    const events = store.load(sessionId);
    const turn = events.length > 0 ? events[events.length - 1]!.turn : 0;
    store.append(sessionId, [
      { type: "todo/update", turn, items: items.map((i) => ({ ...i })) },
    ]);
  };
}

/**
 * J14 回放保护 + J10 两存储位分离（T-P1-06）：装配时的初始模型身份按
 * 优先级解析——流内最新 model/switch 的 to（会话级选择，权威事实源）>
 * initialIdentity（会话装配参数）> 注册表首项。会话级选择与全局默认
 * （globalDefaultIdentity）不一致时 warn 不静默、保留会话级选择；流内
 * 选择不在注册表 = 装配失败（ModelSwitchService 构造抛 ModelNotRegistered
 * Error，fail-closed，绝不静默回退全局默认）。
 */
function resolveInitialIdentity(
  options: ChildAssemblyOptions,
  store: SessionStore,
  sessionId: string,
  logger: Logger | undefined,
): ModelIdentity {
  const fallback =
    options.initialIdentity ?? options.models![0]!.identity;
  const events = store.load(sessionId);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type !== "model/switch") continue;
    const globalDefault = options.globalDefaultIdentity;
    if (
      globalDefault !== undefined &&
      (ev.to.provider !== globalDefault.provider ||
        ev.to.modelId !== globalDefault.modelId)
    ) {
      logger?.warn(
        `J10/J14：会话级模型选择 ${ev.to.provider}:${ev.to.modelId} 与全局默认 ` +
          `${globalDefault.provider}:${globalDefault.modelId} 不一致——` +
          "保留会话级选择（重启/回放不静默覆盖用户选择）",
      );
    }
    return ev.to;
  }
  return fallback;
}

/** 事件流中最新 compaction 的 seq（预算 windowId：压缩后即换窗）。 */
function latestCompactionSeq(events: readonly SessionEvent[]): number | undefined {
  let latest: number | undefined;
  for (const e of events) {
    if (e.type === "compaction") latest = e.seq;
  }
  return latest;
}

export interface ChildAssemblyOptions {
  sessionId: string;
  store: SessionStore;
  /** 工作区根：PathGuard 边界 + 系统提示的 AGENTS.md 收集起点。 */
  workspaceRoot: string;
  /** 上下文窗口 token 数（压力判定与本地溢出口径）。 */
  contextWindow: number;
  /** 审批等待上界（C50：Manual broker 必填，无默认值）。 */
  approvalTimeoutMs: number;
  /** 用户层规则（行文本；缺省无规则——bash 走核心层 shell 语义分析）。 */
  rules?: readonly RuleSource[];
  /**
   * C45 linter 的注册表现存工具名（unknown-tool 判定面）；缺省内置六
   * 工具。装配面注入 registry 名单（动态注册工具时由装配方传入）。
   */
  knownToolNames?: readonly string[];
  /**
   * C49 权限来源画像（多来源时交集折叠为有效上限，opaque 相遇即抛——
   * 拒绝启动，fail-closed）。缺省无 = 单来源装配零行为变化（T-P1-03）。
   */
  permissionProfiles?: readonly PermissionSourceProfile[];
  /**
   * J6 会话级模型注册表（T-P1-04，装配注册）：提供时启用运行时换模——
   * 协议 model/switch 命令受理 + loop 每轮启动从捕获值取 provider；缺省
   * 不提供 = 单模型装配零行为变化。J12 的配置发现/选择器留后续批次。
   */
  models?: readonly RegisteredModel[];
  /**
   * J6 换模启用时的初始身份（必须已注册，装配期即失败）；缺省取注册表
   * 首项。只提供本字段而不提供 models = 装配自相矛盾，拒绝启动。
   */
  initialIdentity?: ModelIdentity;
  /**
   * J10 全局默认模型（配置面的存储位；会话级选择存流内 model/switch
   * 事件——两存储位显式分离）。与流内选择不一致时 warn 不静默、保留
   * 会话级选择（J14 回放保护）。
   */
  globalDefaultIdentity?: ModelIdentity;
  /** git 仓库根（E11 代码检查点）：提供时每轮开始前打 git stash 检查点、
   * /revert 双回退（对话态 + 代码态）。缺省不启用（非 git 场景零开销）。
   */
  checkpointRepoRoot?: string;
  /**
   * 内核 hooks（I1/T-P1-07）：宿主构造并注册后传入，装配把 registry 的
   * 聚合层挂三点位（hook 层在权限 gate 外层——hook 对载荷的修改会被内层
   * 权限重新判定）。无注册的点位不挂层；缺省不提供 = 零行为变化。
   */
  hooks?: HookRegistry;
  /**
   * G1/G7 plan 模式（T-P1-11）：启用时构造 PlanModeService + 注册
   * plan_enter/plan_exit 工具面 + gate 出口硬关联动（写/执行类不可授权）
   * + 系统提示机制段。缺省不启用 = 零行为变化（不注册工具、gate 无联动）。
   */
  planMode?: boolean;
  /**
   * G4 计划 artifact 目录（T-P1-13，planMode 启用时生效）：plan_exit 经
   * 用户批准携带计划文本时落盘 <dir>/<sessionId>/plan.md 并记
   * checkpoint{provider:"plan", ref:{path}} 事件；缺省 = plan 参数仅随
   * 工具结果可见、不落盘。
   */
  planArtifactDir?: string;
  /**
   * G3/G6 会话目标（T-P1-12）：提供时构造 GoalService——新会话（流内无
   * goal 事实）以此落初始 goal/set 事件；已有 goal 事实的会话按流重建
   * （goalFromEvents，流内权威——J14 回放保护同款），选项初始值不落。
   * 每轮开始（beforeFirstModelRequest）注入 goal 提醒；缺省不启用 =
   * 零行为变化。
   */
  goal?: {
    text: string;
    deadline?: number;
    /** 到期动作（G6 三选一：放弃/上报/续期）；缺省 "report"。 */
    expiryAction?: GoalExpiryAction;
    /** "renew" 的续期时长毫秒；缺省 24h。 */
    renewExtendMs?: number;
  };
  /** M10 预算配置；缺省不启用预算轴。 */
  budget?: BudgetConfig;
  /** 压缩摘要器；缺省 P0 内置截断摘要。 */
  summarizer?: Summarizer;
  /**
   * F5/T-P1-18 真摘要模型：提供且未显式传 summarizer 时，装配构造
   * createLlmSummarizer（provider 副调用 + request/header{reason:"compaction"}
   * + 失败回退截断摘要）。缺省 undefined = P0 截断摘要（零行为变化）。
   */
  summarizerModel?: {
    provider: import("../models/provider.js").ModelProvider;
    identity: ModelIdentity;
  };
  /** 压缩 pre/post hook 透传（测试观测用）。 */
  compactionPreHook?: (
    invocation: CompactionInvocation,
  ) => PreCompactOutcome | Promise<PreCompactOutcome>;
  compactionPostHook?: (settled: CompactionSettled) => void | Promise<void>;
  logger?: Logger;
  /** 审批宣告的协议转发口（asked/settled 由 agent-process 转发，timed-out 经事件流可见）。 */
  onApprovalAnnouncement?: (announcement: ApprovalAnnouncement) => void;
}

export interface ChildAssembly {
  /** 三个点位的层（gate / 上下文装配+压力测量 / 压缩）。 */
  layers: NonNullable<AgentLoopDeps["layers"]>;
  /** PreTurn 压缩挂点（loop 的 beforeFirstModelRequest hook）。 */
  beforeFirstModelRequest(turn: number): Promise<void>;
  /** step 收尾记账（loop 的 onToolStepCompleted hook → 抖动断路器）。 */
  onToolStepCompleted(turn: number, step: number): void;
  /** 决策包装（预算记账 + 提醒注入；决策语义仍由 base 给出）。 */
  wrapDecideTurn(base: DecideTurn): DecideTurn;
  /** 协议 approve 请求的处理（C5 挂起唤醒 + C24 scope/feedback：session 作用域落批准缓存、feedback 落审计；Stale/Unknown 类型化错误上抛）。 */
  handleApprove(
    requestId: string,
    action: "allow" | "deny",
    reason?: string,
    scope?: "once" | "session",
    feedback?: string,
  ): Promise<void>;
  /** 协议 revert 请求的处理（E4 对话态；越界错误上抛）。 */
  handleRevert(targetSeq: number): void;
  /**
   * 协议 model/switch 请求的处理（J6 换模立即受理；未注册模型抛
   * ModelNotRegisteredError 上抛给协议层回类型化 error 行）。
   * 未启用换模（无注册表）时 undefined。
   */
  handleModelSwitch?(identity: ModelIdentity): void;
  /** loop 每轮模型解析（J7 turn 启动捕获）；未启用换模时 undefined。 */
  modelForTurn?(turn: number): TurnModel;
  /**
   * loop 的 turn 失败通知（J11 换模事务：不兼容判据命中 → 回滚 prev，
   * 回滚落 warn 日志）；未启用换模时 undefined。
   */
  onTurnError?(turn: number, failure: LlmFailure): void;
  /** E11 代码检查点服务（checkpointRepoRoot 提供时存在；kick 前打点 + restoreCodeTo）。 */
  checkpoint?: GitCheckpointService;
  /**
   * G1 plan 模式服务（planMode 选项启用时存在）：注册工具面（agent-process
   * 传 registerBuiltinTools）+ gate 出口活查询的同一个实例。
   */
  planMode?: PlanModeService;
  /** G4 计划落盘出口（planArtifactDir 提供时存在；agent-process 传工具注册）。 */
  savePlanArtifact?: (plan: string) => { path: string };
  /** G3 goal 服务（goal 选项启用时存在；tick 与事实面供测试/owner 通道观测）。 */
  goal?: GoalService;
  /** 工具注册的面（PathGuard 由装配定形，注册处必收）。 */
  pathGuard: PathGuard;
  /** 释放未决审批（dispose 路径：按超时语义拒绝，不悬挂）。 */
  dispose(): void;
}

export function createChildAssembly(options: ChildAssemblyOptions): ChildAssembly {
  const { sessionId, store, logger } = options;
  const contextWindow = options.contextWindow;

  // —— 审批出口（C5/C51）：挂起注册表 + Manual broker + L2 审计 + 宣告转发
  const audit = createApprovalAuditSink({
    surface: "cli",
    sink: (record) =>
      logger?.info("approval-audit", {
        phase: record.phase,
        requestId: record.requestId,
        tool: record.tool,
        surface: record.surface,
        approver: record.approver,
      }),
  });
  const pending = new PendingApprovals((announcement) => {
    audit(announcement);
    options.onApprovalAnnouncement?.(announcement);
  });
  const broker = new ManualPermissionBroker(pending, options.approvalTimeoutMs);

  // —— 权限链（C58 层序常量展开）：用户规则集 > 核心（会话批准历史 +
  // shell 语义分析）。C22：session-runtime 作用域的批准规则由
  // ApprovalScopeCache 承载（进程内存、随会话灭，结构上不落配置文件），
  // 链上经 createSessionApprovalModule 在后续同规则调用免问（T-P1-02）。
  const approvalCache = new ApprovalScopeCache(sessionId);
  const loadedRules = loadRules(options.rules ?? [], builtinRuleMatchers);
  // C45 linter 装配接线：规则加载后常开，"永不生效"的规则只警告不拒
  // （装配会让有其他活规则的配置整体不可用过狠）——警告落日志可检索。
  const lintIssues = lintRules(loadedRules, {
    knownToolNames: options.knownToolNames ?? BUILTIN_TOOL_NAMES,
    matchers: builtinRuleMatchers,
  });
  for (const issue of lintIssues) {
    logger?.warn(`policy-lint: [${issue.kind}] ${issue.raw} —— ${issue.detail}`);
  }
  // C49 多来源交集折叠（T-P1-03）：opaque 相遇抛 PermissionIntersection
  // Error（装配失败 = 拒绝启动），折叠结果经 gate/revalidator 出口生效。
  const ceiling: CeilingProfile | undefined = intersectAllProfiles(
    options.permissionProfiles ?? [],
  );
  const policyChain = assemblePolicyChain({
    ...(loadedRules.length > 0
      ? {
          user: [
            createRuleSetModule({
              name: "user-rules",
              rules: loadedRules,
              match: loadedRuleMatch(builtinRuleMatchers),
              ruleText: loadedRuleText,
            }),
          ],
        }
      : {}),
    core: [
      // G2（T-P1-10）：内核元操作白名单——todo_write 只写会话元状态、无
      // 工作区副作用，核心层显式放行（不变量 3 的"显式例外"落链上模块）。
      // plan 模式硬关（T-P1-11）在出口级，压不过它不成立——出口在后。
      createMetaOpsModule(),
      createSessionApprovalModule({
        cache: approvalCache,
        sessionId,
        matchers: builtinRuleMatchers,
      }),
      createShellSemanticsModule(),
    ],
  });

  // —— 压缩 / 压力 / 抖动（阶段 7 模块接线）
  const guard = new RapidRefillGuard();
  const monitor = new PressureMonitor({ contextWindow });
  const engineDeps: ConstructorParameters<typeof CompactionEngine>[0] = {
    sessionId,
    store,
    // F5/T-P1-18：真摘要模型优先（LLM 生成 + 截断回退），缺省 P0 截断摘要
    summarizer:
      options.summarizer ??
      (options.summarizerModel !== undefined
        ? createLlmSummarizer({
            provider: options.summarizerModel.provider,
            identity: options.summarizerModel.identity,
            store,
            onWarn: (message) => logger?.warn(message),
          })
        : truncatingSummarizer()),
    rapidRefillGuard: guard,
  };
  if (options.compactionPreHook) {
    engineDeps.preHook = options.compactionPreHook as typeof engineDeps.preHook;
  }
  if (options.compactionPostHook) {
    engineDeps.postHook = options.compactionPostHook as typeof engineDeps.postHook;
  }
  const engine = new CompactionEngine(engineDeps);

  /** 本 turn 已完成的模型 step 数（相位判定；轮边界重置）。 */
  let completedModelSteps = 0;

  const pathGuard = PathGuard.forWorkspace(options.workspaceRoot);

  // —— modelRequest 层：系统提示 + 新窗口重建 + 调用后压力测量
  const contextLayer: ChainLayer<
    LoopContext,
    ModelRequestPayload,
    ModelStepOutput
  > = async (_$, e, next) => {
    // 系统提示首次落流：词汇表 system/message 要求开启的 turn+step（此刻
    // step/start 已落盘，合法）；落事件而非只注入载荷——F22 重建消费事件流。
    const effective = effectiveEvents(store.load(sessionId));
    if (!effective.some((ev) => ev.type === "system/message")) {
      // I2 技能清单（T-P1-08）：扫描 .zcode/skills，坏技能诊断落日志不炸；
      // 清单定格在首落时点（改 SKILL.md 对新会话生效；正文经 skill_load
      // 每次直读、当前会话即时）。
      const skillLoad = loadSkills(options.workspaceRoot);
      for (const d of skillLoad.diagnostics) {
        logger?.warn(`skill-lint: [${d.code}] ${d.path} —— ${d.message}`);
      }
      const prompt = await assembleSystemPrompt({
        approvalTier: "on_request",
        describeWritableRoots: () => pathGuard.describeWritableRoots(),
        cwd: options.workspaceRoot,
        ...(skillLoad.skills.length > 0 ? { skills: skillLoad.skills } : {}),
        ...(planModeService ? { planMode: true } : {}),
      });
      store.append(sessionId, [
        {
          type: "system/message",
          turn: e.turn,
          step: e.step,
          message: { content: prompt },
        },
      ]);
    }
    // 消息集现算：无压缩 = 全量重建；有压缩 = 摘要 + developer 注入 + 保留尾
    //（startNewContextWindow 的语义，压缩事实从事件流读取——不养第二份状态）。
    const messages = startNewContextWindow(store.load(sessionId));
    const output = await next({ ...e, messages });
    // F10 调用后压力测量（成功面；无 usage 由 monitor 本地估算兜底）
    monitor.recordSuccess({
      turn: e.turn,
      step: e.step,
      messages,
      ...(output.usage !== undefined ? { usage: output.usage } : {}),
    });
    completedModelSteps += 1;
    return output;
  };

  // —— turnEnd 层：压缩先于 turn/end 落盘（T-7-04 次序断言的消费面）
  const turnEndCompactionLayer: ChainLayer<LoopContext, TurnEndPayload, void> = async (
    _$,
    e,
    next,
  ) => {
    const stepCount = completedModelSteps;
    completedModelSteps = 0;
    const turnRecords = monitor.history.filter(
      (r) => r.turn === e.turn && r.overThreshold,
    );
    if (turnRecords.length > 0) {
      const last = turnRecords[turnRecords.length - 1]!;
      try {
        await engine.run({
          turn: e.turn,
          phase: phaseForCompletedSteps(stepCount),
          request: {
            reason: "local-overflow",
            estimatedTokens: last.tokens,
            contextWindow: last.contextWindow,
          },
        });
      } catch (err) {
        // 压缩失败不阻断 turn 收尾（turnEnd 截断会让 turn 悬挂，closeTurn
        // 大声失败）。压力仍在：下一轮 PreTurn 判定重试，抖动由 guard 兜底。
        logger?.warn("turnEnd 压缩失败，轮次照常收尾", {
          userContent: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return next(e);
  };

  // —— 决策包装：M10 预算记账 + 提醒注入（写历史成功后才 mark）
  const budget = options.budget ? new RolloutBudget(options.budget) : null;
  const wrapDecideTurn: ChildAssembly["wrapDecideTurn"] = (base) => async (record) => {
    if (budget && record.usage) {
      const exhausted = budget.recordUsage(record.usage);
      const windowId = String(latestCompactionSeq(store.load(sessionId)) ?? 0);
      const reminder = budget.pendingReminder(sessionId, windowId);
      if (reminder) {
        const content =
          `[预算提醒] 已消耗 ${budget.used} 加权 token，剩余约 ` +
          `${reminder.remainingTokens}（提醒档位 ${reminder.reminderIndex}）。`;
        store.append(sessionId, [
          {
            type: "user/message",
            turn: record.turn,
            message: { content },
            source: "injected",
          },
        ]);
        // M10 语义核心：append 成功（已写进模型可见历史）才 mark——
        // 之后的取消不重发（事实已送达）。
        budget.markReminderDelivered(sessionId, windowId, reminder);
      }
      // 预算耗尽 = 显式停止决策（A1：end 由决策给出，loop 不自行推断）
      if (exhausted) return { action: "end" };
    }
    return base(record);
  };

  const revertService = new RevertService(store);
  const checkpoint = options.checkpointRepoRoot
    ? new GitCheckpointService({
        sessionId,
        store,
        runGit: createGitRunner(options.checkpointRepoRoot),
        onWarn: (message) => logger?.warn(message),
      })
    : undefined;

  // —— J6 换模（T-P1-04）：会话级模型选择状态。未提供注册表 = 不启用换模
  //（单模型装配零行为变化）；只给 initialIdentity 而无注册表是装配自相
  // 矛盾，拒绝启动（fail-closed，不静默忽略配置）。
  if (options.initialIdentity !== undefined && !options.models?.length) {
    throw new Error(
      "initialIdentity 需要同时提供 models 注册表（J6 换模装配自相矛盾）",
    );
  }
  const modelSwitch =
    options.models && options.models.length > 0
      ? new ModelSwitchService({
          initial: resolveInitialIdentity(options, store, sessionId, logger),
          models: options.models,
          emit: (emission) => {
            // J9 落流：会话级元事件挂流内最后 turn（session/revert 同款），
            // 空流兜 0；经 ForwardingStore 自然转发为协议 event 行。
            const events = store.load(sessionId);
            const turn = events.length > 0 ? events[events.length - 1]!.turn : 0;
            store.append(sessionId, [
              {
                type: "model/switch",
                turn,
                from: { ...emission.from },
                to: { ...emission.to },
                reason: emission.reason,
              },
            ]);
          },
        })
      : undefined;
  const handleModelSwitch = modelSwitch
    ? (identity: ModelIdentity): void => modelSwitch.switch(identity)
    : undefined;
  const modelForTurn = modelSwitch
    ? (turn: number): TurnModel => modelSwitch.captureForTurn(turn)
    : undefined;
  const onTurnError = modelSwitch
    ? (turn: number, failure: LlmFailure): void => {
        // J11：不兼容判据命中 → 回滚 prev（回滚本身的可观测面 = 服务状态
        // + 此处 warn 日志；落事件流在 T-P1-06 的词汇表扩展统一接入）。
        const rolledBack = modelSwitch.reportRequestFailure(turn, failure);
        if (rolledBack) {
          const to = modelSwitch.configured;
          logger?.warn(
            `换模回滚：${failure.code} 于 turn ${turn}，已恢复到 ` +
              `${to.provider}:${to.modelId}`,
          );
        }
      }
    : undefined;

  // —— G1/G7 plan 模式（T-P1-11）：服务在此构造，gate 出口活查询与工具
  // 注册共用同一实例（agent-process 取 assembly.planMode 注册工具面）。
  const planModeService = options.planMode ? createPlanModeService() : undefined;
  // —— G4 计划落盘（T-P1-13）：文件成功才记 checkpoint 事件（绝不产生
  // 指向不存在文件的引用；写失败上抛交 registry 兜底 isError）。
  const savePlanArtifactFn =
    options.planMode && options.planArtifactDir
      ? (plan: string): { path: string } => {
          const written = savePlanArtifact(options.planArtifactDir!, sessionId, plan);
          const events = store.load(sessionId);
          const turn = events.length > 0 ? events[events.length - 1]!.turn : 0;
          store.append(sessionId, [
            { type: "checkpoint", turn, provider: "plan", ref: { path: written.path } },
          ]);
          return written;
        }
      : undefined;

  // —— G3/G6 goal（T-P1-12）：落流出口与 todo/model/switch 同款（会话级
  // 元事件挂流内最后轮空流兜 0）。流内已有 goal 事实 → 按流重建（流内
  // 权威，J14 回放保护同款）；新会话 → 选项初始 goal 落事件。
  const restoredGoal = goalFromEvents(store.load(sessionId));
  const goalService = options.goal
    ? createGoalService({
        emit: (state) => {
          const events = store.load(sessionId);
          const turn = events.length > 0 ? events[events.length - 1]!.turn : 0;
          store.append(sessionId, [
            {
              type: "goal/set",
              turn,
              text: state.text,
              ...(state.deadline !== undefined ? { deadline: state.deadline } : {}),
              status: state.status,
            },
          ]);
        },
        ...(options.goal.expiryAction !== undefined
          ? { expiryAction: options.goal.expiryAction }
          : {}),
        ...(options.goal.renewExtendMs !== undefined
          ? { renewExtendMs: options.goal.renewExtendMs }
          : {}),
        ...(restoredGoal !== null ? { initial: restoredGoal } : {}),
      })
    : undefined;
  if (goalService !== undefined && restoredGoal === null) {
    // 新会话：初始 goal 落流（G3 验收④——goal 落事件流才有恢复面）
    goalService.set(options.goal!.text, options.goal!.deadline);
  }

  const toolGateLayer = createToolGateLayer({
    chain: policyChain,
    broker,
    sessionId,
    onWarning: (warning) => logger?.warn("策略警告", { userContent: warning }),
    ...(ceiling !== undefined ? { ceiling } : {}),
    ...(planModeService ? { planMode: () => planModeService.isActive } : {}),
  });

  // —— I1 hooks（T-P1-07）：registry 聚合层挂三点位外层（hooks → gate →
  // terminal：hook 改载荷会被内层权限重新判定；无注册点位不挂层，零开销）。
  const hookToolLayer = options.hooks?.layer<
    LoopContext,
    ToolCallPayload,
    ToolExecutionResult
  >("toolCall");
  const hookModelLayer = options.hooks?.layer<
    LoopContext,
    ModelRequestPayload,
    ModelStepOutput
  >("modelRequest");
  const hookTurnEndLayer = options.hooks?.layer<LoopContext, TurnEndPayload, void>("turnEnd");

  const layers: ChildAssembly["layers"] = {
    toolCall: [
      ...(hookToolLayer ? [namedLayer("hooks", hookToolLayer)] : []),
      toolGateLayer,
    ],
    modelRequest: [
      ...(hookModelLayer ? [namedLayer("hooks", hookModelLayer)] : []),
      contextLayer,
    ],
    turnEnd: [
      ...(hookTurnEndLayer ? [namedLayer("hooks", hookTurnEndLayer)] : []),
      turnEndCompactionLayer,
    ],
  };

  return {
    layers,
    beforeFirstModelRequest: async (turn) => {
      completedModelSteps = 0;
      // G3 goal 提醒注入（T-P1-12，同 PreTurn 压缩位）：到期判定 + 配置
      // 动作 + 提醒落流（M10 同款纪律——写进模型可见历史才算送达）。
      if (goalService) {
        const reminder = goalService.tickBeforeTurn(Date.now());
        if (reminder !== null) {
          store.append(sessionId, [
            { type: "user/message", turn, message: { content: reminder }, source: "injected" },
          ]);
        }
      }
      const messages = startNewContextWindow(store.load(sessionId));
      const verdict = detectLocalOverflow({ messages, contextWindow });
      if (!verdict.overflow) return;
      // PreTurn 压缩失败按 F10 处理：不吞——错误上抛交 loop.failTurn 闭合
      //（turn/end{error} 落盘，原始错误进 LlmFailure），绝不留下无恢复点的静默。
      await engine.run({
        turn,
        phase: "PreTurn",
        request: {
          reason: "local-overflow",
          estimatedTokens: verdict.estimatedTokens,
          contextWindow: verdict.contextWindow,
        },
      });
    },
    onToolStepCompleted: () => {
      guard.recordCompletedToolStep();
    },
    wrapDecideTurn,
    handleApprove: async (requestId, action, reason, scope, feedback) => {
      // C22/C24：scope=session 的批准在答复成功后落会话批准缓存——提案
      // 由引擎从挂起请求的 tool/args 计算（C48），缓存进程内、随会话灭。
      const request = pending
        .listPending()
        .find((r) => r.id === requestId);
      await pending.reply(requestId, {
        action,
        ...(reason !== undefined ? { reason } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(feedback !== undefined ? { feedback } : {}),
      });
      if (action === "allow" && scope === "session" && request !== undefined) {
        const proposal = proposeAmendment(
          { tool: request.tool, args: request.args, sessionId, source: "model" },
          builtinRuleMatchers,
        );
        if (proposal !== undefined) {
          approvalCache.record(sessionId, proposal.raw, "session");
        }
      }
    },
    handleRevert: (targetSeq) => {
      revertService.revert(sessionId, targetSeq);
    },
    ...(handleModelSwitch !== undefined && modelForTurn !== undefined
      ? { handleModelSwitch, modelForTurn, ...(onTurnError !== undefined ? { onTurnError } : {}) }
      : {}),
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    ...(planModeService !== undefined ? { planMode: planModeService } : {}),
    ...(savePlanArtifactFn !== undefined ? { savePlanArtifact: savePlanArtifactFn } : {}),
    ...(goalService !== undefined ? { goal: goalService } : {}),
    pathGuard,
    dispose: () => {
      pending.dispose();
    },
  };
}
