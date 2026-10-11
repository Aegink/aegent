/**
 * 内存事件后端（T9-7 拆分——store.ts 行数纪律位）：单测与"不落盘的内存
 * 会话"用；readAll/appendBatch 都是同步原子。W15b/T9-7 加文档面（commit
 * 的 doc 写侧投影）。
 */

import type { SessionEvent, StorageWrite } from "../core/index.js";
import type { EventStorage } from "../core/index.js";

/** 内存后端：单测与"不落盘的内存会话"用；readAll/appendBatch 都是同步原子。 */
export class InMemoryEventStorage implements EventStorage {
  private readonly rows = new Map<string, SessionEvent[]>();
  private readonly documents = new Map<string, Map<string, unknown>>();

  appendBatch(sessionId: string, events: readonly SessionEvent[]): void {
    if (events.length === 0) return;
    let list = this.rows.get(sessionId);
    if (!list) {
      list = [];
      this.rows.set(sessionId, list);
    }
    list.push(...events);
  }

  /** W15b/T9-7：内存文档面（commit 的 doc 写侧——测试投影用）。 */
  putDocument(collection: string, docId: string, body: unknown): void {
    let bucket = this.documents.get(collection);
    if (bucket === undefined) {
      bucket = new Map();
      this.documents.set(collection, bucket);
    }
    bucket.set(docId, body);
  }

  readDocument(collection: string, docId: string): unknown {
    return this.documents.get(collection)?.get(docId);
  }

  readAll(sessionId: string): SessionEvent[] {
    return [...(this.rows.get(sessionId) ?? [])].sort((a, b) => a.seq - b.seq);
  }
}
