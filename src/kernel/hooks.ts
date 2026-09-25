/**
 * 内核 hooks（I1/I6 / T-P1-07、T-P1-09）——注册/触发分离的 hook 面
 * （pi·hooks.ts 的 HookRegistry 同构：on 注册返回注销函数、close 后注册抛错）。
 * 信任轨（I6）在注册时声明（trust），T-P1-09 起**分轨**：
 *
 *   trusted   同链直调——layer(point) 产出聚合层，由装配挂三点位洋葱链
 *             （权限 gate 外层）。崩溃上抛，与策略层 T-5-01 同款（策略模块
 *             崩溃 fail-open 是禁止的：放行一个无法判定的动作比中断更危险）。
 *   untrusted 独立轨——untrustedLayer(point) 产出观察轨，**不进内核链**（分轨
 *             断言：内核 trace 不含 untrusted 层）。能力白名单 = 只观察：
 *             调 next 即能力越界抛错（不能截断/换载荷/驱动内核），崩溃在轨内
 *             隔离（reportError + 跳过继续）。真进程隔离（子进程 + 协议，
 *             dsh·hook-protocol 分包形状）随 K3/K4 批次。
 *
 * hook 本体是 mods 的 `($, e, next)` 链形；注册序 = 轨上嵌套序（先注册先看到
 * 事件，外层在前）；layer()/untrustedLayer() 取注册快照，之后的注册在下一
 * 次取层才生效（装配时序定轨内容，避免动态注册的半态轨）。
 */

import { type ChainLayer, type ChainNext, type ChainPoint } from "./chain.js";

/** 信任轨（I6）：trusted 同链直调（崩溃上抛），untrusted 独立观察轨（崩溃隔离）。 */
export type HookTrust = "trusted" | "untrusted";

export interface HookRegistrationOptions {
  /** hook 名（报告面可检索）；缺省 `hook#<序号>`。 */
  name?: string;
  /** 信任轨；缺省 "trusted"（内核级可信扩展——插件轨必须显式声明 untrusted）。 */
  trust?: HookTrust;
}

/** 崩溃报告（隔离与上抛都报；消费方接 logger 时自行脱敏——C14 纪律）。 */
export interface HookErrorReport {
  readonly point: ChainPoint;
  readonly hook: string;
  readonly error: unknown;
  /** true = untrusted 轨内隔离（跳过继续）；false = trusted 上抛。 */
  readonly isolated: boolean;
}

export interface HookRegistryOptions {
  /** 崩溃报告出口（pi 同构的 reportError）；缺省无出口（测试面直接收集）。 */
  reportError?(report: HookErrorReport): void;
}

interface InternalRegistration {
  readonly name: string;
  readonly trust: HookTrust;
  run($: unknown, e: unknown, next: unknown): unknown;
}

export class HookRegistry {
  private readonly registrations = new Map<ChainPoint, InternalRegistration[]>();
  private readonly reportError: HookRegistryOptions["reportError"];
  private disposedError: Error | undefined;
  private counter = 0;

  constructor(options: HookRegistryOptions = {}) {
    this.reportError = options.reportError;
  }

  /** 注册一个 hook（洋葱层同形：调 next 放行、不调即截断）；返回注销函数。 */
  on<C, E, R>(
    point: ChainPoint,
    handler: ChainLayer<C, E, R>,
    options: HookRegistrationOptions = {},
  ): () => void {
    if (this.disposedError !== undefined) throw this.disposedError;
    const registration: InternalRegistration = {
      name: options.name ?? `hook#${String(this.counter++)}`,
      trust: options.trust ?? "trusted",
      run: ($, e, next) =>
        handler($ as C, e as E, next as ChainNext<E, R>),
    };
    const list = this.registrations.get(point) ?? [];
    list.push(registration);
    this.registrations.set(point, list);
    return () => {
      const index = list.indexOf(registration);
      if (index !== -1) list.splice(index, 1);
    };
  }

  has(point: ChainPoint): boolean {
    return (this.registrations.get(point)?.length ?? 0) !== 0;
  }

  private snapshot(point: ChainPoint, trust: HookTrust): InternalRegistration[] {
    return (this.registrations.get(point) ?? []).filter((r) => r.trust === trust);
  }

  /**
   * 内核链层（trusted 轨，I6 分轨的"同链直调"侧）：装配挂三点位（gate 外层
   * ——hook 改载荷会被内层权限重新判定）。无 trusted 注册 = undefined（不挂
   * 层，零开销）。取快照——之后的注册不进本层。trusted 崩溃上抛（策略层
   * T-5-01 同款：fail-open 禁止）。
   */
  layer<C, E, R>(point: ChainPoint): ChainLayer<C, E, R> | undefined {
    const snapshot = this.snapshot(point, "trusted");
    if (snapshot.length === 0) return undefined;
    return async ($, e, next) => {
      // dispose 后层直通（收摊不炸 turn）：已装配的链还持有本层，注册表
      // 清空后 hook 退场，事件照常推进。
      if (this.disposedError !== undefined) return next(e);
      const runFrom = async (index: number, event: E): Promise<R> => {
        const reg = snapshot[index];
        if (reg === undefined) return next(event);
        let nextCalled = false;
        const hookNext: ChainNext<E, R> = Object.assign(
          (e2: E) => {
            if (nextCalled) {
              throw new Error(
                `hook「${reg.name}」重复调用 next（point=${point}）——每 hook 至多一次`,
              );
            }
            nextCalled = true;
            return runFrom(index + 1, e2);
          },
          // trace/budget 透传链上真实 next 的视图（hook 层在链上是一层，
          // hook 间嵌套不新增 trace 条目——I13 的粒度是链层）。
          { point, trace: next.trace, budget: next.budget },
        );
        // 与策略层 T-5-01 同款：崩溃上抛（fail-open 禁止）。
        return (await reg.run($, event, hookNext)) as R;
      };
      return runFrom(0, e);
    };
  }

  /**
   * untrusted 独立观察轨（I6 分轨的"隔离 + 能力受限"侧）：**不进内核链**
   * （分轨断言：内核 trace 不含 untrusted 层——真进程隔离随 K3/K4）。
   * 能力白名单 = 只观察：hook 拿到的 next 是哨兵，调用即抛能力越界
   * （不能截断/换载荷/驱动内核）；hook 崩溃在轨内隔离（reportError +
   * 跳过继续——观察结果无人消费，无 turn 悬挂风险，统一吞错无需分点位）。
   * 轨底返回 undefined as R（观察终点没有内核动作可驱动；R 由调用方语境定）。
   */
  untrustedLayer<C, E, R>(point: ChainPoint): ChainLayer<C, E, R> | undefined {
    const snapshot = this.snapshot(point, "untrusted");
    if (snapshot.length === 0) return undefined;
    return async ($, e, next) => {
      void next; // 观察轨不消费宿主 next：dispose 后轨退场返回 undefined
      if (this.disposedError !== undefined) return undefined as R;
      const forbiddenNext: ChainNext<E, R> = Object.assign(
        () => {
          throw new Error(
            `untrusted hook 能力越界（point=${point}）——观察轨不可调 next` +
              "（能力白名单 = 只观察，截断/换载荷/驱动内核均为 trusted 轨能力）",
          );
        },
        { point, trace: Object.freeze([]) as never, budget: Object.freeze({}) },
      );
      const runFrom = async (index: number, event: E): Promise<R> => {
        const reg = snapshot[index];
        if (reg === undefined) return undefined as R;
        try {
          return (await reg.run($, event, forbiddenNext)) as R;
        } catch (error) {
          this.reportError?.({ point, hook: reg.name, error, isolated: true });
          return runFrom(index + 1, event);
        }
      };
      return runFrom(0, e);
    };
  }

  /** 关闭注册表：清空全部注册；此后 on() 抛错（pi 的 close 同款语义）。 */
  dispose(): void {
    this.disposedError ??= new Error("HookRegistry 已 dispose——注册被拒绝");
    this.registrations.clear();
  }
}
