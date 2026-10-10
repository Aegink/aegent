/**
 * 一把 promise 化的读写锁（B17/T-P1-15）——codex tools/parallel.rs:191 的
 * 我方对应物：`supports_parallel ? lock.read() : lock.write()`。声明了并行
 * 的只读工具持读锁（可互相并发），未声明者持写锁（与任何执行互斥）——
 * **未声明即不可并行**（fail-closed）。不抄 tokio：单线程 JS 里用 promise
 * 队列表达同一把锁的纪律。
 *
 * 唤醒策略 = FIFO + 头部读者成批放行（tokio RwLock 缺省公平序的同款）：
 * 排在写者后面的读者不越位（防写者饿死），写者之后的连续读者一并放行。
 */

type Waiter = { kind: "read" | "write"; admit: () => void };

export class RwLock {
  private activeReaders = 0;
  private activeWriter = false;
  private readonly queue: Waiter[] = [];

  /** 取读锁；返回释放函数。无写者且无排队者时立即入读。 */
  async read(): Promise<() => void> {
    await this.acquire("read");
    return () => {
      this.activeReaders--;
      this.pump();
    };
  }

  /** 取写锁；返回释放函数。与所有持有者互斥（完全空闲才立即入写）。 */
  async write(): Promise<() => void> {
    await this.acquire("write");
    return () => {
      this.activeWriter = false;
      this.pump();
    };
  }

  private acquire(kind: "read" | "write"): Promise<void> {
    const fastPath =
      kind === "read"
        ? !this.activeWriter && this.queue.length === 0
        : !this.activeWriter && this.activeReaders === 0 && this.queue.length === 0;
    if (fastPath) {
      this.admit(kind);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      // admit 在 pump 放行时调用（先记账再 resolve，唤醒即持锁）
      this.queue.push({
        kind,
        admit: () => {
          this.admit(kind);
          resolve();
        },
      });
    });
  }

  private admit(kind: "read" | "write"): void {
    if (kind === "read") this.activeReaders++;
    else this.activeWriter = true;
  }

  /** 持有者释放后从队首放行：头部连续读者成批入读，或队首写者独占入写。 */
  private pump(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (head === undefined) return;
      if (head.kind === "read") {
        if (this.activeWriter) return;
        let i = 0;
        while (i < this.queue.length) {
          const waiter = this.queue[i];
          if (waiter === undefined || waiter.kind !== "read") break;
          waiter.admit();
          i++;
        }
        this.queue.splice(0, i);
        return;
      }
      if (this.activeWriter || this.activeReaders > 0) return;
      this.queue.shift();
      head.admit();
      return;
    }
  }
}
