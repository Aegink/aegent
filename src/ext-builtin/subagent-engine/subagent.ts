import { mkdirSync } from "node:fs";

// T2-6 依赖倒置：子代理端口类型（Delegation*/Subagent*）下沉
// core/contracts/subagent.ts——本文件保留实现面（createSubagentRunner 与
// SubagentRunnerDeps 装配参数），契约 re-export 保兼容消费面。
export type {
  DelegationSendReceipt,
  DelegationSnapshot,
  DelegationStatus,
  DelegationsApi,
  SubagentBackgroundStart,
  SubagentRunOutcome,
  SubagentRunResult,
  SubagentStopReason,
  SubagentRunner,
} from "../../core/index.js";
import type {
  DelegationSendReceipt,
  DelegationSnapshot,
  DelegationStatus,
  DelegationsApi,
  SubagentBackgroundStart,
  SubagentRunOutcome,
  SubagentRunResult,
  SubagentStopReason,
  SubagentRunner,
} from "../../core/index.js";
import { DelegationSendError } from "../../core/index.js";
import { PromptQueue } from "../../core/index.js";
import path from "node:path";
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

import type { ModelIdentity } from "../../models/identity.js";
import type { ModelProvider } from "../../models/provider.js";
import { resolveSubagent } from "../../session/subagents-config.js";
import { DenyPermissionBroker } from "../../policy/broker.js";
import { deriveSubagentRules } from "../../policy/subagent-rules.js";
import type { RuleSource } from "../../policy/rule-loader.js";
import { createChildAssembly, type ChildAssembly } from "../../runtime/assembly.js";
import type { AgentLoopDeps } from "../../core/index.js";
import { AgentLoop } from "../../core/index.js";
import type { Logger } from "../../core/index.js";
import type { SessionStore } from "../../session/store.js";
import { project } from "../../session/project.js";
import { NodeExecutionEnv } from "../../core/index.js";
import { ToolRegistry } from "../../core/index.js";
import { registerBuiltinTools } from "../../../plugins/tools-builtin/index.js";
import type { TurnEndReason } from "../../core/index.js";

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




// ---------------------------------------------------------------------------
// T-P3-145 G：后台委托（run_in_background——pi-desktop Task 生命周期同构收敛面）
// ---------------------------------------------------------------------------

/** 后台委托状态机（running → completed|failed|cancelled|stopped 终态一次）。 */


/** 委托快照（task_list / task_wait 的数据面）。 */


/** 后台启动回执（task 工具 run_in_background 的返回形状）。 */


/** runSubagent 的返回：前台 = 完整结算（既有语义）；后台 = 启动收执。 */


/** 注册表面（task_wait/task_list/task_stop 与主 loop 收敛钩子共用）。 */


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
    readonly backend: import("../../sandbox/backend.js").SandboxBackend;
    readonly defaultMode: import("../../sandbox/backend.js").SandboxMode;
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
  readonly subagentDefs?: import("../../session/subagents-config.js").SubagentDefinition[];
  /**
   * U23/T-P3-126：预设独立模型解析闭包（装配面注入——agent-child 按
   * resolveSubagentModel 链解析为 RegisteredModel；未解析出 = 回退父模型）。
   */
  readonly resolveSubagentModel?: (
    subagent: import("../../session/subagents-config.js").ResolvedSubagent,
  ) => { provider: ModelProvider; identity: ModelIdentity } | undefined;
  /**
   * J6/J7 捕获闭包透传（父装配的 modelForTurn）：子 turn 启动时捕获
   * configured 当前值——换模后派发的子代理用新模型（继承父当前选择）。
   */
  readonly modelForTurn?: AgentLoopDeps["modelForTurn"];
  /**
   * T-P3-145 G：后台委托结算回调（装配方接线——报告注入父队列）。回调
   * 抛错被吞（报告仍在注册表——task_wait 可查）；缺省 undefined = 只登记
   * 不注入。
   */
  readonly onSettle?: (delegation: DelegationSnapshot) => void;
  /**
   * C4：外部子代理后端表（装配方注入——agent-child 按 settings
   * subagentBackend 段构造；键 = 后端名如 "acp"）。run 的 opts.backend
   * 命中表时经其出闸（表内实现自带审批/超时/结算语义）；未命中 failed
   * 结算（never-reject 纪律——不炸父轮）。缺省 undefined = 仅进程内
   * fork（既有行为零变化）。
   */
  readonly externalBackends?: ReadonlyMap<
    string,
    (request: { prompt: string; description: string; signal?: AbortSignal }) => Promise<SubagentRunResult>
  >;
  /**
   * W9/T9-2 continuable 回投出口（子代理 task_send({delegationId:"parent"})
   * 的投递面——dsh withContinuableReturnGuidance 同构）：本 runner 产生的
   * 子代理把自足结果发回父会话的通道。装配 = 父队列注入（onSettle 同款）；
   * 缺省 undefined = 子代理提示不含回投指引、task_send("parent") 类型化
   * 拒绝（不可续面 zero 变化）。
   */
  readonly sendToParent?: (message: string) => void;
}

/**
 * W9/T9-2：continuable 子提示（dsh continuation-messages 同构）——在子任务
 * 提示后追加"结束前把自足结果发回父会话"的指引。发送不结束回合（A9——
 * 队列收执即返回）。
 */
export function withContinuableReturnGuidance(parentSessionId: string, prompt: string): string {
  return (
    `${prompt}\n\n` +
    `【续跑协作指引】你的父会话 id 是 ${parentSessionId}。结束前，用 ` +
    `task_send({ delegationId: "parent", message: "<自足的最终结果——包含父会话续推所需的全部上下文>" }) ` +
    `把结果发回父会话。发送消息不会结束你的回合（收到受理回执即返回）；` +
    `发送后你可以继续做收尾工作。父会话也会在你结束时自动收到你的完整报告——` +
    `task_send 适用于你想让父会话**更早**拿到关键结果（或分批回投）的场景。`
  );
}

/**
 * 构造子代理 runner（每个持有者一个实例；counter 保证同进程内子会话 id
 * 唯一，Date.now 后缀防跨进程重启撞名）。返回 { run, delegations }：
 * run 是 task 工具 deps 的 runSubagent（深度检查在入口——先于任何状态
 * 创建，拒绝是纯函数式的：不产生半态子会话）；delegations 是后台委托
 * 注册表面（T-P3-145 G——task_wait/list/stop 与主 loop 收敛钩子共用）。
 *
 * 第三个参数 opts.signal（T-P1-43 取消联动）：父 turn 的取消信号——
 *   - 已 abort（父取消先于派发）：不起子轮，直接 cancelled 结算
 *     （零子会话零模型调用——"迟到的取消不武装后续工作"的子代理面）；
 *   - 运行中 abort：联动 subLoop.cancel({kind: "parent"})（CancelCause
 *     "parent"——"子代理被父级取消"槽位的真用），子 loop 在 await 边界
 *     收轮 aborted，结算 cancelled（dsh activation stop 传播 /
 *     opencode ctx.abort.addEventListener 同构）。
 *
 * G（T-P3-145）：opts.background = true 时启动不等待——立即返回启动收执，
 * 子 loop 在后台跑到终态（注册表结算 + onSettle 回调）。**后台委托不受
 * opts.signal 取消联动**（后台语义——父轮取消不杀后台委托；父会话收尾
 * 才是终止点，dispose 纪律）。
 */
export function createSubagentRunner(deps: SubagentRunnerDeps): SubagentRunner {
  let counter = 0;
  let delegationSeq = 0;
  const maxDepth = deps.maxDepth ?? 1;
  // 并发上限（pi-desktop MAX_SUBAGENT_CONCURRENCY 同值）——满时后台启动拒绝。
  const MAX_SUBAGENT_DELEGATIONS = 10;
  /** 报告截断（pi-desktop MAX_SUBAGENT_REPORT_CHARS 同值——头尾保留）。 */
  const MAX_REPORT_CHARS = 12_000;

  interface DelegationEntry {
    id: string;
    childSessionId: string;
    agentName: string;
    description: string;
    status: DelegationStatus;
    startedAt: number;
    settledAt?: number;
    report?: string;
    error?: string;
    cancel: () => void;
    /** W9/T9-2 定向 steer 面（工作中的子 loop 队列入队——step 边界注入）；
     * 缺省 undefined = 无队列面（不可 steer）。snapshot 剥离（非契约面）。 */
    steer?: (content: string) => boolean;
    /** W16 排查 D1：steer 收队闸——子 loop runTurn 返回后的同步段置 false
     * （与 send 无 await 竞态）。false = loop 已停，steer 入队无人消费——
     * send 改走 resume 路径（消息不丢、不假收执）。 */
    acceptsSteer: boolean;
    /** W16 排查 D1：异常终态（非 completed）时 steer 队列残留——loop 不再
     * 续跑消化，暂存于此；resume 启动时经 presetSteer 注入新轮队列。 */
    pendingSteer?: string[];
  }
  const delegations = new Map<string, DelegationEntry>();
  const waiters = new Set<() => void>();

  const notifyWake = () => {
    for (const w of waiters) w();
    waiters.clear();
  };

  const snapshot = (d: DelegationEntry): DelegationSnapshot => {
    const { cancel: _c, steer: _s, ...rest } = d;
    return rest;
  };

  function boundedReport(text: string): string {
    if (text.length <= MAX_REPORT_CHARS) return text;
    const head = Math.floor(MAX_REPORT_CHARS / 2);
    return `${text.slice(0, head)}\n…（报告过长，中段已截断——完整过程见子会话）…\n${text.slice(-MAX_REPORT_CHARS - head)}`;
  }

  const delegationsApi: DelegationsApi = {
    list: () => [...delegations.values()].map(snapshot),
    hasRunning: () => [...delegations.values()].some((d) => d.status === "running"),
    async wait(opts) {
      const ids = opts?.ids;
      const mode = opts?.mode ?? "all";
      const minCompleted = opts?.minCompleted;
      const deadline = opts?.timeoutMs !== undefined ? Date.now() + opts.timeoutMs : undefined;
      const targets = (id: string) => ids === undefined || ids.includes(id);
      for (;;) {
        const relevant = [...delegations.values()].filter((d) => targets(d.id));
        if (ids !== undefined && relevant.length === 0) {
          throw new Error(`task_wait：未知委托 id（${ids.join(", ")}——task_list 可查在途清单）`);
        }
        const settled = relevant.filter((d) => d.status !== "running");
        const done = settled.length;
        const anyDone = done > 0;
        const allDone = relevant.every((d) => d.status !== "running");
        const minMet = minCompleted === undefined || settled.filter((d) => d.status === "completed").length >= minCompleted;
        if (relevant.length > 0 && (mode === "any" ? anyDone && (minCompleted === undefined || minMet) : allDone || (minCompleted !== undefined && minMet))) {
          return relevant.map(snapshot);
        }
        if (deadline !== undefined && Date.now() >= deadline) {
          return relevant.map(snapshot);
        }
        await new Promise<void>((resolve) => {
          waiters.add(resolve);
          // 轮询兜底（唤醒面遗漏防御——注册表结算必 notifyWake，这里是保险）
          setTimeout(resolve, 500);
        });
      }
    },
    stop(id: string): boolean {
      const d = delegations.get(id);
      if (d === undefined || d.status !== "running") return false;
      d.cancel();
      return true;
    },
    async send(id, message): Promise<DelegationSendReceipt> {
      const d = delegations.get(id);
      if (d === undefined) {
        throw new DelegationSendError(
          "DELEGATION_UNKNOWN",
          `未知委托 id：${id}（task_list 可查当前清单）`,
        );
      }
      if (d.status === "running" && d.acceptsSteer !== false) {
        // working → steer（A2 step 边界注入——子 loop 队列在位才可 steer）
        if (d.steer === undefined) {
          throw new DelegationSendError(
            "DELEGATION_QUEUE_FULL",
            `委托 ${id} 无 steer 面（内部纪律违规——running 后台委托必有队列）`,
          );
        }
        if (!d.steer(message)) {
          throw new DelegationSendError(
            "DELEGATION_QUEUE_FULL",
            `委托 ${id} 的注入队列已满——稍后再发或用 task_wait 收敛`,
          );
        }
        return { delegationId: id, childSessionId: d.childSessionId, mode: "steer", messageId: `send-${id}` };
      }
      // terminal → resume（同 childSessionId 新轮——上下文从流投影重建）。
      // W16 排查 D1：running 但 acceptsSteer=false = finalize 窗口（loop 已
      // 停、结算链在跑）——steer 入队无人消费且旧实现假回执 accepted（消息
      // 永久滞留死队列），此处同样转 resume（消息不丢）。
      return startResume(d, message);
    },
    async resume(id, message): Promise<DelegationSendReceipt> {
      const d = delegations.get(id);
      if (d === undefined) {
        const available = [...delegations.values()]
          .filter((x) => x.status !== "running")
          .map((x) => x.id)
          .join(", ");
        throw new DelegationSendError(
          "DELEGATION_UNKNOWN",
          `未知委托 id：${id}（当前可续清单：${available === "" ? "（空）" : available}）`,
        );
      }
      if (d.status === "running") {
        // 仍运行中 → 显式提示 TaskWait（pi-desktop ADR 0279 校验表）
        throw new DelegationSendError(
          "DELEGATION_RUNNING",
          `委托 ${id} 仍在运行——先 task_wait 等它收敛，再 resume 续跑`,
        );
      }
      return startResume(d, message);
    },
  };

  /** terminal 委托的续跑启动（同 childSessionId 新链环——新 delegationId）。
   * 复用 run 机制（background:true）；上限/深度拒绝转类型化 send 错误。
   * W16 排查 D1：旧委托 steer 队列残留（异常终态）经 presetSteer 注入新轮。 */
  const startResume = async (d: DelegationEntry, message: string): Promise<DelegationSendReceipt> => {
    const carriedSteer = d.pendingSteer ?? [];
    const outcome = await run(message, `${d.description}（续跑）`, {
      background: true,
      ...(d.agentName !== "general" ? { subagentType: d.agentName } : {}),
      childSessionId: d.childSessionId,
      ...(carriedSteer.length > 0 ? { presetSteer: carriedSteer } : {}),
    });
    d.pendingSteer = undefined; // 已交割（成败均不重复注入——新轮队列接管）
    if (outcome.kind !== "background") {
      // 上限满/会话占用/深度拒绝等前台 failed 结算 → 类型化拒绝（fail-visible；
      // 会话占用单列 code——与并发上限的可自修路径不同：等在途收敛即可重试）
      const busy = outcome.result.error?.startsWith("DELEGATION_SESSION_BUSY");
      throw new DelegationSendError(
        busy ? "DELEGATION_SESSION_BUSY" : "DELEGATION_CAP_REACHED",
        outcome.result.error ?? "续跑未能启动（并发上限或装配拒绝）",
      );
    }
    return {
      delegationId: outcome.delegationId,
      childSessionId: outcome.childSessionId,
      mode: "resume",
      messageId: outcome.delegationId,
    };
  };

  const run = async (
    prompt: string,
    description: string,
    opts?: {
      signal?: AbortSignal;
      backend?: string;
      subagentType?: string;
      background?: boolean;
      /**
       * T9-1/T9-2：预设子会话 id（collab worker 的编排会话语义——血统/
       * 标题落同一 id；task resume 续跑同 delegation 的原子会话）。缺省
       * undefined = 内部生成 `${parent}::task-N-ts`（既有行为零变化）。
       * W16 排查 D2：调用方纪律改为类型化守卫——同 childSessionId 的
       * running 委托在途时后台启动类型化拒绝（防双 loop 交叉写流）。
       */
      childSessionId?: string;
      /** W16 排查 D1：resume 时旧委托 steer 队列残留（异常终态未消化）——
       * 逐条入新轮队列（队列上限 8，与残留上限一致）。 */
      presetSteer?: readonly string[];
    },
  ): Promise<SubagentRunOutcome> => {
    const childDepth = deps.depth + 1;
    if (!Number.isSafeInteger(childDepth) || childDepth > maxDepth) {
      throw new SubagentDepthError(childDepth, maxDepth);
    }
    // —— C4 后端分派：task 工具透传的 backend 命中外部后端表时出闸
    // （"in-process"/缺省走本文件 fork 循环——常量与 session 域
    // IN_PROCESS_BACKEND 同值，kernel 不 import 该域仅字面对应）。
    // 外部后端不经过子装配（fork 循环专属），审批/超时/结算语义由后端
    // 实现自带（createAcpBackend：never-reject 转 failed/cancelled）。
    if (opts?.backend !== undefined && opts.backend !== "in-process") {
      const spawn = deps.externalBackends?.get(opts.backend);
      if (spawn === undefined) {
        return {
          kind: "foreground",
          result: {
            sessionId: "",
            stopReason: "failed",
            output: "",
            error: `子代理后端 "${opts.backend}" 未装配（SUBAGENT_BACKEND_UNKNOWN——设置页子智能体分节可切换 in-process/acp）`,
          },
        };
      }
      return {
        kind: "foreground",
        result: await spawn({
          prompt,
          description,
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        }),
      };
    }
    // U23/T-P3-126：预设解析（未知/停用同为类型化拒绝——停用名单不进
    // 可用清单，模型可见可自修）。缺省 undefined = 通用子代理（既有行为）。
    const preset =
      opts?.subagentType !== undefined
        ? resolveSubagent(opts.subagentType, deps.subagentDefs)
        : undefined;
    if (opts?.subagentType !== undefined && preset === undefined) {
      return {
        kind: "foreground",
        result: {
          sessionId: "",
          stopReason: "failed",
          output: "",
          error:
            `未知或已停用的子代理预设：${opts.subagentType}` +
            `（可用见设置页子智能体分节）`,
        },
      };
    }
    // 取消先于派发：不起子轮（无半态——深度检查与取消检查同位）
    if (opts?.signal?.aborted) {
      return {
        kind: "foreground",
        result: {
          sessionId: "",
          stopReason: "cancelled",
          output: "",
          error: "父轮在派发前已取消——子代理未启动",
        },
      };
    }
    const background = opts?.background ?? false;
    // W9/T9-2：后台委托的子 loop 注入队列（steer 面——task_send working
    // 目标经此在 step 边界注入；A2 drainQueue 消费）。前台运行无队列
    // （单轮语义零变化）。上限 8（防无界 steer 打爆子上下文）。
    // W16 排查 D1：resume 携带的旧队列残留（异常终态未消化）逐条注入。
    const subQueue = background ? new PromptQueue("one-at-a-time", 8) : undefined;
    if (subQueue !== undefined) {
      for (const carried of opts?.presetSteer ?? []) subQueue.enqueue(carried);
    }

    const childSessionId =
      opts?.childSessionId ?? `${deps.parentSessionId}::task-${++counter}-${Date.now()}`;

    // —— 子装配：降级规则（H5）+ Deny broker（H3）+ 全套上下文/压缩层复用。
    // 默认禁用 task 的双保险按深度分工：childDepth >= maxDepth（不可再派）
    // 时 deny task 规则留在子规则集（gate 拒绝 = H5 最强面）；childDepth <
    // maxDepth（maxDepth>1 允许递归委派）时放开 task 的默认 deny——深度
    // 检查仍是最终权威（孙代入口拒绝，maxDepth=1 下被 deny 抢先只是快路径）。
    // U23：预设工具集 = C25 activation 的 session 层白名单（声明面收窄——
    // H3/H5 降级面之上的预设声明）；预设身份段 = extraPrompt（系统提示追加）。
    const canDelegateFurther = childDepth < maxDepth;
    // T-P3-156 V（轻隔离——裁决 5b）：子代理写路径约束到专属子目录
    // `.aegent/isolated/<childId>/`——PathGuard 写边界=子目录，子代理的全部
    // 写落隔离区（"子代理/分支/主会话不相互写同一文件"的核心诉求）；
    // 读不受限（主工作区文件可读）；产出落回主工作区由父级决定（结果经
    // 后台委托报告回传后父 AI 复制——写权在父）。per-child git worktree
    // 记 P2（报告 §4-V 备选 a）。
    // 目录名净化：会话 id 可含 "::"（任务派发命名）——Windows 文件名禁
    // 冒号，隔离目录用替换形态（回看语义不受影响，映射稳定）。
    const isolatedDirName = childSessionId.replaceAll(":", "_");
    const isolatedRoot = path.join(deps.workspaceRoot, ".aegent", "isolated", isolatedDirName);
    mkdirSync(isolatedRoot, { recursive: true });
    const isolationPrompt = [
      `【工作区隔离】你的写操作被约束在隔离区 ${isolatedRoot}（相对主工作区的 .aegent/isolated/${childSessionId}/）——不要尝试写隔离区外的路径（会被拒绝）。读主工作区任意文件不受限。产出文件全部放隔离区内，父会话会在结果回传后决定是否落回主工作区。`,
    ];
    const subAssembly: ChildAssembly = createChildAssembly({
      sessionId: childSessionId,
      store: deps.store,
      workspaceRoot: isolatedRoot,
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
      ...(preset?.prompt !== undefined || isolationPrompt.length > 0
        ? { extraPrompt: [...isolationPrompt, ...(preset?.prompt !== undefined ? [preset.prompt] : [])].join("\n\n") }
        : {}),
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
        // 孙代递归 runner：delegations 同步注入（孙代的 task_wait/list/stop
        // 管孙代自己的委托——各 runner 闭包独立注册表）。W9/T9-2：子代的
        // sendToParent 逐级上递——孙代 task_send("parent") 落到本 runner 的
        // 父链（本 runner 也是子代则沿 sendToParent 上递；顶层经 onSettle
        // 合成快照注入父队列）。
        ...(() => {
          const childRuntime = createSubagentRunner({
            ...deps,
            parentSessionId: childSessionId,
            depth: childDepth,
            sendToParent: (message: string) => {
              if (deps.sendToParent !== undefined) {
                deps.sendToParent(message);
                return;
              }
              deps.onSettle?.({
                id: `send-${childSessionId}-${Date.now()}`,
                childSessionId,
                agentName: "子代理回投",
                description: "task_send(\"parent\") 回投",
                status: "completed",
                startedAt: Date.now(),
                settledAt: Date.now(),
                report: message,
              });
            },
          });
          return {
            runSubagent: childRuntime.run,
            taskWait: { delegations: childRuntime.delegations },
            taskList: { delegations: childRuntime.delegations },
            taskStop: { delegations: childRuntime.delegations },
            // W9/T9-2：子代 task 的 resume 面（续跑自己的委托）
            delegations: childRuntime.delegations,
            ...(deps.sendToParent !== undefined || deps.onSettle !== undefined
              ? {
                  taskSend: {
                    delegations: childRuntime.delegations,
                    sendToParent: (message: string) => {
                      if (deps.sendToParent !== undefined) deps.sendToParent(message);
                      else
                        deps.onSettle?.({
                          id: `send-${childSessionId}-${Date.now()}`,
                          childSessionId,
                          agentName: "子代理回投",
                          description: "task_send(\"parent\") 回投",
                          status: "completed",
                          startedAt: Date.now(),
                          settledAt: Date.now(),
                          report: message,
                        });
                    },
                  },
                }
              : {}),
          };
        })(),
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
      ...(subQueue !== undefined ? { queue: subQueue } : {}),
      ...(presetModel !== undefined
        ? { modelForTurn: () => ({ provider: presetModel.provider, identity: presetModel.identity }) }
        : deps.modelForTurn
          ? { modelForTurn: deps.modelForTurn }
          : {}),
    });

    // T-P1-43 取消联动：父 turn 取消 → 子 loop 取消（CancelCause "parent"）。
    // listener 随 signal 生命周期回收（per-turn controller 被 loop 替换后
    // 不可达）——turn 活动期间取消在子 loop 的 await 边界收轮。
    // G：后台委托不挂父 turn 信号（后台语义——父轮取消不杀后台委托）。
    if (opts?.signal && !background) {
      const onAbort = () => subLoop.cancel({ kind: "parent" });
      opts.signal.addEventListener("abort", onAbort, { once: true });
      if (opts.signal.aborted) onAbort();
    }

    // G：后台委托——子流首条落 system/message 头部（回放可读"这是谁的子会话"，
    // 零词汇表扩展——system/message 是既有类型）；注册表登记（上限 fail-closed）。
    const delegationId = `dlg-${++delegationSeq}`;
    const agentName = preset?.name ?? "general";
    if (background) {
      // W16 排查 D2：同 childSessionId 的在途唯一性守卫（类型化拒绝——旧
      // "调用方纪律"注释升级为运行时守卫；双 loop 交叉写同一子流 = 结算
      // 报告错配 + 间隙窗口交错落流）。
      if (
        [...delegations.values()].some(
          (x) => x.status === "running" && x.childSessionId === childSessionId,
        )
      ) {
        return {
          kind: "foreground",
          result: {
            sessionId: "",
            stopReason: "failed",
            output: "",
            error: `DELEGATION_SESSION_BUSY：子会话 ${childSessionId} 已有在途委托（task_wait 等其收敛后重试）`,
          },
        };
      }
      // W16 排查 D3：上限只数 running（在途）——已结算条目保留注册表供
      // task_result 查询但不占并发额度（旧实现 size 计入已结算 → 同一会话
      // 累计 10 个后台委托后永久楔死，错误文案指路的 wait/stop 永不释放槽位）。
      const activeCount = [...delegations.values()].filter((x) => x.status === "running").length;
      if (activeCount >= MAX_SUBAGENT_DELEGATIONS) {
        return {
          kind: "foreground",
          result: {
            sessionId: "",
            stopReason: "failed",
            output: "",
            error: `后台委托在途已达并发上限（${MAX_SUBAGENT_DELEGATIONS}）——task_list 查看在途并 task_wait/task_stop 收敛后再派`,
          },
        };
      }
      // 记档：子流头部标记不落——system/message 词汇表要求开启的 turn+step
      // （project.ts:639），runTurn 前后都无合法窗口；子会话辨识面 = title
      // （prompt 前 60 字）+ 父流 task 结果 meta.subagent.sessionId 回链。
      const entry: DelegationEntry = {
        id: delegationId,
        childSessionId,
        agentName,
        description,
        status: "running",
        startedAt: Date.now(),
        cancel: () => subLoop.cancel({ kind: "user" }),
        // W16 排查 D1：steer 收队闸（runTurn 返回后的同步段置 false）
        acceptsSteer: true,
        // W9/T9-2：steer 面（task_send working 目标的注入通道——队列满 false）
        ...(subQueue !== undefined
          ? {
              steer: (content: string): boolean => {
                try {
                  subQueue.enqueue(content);
                  return true;
                } catch {
                  return false;
                }
              },
            }
          : {}),
      };
      delegations.set(delegationId, entry);
    }

    // 启动子轮（后台不 await——promise 链结算进注册表；前台照旧 await）。
    // W9/T9-2：continuable 面（sendToParent 在位）的后台委托追加回投指引
    // （dsh withContinuableReturnGuidance 同构——子代理可主动提前回投）。
    const settlePromise = (async (): Promise<SubagentRunResult> => {
      let reason: TurnEndReason;
      try {
        // 子代理 = 一次普通 prompt 轮（opencode runTask = ops.prompt 同构）；
        // 单轮语义——decideTurn 无工具调用即 end，无队列不续轮。
        const effectivePrompt =
          background && deps.sendToParent !== undefined
            ? withContinuableReturnGuidance(deps.parentSessionId, prompt)
            : prompt;
        reason = await subLoop.runTurn(effectivePrompt);
        // W9/T9-2：steer 残留续跑（dsh continuation 生命周期——send_message
        // 到 inactive 目标经 continuation 起新轮）。steer 在最后一步之后
        // 到达会错过 step 边界（turn 收束）——后台委托续跑新轮消化队列，
        // 消息不丢；completed 链上的异常终态不再续。
        while (
          background &&
          subQueue !== undefined &&
          reason.kind === "completed" &&
          subQueue.size > 0
        ) {
          reason = await subLoop.runTurn("（处理 steer 注入的消息）");
        }
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

      // W16 排查 D1：收队（try/catch 后同步段——成败两路都收，且与 send 的
      // await 边界互斥、无竞态窗口）。runTurn 已返回/已抛 = loop 已停：此后
      // 到达的 send 经 acceptsSteer=false 转 resume（消息不丢、不假收执）。
      // 异常终态不再续跑——队列残留 drain 出暂存 entry.pendingSteer，resume
      // 启动时经 presetSteer 注入新轮消化。
      if (background && subQueue !== undefined) {
        const entry = delegations.get(delegationId);
        if (entry !== undefined) {
          entry.acceptsSteer = false;
          if (reason.kind !== "completed" && subQueue.size > 0) {
            entry.pendingSteer = subQueue.drainAll().map((q) => q.content);
          }
        }
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
    })();

    if (!background) {
      const result = await settlePromise;
      return { kind: "foreground", result };
    }

    // 后台结算链：注册表状态机 + onSettle 回调（报告注入父队列——装配方
    // 接线）+ 唤醒 task_wait 等待者。promise 不上抛（后台绝不炸父 step）。
    const entry = delegations.get(delegationId)!;
    void settlePromise
      .then((result) => {
        entry.status = result.stopReason === "completed" ? "completed" : result.stopReason === "cancelled" ? "cancelled" : "failed";
        entry.settledAt = Date.now();
        if (result.stopReason === "completed") entry.report = boundedReport(result.output);
        else entry.error = result.error ?? result.stopReason;
        deps.logger?.info("delegation-settled", { delegationId, status: entry.status });
      })
      .catch((err) => {
        entry.status = "failed";
        entry.settledAt = Date.now();
        entry.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        try {
          deps.onSettle?.(snapshot(entry));
        } catch {
          // onSettle（队列注入）失败不致命——报告仍在注册表（task_wait 可查）
        }
        notifyWake();
      });
    return {
      kind: "background",
      delegationId,
      childSessionId,
    };
  };

  return { run, delegations: delegationsApi };
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
