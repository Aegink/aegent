/**
 * Execution epoch（M8，T-P1-87）——持久化权威分代的进程内实现。
 *
 * 取 pi-desktop·ADR 0041:22 "A stale host generation cannot issue
 * notifications or accept new RPC writes" 与 ADR 0053 §4 的两条纪律：
 * ① boot epoch 是**进程内值**——"not serialized in the database and is not
 *    a protocol field"（不落库、不进事件流、不进协议载荷）；
 * ② 过期代的句柄拒绝——旧进程发出的 job id（唯一的可跨代存活句柄形状）
 *    在新进程查询/取消 → 类型化 JOB_EPOCH_STALE，绝不静默误命中。
 *
 * "重启绝不重放旧进程创建的工作"（ADR 0053 "No approval, queue entry,
 * provider call, or tool execution is replayed"）的断言面收拢在三处既有
 * 语义：Q5 对账（T-8-04 启动期 interrupted 闭合）、plan artifact 不重放
 * （T-P1-13）、M3 显式 resume（T-P1-86——唯一续跑例外且必须经请求触发）。
 * 本模块不新增任何执行路径。
 *
 * "cannot issue notifications" 面（过期代不得发通知）：本方单 agent-child
 * 进程内宣告无跨代路径——write-behind 缓冲与审批挂起都是内存态，进程死即
 * 消失，旧代没有可存活的推送通道（记档）；多端 host 的跨代通知面随批次 12
 * N7 扩展。
 *
 * N4 打底：跨端 epoch 无上游参考（requirements 原文"需自研"）——本模块的
 * epoch 值与编码纪律是批次 12 N7 host / N8 roster 扩展为流内载荷时的地基
 * （届时走词汇表立案管线，本轮零事件扩展）。
 */

import { randomUUID } from "node:crypto";

/**
 * boot 时生成 fresh 代标识：8 位 hex（randomUUID 片段——同毫秒重启也
 * 不碰撞；每次进程启动必然不同，测试与运行时同一路径）。
 */
export function createExecutionEpoch(): string {
  return randomUUID().replaceAll("-", "").slice(0, 8);
}

/** 分代句柄形状：`<epoch>-<localId>`（dsh JobRegistry `<kind>-N` 的分代扩展）。 */
export function encodeEpochScopedId(epoch: string, localId: string): string {
  return `${epoch}-${localId}`;
}

/** 解析分代句柄；无 epoch 段（外来 id / 不认识形状）返回 null——按"不存在"处理。 */
export function parseEpochScopedId(id: string): { epoch: string; localId: string } | null {
  const separator = id.indexOf("-");
  if (separator <= 0) return null;
  const epoch = id.slice(0, separator);
  const localId = id.slice(separator + 1);
  if (epoch === "" || localId === "") return null;
  return { epoch, localId };
}

/** 过期代句柄拒绝（M8 验收："stale host generation cannot accept writes"）。 */
export class JobEpochStaleError extends Error {
  readonly code = "JOB_EPOCH_STALE";
  constructor(
    readonly handleId: string,
    readonly handleEpoch: string,
    readonly currentEpoch: string,
  ) {
    super(
      `句柄 ${handleId} 来自已过期的进程代 ${handleEpoch}（当前代 ${currentEpoch}）——` +
        "过期代的工作不重放、句柄不接受写入（M8）",
    );
    this.name = "JobEpochStaleError";
  }
}
