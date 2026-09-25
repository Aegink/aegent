/**
 * 子进程生产装配（T-8-01）——阶段 5/7 的模块级交付在此接进 loop：
 *
 *   toolCall      权限 gate（C9 求值先于执行；ask → Manual broker 挂起等
 *                 CLI /approve 转达答复，超时/拒绝落 isError 保配平）。
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
  TurnEndPayload,
} from "./loop.js";
import type { ChainLayer } from "./chain.js";
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
import { PathGuard } from "../sandbox/path-guard.js";
import {
  ModelSwitchService,
  type RegisteredModel,
  type TurnModel,
} from "./model-switch.js";
import type { ModelIdentity } from "../models/identity.js";

/** P0 内置摘要器：声明性前缀 + 拼接截断。真实摘要质量属 F5（P1）。 */
export function truncatingSummarizer(maxChars = 2000): Summarizer {
  return async ({ messages }) => {
    const text = messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n");
    return (
      text.length > maxChars
        ? `${text.slice(0, maxChars)}…（自动摘要截断）`
        : text
    );
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
  /** M10 预算配置；缺省不启用预算轴。 */
  budget?: BudgetConfig;
  /** 压缩摘要器；缺省 P0 内置截断摘要。 */
  summarizer?: Summarizer;
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
    summarizer: options.summarizer ?? truncatingSummarizer(),
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
      const prompt = await assembleSystemPrompt({
        approvalTier: "on_request",
        describeWritableRoots: () => pathGuard.describeWritableRoots(),
        cwd: options.workspaceRoot,
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

  const toolGateLayer = createToolGateLayer({
    chain: policyChain,
    broker,
    sessionId,
    onWarning: (warning) => logger?.warn("策略警告", { userContent: warning }),
    ...(ceiling !== undefined ? { ceiling } : {}),
  });

  const layers: ChildAssembly["layers"] = {
    toolCall: [toolGateLayer],
    modelRequest: [contextLayer],
    turnEnd: [turnEndCompactionLayer],
  };

  return {
    layers,
    beforeFirstModelRequest: async (turn) => {
      completedModelSteps = 0;
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
    pathGuard,
    dispose: () => {
      pending.dispose();
    },
  };
}
