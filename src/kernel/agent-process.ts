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
import { AgentLoop, type AgentLoopDeps } from "./loop.js";
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
import { createChildAssembly, type ChildAssembly, type ChildAssemblyOptions } from "./assembly.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";
import { NodeExecutionEnv } from "./tools/env.js";
import { ToolRegistry } from "./tools/registry.js";

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
  const toolRegistry = new ToolRegistry({ env: new NodeExecutionEnv() });
  registerBuiltinTools(toolRegistry, assembly ? { pathGuard: assembly.pathGuard } : {});
  const decideTurnBase: AgentLoopDeps["decideTurn"] = (record) =>
    record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" };
  const loopDeps: AgentLoopDeps = {
    sessionId,
    store,
    provider: options.provider ?? echoProvider(),
    identity: options.identity ?? { provider: "echo", modelId: "echo-1" },
    tools: toolRegistry.toChatTools(),
    executeTool: (call) => toolRegistry.dispatch(call),
    decideTurn: assembly ? assembly.wrapDecideTurn(decideTurnBase) : decideTurnBase,
    queue,
    ...(assembly
      ? {
          layers: assembly.layers,
          beforeFirstModelRequest: assembly.beforeFirstModelRequest,
          onToolStepCompleted: (turn: number, step: number) =>
            assembly.onToolStepCompleted(turn, step),
        }
      : {}),
  };
  const loop = new AgentLoop(loopDeps);

  let inflight: Promise<void> | null = null;
  let disposing = false;

  const kick = (): void => {
    if (inflight) return;
    const next = queue.drain()[0];
    if (!next) {
      if (disposing) {
        exit(0);
        return;
      }
      // T-8-01：宣告空闲（无在途轮且队列空）——CLI 的 EOF 语义据此等
      // idle 再 dispose，避免"输入流关闭即取消在途轮"。
      send({ type: "idle" });
      return;
    }
    inflight = loop
      .runTurn(next.content)
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
        // E4 对话态回退：成功无专用应答——session/revert 事件经事件流可见；
        // 失败（未装配 / 越界）回 error 行。
        if (!assembly) {
          send({
            type: "error",
            code: "REVERT_FAILED",
            message: "子进程未装配会话服务（最小装配无 revert 处理）",
          });
          return;
        }
        try {
          assembly.handleRevert(req.targetSeq);
        } catch (e) {
          send({
            type: "error",
            code: "REVERT_FAILED",
            message: e instanceof Error ? e.message : String(e),
          });
        }
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
        assembly.handleApprove(req.requestId, req.action, req.reason).catch(
          (e: unknown) => {
            send({
              type: "error",
              code: e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "APPROVE_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          },
        );
        return;
      }
      case "dispose":
        disposing = true;
        loop.cancel({ kind: "disposed" });
        assembly?.dispose(); // 挂起审批按超时语义拒绝——gate 落 isError 后轮可收
        if (!inflight) exit(0);
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
  await closed;
  // stdin 关闭：视作 dispose（父进程先行离场时不留悬挂轮）
  if (!disposing) {
    disposing = true;
    loop.cancel({ kind: "disposed" });
    assembly?.dispose();
  }
  if (!inflight) exit(0);
  await inflight;
  exit(0);
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
