/**
 * 导入日志（N9/T-P1-118）——"导入日志可崩溃恢复"的机制面：apply 前落
 * 步进记录（begin → done），中断后重跑时 completed 步跳过（幂等收敛——
 * M3"不重复已完成副作用"的同族纪律）。
 *
 * JSONL 追加（一行一条）；无 path = 内存面（测试/协调器的默认无盘模式）。
 */

import { appendFileSync, readFileSync, existsSync } from "node:fs";

export interface JournalEntry {
  op: "apply";
  entityId: string;
  done: boolean;
  at: number;
}

export class SyncJournal {
  private readonly entries: JournalEntry[] = [];

  constructor(private readonly path?: string) {
    if (path !== undefined && existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (line.trim() === "") continue;
        try {
          this.entries.push(JSON.parse(line) as JournalEntry);
        } catch {
          // 崩溃残缺行（写一半）——跳过不静默吞语义由消费方审计
        }
      }
    }
  }

  /** 步开始（done:false 落盘——崩溃在此前 = 该步未完成，重跑重做）。 */
  begin(entityId: string): void {
    this.push({ op: "apply", entityId, done: false, at: Date.now() });
  }

  /** 步完成（done:true 落盘——崩溃在此后 = 该步已完成，重跑跳过）。 */
  complete(entityId: string): void {
    this.push({ op: "apply", entityId, done: true, at: Date.now() });
  }

  /** 已完成步集合（幂等重放的跳过面）。 */
  completedEntityIds(): Set<string> {
    const done = new Set<string>();
    for (const entry of this.entries) {
      if (entry.done) done.add(entry.entityId);
    }
    return done;
  }

  private push(entry: JournalEntry): void {
    this.entries.push(entry);
    if (this.path !== undefined) {
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
    }
  }
}
