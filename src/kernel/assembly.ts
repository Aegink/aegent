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
import type { JsonRecord, SessionEvent, LlmFailure } from "./events.js";
import type { PrefixChange } from "../context/prefix-anchor.js";
import { createNetworkGuard } from "../sandbox/network.js";
import {
  createRoutingBackend,
  resolveSandboxHelperPath,
  Win32SandboxBackend,
} from "../sandbox/containment.js";
import { canonicalize } from "../sandbox/workspace-sid.js";
import { NodeExecutionEnv, type ExecutionEnv } from "./tools/env.js";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  compHashChangeRequest,
  compactionFingerprint,
  DEFAULT_RETAINED_FROM_END,
  type CompactionInvocation,
  type CompactionSettled,
  type PreCompactOutcome,
  phaseForCompletedSteps,
} from "../context/compaction.js";
import {
  startNewContextWindow,
  DEFAULT_DEVELOPER_BUDGET_TOKENS,
} from "../context/new-window.js";
import { PressureMonitor } from "../context/pressure.js";
import { detectLocalOverflow } from "../context/overflow.js";
import { RapidRefillGuard } from "../context/rapid-refill.js";
import { currentWindow } from "../context/window.js";
import {
  DEFAULT_TIME_REMINDER_INTERVAL_SECONDS,
  timeReminderContent,
  timeReminderDue,
} from "../context/time-reminder.js";
import { type BudgetConfig, RolloutBudget } from "../context/budget.js";
import { assembleSystemPrompt } from "../context/system-prompt.js";
import { renderPersona, resolvePersona } from "../session/persona.js";
import { loadSkillsFromRoots } from "./skills.js";
import {
  type ApprovalAnnouncement,
  PendingApprovals,
} from "../policy/pending.js";
import { ManualPermissionBroker, type PermissionBrokerPort } from "../policy/broker.js";
import { assemblePolicyChain } from "../policy/chain.js";
import { createRuleSetModule } from "../policy/rules.js";
import {
  type RuleSource,
  loadRules,
  loadedRuleMatch,
  loadedRuleText,
  loadedRuleDenial,
} from "../policy/rule-loader.js";
import { builtinRuleMatchers } from "../policy/matchers.js";
import { createShellSemanticsModule } from "../policy/shell-semantics.js";
import {
  enforceCeiling,
  intersectAllProfiles,
  type CeilingProfile,
  type PermissionSourceProfile,
} from "../policy/intersect.js";
import { lintRules } from "../policy/linter.js";
import { BUILTIN_TOOL_NAMES, builtinToolParamNames } from "./tools/builtin/index.js";
import {
  ApprovalScopeCache,
  createSessionApprovalModule,
  proposeAmendment,
} from "../policy/review-decision.js";
import { createToolGateLayer, type ToolPolicyEvalOptions } from "../policy/gate.js";
import { createApprovalAuditSink } from "../policy/audit-fields.js";
import { createMetaOpsModule } from "../policy/meta-ops.js";
import { PathGuard } from "../sandbox/path-guard.js";
import {
  ModelSwitchService,
  type RegisteredModel,
  type TurnModel,
} from "./model-switch.js";
import { createPlanModeService, savePlanArtifact, type PlanModeService } from "./plan-mode.js";
import { createDefaultRegistry } from "./invariants.js";
import {
  createGoalService,
  goalFromEvents,
  type GoalExpiryAction,
  type GoalService,
} from "./goal.js";
import type { ModelIdentity } from "../models/identity.js";
import { createLlmSummarizer, truncatingSummarizer } from "../context/llm-summarizer.js";
import { createLlmJudge } from "../policy/judge.js";
import { JudgeBudgetTracker } from "../policy/judge-port.js";

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
 * T-P3-172：todo 投影 getter（todo_read 的数据源——与 emit 同源同纪律）：
 * 流内最后一条 todo/update 的 items（E12 整值提交，无增量折叠问题；
 * revert 切点语义由流本身承载——revert 后旧 update 仍在流上，与
 * todo_write 的落流事实一致）。
 */
export function createTodoReadGetter(
  store: SessionStore,
  sessionId: string,
): () => Array<{ content: string; status: "pending" | "in_progress" | "completed" }> {
  return () => {
    const events = store.load(sessionId);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i] as { type?: string; items?: unknown };
      if (e?.type === "todo/update" && Array.isArray(e.items)) {
        return e.items.map((it) => {
          const item = it as { content?: unknown; status?: unknown };
          return {
            content: typeof item?.content === "string" ? item.content : "",
            status: item?.status === "in_progress" || item?.status === "completed" ? item.status : "pending",
          };
        });
      }
    }
    return [];
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

export interface ChildAssemblyOptions {
  sessionId: string;
  store: SessionStore;
  /** 工作区根：PathGuard 边界 + 系统提示的 AGENTS.md 收集起点。 */
  workspaceRoot: string;
  /** 上下文窗口 token 数（压力判定与本地溢出口径）。 */
  contextWindow: number;
  /** 审批等待上界（C50：Manual broker 必填，无默认值）。 */
  approvalTimeoutMs: number;
  /**
   * T-P3-137 八轮 A：权限模式（settings.permission.mode——settings.json
   * 装配注入；子进程内经 SessionConfigStore.initial 转成 approvalMode
   * 活查询，config/refresh 会话内切换即生效）。
   */
  permissionMode?: string;
  /**
   * T-P3-140 批次 A：沙箱模式初始（settings.sandbox.mode——settings.json
   * 装配注入；子进程内经 SessionConfigStore.initial 转成活查询，config/
   * refresh 会话内切换即生效，权限模式预设同样写它）。缺省 undefined =
   * 全自动（danger-full-access 直通——既有行为零变化，装沙箱是显式选择）。
   */
  sandboxMode?: import("../sandbox/backend.js").SandboxMode;
  /**
   * T-P3-140 批次 A：沙箱模式活查询（agent-process 传 () =>
   * configStore.sandboxMode——与 approvalMode getter 同语义：活值优先于
   * 初始值，都缺席 = 全自动）。
   */
  sandboxModeProvider?: () => import("../sandbox/backend.js").SandboxMode | undefined;
  /**
   * T-P3-140 批次 A：helper exe 路径（测试注入/替代实现）；缺省
   * resolveSandboxHelperPath() 三段式解析（env → 发行包伴随位 → 仓库约定）。
   */
  sandboxHelperPath?: string;
  /**
   * T-P3-140 批次 A：受限档的私有 temp 目录（dsh "tempDir: null to
   * disable temp writes"——环境 temp 根绝不隐式授予）；缺省装配按工作区
   * 派生一个并落盘（helper 每次 run 补 grant）。null = 显式禁 temp。
   */
  sandboxTempDir?: string | null;
  /**
   * T-P3-140 批次 A：沙箱接线显式武装（生产入口 agent-child 传 true——
   * helper 在场即接线，defaultMode 全自动档 = local 直通零行为差）。缺省
   * false 时仅在显式配置了初始档时接线（受限档塌缩面可测）。测试装配不
   * 传 = 零行为变化（不依赖本机 helper 是否在场，CI 确定性）。
   */
  sandboxWiring?: boolean;
  /**
   * T-P3-140 批次 A：沙箱 local 直通档的执行环境（agent-process 传与
   * ToolRegistry 同一个 env 实例——全自动档与无沙箱路径共用一套 spawn
   * 面，测试注入 fake env 也同时生效两者）。缺省装配自建 NodeExecutionEnv。
   */
  sandboxLocalEnv?: ExecutionEnv;
  /**
   * T-P3-140 批次 D：工作区外的显式写白名单（PathGuard writeWhitelist
   * 透传——codex writable_roots 同位）。缺省无 = 仅工作区可写。
   */
  writeWhitelist?: readonly string[];
  /**
   * T-P3-141：回复语言（qwen outputLanguage 同构——非 auto 时系统提示注入
   * 输出语言指令；缺省/auto = 装配零变化）。
   */
  outputLanguage?: "zh-CN" | "en";
  /**
   * B8b/T-P1-21 question 的答复等待上界（毫秒）；缺省同 approvalTimeoutMs
   * ——超时按拒结算（C50 语义复用），测试用短上界。
   */
  questionTimeoutMs?: number;
  /** 用户层规则（行文本；缺省无规则——bash 走核心层 shell 语义分析）。 */
  rules?: readonly RuleSource[];
  /**
   * C45 linter 的注册表现存工具名（unknown-tool 判定面）；缺省内置六
   * 工具。装配面注入 registry 名单（动态注册工具时由装配方传入）。
   */
  knownToolNames?: readonly string[];
  /**
   * C40 linter 的工具参数名名单（unknown-param-name 判定面，T-P2-201）：
   * 工具名 → 参数 schema 属性名。缺省 builtinToolParamNames()（内置工具
   * 真实 schema 派生）；注册了 MCP 等动态工具的装配方传入合并表——无
   * 条目的工具跳过参数名警告（宁可漏报不误报）。
   */
  knownToolParams?: Readonly<Record<string, readonly string[]>>;
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
   * C11 项目信任（T-P1-69）：提供 ProjectTrustService 时 gate/revalidator
   * 出口挂信任降权（未信任时写/执行类出口 deny，规则不得授权）+
   * session-approval 挂 trustGated 过滤（C34 每次决策读当前信任）。缺省
   * undefined = 未启用，零行为变化。
   */
  trustService?: import("../policy/project-trust.js").ProjectTrustService;
  /**
   * Q2/T-P2-105 会话查询工具（session_query/session_get，dbPath 提供时
   * 注册到工具面）——agent-process 传 registerBuiltinTools。缺省 undefined
   * = 无持久库的装配无历史查询面（零行为变化）。
   */
  sessionQuery?: import("./tools/builtin/session-query.js").SessionQueryToolDeps;
  /**
   * U22/T-P3-125 技能面（settings skills 段装配消费）：disabled = 停用名单
   * （loadSkills 过滤——系统提示清单/skill_load/ready 补全三处统一收口）；
   * roots = 附加技能来源目录（loadSkillsFromRoots 多根扫描——workspace 主
   * 目录恒在）。缺省 undefined = 全启用 + 单根扫描（既有行为零变化）。
   */
  skillsDisabled?: readonly string[];
  skillsRoots?: readonly string[];
  /** T-P3-148 D：插件贡献技能目录（getter 活读——插件装载晚于装配构造，
   * 系统提示首落时点已回填；loadSkillsFromRoots extraDirs 直通）。 */
  pluginSkillDirs?: () => readonly { readonly dir: string; readonly namePrefix: string }[];
  /**
   * U23/T-P3-126 子代理身份段（task subagent_type 的预设 prompt——追加进
   * 系统提示，persona 同款位置）。仅子装配使用（runner 传入）；父会话
   * 缺省 undefined = 零追加零变化。
   */
  extraPrompt?: string;
  /**
   * U24/T-P3-127 全局指令文件（~/.aegent/AGENTS.md——F2 合并的最远层）。
   * 缺省 undefined = 不加全局层（既有行为零变化）。
   */
  globalAgentsPath?: string;
  /** T-P3-151 C2 记忆索引（~/.aegent/memory/MEMORY.md——装配末层）。 */
  memoryIndexPath?: string;
  /**
   * C12/C13 编辑前必须先读（T-P1-71）：提供 ReadGateService 时 read 记账、
   * edit/write/apply_patch 校验（未读拒/过期拒）。缺省 undefined = 不启用
   * （C13 整体丢弃，工具照常用）。
   */
  readGate?: import("../policy/read-gate.js").ReadGateService;
  /**
   * C25 工具激活四层（T-P1-76）：workspace/profile/global/session 纯 AND，
   * 任一层禁用 → 工具不可达（gate 首步 TOOL_NOT_ACTIVE，不进批准层）。
   * 缺省 undefined = 无激活面，零行为变化。
   */
  activation?: import("../policy/tool-activation.js").ToolActivationLayers;
  /**
   * C33 无人值守活查询（T-P1-77）：true 时 gate 把每一个 ask/abstain 转
   * 为 deny（保留检测只改结局）。装配侧接 SessionConfigStore 的活查询
   * （agent-process 传 () => configStore.unattended === true）；缺省
   * undefined = 零行为变化。
   */
  unattended?: () => boolean;
  /**
   * T-P3-137 八轮 A：审批模式活查询（SessionConfigStore.approvalMode——
   * config/refresh 会话内切换即生效）。gate ask 分支映射：auto 放行 /
   * read-only 写类拒绝 / accept-edits 编辑类放行 / ask-all 落 broker。
   * 缺省 undefined = 零行为变化（每次询问）。
   */
  approvalMode?: () => string | undefined;
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
  /**
   * F7/T-P1-103 时间上下文注入；缺省 undefined = 不启用（零注入零行为
   * 变化）。intervalSeconds 缺省 3600（新窗必送 + 区间节流）。
   */
  timeReminder?: { intervalSeconds?: number };
  /** 压缩摘要器；缺省 P0 内置截断摘要。 */
  summarizer?: Summarizer;
  /**
   * F5/T-P1-18 真摘要模型：提供且未显式传 summarizer 时，装配构造
   * createLlmSummarizer（provider 副调用 + request/header{reason:"compaction"}
   * + 失败回退截断摘要）。缺省 undefined = P0 截断摘要（零行为变化）。
   */
  /**
   * T-P3-147 H：压缩摘要指令覆写（settings enhancement.summaryPrompt——
   * codex compact_prompt 同构；缺省 = 内置 SUMMARY_SYSTEM_PROMPT）。
   */
  summaryPrompt?: string;
  summarizerModel?: {
    provider: import("../models/provider.js").ModelProvider;
    identity: ModelIdentity;
  };
  /**
   * F27/T-P2-511 压缩策略（配置选择）：prefix_window = 保留更大近期原文
   * 窗口、摘要只覆盖更早区间（活前缀缓存友好）。缺省 full_summary 零行为
   * 变化。策略入指纹（strategy 变更跨进程对拍可见 → 重压）。
   */
  compactionStrategy?: import("../context/compaction.js").CompactionStrategy;
  /**
   * C42/T-P2-203 判官模型（J3 配置面独立 judge 段）：提供时装配构造
   * createLlmJudge（两阶段 LLM 复核）挂 gate 的 judge 槽位 + 会话级
   * JudgeBudgetTracker（C56 预算槽）。缺省 undefined = 无判官（零行为
   * 变化——ask 全部落人，可降级运行）。
   */
  judgeModel?: {
    provider: import("../models/provider.js").ModelProvider;
    identity: ModelIdentity;
  };
  /**
   * C56 受管强制位：true 且判官 abstain/不可用 → 类型化失败非静默落回
   * （judgeModel 未提供时无判官可强制——此位只随 judgeModel 生效）。
   */
  requireJudge?: boolean;
  /**
   * B8a/T-P1-20 网络档（D3）：提供时装配创建 NetworkGuard（工具层唯一
   * 网络入口）并注册 webfetch 工具；缺省 undefined = 无网络工具（P0
   * 装配零变化，fail-closed——没配网络档就没有网络能力）。
   */
  networkPolicy?: import("../sandbox/network.js").NetworkPolicy;
  /** 压缩 pre/post hook 透传（测试观测用）。 */
  compactionPreHook?: (
    invocation: CompactionInvocation,
  ) => PreCompactOutcome | Promise<PreCompactOutcome>;
  compactionPostHook?: (settled: CompactionSettled) => void | Promise<void>;
  /**
   * O12 不变量检查（T-P1-30）：显式启用时装配期对既有流跑一轮内建不变量
   * （createDefaultRegistry），失败落 logger.warn——诊断面不是运行时前置
   * 条件，坏流照常按 Q5 对账恢复；缺省 false = 零行为变化。
   */
  invariants?: boolean;
  logger?: Logger;
  /** 审批宣告的协议转发口（asked/settled 由 agent-process 转发，timed-out 经事件流可见）。 */
  onApprovalAnnouncement?: (announcement: ApprovalAnnouncement) => void;
  /**
   * 审批 broker 覆盖（H3/T-P1-42 子代理装配）：缺省 Manual（CLI 审批出口，
   * C51 零行为变化）；子代理装配传 DenyPermissionBroker——ask 请求确定性
   * 拒绝（dsh approvalPolicy 钉死 'never' 同构，见 subagent.ts）。
   */
  broker?: PermissionBrokerPort;
  /**
   * 子代理 delegation 声明（H3/T-P1-44）：子代理装配置 true——系统提示
   * 渲染降级范围声明段（system-prompt 的 delegation 段）。缺省 false =
   * 父会话提示零变化。
   */
  delegation?: boolean;
  /**
   * I8 人格预设（T-P2-305）：--persona 选的内置预设 id——系统提示首落时
   * 渲染人格段追加进同一条 system/message（随会话流持久）；缺省 undefined
   * = 无人格段，装配零变化。未知 id 装配期即拒绝（PersonaError）。
   */
  personaId?: string;
}

export interface ChildAssembly {
  /** 三个点位的层（gate / 上下文装配+压力测量 / 压缩）。 */
  layers: NonNullable<AgentLoopDeps["layers"]>;
  /** C19/T-P1-75 dry-run 求值面（与 gate 层同一选项对象——同链保证）。 */
  policyEvalOptions: ToolPolicyEvalOptions;
  /** PreTurn 压缩挂点（loop 的 beforeFirstModelRequest hook）。 */
  beforeFirstModelRequest(turn: number): Promise<void>;
  /** step 收尾记账（loop 的 onToolStepCompleted hook → 抖动断路器）。 */
  onToolStepCompleted(turn: number, step: number): void;
  /**
   * B8a/T-P1-20 网络守卫（D3 唯一网络入口；networkPolicy 装配选项提供时
   * 存在）——agent-process 传给 registerBuiltinTools 注册 webfetch。
   */
  networkGuard?: import("../sandbox/network.js").NetworkGuard;
  /**
   * T-P3-140 批次 A：bash/pwsh 的沙箱装配（模式路由后端 + 活 defaultMode
   * + 升级审批通道）——agent-process 传给 registerBuiltinTools。缺省
   * undefined = env 直通（P0 行为；escalation 参数报 SANDBOX_UNAVAILABLE）。
   * pwshSandbox 是同一后端的"无审批"切片（受限档同样强制，但升级申请在
   * bash 一侧——pwsh 不双开升级面）。
   */
  bashSandbox?: {
    backend: import("../sandbox/backend.js").SandboxBackend;
    readonly defaultMode: import("../sandbox/backend.js").SandboxMode;
    approvals?: PendingApprovals;
    sessionId?: string;
    approvalTimeoutMs?: number;
  };
  pwshSandbox?: {
    backend: import("../sandbox/backend.js").SandboxBackend;
    readonly defaultMode: import("../sandbox/backend.js").SandboxMode;
  };
  /**
   * B8b/T-P1-21 question 工具依赖（与权限审批共用的同一个 PendingApprovals
   * ——不新增第二套挂起注册表）——agent-process 传给 registerBuiltinTools。
   */
  question: {
    pending: PendingApprovals;
    sessionId: string;
    timeoutMs: number;
  };
  /** 协议 question/answer 的处理（B8b：答复映射 allow+reason=文本 / deny=未作答；迟到/未知类型化错误上抛）。 */
  handleQuestionAnswer(requestId: string, answer: string): Promise<void>;
  /**
   * F6/F13/T-P1-19 缓存锚变化观测（loop 的 onCacheAnchorChange hook）：
   * rewritten = 前缀作废（换模 + rewritten 即违背 F13）落 warn；
   * appended = 位置性追加落 info。
   */
  onCacheAnchorChange(change: PrefixChange): void;
  /** 决策包装（预算记账 + 提醒注入；决策语义仍由 base 给出）。 */
  wrapDecideTurn(base: DecideTurn): DecideTurn;
  /** 协议 approve 请求的处理（C5 挂起唤醒 + C24 scope/feedback：session 作用域落批准缓存、feedback 落审计；Stale/Unknown 类型化错误上抛）。 */
  handleApprove(
    requestId: string,
    action: "allow" | "deny",
    reason?: string,
    scope?: "once" | "session",
    feedback?: string,
    modifiedInput?: JsonRecord,
    source?: string,
  ): Promise<void>;
  /** 协议 revert 请求的处理（E4 对话态；越界错误上抛）。 */
  handleRevert(targetSeq: number): void;
  /**
   * T-P3-161：会话思考档覆盖（thinking/set 命令面——"omit"=显式不传思考
   * 参数；undefined=未覆盖跟模型默认档）。内存态：与 model/switch 的换模
   * 生命周期同款，落流归档记档（词汇表扩展另立）。
   */
  setThinkingOverride(level: string): void;
  thinkingOverrideForTurn(): string | undefined;
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
  /**
   * T-P3-174 批次 1：get_context_remaining 的数据源（F10 调用后压力测量
   * 的只读投影——最后一条压力记录 = 最近一次模型调用的已用/窗口；无记录
   * 返回 null 诚实降级）。
   */
  contextUsage?: () => import("./tools/builtin/get-context-remaining.js").ContextUsageSnapshot | null;
  /** 工具注册的面（PathGuard 由装配定形，注册处必收）。 */
  pathGuard: PathGuard;
  /** 释放未决审批（dispose 路径：按超时语义拒绝，不悬挂）。 */
  dispose(): void;
}

export function createChildAssembly(options: ChildAssemblyOptions): ChildAssembly {
  const { sessionId, store, logger } = options;
  // T-P3-161：会话思考档覆盖（thinking/set 写入；turn 捕获时读——turn 内
  // 一致语义与 J7 捕获同款）
  let sessionThinkingOverride: string | undefined;
  // I8：personaId 装配期即校验（fail-closed——initialIdentity 同款纪律：
  // 坏配置在启动时大声失败，不等到首个 modelRequest 才炸）。
  if (options.personaId !== undefined) resolvePersona(options.personaId);
  const contextWindow = options.contextWindow;
  // F7：时间注入间隔（未启用 = undefined，注入位跳过）。
  const timeReminderIntervalSeconds =
    options.timeReminder !== undefined
      ? (options.timeReminder.intervalSeconds ?? DEFAULT_TIME_REMINDER_INTERVAL_SECONDS)
      : undefined;

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
  const broker = options.broker ?? new ManualPermissionBroker(pending, options.approvalTimeoutMs);

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
    // C40（T-P2-201）：缺省面 = 内置工具真实 schema 派生的参数名表
    // （builtinToolParamNames 模块级缓存）；MCP 等动态工具由装配方合并。
    knownToolParams: options.knownToolParams ?? builtinToolParamNames(),
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
              match: loadedRuleMatch(),
              ruleText: loadedRuleText,
              // C55（T-P2-202）：命中规则声明了 justification/alternatives
              // 时附带结构化拒绝面——gate 渲染"怎么办"。
              ruleDenial: loadedRuleDenial,
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
        // C34：trustGated 批准仅信任期间生效（每次评估读当前信任）
        ...(options.trustService !== undefined
          ? { trustState: () => options.trustService!.isTrusted() }
          : {}),
      }),
      createShellSemanticsModule(),
    ],
  });

  // —— 压缩 / 压力 / 抖动（阶段 7 模块接线）
  const guard = new RapidRefillGuard();
  const monitor = new PressureMonitor({ contextWindow });
  // F26/T-P1-100：压缩指纹（影响摘要内容或重建的配置面——覆盖面卡内定形，
  // 见 CompactionFingerprintInput）。装配期配置不变 → 指纹会话内恒定；
  // 变更只可能来自重启时的新装配（fingerprint 跨进程由事件 compHash 对拍）。
  const fingerprint = compactionFingerprint({
    ...(options.summarizerModel !== undefined
      ? { model: options.summarizerModel.identity }
      : {}),
    summarizerKind: options.summarizer
      ? "custom"
      : options.summarizerModel !== undefined
        ? "llm"
        : "truncating",
    retainedFromEnd: DEFAULT_RETAINED_FROM_END,
    developerBudgetTokens: DEFAULT_DEVELOPER_BUDGET_TOKENS,
    // F27/T-P2-511：策略入指纹——prefix_window 改变摘要覆盖区间，变更后重压
    ...(options.compactionStrategy !== undefined
      ? { strategy: options.compactionStrategy }
      : {}),
  });
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
            contextWindow,
            ...(options.summaryPrompt !== undefined && options.summaryPrompt.trim() !== ""
              ? { systemPrompt: options.summaryPrompt }
              : {}),
          })
        : truncatingSummarizer()),
    rapidRefillGuard: guard,
    compHash: () => fingerprint,
    // F27/T-P2-511：配置选择的压缩策略（prefix_window 活前缀切点）
    ...(options.compactionStrategy !== undefined
      ? { strategy: options.compactionStrategy }
      : {}),
    // F11/T-P1-101：兜底检查点的硬安全复检预算 + 摘要器尺寸预检/分块的窗口面
    contextWindow,
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

  const pathGuard =
    options.writeWhitelist !== undefined && options.writeWhitelist.length > 0
      ? PathGuard.forWorkspace(options.workspaceRoot, {
          writeWhitelist: options.writeWhitelist,
        })
      : PathGuard.forWorkspace(options.workspaceRoot);

  // —— T-P3-140 批次 A：沙箱三档生产接线（模式路由后端 + 活 defaultMode）。
  // 受限档强制面 = win32 受限令牌 helper（缺席 → D5 fail-closed + 可见降级
  // 告警）；全自动档恒 local 直通（既有行为零变化）。defaultMode 活值 =
  // provider() ?? 初始 ?? 全自动；helper 缺席时受限档塌缩全自动（每档一次
  // warn——不静默放宽，自检面板常显降级事实）。接线门槛 = 显式 opt-in
  //（sandboxWiring）或显式初始档——最小装配与既有测试路径零变化。
  const sandboxArmed =
    options.sandboxWiring === true || options.sandboxMode !== undefined;
  const sandboxHelperPath = options.sandboxHelperPath ?? resolveSandboxHelperPath();
  const win32SandboxBackend = new Win32SandboxBackend({
    helperPath: sandboxHelperPath,
    workspace: options.workspaceRoot,
    // 私有 temp 目录（dsh "tempDir: null to disable temp writes"——环境
    // temp 根绝不隐式授予）：按 canonical 工作区路径派生独立目录并落盘
    //（helper 每次 run 补 grant；canonical 失败回原样——派生仍确定）。
    tempDir:
      options.sandboxTempDir !== undefined
        ? options.sandboxTempDir
        : (() => {
            const dir = path.join(
              tmpdir(),
              `aegent-sandbox-${createHash("sha256").update(canonicalize(options.workspaceRoot)).digest("hex").slice(0, 16)}`,
            );
            try {
              mkdirSync(dir, { recursive: true });
            } catch {
              // temp 目录建不了 = temp 面放弃（workspace-write 仍可用），
              // 不炸装配——helper 侧 grant 缺目录会类型化报错。
            }
            return dir;
          })(),
  });
  const sandboxExecutionEnv: ExecutionEnv = options.sandboxLocalEnv ?? new NodeExecutionEnv();
  const sandboxBackend = createRoutingBackend({
    ...(win32SandboxBackend.isHelperAvailable() ? { restricted: win32SandboxBackend } : {}),
    localEnv: sandboxExecutionEnv,
    ...(logger !== undefined
      ? { logger: { warn: (message: string) => logger.warn(message) } }
      : {}),
  });
  const degradedWarnedModes = new Set<string>();
  const sandboxDefaultMode = (): import("../sandbox/backend.js").SandboxMode => {
    const configured = options.sandboxModeProvider?.() ?? options.sandboxMode;
    if (configured === undefined || configured === "danger-full-access") {
      return "danger-full-access";
    }
    if (!win32SandboxBackend.isHelperAvailable()) {
      if (!degradedWarnedModes.has(configured)) {
        degradedWarnedModes.add(configured);
        logger?.warn(
          `子进程管辖降级：沙箱档「${configured}」配置在场但 helper 不在场` +
            `（${sandboxHelperPath}）——bash/pwsh 按全自动降级运行，升级申请不受理` +
            `（自检面板常显此事实；恢复强管辖后新会话即真实强制）。`,
        );
      }
      return "danger-full-access";
    }
    return configured;
  };
  const shellSandbox = sandboxArmed
    ? {
        backend: sandboxBackend,
        get defaultMode() {
          return sandboxDefaultMode();
        },
      }
    : undefined;

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
      // 每次直读、当前会话即时）。U22/T-P3-125：disabled 停用过滤 +
      // roots 多根扫描（settings skills 段装配消费）。
      const skillLoad = loadSkillsFromRoots(
        options.workspaceRoot,
        options.skillsRoots,
        options.skillsDisabled !== undefined || options.pluginSkillDirs !== undefined
          ? {
              ...(options.skillsDisabled !== undefined ? { disabled: options.skillsDisabled } : {}),
              ...(options.pluginSkillDirs !== undefined ? { extraDirs: options.pluginSkillDirs() } : {}),
            }
          : undefined,
      );
      for (const d of skillLoad.diagnostics) {
        logger?.warn(`skill-lint: [${d.code}] ${d.path} —— ${d.message}`);
      }
      const prompt = await assembleSystemPrompt({
        approvalTier: "on_request",
        describeWritableRoots: () => pathGuard.describeWritableRoots(),
        cwd: options.workspaceRoot,
        ...(options.globalAgentsPath !== undefined ? { globalAgentsPath: options.globalAgentsPath } : {}),
        ...(options.memoryIndexPath !== undefined ? { memoryPath: options.memoryIndexPath } : {}),
        ...(skillLoad.skills.length > 0 ? { skills: skillLoad.skills } : {}),
        ...(planModeService ? { planMode: true } : {}),
        ...(options.delegation ? { delegation: true } : {}),
        ...(options.outputLanguage !== undefined ? { outputLanguage: options.outputLanguage } : {}),
      });
      // I8 人格段（T-P2-305）：--persona 选了预设则渲染后追加进同一条系统
      // 提示（人格随会话流持久——恢复自动生效）；未选择 = 零追加。
      const persona = resolvePersona(options.personaId);
      // U23/T-P3-126：子代理身份段（extraPrompt——task subagent_type 的
      // 预设身份提示，persona 同款追加位；父会话缺省无此段零变化）。
      const withPersona =
        `${prompt}${persona === undefined ? "" : `\n\n${renderPersona(persona, { workspace: options.workspaceRoot })}`}` +
        `${options.extraPrompt === undefined ? "" : `\n\n${options.extraPrompt}`}`;
      store.append(sessionId, [
        {
          type: "system/message",
          turn: e.turn,
          step: e.step,
          message: { content: withPersona },
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
      // F25/T-P1-99：窗口身份经 currentWindow 推导（已结算压缩才换窗——
      // started/failed 残留不换、revert 掉压缩窗口回退；M10"压缩后即换窗"
      // 的派生串归一到 context/window.ts 单一实现位）。
      const windowId = String(currentWindow(store.load(sessionId)).currentId);
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

  // —— O12 不变量检查（T-P1-30）：显式启用时对既有流跑一轮内建不变量，
  // 失败落 warn 诊断。诊断面不是运行时前置条件——坏流照常按 Q5 对账恢复。
  if (options.invariants) {
    for (const report of createDefaultRegistry().check(store.load(sessionId))) {
      for (const failure of report.ok ? [] : report.failures) {
        logger?.warn(`不变量检查失败[${report.name}]：${failure}`);
      }
    }
  }

  // C19/T-P1-75：求值面选项单独成对象——gate 层与 dry-run（协议
  // policy/check）消费同一形状，"同一条链"由共享对象结构性保证。
  const toolGateEvalOptions: ToolPolicyEvalOptions = {
    chain: policyChain,
    sessionId,
    ...(ceiling !== undefined ? { ceiling } : {}),
    ...(planModeService ? { planMode: () => planModeService.isActive } : {}),
    // C11：未信任项目写/执行类出口降权（规则不得授权），缺省零行为变化
    ...(options.trustService !== undefined
      ? { trustState: () => options.trustService!.isTrusted() }
      : {}),
  };
  const toolGateLayer = createToolGateLayer({
    ...toolGateEvalOptions,
    broker,
    onWarning: (warning) => logger?.warn("策略警告", { userContent: warning }),
    // C25：激活四层（缺省 undefined = 零行为变化）
    ...(options.activation !== undefined ? { activation: options.activation } : {}),
    // C33：无人值守活查询（缺省 undefined = 零行为变化）
    ...(options.unattended !== undefined ? { unattended: options.unattended } : {}),
    // T-P3-137 八轮 A：审批模式活查询（缺省 undefined = 零行为变化）
    ...(options.approvalMode !== undefined ? { approvalMode: options.approvalMode } : {}),
    // C42/T-P2-203：判官本体（J3 独立 judge 段）+ 会话级预算记账（C56
    // 预算槽）+ L2 审计（judge 决策可追溯——logger 宣告面，与审批审计
    // 同款；零词汇表事件）。缺省 undefined = 无判官（ask 全部落人）。
    ...(options.judgeModel !== undefined
      ? {
          judge: createLlmJudge({
            provider: options.judgeModel.provider,
            identity: options.judgeModel.identity,
            audit: (record) =>
              logger?.info("judge-audit", {
                phase: record.phase,
                tool: record.tool,
                ...(record.outcome !== undefined ? { outcome: record.outcome } : {}),
                ...(record.reason !== undefined ? { reason: record.reason } : {}),
                ...(record.stage !== undefined ? { stage: record.stage } : {}),
                ...(record.model !== undefined ? { model: record.model } : {}),
                ...(record.durationMs !== undefined
                  ? { durationMs: record.durationMs }
                  : {}),
              }),
            onWarn: (message) => logger?.warn("judge", { userContent: message }),
          }),
          judgeBudget: new JudgeBudgetTracker(),
          ...(options.requireJudge === true ? { requireJudge: true } : {}),
        }
      : {}),
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
    policyEvalOptions: toolGateEvalOptions,
    // T-P3-174 批次 1：F10 压力测量的只读投影（get_context_remaining 数据源）
    contextUsage: () => {
      const last = monitor.history[monitor.history.length - 1];
      return last === undefined
        ? null
        : { used: last.tokens, contextWindow: last.contextWindow };
    },
    // F6/F13/T-P1-19：锚变化观测——rewritten 落 warn（前缀作废，换模时
    // 即违背 F13）；appended 落 info（位置性追加，F13 允许形态）。
    onCacheAnchorChange: (change) => {
      if (change.kind === "rewritten") {
        logger?.warn(
          `缓存锚前缀作废（${change.modelSwitched ? "伴随换模" : "同模型"}）——已缓存前缀本次失效`,
        );
      } else {
        logger?.info("cache-anchor", {
          kind: change.kind,
          modelSwitched: change.modelSwitched,
        });
      }
    },
    // B8a/T-P1-20：networkPolicy 提供时创建守卫（工具层唯一网络入口）；
    // 缺省 undefined = 无网络工具（P0 装配零变化）
    ...(options.networkPolicy !== undefined
      ? {
          networkGuard: createNetworkGuard({ policy: options.networkPolicy }),
        }
      : {}),
    // T-P3-140 批次 A：沙箱三档接线（武装时暴露——agent-process 传
    // registerBuiltinTools；bash 带升级审批通道，pwsh 是无升级切片）。
    ...(shellSandbox !== undefined
      ? {
          bashSandbox: {
            backend: shellSandbox.backend,
            defaultMode: shellSandbox.defaultMode,
            approvals: pending,
            sessionId,
            approvalTimeoutMs: options.approvalTimeoutMs,
          },
          pwshSandbox: {
            backend: shellSandbox.backend,
            defaultMode: shellSandbox.defaultMode,
          },
        }
      : {}),
    // B8b/T-P1-21：question 依赖（共用 pending 注册表）+ 协议答复处理；
    // C36 有界警告落 logger（T-P1-70）
    question: {
      pending,
      sessionId,
      timeoutMs: options.questionTimeoutMs ?? options.approvalTimeoutMs,
      ...(logger !== undefined
        ? { onWarn: (message: string) => logger.warn("question", { userContent: message }) }
        : {}),
    },
    handleQuestionAnswer: async (requestId, answer) => {
      await pending.reply(
        requestId,
        answer !== ""
          ? { action: "allow", reason: answer }
          : { action: "deny", reason: "用户选择不回答" },
      );
    },
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
      // F7/T-P1-103：时间上下文注入（新窗必送 + interval 节流；状态从流
      // 重建——timeReminderDue 纯函数判定，落流动作即"送达"闭合，M10 纪律）。
      if (timeReminderIntervalSeconds !== undefined) {
        if (timeReminderDue(store.load(sessionId), Date.now(), timeReminderIntervalSeconds)) {
          store.append(sessionId, [
            {
              type: "user/message",
              turn,
              message: { content: timeReminderContent(new Date()) },
              source: "injected",
            },
          ]);
        }
      }
      const messages = startNewContextWindow(store.load(sessionId));
      const verdict = detectLocalOverflow({ messages, contextWindow });
      if (!verdict.overflow) {
        // F26/T-P1-100：溢出未触发时查压缩指纹——配置指纹变了（如重启后换了
        // 摘要模型）重压旧窗口（CompHashChanged）。双值齐备且不等才触发
        // （compHashChangeRequest 内判）；溢出刚压缩过则指纹已刷新、自然跳过。
        const hashRequest = compHashChangeRequest(store.load(sessionId), fingerprint);
        if (hashRequest !== null) {
          await engine.run({ turn, phase: "PreTurn", request: hashRequest });
        }
        return;
      }
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
    handleApprove: async (requestId, action, reason, scope, feedback, modifiedInput, source) => {
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
        // C52：修改后参数随答复透传（gate 侧重跑出口族硬拦）
        ...(modifiedInput !== undefined ? { modifiedInput } : {}),
        // C6：答复端标识透传（跨端回转审计面）
        ...(source !== undefined ? { source } : {}),
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
    setThinkingOverride: (level) => {
      sessionThinkingOverride = level;
    },
    thinkingOverrideForTurn: () => sessionThinkingOverride,
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
