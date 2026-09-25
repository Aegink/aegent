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
import type { SessionEvent } from "./events.js";
import type { SessionStore } from "../session/store.js";
import { RevertService } from "../session/revert.js";
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
import { createToolGateLayer } from "../policy/gate.js";
import { createApprovalAuditSink } from "../policy/audit-fields.js";
import { PathGuard } from "../sandbox/path-guard.js";

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
  /** 协议 approve 请求的处理（C5 挂起唤醒；Stale/Unknown 类型化错误上抛）。 */
  handleApprove(requestId: string, action: "allow" | "deny", reason?: string): Promise<void>;
  /** 协议 revert 请求的处理（E4 对话态；越界错误上抛）。 */
  handleRevert(targetSeq: number): void;
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

  // —— 权限链（C58 层序常量展开）：用户规则集 > 核心（shell 语义分析）
  const loadedRules = loadRules(options.rules ?? [], builtinRuleMatchers);
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
    core: [createShellSemanticsModule()],
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

  const toolGateLayer = createToolGateLayer({
    chain: policyChain,
    broker,
    sessionId,
    onWarning: (warning) => logger?.warn("策略警告", { userContent: warning }),
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
    handleApprove: async (requestId, action, reason) => {
      await pending.reply(requestId, {
        action,
        ...(reason !== undefined ? { reason } : {}),
      });
    },
    handleRevert: (targetSeq) => {
      revertService.revert(sessionId, targetSeq);
    },
    pathGuard,
    dispose: () => {
      pending.dispose();
    },
  };
}
