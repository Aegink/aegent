/**
 * 迁移断言基建（O19，T-P1-36）——kimi·migration-legacy 的三类迁移测试
 * 语义映射到本仓的真实迁移面（命名避开 migration 词汇——本仓没有"旧版
 * 产品迁移"域，对应关系在头注释写明）：
 *
 *   kimi「旧字段不再被读」→ **前向兼容**（assertForwardCompatibleStream）：
 *     词汇表加可选字段后，旧形状事件流（缺全部新增可选字段）restore 与
 *     投影全跑且语义不变——新代码不依赖新字段存在于旧流。
 *   kimi「旧入口已退役」→ **版本闸门**（assertSchemaVersionGate）：
 *     DB schema 版本高于当前代码 → 类型化拒绝 fail-closed，绝不静默读
 *     未知 schema。
 *   kimi「迁移后可恢复」→ **原子性**（assertMigrationAtomic）：
 *     迁移/写入闭包抛错后库仍可打开、数据未半写（T-1-02 单事务语义的
 *     消费面；真实 v0→vN 迁移链在批次 10 Q1 落地时作为既定消费方）。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { SessionEvent } from "../kernel/events.js";
import { CURRENT_SCHEMA_VERSION } from "../session/db.js";

/**
 * 旧形状事件流：当前词汇表中**全部可选字段缺席**的完整会话流（模拟
 * "新字段加入之前"录制的历史会话）。词汇表新增可选字段时把该事件补进
 * 本清单——缺位即前向兼容断言没有覆盖到新字段（O22 派生断言的同思路）。
 * 当前可选字段清单：goal/set{deadline?}、compaction{title?}、
 * tool/result.message.isError?、assistant/message.usage?、tool/progress 无可选。
 */
export function legacyShapeStream(): SessionEvent[] {
  let seq = 0;
  const mk = (fields: Record<string, unknown>): SessionEvent =>
    ({ seq: ++seq, ts: 0, ...fields }) as SessionEvent;
  return [
    mk({ type: "turn/start", turn: 1 }),
    mk({ type: "user/message", turn: 1, message: { content: "记录一个目标" }, source: "user" }),
    // goal/set 无 deadline（可选字段缺席）
    mk({ type: "goal/set", turn: 1, text: "旧会话的目标", status: "active" }),
    mk({ type: "step/start", turn: 1, step: 1 }),
    mk({
      type: "assistant/message",
      turn: 1,
      step: 1,
      message: { content: "收到" },
      stream: [{ time: 0, chunk: { type: "text-delta", text: "收到" } }],
      // usage 缺席（适配器未报告 token 计量）
    }),
    mk({ type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" }),
    // tool/result 无 isError（可选字段缺席）
    mk({ type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "ok" } }),
    mk({ type: "step/end", turn: 1, step: 1 }),
    mk({ type: "turn/end", turn: 1, reason: { kind: "completed" } }),
    // compaction 无 title（可选字段缺席；压缩合法落轮外）
    mk({
      type: "compaction",
      turn: 1,
      reason: "local-overflow",
      summary: "旧会话摘要",
      tokensBefore: 100,
    }),
    mk({ type: "goal/set", turn: 1, text: "旧会话的目标", status: "achieved" }),
  ];
}

/**
 * 前向兼容断言：restore 与投影全跑（旧形状流 → 新代码），返回 restore 结果
 * 供调用方追加语义断言（"投影值与逐字节期望一致"）。restore 内抛错即失败
 * ——新代码依赖了旧流中不存在的字段。
 */
export async function assertForwardCompatibleStream<T>(
  restore: (events: readonly SessionEvent[]) => T | Promise<T>,
  expect?: (result: T, events: readonly SessionEvent[]) => void,
): Promise<T> {
  const events = legacyShapeStream();
  const result = await restore(events);
  expect?.(result, events);
  return result;
}

/**
 * 版本闸门断言：构造 user_version = CURRENT + 1 的库文件（"未来代码写的库"），
 * 断言 open 打开它时类型化拒绝（fail-closed 原文语义：拒绝用旧代码打开新库）。
 */
export function assertSchemaVersionGate(options: {
  dbPath: string;
  open: (path: string) => unknown;
}): void {
  const db = new Database(options.dbPath);
  try {
    db.exec("CREATE TABLE placeholder (id INTEGER)");
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
  } finally {
    db.close();
  }
  let rejected = false;
  try {
    options.open(options.dbPath);
  } catch (error) {
    rejected = true;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("拒绝用旧代码打开新库")) {
      throw new Error(`版本闸门拒绝了打开，但错误不是类型化的版本错误：${message}`);
    }
  }
  if (!rejected) {
    throw new Error(
      `超当前 schema 版本（${CURRENT_SCHEMA_VERSION + 1}）的库被静默打开——fail-closed 闸门失守`,
    );
  }
}

/**
 * 原子性断言模板：迁移/写入闭包抛错后执行恢复断言（库仍可打开、数据未半写）。
 * migrate 不抛错即模板误用（要求注入一个中途失败的迁移）。
 */
export function assertMigrationAtomic(
  migrate: () => void,
  assertAfterFailure: () => void,
): void {
  try {
    migrate();
  } catch {
    assertAfterFailure();
    return;
  }
  throw new Error("迁移闭包未抛错——原子性模板要求注入一个中途失败的迁移");
}

/** 读取 schema.sql DDL 文本（v0 造库 / 未来迁移演练夹具用）。 */
export function readSchemaDdl(): string {
  return readFileSync(join(process.cwd(), "src", "session", "schema.sql"), "utf-8");
}
