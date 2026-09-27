/**
 * 会话记录检视面（E7，T-P1-96）——"会话记录可脱离内核被检视"。
 *
 * 取 kimi·transcript/ 的纪律（记录检视面与内核分离、回合分帧视角），
 * 不抄其七目录包结构（单文件纯函数面足够——kimi 是产品级多消费方形态，
 * YAGNI）。**脱离内核的结构保证**：本模块入边只有词汇表类型（events.ts），
 * 零 store / loop / agent-process 依赖——给定一个 SessionEvent[]（无论来自
 * store.load、E8 导出物还是任何来源）即可渲染，不需要内核运行时。
 *
 * 输出是**结构化条目流**（非字符串 dump）：回合帧（turn-start/turn-end 界定）、
 * 消息行、工具调用行（聚合其 result——callId 关联）、压缩标记行（含 E17
 * status）、revert 标记行、命令生命周期行（L7）。噪声事件（step/request
 * header/attempt/retrying/progress 等瞬态与编排事实）不产生条目——E14
 * "派生以组装事件为准"的同构口径。
 *
 * CLI/协议露出（--print-transcript / 协议命令）随真实需求记档（K 层域），
 * 本卡只落库面。
 */

import type { SessionEvent } from "../kernel/events.js";

export type TranscriptEntry =
  | { kind: "turn-start"; turn: number }
  | {
      kind: "turn-end";
      turn: number;
      reason: string;
      /** E18 机器自报的产出集合（收轮时点照抄——检视面免反推）。 */
      produced?: number[];
    }
  | {
      kind: "message";
      seq: number;
      role: "user" | "assistant" | "system";
      content: string;
      /** user 注入消息（steer/预算提醒等 injected 源）。 */
      injected?: boolean;
      /** assistant 流中途被打断（A7 中断前缀标记）。 */
      interrupted?: boolean;
      /** user/message 的关联键（A12）。 */
      promptId?: string;
    }
  | {
      kind: "tool";
      seq: number;
      turn: number;
      callId: string;
      name: string;
      arguments: string;
      /** 聚合的 result（同 callId 的 tool/result 到达后回填；挂起 = undefined）。 */
      result?: { content: string; isError?: boolean };
    }
  | {
      kind: "compaction";
      seq: number;
      /** E17：started（进行中/崩溃残留）| completed（结算）| failed。 */
      status?: "started" | "completed" | "failed";
      summary?: string;
      tokensBefore?: number;
      reason?: string;
    }
  | {
      kind: "revert";
      seq: number;
      targetSeq: number;
      phase: "revert" | "undo";
    }
  | {
      kind: "offload";
      seq: number;
      /** 被卸载出现清单（seq + 下标——与 image/offload.targets 同构）。 */
      targets: { seq: number; imageIndexes: number[] }[];
    }
  | {
      kind: "command";
      seq: number;
      phase: "run" | "done";
      commandId: string;
      name?: string;
      /** done 面：结算二值（success/error——与判别字段 kind 分名）。 */
      outcome?: "success" | "error";
      text?: string;
      args?: string;
    };

/** 事件流 → 结构化 transcript（纯函数；输入只读）。 */
export function renderTranscript(events: readonly SessionEvent[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const openTools = new Map<string, Extract<TranscriptEntry, { kind: "tool" }>>();
  for (const event of events) {
    switch (event.type) {
      case "turn/start":
        entries.push({ kind: "turn-start", turn: event.turn });
        break;
      case "turn/end":
        entries.push({
          kind: "turn-end",
          turn: event.turn,
          reason: event.reason.kind,
          ...(event.produced !== undefined ? { produced: event.produced } : {}),
        });
        break;
      case "user/message":
        entries.push({
          kind: "message",
          seq: event.seq,
          role: "user",
          content: event.message.content,
          ...(event.source === "injected" ? { injected: true } : {}),
          ...(event.promptId !== undefined ? { promptId: event.promptId } : {}),
        });
        break;
      case "system/message":
        entries.push({ kind: "message", seq: event.seq, role: "system", content: event.message.content });
        break;
      case "assistant/message":
        entries.push({
          kind: "message",
          seq: event.seq,
          role: "assistant",
          content: event.message.content,
          ...(event.interrupted ? { interrupted: true } : {}),
        });
        break;
      case "tool/call": {
        const entry: Extract<TranscriptEntry, { kind: "tool" }> = {
          kind: "tool",
          seq: event.seq,
          turn: event.turn,
          callId: event.callId,
          name: event.name,
          arguments: event.arguments,
        };
        openTools.set(event.callId, entry);
        entries.push(entry);
        break;
      }
      case "tool/result": {
        const call = openTools.get(event.callId);
        if (call) {
          call.result = { content: event.message.content, ...(event.message.isError ? { isError: true } : {}) };
          openTools.delete(event.callId);
        }
        break;
      }
      case "compaction":
        entries.push({
          kind: "compaction",
          seq: event.seq,
          // 值域由 project 校验闭集保证（写入面），读面收窄安全
          ...(event.status !== undefined
            ? { status: event.status as "started" | "completed" | "failed" }
            : {}),
          ...(event.summary !== "" ? { summary: event.summary } : {}),
          ...(event.reason !== undefined ? { reason: event.reason } : {}),
          tokensBefore: event.tokensBefore,
        });
        break;
      case "session/revert":
        entries.push({
          kind: "revert",
          seq: event.seq,
          targetSeq: event.targetSeq,
          phase: event.phase,
        });
        break;
      case "image/offload":
        // P2/T-P1-125：卸载决策是流内容量事实（与 compaction/revert 同级）——
        // 检视面必须可见（否则"模型为什么没收到图片"不可追溯）
        entries.push({ kind: "offload", seq: event.seq, targets: event.targets.map((t) => ({ seq: t.seq, imageIndexes: [...t.imageIndexes] })) });
        break;
      case "command/run":
        entries.push({
          kind: "command",
          seq: event.seq,
          phase: "run",
          commandId: event.commandId,
          name: event.name,
          ...(event.args !== undefined ? { args: event.args } : {}),
        });
        break;
      case "command/done":
        entries.push({
          kind: "command",
          seq: event.seq,
          phase: "done",
          commandId: event.commandId,
          outcome: event.kind,
          ...(event.text !== undefined ? { text: event.text } : {}),
        });
        break;
      default:
        // 噪声不产生条目：step/*（编排）、request/header（请求元）、
        // assistant/attempt 与 retrying（provider 失败域）、tool/progress
        // （瞬态进度）、checkpoint/model/switch/todo/goal/fork/plugin
        // （域事实——UI 检视随 K 层，YAGNI 记档）；image/offload 产生条目
        // （T-P1-127 收口盘点⑦——容量决策事实与 compaction 同级可见）
        break;
    }
  }
  return entries;
}
