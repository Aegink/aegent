/**
 * 文件写串行化队列（B4）——同一路径 FIFO 串行，不同路径互不阻塞。
 * 粒度取 pi harness/tools/file-mutation-queue.ts 的"按 canonical path 串行"
 * （P0 以 resolve 后的绝对路径为 key；大小写/符号链接归一留 P1——Windows
 * 上同文件不同大小写会被误判为不同路径，已记录为已知边界）。
 *
 * 语义：
 *   - 同 key 任务按提交顺序执行（promise 链 FIFO）；
 *   - 前一任务的失败**不毒化**后一任务（链上存的是吞错尾巴，调用方拿到的
 *     next 的 rejection 只属于它自己的任务）；
 *   - 任务完成后从 Map 摘除自己的尾巴，长期运行不泄漏。
 *
 * 接入点：write / edit 的整个"读-改-写"动作进队列（T-4-02/03 头注释声明的
 * 接入兑现）；bash 等非文件工具不经过本队列。
 */

export class WriteQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  /** 把 task 追加到 key 的队尾；返回值只反映本任务自身（成功或其 rejection）。 */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    // chains 里存的是吞错尾巴（永不 reject），fulfilled 分支即可续链
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(task);
    const tail = next.then(
      () => {
        if (this.chains.get(key) === tail) this.chains.delete(key);
      },
      () => {
        if (this.chains.get(key) === tail) this.chains.delete(key);
      },
    );
    this.chains.set(key, tail);
    return next;
  }
}
