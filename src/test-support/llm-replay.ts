/**
 * 录制/回放真实模型流（O15，T-P1-34）——"避免手写 mock 漂移"
 * （dsh·llm-replay："replaying model streams from recorded fixtures / each
 * session receives its recorded script in first-call order"）。
 *
 * RecordingProvider wrap 任意 ModelProvider（真实厂商 provider 或 ScriptedProvider
 * ——批次 1/2 真实网关实测剧本可复用：先录后测，网络抖动不进测试面），逐调用
 * 记 {request, chunks} 序列化为 JSONL fixture；ReplayProvider 按 first-call 序
 * 回放，请求多于剧本给可读失败（序漂移 = 测试该失败，正是录制回放要抓的）；
 * override 表示注入面——指定调用替换为故障或替代剧本（dsh replay.override.json
 * sidecar 语义：录制成功的流 + 注入失败面 = 恢复类逻辑可测）。
 *
 * fixture 无时间戳：StreamChunk 是无损定时序列本身（E14 分片序），回放按序
 * 产出即等价——网络抖动不属于被记录的事实。
 */

import type { StreamChunk } from "../kernel/events.js";
import type { ChatRequest, ModelProvider } from "../models/provider.js";

/** 一次模型调用的完整记录。 */
export interface RecordedCall {
  request: ChatRequest;
  chunks: StreamChunk[];
}

export function serializeCalls(calls: readonly RecordedCall[]): string {
  return `${calls.map((c) => JSON.stringify(c)).join("\n")}\n`;
}

export function parseCalls(fixture: string): RecordedCall[] {
  return fixture
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedCall);
}

/** wrap 任意 provider：流原样透传，同时逐调用记录（录制面无行为变化）。 */
export class RecordingProvider implements ModelProvider {
  private readonly calls: RecordedCall[] = [];

  constructor(private readonly inner: ModelProvider) {}

  async *streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
    const chunks: StreamChunk[] = [];
    for await (const chunk of this.inner.streamChat(req)) {
      chunks.push(chunk);
      yield chunk;
    }
    this.calls.push({ request: req, chunks });
  }

  recordedCalls(): readonly RecordedCall[] {
    return this.calls;
  }

  toFixture(): string {
    return serializeCalls(this.calls);
  }
}

/** 回放注入面：第 atCall 次（0 起）调用替换为故障或替代剧本。 */
export interface ReplayOverride {
  atCall: number;
  chunks?: StreamChunk[];
  error?: Error;
}

/** 按 fixture first-call 序回放（dsh llm-replay 同语义）；序漂移给可读失败。 */
export class ReplayProvider implements ModelProvider {
  private callCount = 0;

  constructor(
    private readonly calls: readonly RecordedCall[],
    private readonly overrides: readonly ReplayOverride[] = [],
  ) {}

  async *streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
    const callIndex = this.callCount;
    this.callCount += 1;
    const override = this.overrides.find((o) => o.atCall === callIndex);
    if (override?.error !== undefined) throw override.error;
    const script = this.calls[callIndex];
    if (!script) {
      throw new Error(
        `回放剧本耗尽：第 ${callIndex + 1} 次模型调用无剧本（expected ≤ ${this.calls.length}, got 第 ${callIndex + 1} 次）——请求序漂移，检查被测流程是否与录制时不一致`,
      );
    }
    void req; // 按序消费不按内容匹配（dsh first-call order）；请求形状漂移由上层快照断言抓
    for (const chunk of override?.chunks ?? script.chunks) {
      yield chunk;
    }
  }
}
