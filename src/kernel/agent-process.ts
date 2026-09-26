/**
 * agent 出进程（T9 / Q16）——子进程入口 + 父进程句柄，走真实 stdio JSON 行
 * 协议（agent-protocol.ts）。入口类型签名只收 JsonValue 可序列化值：跨进程
 * 不传函数、不传引用，子进程的装配由入口自身完成（P0 内置 echo provider，
 * 真实厂商装配在 T-8 CLI 端）。
 *
 * 子进程的编排面（本文件 childScheduler）是 A9 "turn 只能入队"的进程级落点：
 * - prompt 到达即回 `accepted` 收执（不等轮结束——无 per-prompt 完成语义）；
 *   有轮在跑就进 PromptQueue（成为本轮 step 边界的 steer），空闲就开新轮，
 *   轮结束后自动从队列续开（kick 调度器，单线程无锁）；
 * - 没有 session.finished；轮终态经事件流自然可见。
 *
 * 冷启动纪律（Q16）：spawn → 首个会话事件要实测（scripts/cold-start.mjs），
 * <500ms（§6.2）。子进程图里不含 better-sqlite3（InMemory store），原生模块
 * 不进冷启动路径。
 */

import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

import type { CancelCause } from "./events.js";
import { AgentLoop, type AgentLoopDeps, type ToolExecutionMode } from "./loop.js";
import { PromptQueue } from "./queue.js";
import {
  type AgentMessage,
  type AgentRequest,
  ProtocolError,
  decodeMessage,
  decodeRequest,
} from "./agent-protocol.js";
import type { ApprovalAnnouncement } from "../policy/pending.js";
import type { ChatRequest, ModelProvider } from "../models/provider.js";
import type { ModelIdentity } from "../models/identity.js";
import { InMemoryEventStorage, type EventStorage, SessionStore } from "../session/store.js";
import { Projector } from "../session/project.js";
import { createChildAssembly, createTodoUpdateEmitter, type ChildAssembly, type ChildAssemblyOptions } from "./assembly.js";
import { ModelNotRegisteredError } from "./model-switch.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";
import { NodeExecutionEnv } from "./tools/env.js";
import { ToolRegistry } from "./tools/registry.js";
import { DEFAULT_SPILL_DIR } from "./tools/truncate.js";
import { sweepSessionSpill } from "./tools/spill-gc.js";

// ---------------------------------------------------------------------------
// echo provider（P0 子进程内置：回声最后一条 user 消息；协议与进程全真）
// ---------------------------------------------------------------------------

export function echoProvider(): ModelProvider {
  return {
    async *streamChat(req: ChatRequest) {
      let last = "";
      for (const m of req.messages) {
        if (m.role === "user") last = m.content;
      }
      yield { type: "text-delta", text: `echo: ${last}` };
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: "done" };
    },
  };
}

// ---------------------------------------------------------------------------
// 子进程侧：读 stdin 行 → 分发 → 写 stdout 事件行
// ---------------------------------------------------------------------------

export interface AgentChildOptions {
  sessionId?: string;
  provider?: ModelProvider;
  identity?: ModelIdentity;
  /** 缺省用 process.stdin/stdout（测试可注入内存流做进程外单测）。 */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** dispose 或 stdin 关闭后退出（测试注入以免真实退出进程）。默认 process.exit。 */
  exit?: (code: number) => void;
  /**
   * spill 文件目录（Q3/T-P1-14）：工具出口截断的落盘位与会话关闭清理的
   * 目标位；缺省 DEFAULT_SPILL_DIR（系统临时目录 aegent-tool-spill）。
   */
  spillDir?: string;
  /**
   * B6/T-P1-15 工具执行模式：缺省 sequential（P0 行为）。parallel 时由
   * 注册表的 B17 并行声明（isParallelDeclared）驱动并发分组。
   */
  toolExecution?: ToolExecutionMode;
  /**
   * 事件存储（T-8-01：CLI 的 SQLite 落库走此注入）。缺省 InMemory——
   * 原生模块不进 echo 模式冷启动路径（Q16 <500ms 的结构性前提）。
   */
  storage?: EventStorage;
  /**
   * T-8-01 生产装配（权限 gate / 压缩 / 预算 / 抖动 / 系统提示）。
   * 缺省 undefined = T-3-06 最小装配（echo + 无权限层），旧测试行为不变。
   */
  assembly?: Omit<ChildAssemblyOptions, "sessionId" | "store">;
}

/**
 * 子进程主循环：阻塞到 stdin 关闭或 dispose。行协议见 agent-protocol.ts。
 * 队列固定 one-at-a-time：每条排队的 prompt 各自成轮、每 step 边界最多注入
 * 一条 steer（"all" 的节奏是会话级配置，T-8 暴露给用户）。
 */
export async function runAgentChildStdio(options: AgentChildOptions = {}): Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const sessionId = options.sessionId ?? "s0";
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;

  const send = (message: AgentMessage): void => {
    output.write(`${JSON.stringify(message)}\n`);
  };

  // 事件出进程的唯一通道：append 返回的已提交事件逐条转发为协议 event 行
  // （C14 已在 append 兜底，转发值必为 JSON 安全）
  const store = new (class ForwardingStore extends SessionStore {
    override append(
      sessionId: string,
      events: readonly import("./events.js").NewSessionEvent[],
    ): import("./events.js").SessionEvent[] {
      const committed = super.append(sessionId, events);
      for (const event of committed) send({ type: "event", event });
      return committed;
    }
  })(options.storage ?? new InMemoryEventStorage());

  // T-8-01 生产装配：审批宣告在此转发为协议行（asked → 待审批请求、
  // settled → 答复落定；timed-out 不走协议——isError 的 tool/result 事件
  // 已是事件流上的宣告事实）。
  const assembly: ChildAssembly | undefined = options.assembly
    ? createChildAssembly({
        sessionId,
        store,
        ...options.assembly,
        onApprovalAnnouncement: (announcement: ApprovalAnnouncement) => {
          if (announcement.kind === "asked") {
            send({
              type: "approval_requested",
              requestId: announcement.request.id,
              tool: announcement.request.tool,
              args: announcement.request.args,
              timeoutMs: announcement.timeoutMs,
            });
          } else if (announcement.kind === "settled") {
            send({
              type: "approval_settled",
              requestId: announcement.id,
              allowed: announcement.verdict.action === "allow",
            });
          }
          options.assembly?.onApprovalAnnouncement?.(announcement);
        },
      })
    : undefined;

  const queue = new PromptQueue("one-at-a-time");
  // 工具装配（T-4-05 接线，兑现 T-4-02 偏离⑥）：注册表分发就是 toolCall 链的
  // 链底 terminal——executeTool 槽位由 registry.dispatch 充当，不存在旁路。
  // T-8-01：装配提供 PathGuard 时经它构造（写守卫唯一入口，T-6-01）。
  // Q3（T-P1-14）：sessionId/spillDir 传进注册表——spill 标记带真实会话身份，
  // 会话关闭清理才能按身份命中（缺省标记记 unknown-session 无法清理）。
  const toolRegistry = new ToolRegistry({
    env: new NodeExecutionEnv(),
    sessionId,
    ...(options.spillDir !== undefined ? { spillDir: options.spillDir } : {}),
  });
  registerBuiltinTools(
    toolRegistry,
    {
      // G2 todo 落流出口（T-P1-10）：无条件构造——最小装配（无权限层）
      // 也有 store，todo/update 事件落流不依赖生产装配在位。
      todoEmit: createTodoUpdateEmitter(store, sessionId),
      ...(assembly
        ? {
            pathGuard: assembly.pathGuard,
            // I2 技能根 = 工作区根（skill_load 的扫描面）
            skillsRoot: options.assembly?.workspaceRoot ?? process.cwd(),
            // G1 plan 模式工具面（planMode 启用时装配提供同一服务实例）
            // + G4 计划落盘出口（planArtifactDir 提供时存在）
            ...(assembly.planMode ? { planMode: assembly.planMode } : {}),
            ...(assembly.savePlanArtifact
              ? { savePlanArtifact: assembly.savePlanArtifact }
              : {}),
          }
        : {}),
    },
  );
  const decideTurnBase: AgentLoopDeps["decideTurn"] = (record) =>
    record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" };
  const loopDeps: AgentLoopDeps = {
    sessionId,
    store,
    provider: options.provider ?? echoProvider(),
    identity: options.identity ?? { provider: "echo", modelId: "echo-1" },
    // F12/F14（T-P1-17）：每请求现取工具清单——tool_load 索取后 deferrable
    // 工具的真 schema 才进后续请求（request/header.tools 同步如实记录）
    toolsProvider: () => toolRegistry.toChatTools(),
    executeTool: (call) => toolRegistry.dispatch(call),
    decideTurn: assembly ? assembly.wrapDecideTurn(decideTurnBase) : decideTurnBase,
    queue,
    // J6/J7：装配启用换模时，loop 每轮启动从捕获值取 provider/identity
    //（在途换模生效点在新 turn）；未启用时缺省固定 provider/identity。
    // J11：turn 失败通知 → 装配驱动换模回滚判据。
    ...(assembly?.modelForTurn ? { modelForTurn: assembly.modelForTurn } : {}),
    ...(assembly?.onTurnError ? { onTurnError: assembly.onTurnError } : {}),
    // B6/B17（T-P1-15）：装配选择 parallel 时，并发分组以注册表的并行声明
    // 为准（未声明即排他）；缺省 sequential 时两个槽位都不进 deps（P0 原样）。
    ...(options.toolExecution === "parallel"
      ? {
          toolExecution: "parallel" as const,
          isParallelTool: (name: string) => toolRegistry.isParallelDeclared(name),
        }
      : {}),
    ...(assembly
      ? {
          layers: assembly.layers,
          beforeFirstModelRequest: assembly.beforeFirstModelRequest,
          onToolStepCompleted: (turn: number, step: number) =>
            assembly.onToolStepCompleted(turn, step),
          // F6/F13/T-P1-19：逐请求缓存锚检测 → 装配观测（rewritten 告警）
          onCacheAnchorChange: assembly.onCacheAnchorChange,
        }
      : {}),
  };
  const loop = new AgentLoop(loopDeps);

  let inflight: Promise<void> | null = null;
  let disposing = false;

  // Q3 会话关闭触发（T-P1-14）：退出前清掉本会话的自动可删 spill 文件
  // （manual 声明者与其他会话的文件由 spill-gc 保留）。exit 缺省是
  // process.exit——挂起的 unlink 会被切断，所以清理必须 await 完再退。
  // AGENT_LOOP_CRASH 的 exit(1) 不在此列：异常路径保持即时退出，残留文件
  // 由下次 spill 的超量配额兜底。
  let finishing = false;
  const finish = async (): Promise<void> => {
    if (finishing) return;
    finishing = true;
    try {
      await sweepSessionSpill(options.spillDir ?? DEFAULT_SPILL_DIR, sessionId);
    } finally {
      exit(0);
    }
  };

  const kick = (): void => {
    if (inflight) return;
    const next = queue.drain()[0];
    if (!next) {
      if (disposing) {
        void finish();
        return;
      }
      // T-8-01：宣告空闲（无在途轮且队列空）——CLI 的 EOF 语义据此等
      // idle 再 dispose，避免"输入流关闭即取消在途轮"。
      send({ type: "idle" });
      return;
    }
    inflight = (async () => {
      // E11 代码检查点：每轮开始前打点（pi turn_start "before LLM makes
      // changes" 的等价时点——此刻工作区就是"改前"状态，场景①的恢复依据）。
      // 打点失败内部消化（onWarn），不阻断轮。
      if (assembly?.checkpoint) {
        const turn =
          Projector.fold(store.load(sessionId)).projection.turnCount + 1;
        await assembly.checkpoint.capture(turn);
      }
      return loop.runTurn(next.content);
    })()
      .then(() => undefined)
      .catch((e: unknown) => {
        // loop 崩溃（异常逃出 runTurn）：会话可能有未闭合 turn，进程不可继续
        send({
          type: "error",
          code: "AGENT_LOOP_CRASH",
          message: e instanceof Error ? e.message : String(e),
        });
        exit(1);
      })
      .finally(() => {
        inflight = null;
        kick(); // 收尾后再踢一次——轮跑动期间入队的 prompt 从这里续开新轮
      });
  };

  const handleRequest = (req: AgentRequest): void => {
    switch (req.type) {
      case "prompt":
        // A9：先收执、再入队/开轮——accepted 只证明 admission
        send({ type: "accepted", messageId: req.messageId });
        queue.enqueue(req.content);
        kick();
        return;
      case "cancel":
        loop.cancel(req.cause as CancelCause);
        return;
      case "revert": {
        // E4+E11 双回退：先对话态（校验便宜、失败不产生半退）再代码态。
        // 成功回 reverted 回执（CLI 据此报告代码是否回退）；失败回 error 行。
        if (!assembly) {
          send({
            type: "error",
            code: "REVERT_FAILED",
            message: "子进程未装配会话服务（最小装配无 revert 处理）",
          });
          return;
        }
        void (async () => {
          try {
            assembly.handleRevert(req.targetSeq);
            let codeRestored = false;
            if (assembly.checkpoint) {
              await assembly.checkpoint.restoreCodeTo(req.targetSeq);
              codeRestored = true;
            }
            send({ type: "reverted", targetSeq: req.targetSeq, codeRestored });
          } catch (e) {
            send({
              type: "error",
              code: "REVERT_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          }
        })();
        return;
      }
      case "approve": {
        // C5 答复转达：成功无专用应答——settled 宣告与后续 tool/result 事件
        // 可见；失败（未装配 / 迟到 / 未知 id）回 error 行（类型化 code）。
        if (!assembly) {
          send({
            type: "error",
            code: "APPROVE_FAILED",
            message: "子进程未装配审批服务（最小装配无审批处理）",
          });
          return;
        }
        assembly
          .handleApprove(
            req.requestId,
            req.action,
            req.reason,
            req.scope,
            req.feedback,
          )
          .catch((e: unknown) => {
            send({
              type: "error",
              code: e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "APPROVE_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          });
        return;
      }
      case "model/switch": {
        // J6 换模：立即受理（configured 更新，生效点在新 turn——在途轮用
        // 启动时捕获值跑完，行为证据经后续 request/header 的身份变化可见）。
        // 失败回类型化 error 行：未注册 = MODEL_NOT_REGISTERED（不静默）。
        if (!assembly?.handleModelSwitch) {
          send({
            type: "error",
            code: "MODEL_SWITCH_UNAVAILABLE",
            message: "子进程未装配模型注册表（最小/单模型装配无换模能力）",
          });
          return;
        }
        try {
          assembly.handleModelSwitch(req.identity);
        } catch (e) {
          send({
            type: "error",
            code:
              e instanceof ModelNotRegisteredError
                ? e.code
                : "MODEL_SWITCH_FAILED",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case "dispose":
        disposing = true;
        loop.cancel({ kind: "disposed" });
        assembly?.dispose(); // 挂起审批按超时语义拒绝——gate 落 isError 后轮可收
        if (!inflight) void finish();
        return;
    }
  };

  send({ type: "ready" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  const closed = new Promise<void>((resolve) => rl.on("close", resolve));
  rl.on("line", (line: string) => {
    if (line.trim() === "") return;
    let req: AgentRequest;
    try {
      req = decodeRequest(line);
    } catch (e) {
      const code = e instanceof ProtocolError ? e.code : "PROTOCOL_MALFORMED";
      send({ type: "error", code, message: e instanceof Error ? e.message : String(e) });
      return;
    }
    try {
      handleRequest(req);
    } catch (e) {
      send({
        type: "error",
        code: "AGENT_DISPATCH_ERROR",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });
  // 父进程意外离场（stdout 断开 → EPIPE）：不崩——无监听器时该错误会直接
  // 杀死子进程，turn 的 write-behind buffer 随之丢失。走与 stdin 关闭相同的
  // 优雅收尾：cancel 在途轮、等轮收尾（turn 末 flush 落库）再退出。
  // J2 实测踩中：父进程被 head 截断后子进程崩溃，事件 buffer 全丢。
  const outputBroken = new Promise<void>((resolve) => {
    output.on("error", () => resolve());
  });
  await Promise.race([closed, outputBroken]);
  // stdin 关闭或输出断开：视作 dispose（父进程先行离场时不留悬挂轮）
  if (!disposing) {
    disposing = true;
    loop.cancel({ kind: "disposed" });
    assembly?.dispose();
  }
  if (!inflight) {
    await finish();
    return;
  }
  await inflight;
  await finish();
}

// ---------------------------------------------------------------------------
// 父进程侧：spawn + 行分帧 + 异步消息队列
// ---------------------------------------------------------------------------

/** 最小异步队列：push/finish 与 async iterator 的 next 对接。 */
class MessageQueue {
  private readonly items: AgentMessage[] = [];
  private waiter: ((r: IteratorResult<AgentMessage>) => void) | null = null;
  private finished = false;

  push(message: AgentMessage): void {
    if (this.finished) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: message, done: false });
      return;
    }
    this.items.push(message);
  }

  finish(): void {
    this.finished = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<AgentMessage>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.finished) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

export interface AgentProcess {
  /** 发请求（fire-and-forget；收执/事件经 messages 观察）。 */
  send(request: AgentRequest): void;
  /** 子进程消息流（ready → accepted/event/error*），进程退出后自然结束。 */
  messages: AsyncIterable<AgentMessage>;
  /** 终止子进程并等待退出。 */
  kill(): Promise<void>;
}

export interface SpawnAgentOptions {
  /** 编译后的子进程入口（dist/src/kernel/agent-child.js）。 */
  entryPath: string;
  /** 透传给子进程的参数（T-8-01：CLI 装配选项）。 */
  args?: readonly string[];
}

export function spawnAgentProcess(options: SpawnAgentOptions): AgentProcess {
  const child = spawn(process.execPath, [options.entryPath, ...(options.args ?? [])], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const queue = new MessageQueue();
  let buffer = "";

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim() === "") continue;
      try {
        queue.push(decodeMessage(line));
      } catch {
        // 子进程产出非协议行：父进程不该假装没看见，但也不该崩——丢弃并继续
      }
    }
  });
  child.stdout.on("close", () => queue.finish());
  child.on("close", () => queue.finish());

  return {
    send(request: AgentRequest): void {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    },
    messages: {
      [Symbol.asyncIterator]() {
        return { next: () => queue.next() };
      },
    },
    kill(): Promise<void> {
      return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("close", () => resolve());
        child.kill();
      });
    },
  };
}
