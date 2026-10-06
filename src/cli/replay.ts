/**
 * `aegent replay` 子命令（C6 补口——L4 轨迹回放的生产消费入口）：从事件库
 * 读一个会话的全部事件 → replaySession 重建"模型每一步实际看到了什么/
 * 发出了什么"→ 人读输出（turn/step/模型身份/可见消息数/工具调用/响应摘要）。
 *
 * 数据面 = obs/replay 的纯函数（零新机制）；本命令是入口面不是新机制。
 * 缺省库路径同 sessions 命令（<home>/.aegent/sessions.db，--db 覆盖）。
 *
 * 注：L6 审计报表（auditReport）不在本命令面——其上游 L2 审计记录流
 * （approvalAuditRecord）未落流（审批呈现在协议层、不入会话事件，设计
 * 现状记档）；待审计记录持久化立项后再接 CLI（不造"从流内近似推"的假
 * 报表）。
 */

import os from "node:os";
import path from "node:path";

import { SqliteEventStorage } from "../session/db.js";
import { replaySession } from "../obs/replay.js";
import { isValidSessionId } from "../session/session-id.js";

export const REPLAY_COMMAND_USAGE =
  "用法：aegent replay <sessionId> [--db <path>] [--full]";

/** 缺省事件库路径（与 sessions 命令同一路径约定）。 */
export function defaultReplayDbPath(): string {
  return path.join(os.homedir(), ".aegent", "sessions.db");
}

export interface ReplayCommandIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

function pickDbPath(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--db");
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** 截断长文本（人读摘要面——完整内容在事件流里，--full 不截）。 */
function brief(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}

/** 逐请求重放条目 → 人读行集（纯函数便于直测）。 */
export function renderReplayEntries(
  entries: ReturnType<typeof replaySession>,
  full: boolean,
): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const step = entry.step !== undefined ? ` step ${String(entry.step)}` : "";
    lines.push(
      `turn ${String(entry.turn)}${step} · ${entry.reason} · ${entry.identity.provider}/${entry.identity.modelId}` +
        ` · 可见消息 ${String(entry.messages.length)} 条` +
        ` · 工具 ${String(entry.tools !== undefined ? "清单在位" : "缺席")}`,
    );
    const last = entry.messages.at(-1);
    if (last !== undefined) {
      lines.push(`  末条请求消息：${full ? JSON.stringify(last) : brief(JSON.stringify(last), 120)}`);
    }
    if (entry.response === undefined) {
      lines.push("  响应：无可见产出（中断/失败/压缩副调用）");
      continue;
    }
    lines.push(`  响应：${full ? entry.response.content : brief(entry.response.content, 160)}`);
    for (const call of entry.response.toolCalls) {
      lines.push(
        `  工具调用 ${call.name}(${full ? call.arguments : brief(call.arguments, 100)})`,
      );
    }
    if (entry.response.usage !== undefined) {
      lines.push(
        `  usage: in ${String(entry.response.usage.inputTokens)} / out ${String(entry.response.usage.outputTokens)}`,
      );
    }
  }
  return lines;
}

/** replay 子命令入口（argv = "replay" 之后的参数）；返回进程退出码。 */
export async function runReplayCommand(
  argv: readonly string[],
  io: ReplayCommandIo,
): Promise<number> {
  const [id] = argv;
  const full = argv.includes("--full");
  const dbPath = pickDbPath(argv) ?? defaultReplayDbPath();
  if (id === undefined) {
    io.err(REPLAY_COMMAND_USAGE);
    return 1;
  }
  if (!isValidSessionId(id)) {
    io.err(`会话 id 不合法：${id}`);
    return 1;
  }
  try {
    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      const events = storage.readAll(id);
      if (events.length === 0) {
        io.out(`（库 ${dbPath} 无会话 ${id} 的事件）`);
        return 0;
      }
      const entries = replaySession(events);
      io.out(`会话 ${id} 重放（${String(events.length)} 事件 → ${String(entries.length)} 次模型请求）：`);
      for (const line of renderReplayEntries(entries, full)) io.out(line);
      return 0;
    } finally {
      storage.close();
    }
  } catch (e) {
    io.err(`replay 命令失败：${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
