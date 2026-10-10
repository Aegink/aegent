/**
 * 原始流分片诊断日志（E14，T-P1-90）——dsh·event-sourced-sessions:13 的
 * "raw stream chunks are logged for token-level replay fidelity while the
 * assembled assistant/message event is authoritative for derivation" 的
 * 前半落地（后半——派生只认组装事件——本方现状已满足，对照断言钉死）。
 *
 * 落点：loop 的模型请求完成后（runStep 的 finally——取消/异常路径的已到达
 * 分片同样如实记录，token 级回放保真不分顺逆）。写入是**旁路通道**（E13
 * 热路径纪律）：JSONL append、失败降级告警一次不带崩（T-6-05 同款）、
 * 不在流式消费路径内做任何同步 I/O 等待（分片收集已在内存，写盘在请求尾）。
 *
 * 与 T-P1-34 RecordingProvider 的分界：RecordingProvider 是测试基建
 * （显式启用、逐调用 {request,chunks} fixture 供回放）；本模块是运行时
 * 诊断日志（按日文件、密钥掩码、无回放契约）。
 *
 * D9 纪律：整行 JSON 经 redactSecrets（密钥形状掩码后再落盘）。
 */

import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import type { TimedStreamChunk } from "./events.js";
import { redactSecrets } from "./logger.js";

export interface RawStepRecord {
  ts: number;
  sessionId: string;
  turn: number;
  step: number;
  identity: { provider: string; modelId: string };
  /** 本 step 的分片全序列（{time, chunk} 原样——token 级回放保真）。 */
  chunks: readonly TimedStreamChunk[];
}

export interface RawChunkLogOptions {
  logDir: string;
  now?: () => Date;
}

export class RawChunkLog {
  private readonly logDir: string;
  private readonly now: () => Date;
  private warned = false;

  constructor(options: RawChunkLogOptions) {
    this.logDir = options.logDir;
    this.now = options.now ?? (() => new Date());
  }

  /** 请求完成后写一行 JSONL（E14：分片序列原样 + 密钥掩码）。失败只降级。 */
  write(record: RawStepRecord): void {
    try {
      mkdirSync(this.logDir, { recursive: true });
      const day = this.now().toISOString().slice(0, 10).replaceAll("-", "");
      const line = redactSecrets(JSON.stringify(record));
      appendFileSync(join(this.logDir, `raw-${day}.jsonl`), `${line}\n`, "utf8");
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        console.error(`[aegent] 原始分片日志落盘失败（本进程内只告警一次）：${String((e as Error).message)}`);
      }
    }
  }
}
