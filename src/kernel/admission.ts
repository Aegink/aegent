/**
 * 有界准入（J20 + M9 并发面 / T-P1-49）。
 *
 * TurnAdmission 形状取 codex·turn_admission.rs（TurnAdmission{closed,active}
 * + admit()→TurnPermit + begin_drain() + subscribe_active() + Drop 递减）：
 * - `admit()` 在闭闸时抛 ServerDrainingError（codex server_draining_error
 *   同构——类型化拒绝，协议层转 error 行）；
 * - Permit 显式 release（JS 无 Drop；双 release 幂等防泄漏）；
 * - "Admit and close take the same short lock"：JS 单线程事件循环内
 *   同步方法天然互斥，无需锁。
 *
 * 我方落点：单会话单进程内"在途轮"准入（admit 包住 kick 的 runTurn——
 * active = 在途轮数）；begin_drain 挂 dispose/stdin 收尾路径——**其后到达的
 * prompt/steer 类型化拒绝**（"重启绝不重放旧进程创建的工作"的准入面同构，
 * pi-desktop·ADR 0041）。多会话 host 级的两级上限（全局/每会话）随 K3
 * （批次 12），此处不预埋（YAGNI）。
 *
 * ToolClassLimiter 落 M9 半边："Tool classes have independent global limits"
 * ——写执行类与只读类各自独立上限，类内超限**排队等待**而非无限并发
 * （"超限排队而非无限并发"）。工具类判定函数由调用方注入（classify）——
 * 本模块不反向依赖 policy 层（T-6-01 的 builtin→shell-semantics 是唯一
 * 反向依赖先例，不开第二处）。缺省 Infinity = 零行为变化；B17 的 RwLock
 * 在其内层照旧工作（层序：类级排队 → loop 派发 → 工具级互斥/并发）。
 */

/** draining 后准入的类型化拒绝（codex server_draining_error 同构）。 */
export class ServerDrainingError extends Error {
  readonly code = "SERVER_DRAINING";
  constructor() {
    super("进程正在收尾（draining）——不再受理新 turn");
    this.name = "ServerDrainingError";
  }
}

export interface AdmissionPermit {
  /** 释放一个在途名额（幂等——双 release 不产生负计数）。 */
  release(): void;
}

export class TurnAdmission {
  private closed = false;
  private active = 0;

  /** 闭闸：其后 admit 一律拒绝（收尾路径调用，不可逆）。 */
  beginDrain(): void {
    this.closed = true;
  }

  get draining(): boolean {
    return this.closed;
  }

  /** 在途名额（可观测面——ADR 0041 "Tool capacity becomes observable"）。 */
  get activeCount(): number {
    return this.active;
  }

  admit(): AdmissionPermit {
    if (this.closed) throw new ServerDrainingError();
    this.active += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
      },
    };
  }
}

export interface ToolClassLimits {
  /** 写执行类（isWriteExecuteTool 判定面）并发上限；缺省 Infinity 不限。 */
  writeExecuteMax?: number;
  /** 只读类并发上限；缺省 Infinity 不限。 */
  readOnlyMax?: number;
}

type Release = () => void;

interface Lane {
  running: number;
  limit: number;
  /** FIFO 等待队列：超限排队而非无限并发（J20 验收语义）。 */
  waiters: Array<(release: Release) => void>;
}

/**
 * 工具类并发上限信号量：每类一个独立泳道（独立全局上限），acquire 超限
 * FIFO 排队、release 唤醒队头。classify 在构造时注入。
 */
export class ToolClassLimiter {
  private readonly writeLane: Lane;
  private readonly readLane: Lane;

  constructor(
    private readonly limits: ToolClassLimits = {},
    private readonly classify: (name: string) => "write" | "read",
  ) {
    this.writeLane = { running: 0, limit: limits.writeExecuteMax ?? Infinity, waiters: [] };
    this.readLane = { running: 0, limit: limits.readOnlyMax ?? Infinity, waiters: [] };
  }

  private laneFor(name: string): Lane {
    return this.classify(name) === "write" ? this.writeLane : this.readLane;
  }

  /** 取一个名额；类满则 FIFO 排队等待。返回 release（幂等）。 */
  async acquire(name: string): Promise<Release> {
    const lane = this.laneFor(name);
    if (lane.running < lane.limit) {
      lane.running += 1;
      return makeRelease(lane);
    }
    return new Promise<Release>((resolve) => {
      lane.waiters.push(resolve);
    });
  }

  /** 各泳道占用快照（可观测面）。 */
  snapshot(): { writeRunning: number; readRunning: number; writeWaiting: number; readWaiting: number } {
    return {
      writeRunning: this.writeLane.running,
      readRunning: this.readLane.running,
      writeWaiting: this.writeLane.waiters.length,
      readWaiting: this.readLane.waiters.length,
    };
  }
}

function makeRelease(lane: Lane): Release {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = lane.waiters.shift();
    if (next) {
      // 名额直接转交给队头等待者（计数不落 0 再起——FIFO 公平）
      next(makeRelease(lane));
      return;
    }
    lane.running -= 1;
  };
}
