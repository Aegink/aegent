/**
 * 内核 hooks（I1 / T-P1-07）——注册/触发分离的 hook 面（pi·hooks.ts 的
 * HookRegistry 同构：on 注册返回注销函数、close 后注册抛错；触发面在我方
 * 是 layer(point)：把已注册 hooks 按 mods 的 `($, e, next)` 链形嵌成一个
 * ChainLayer，由装配挂进三点位洋葱链）。
 *
 * ── 与策略层的关系（同链不同信任轨，I6 最小面）──
 * hook 层挂在权限 gate 外层（hooks → gate → terminal）：hook 对载荷的任何
 * 修改都会被内层权限重新判定，hook 截断优先于权限求值（不执行的方向安全）。
 * 信任轨在注册时声明（trust），崩溃语义与策略层相反：
 *
 *   trusted   崩溃上抛——与策略层 T-5-01 同款（策略模块崩溃 fail-open 是
 *             禁止的：放行一个无法判定的动作比中断更危险）。
 *   untrusted 崩溃隔离为 isError——扩展崩溃不能炸 turn（策略层语义的反面）。
 *
 * 隔离按点位与崩溃时机细分为三种（各自有"为什么"）：
 *   toolCall      before 段崩溃 → isError 工具结果截断（工具不执行，fail-closed）；
 *   modelRequest  before 段崩溃 → 空输出截断（loop 对截断只看 truncated 标记，
 *                 turn 以 blocked 终止，value 不消费）；
 *   turnEnd       崩溃一律吞错继续——turnEnd 截断 = turn 悬挂（closeTurn 大声
 *                 失败），比吞错更糟；hook 是收尾观察面，不能让观察者卡死收尾。
 *   after 段（next 已调）崩溃 → 一律上抛：动作事实已发生（工具已执行/请求已
 *   发出），"隔离为不执行"不存在，装睡等于伪造事实——上抛走既有基础设施
 *   catch 路径（toolCall 的 dispatchTool catch 落 isError，turn 不炸）。
 *
 * 分轨断言（untrusted 不进内核 trace）是 T-P1-09 的验收——本卡只保证结构
 * 可分：trust 维度注册时声明、聚合层按 trust 分流崩溃处理。注册序 = 链上
 * 嵌套序（先注册先看到事件，外层在前）；layer() 取注册快照，之后的注册在
 * 下一次 layer() 才生效（装配时序决定链内容，避免动态注册的半态链）。
 */

import { type ChainLayer, type ChainNext, type ChainPoint } from "./chain.js";
import type { ModelStepOutput, ToolExecutionResult } from "./loop.js";

/** 信任轨（I6 最小面）：trusted 崩溃上抛，untrusted 崩溃隔离。 */
export type HookTrust = "trusted" | "untrusted";

export interface HookRegistrationOptions {
  /** hook 名（隔离/报告面可检索）；缺省 `hook#<序号>`。 */
  name?: string;
  /** 信任轨；缺省 "trusted"（I1 是内核级可信扩展——P1-09 插件轨必须显式声明 untrusted）。 */
  trust?: HookTrust;
}

/** 崩溃报告（隔离与上抛都报；消费方接 logger 时自行脱敏——C14 纪律）。 */
export interface HookErrorReport {
  readonly point: ChainPoint;
  readonly hook: string;
  readonly error: unknown;
  /** true = 已隔离（untrusted before 段）；false = 上抛（trusted / after 段）。 */
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

  /**
   * 产出挂进三点位链的聚合层（pi 的"触发"面）：注册序嵌套（先注册外层），
   * 链内最末 hook 的 next = 链上真实 next。无注册 = undefined（装配不挂层，
   * 零开销）。layer() 取快照——之后的注册不进本层。
   */
  layer<C, E, R>(point: ChainPoint): ChainLayer<C, E, R> | undefined {
    const snapshot = [...(this.registrations.get(point) ?? [])];
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
        if (reg.trust === "trusted") {
          // 与策略层 T-5-01 同款：崩溃上抛（fail-open 禁止）。
          return (await reg.run($, event, hookNext)) as R;
        }
        try {
          return (await reg.run($, event, hookNext)) as R;
        } catch (error) {
          if (nextCalled) {
            // after 段崩溃：动作已发生，装睡等于伪造事实——上抛。
            this.reportError?.({ point, hook: reg.name, error, isolated: false });
            throw error;
          }
          // before 段崩溃：隔离（错误可检索，turn 不炸）。
          this.reportError?.({ point, hook: reg.name, error, isolated: true });
          if (point === "turnEnd") {
            return runFrom(index + 1, event);
          }
          return isolatedValue(point, error) as R;
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

/**
 * untrusted hook before 段崩溃的隔离值（按点位）：形状知识在本文件（R 的
 * 类型来自 loop.ts，依赖单向），装配零负担。C14：content 只带错误消息，
 * 与 dispatchTool 的 isError 兜底同款纪律。
 */
function isolatedValue(point: ChainPoint, error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  switch (point) {
    case "toolCall": {
      const result: ToolExecutionResult = {
        content: `hook 崩溃（已隔离）：${message}`,
        isError: true,
        error: { name: "HookError", code: "HOOK_FAILED" },
      };
      return result;
    }
    case "modelRequest": {
      // loop 对 modelRequest 截断只看 truncated 标记（turn blocked），
      // value 不消费——空输出是哨兵不是事实。
      const output: ModelStepOutput = { content: "", toolCalls: [], timed: [] };
      return output;
    }
    case "turnEnd":
      // 不可达（turnEnd 的 untrusted 崩溃走吞错继续分支）。
      return undefined;
  }
}
