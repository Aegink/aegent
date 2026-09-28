/**
 * 会话空闲回收（M4，T-P2-104）——空闲会话被回收，不常驻内存。
 *
 * 行为锚：qwen·docs/design/session-idle-reaper/README.md（Draft 设计文档；
 * §2 设计目标 + §4.2 空闲判定 + §4.3 回收动作）——取三行为：
 * 1. **空闲判定** = 无活动工作 + 无连接端 + `now − lastActivity > 阈值`
 *    （qwen：claim 无活跃 prompt + 无 SSE 订阅者 + 心跳超时）；阈值可配、
 *    可整体禁用（0 / Infinity——qwen 的 "set to 0 or Infinity to disable"）。
 * 2. **回收动作** = 走既有优雅释放路径（qwen 复用 closeSession 而非
 *    killSession 的纪律）——我方 = `AgentHost.dispose()`（摘出 registry，
 *    内存态释放）；**存储态保留**（qwen 目标 3："only in-memory bridge
 *    state is released; disk transcripts are untouched"——存储半边归 Q4
 *    清理/归档，本模块一行不碰盘）。
 * 3. **可观测**（qwen 目标 4：distinct event with reason）——回收通知经
 *    `onReap` 回调广播（装配接线到 host 通知面）。**零事件词汇表扩展**
 *    （卡面"落流候选随 #22 立案"的定形结论）：回收是**进程内运行时事实**
 *    （重启后重新判定、可重复发生），不是会话状态变更——落流会把进程
 *    生命周期噪音写进会话的持久流，且与 M9/job 面"进程内事实 + 回调不进
 *    词汇表"先例冲突；EVENT_TYPES 27 基线不变（复核断言在测试）。
 *
 * 不抄什么：qwen 的多进程 daemon 与 byId/EventBus/SSE 形状（我方单进程
 * host + HostRegistry）；其 LRU/RSS 自适应淘汰、EventBus ring 压缩都是
 * 其非目标（同样 YAGNI）。**不做后台定时器**：`sweep()` 是被动扫描原语，
 * 调度（定时/闲时/按需）由调用方决定（host server 可周期调用；统一调度
 * 面随 15d S1）——与 deadline.ts 的"被动查询式"纪律一致。
 */

import type { HostRegistry } from "./registry.js";

/** 缺省空闲阈值：30 分钟（qwen 同值——"Default: 30 * 60_000"）。 */
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000;

export interface IdleReaperOptions {
  registry: HostRegistry;
  /** 空闲阈值（毫秒；缺省 30 分钟）。0 / Infinity = 禁用（扫描恒空）。 */
  idleTimeoutMs?: number;
  /** 时钟注入（缺省 Date.now——空闲判定与 readAt 的来源）。 */
  now?: () => number;
  /** 回收通知面（装配接线到 host 通知广播/logger；进程内事实 + 回调纪律）。 */
  onReap?: (notice: SessionReapedNotice) => void;
}

/** 回收通知（可观测面——"哪条会话因何被回收"）。 */
export interface SessionReapedNotice {
  sessionId: string;
  hostId: string;
  reason: "idle_timeout";
  lastActiveAt: number;
  /** 空闲时长（readAt − lastActiveAt）。 */
  idleMs: number;
  /** 回收时刻。 */
  reapedAt: number;
}

export class IdleReaper {
  private readonly registry: HostRegistry;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;
  private readonly onReap: ((notice: SessionReapedNotice) => void) | undefined;

  constructor(options: IdleReaperOptions) {
    this.registry = options.registry;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.onReap = options.onReap;
  }

  /**
   * 被动扫描一次：对每个到期可回收的 host 执行回收（dispose + 通知），
   * 返回本轮回收清单（顺序 = registry 注册序）。幂等：已回收的不复现
   * （dispose 已摘出 registry）。
   */
  sweep(): SessionReapedNotice[] {
    const readAt = this.now();
    if (!Number.isFinite(readAt)) {
      throw new TypeError(`空闲回收需要有限时钟（收到 ${String(readAt)}）`);
    }
    // 阈值 0 / Infinity / 负数 = 禁用（qwen "0 or Infinity to disable"）
    if (this.idleTimeoutMs <= 0 || !Number.isFinite(this.idleTimeoutMs)) return [];

    const reaped: SessionReapedNotice[] = [];
    for (const host of this.registry.list()) {
      // 豁免一（显式 opt-in）：未申报回收的一律不动（主 host 会话豁免）
      if (!host.reapable) continue;
      // 豁免二（连接即存活性——批次 12"连接生命周期即租约存活性"纪律的
      // 空闲回收面）：有端连着就不算孤儿（qwen "no live SSE subscribers"）
      if (host.surfaces.connectedSurfaceIds().length > 0) continue;
      // 豁免三：有在途 run（持约）不做——绝不杀掉进行中的工作
      // （qwen 目标 2 "Never destroy a session that has an active prompt"）
      if (host.surfaces.currentLeaseHolder() !== undefined) continue;
      // 到期判定：严格超过阈值（恰在界上不回收）
      const idleMs = readAt - host.lastActiveAt;
      if (idleMs <= this.idleTimeoutMs) continue;

      const notice: SessionReapedNotice = {
        sessionId: host.sessionId,
        hostId: host.hostId,
        reason: "idle_timeout",
        lastActiveAt: host.lastActiveAt,
        idleMs,
        reapedAt: readAt,
      };
      host.dispose(); // 内存态释放（存储态零触碰——本模块不碰盘）
      this.onReap?.(notice);
      reaped.push(notice);
    }
    return reaped;
  }

  /** 当前阈值（可观测/测试面）。 */
  get timeoutMs(): number {
    return this.idleTimeoutMs;
  }
}
