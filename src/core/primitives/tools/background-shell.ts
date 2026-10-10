/**
 * 后台 shell 任务注册表（T-P3-174 批次 1）——bash/pwsh 的
 * run_in_background 语义的进程内侧。任务 id 由这里分配（进程内唯一、
 * **有意不持久**：重启即失与宿主进程同生命周期，opencode background-job
 * 同款决策——宿主死了后台进程也无意义），句柄来自 env.spawnBackground
 * （D4：进程能力只在 env 实现层，本文件零 child_process 词汇）。
 *
 * 容量上限 64（codex MAX_UNIFIED_EXEC_PROCESSES 同款）：超限优先驱逐已
 * 结束的最老任务；全在跑时拒绝新任务（fail-closed，模型可 kill 后重试）。
 */

import type { BackgroundHandle } from "./env.js";

export interface BackgroundTaskRecord {
  taskId: string;
  shell: "bash" | "pwsh";
  command: string;
  startedAt: number;
  handle: BackgroundHandle;
}

/** 注册表容量（codex 同款 64）。 */
export const MAX_BACKGROUND_TASKS = 64;

export class BackgroundShellRegistry {
  private readonly tasks = new Map<string, BackgroundTaskRecord>();
  private seq = 0;

  start(input: { shell: "bash" | "pwsh"; command: string; handle: BackgroundHandle }): string {
    this.evict();
    if (this.tasks.size >= MAX_BACKGROUND_TASKS) {
      throw new Error(
        `后台任务已满（${String(MAX_BACKGROUND_TASKS)}）——先收束/终止既有任务（task_output kill）再启动`,
      );
    }
    this.seq += 1;
    const taskId = `task-${String(this.seq)}`;
    this.tasks.set(taskId, {
      taskId,
      shell: input.shell,
      command: input.command,
      startedAt: Date.now(),
      handle: input.handle,
    });
    return taskId;
  }

  get(taskId: string): BackgroundTaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  /** 结束任务的延迟清理：只清已终止的（运行中永不丢句柄）。 */
  prune(): void {
    for (const [id, record] of this.tasks) {
      if (record.handle.output().status !== "running") this.tasks.delete(id);
    }
  }

  list(): BackgroundTaskRecord[] {
    return [...this.tasks.values()];
  }

  /** 会话收尾：杀掉全部运行中任务（宿主退出不留孤儿进程树）。 */
  async dispose(): Promise<void> {
    const running = this.list().filter((r) => r.handle.output().status === "running");
    await Promise.allSettled(running.map((r) => r.handle.kill()));
    this.tasks.clear();
  }

  private evict(): void {
    if (this.tasks.size < MAX_BACKGROUND_TASKS) return;
    // 已结束的最老先走；全在跑则不动（start 的满员检查兜底拒绝）
    for (const [id, record] of this.tasks) {
      if (record.handle.output().status !== "running") {
        this.tasks.delete(id);
        return;
      }
    }
  }
}
