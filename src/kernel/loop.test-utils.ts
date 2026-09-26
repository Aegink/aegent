/**
 * loop 测试共用工具（T-3-02 起，queue.test 等复用）——剧本化假 provider +
 * 组装 harness。只服务测试，不入运行时。
 */

import type { StreamChunk } from "./events.js";
import {
  AgentLoop,
  type AgentLoopDeps,
  type DecideTurn,
  type StepRecord,
} from "./loop.js";
import type { ChatRequest, ModelProvider } from "../models/provider.js";
import type { PromptQueue } from "./queue.js";
import type { RunState } from "./run-state.js";
import { SessionStore } from "../session/store.js";

/** 剧本化假 provider：每次模型调用吃一份 StreamChunk 脚本，记录收到的请求。 */
export class ScriptedProvider implements ModelProvider {
  private readonly scripts: StreamChunk[][] = [];
  readonly requests: ChatRequest[] = [];
  private callCount = 0;

  mount(script: StreamChunk[]): void {
    this.scripts.push(script);
  }

  async *streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
    this.requests.push(req);
    const script = this.scripts[this.callCount];
    this.callCount += 1;
    if (!script) throw new Error(`无剧本（第 ${this.callCount} 次调用）`);
    for (const chunk of script) yield chunk;
  }
}

export interface Harness {
  store: SessionStore;
  loop: AgentLoop;
  decideCalls: StepRecord[];
}

export function makeLoop(
  provider: ModelProvider,
  opts?: {
    decideTurn?: DecideTurn;
    executeTool?: AgentLoopDeps["executeTool"];
    layers?: AgentLoopDeps["layers"];
    queue?: PromptQueue;
    runState?: RunState;
    toolBudget?: AgentLoopDeps["toolBudget"];
    toolExecution?: AgentLoopDeps["toolExecution"];
    isParallelTool?: AgentLoopDeps["isParallelTool"];
  },
): Harness {
  const store = new SessionStore();
  const decideCalls: StepRecord[] = [];
  // 默认决策（真实语义的占位）：有 toolCall 继续、没有则 end——注意 loop
  // 本体不看 toolCall，继续/停止完全来自这里。
  const decideTurn: DecideTurn = async (record) => {
    decideCalls.push(record);
    if (opts?.decideTurn) return opts.decideTurn(record);
    return record.toolCalls.length > 0
      ? { action: "continue" }
      : { action: "end" };
  };
  const executeTool: AgentLoopDeps["executeTool"] =
    opts?.executeTool ??
    (async (call) => ({ content: `ran ${call.name} ${call.arguments}` }));
  const loop = new AgentLoop({
    sessionId: "s1",
    store,
    provider,
    identity: { provider: "mock", modelId: "m-1" },
    executeTool,
    decideTurn,
    ...(opts?.layers ? { layers: opts.layers } : {}),
    ...(opts?.queue ? { queue: opts.queue } : {}),
    ...(opts?.runState ? { runState: opts.runState } : {}),
    ...(opts?.toolBudget ? { toolBudget: opts.toolBudget } : {}),
    ...(opts?.toolExecution ? { toolExecution: opts.toolExecution } : {}),
    ...(opts?.isParallelTool ? { isParallelTool: opts.isParallelTool } : {}),
  });
  return { store, loop, decideCalls };
}
