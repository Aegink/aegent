/**
 * Provider 容错层（J15/J18/J19，T-P1-23）——withRetry 之上的**跨请求**层。
 *
 * 分层边界（卡内定形，避免双计数）：**重试在请求内、熔断跨请求**——
 * withRetry 包装单个请求（响应头阶段失败的自动重试），熔断器看到的是每个
 * 请求的**最终**结局（成功 / 最终失败）；请求内的 N 次重试在熔断器眼里是
 * 1 次请求，绝不按重试次数计数。
 *
 * J19 Disposition 判据（grok retry_policy 的"状态码→处置映射集中一处"）：
 * 失败分两类——retryable（429/5xx/网络类：向熔断计数）与 terminal（400/
 * 403/404 等请求级错误：不向熔断计数——端点本身健康）；判据复用 J26 的
 * isRetryableStatus，不另立第二份状态码清单。
 *
 * J18 限流桶（hermes RateLimitBucket）：按 provider 计量 used/usage_pct/
 * remaining_seconds_now，越过告警阈值提前告知（edge 触发：自阈值下方上穿
 * 告警一次，不逐请求刷屏）。
 *
 * J15 故障转移队列（cc-switch failover 的"队列非开关 + sort_index 序"）：
 * 后端按队列序排列（数组序 = sort_index 序），当前后端开路或请求最终失败
 * 时按序切下一家（环绕）；成功后粘住新后端。全部后端不可用 → 类型化错误。
 *
 * 流边界（T-2-03"流产出后不重试"的跨后端版本）：本层只在实际交付任何增量
 * **之前**故障转移——增量已送达调用方后失败原样上抛（换家重放必然重复
 * 产出）。时钟全部注入（logger 跨日教训：凡时间面必须同源）。
 */

import { ProviderHttpError, type ModelProvider } from "./provider.js";
import { isRetryableStatus, withRetry, type RetryOptions } from "./retry.js";
import { identityKey, type ModelIdentity } from "./identity.js";

// ---------------------------------------------------------------------------
// J19：失败处置判据（集中一处，复用 J26 分类）
// ---------------------------------------------------------------------------

export type FailureDisposition = "retryable" | "terminal";

export function classifyProviderFailure(error: unknown): FailureDisposition {
  if (error instanceof ProviderHttpError) {
    return isRetryableStatus(error.status) ? "retryable" : "terminal";
  }
  // 非 HTTP 错误（网络不可达/超时/wire 破坏）按可重试类计——端点不可达
  // 正是熔断要拦的事故
  return "retryable";
}

// ---------------------------------------------------------------------------
// J19：熔断器（连续失败开路、半开探测恢复）
// ---------------------------------------------------------------------------

export type BreakerState = "closed" | "open" | "half_open";

export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_RESET_TIMEOUT_MS = 30_000;

export interface CircuitBreakerOptions {
  name: string;
  /** 连续可重试失败次数阈值；缺省 5。 */
  failureThreshold?: number;
  /** open → half_open 的冷却时长（毫秒）；缺省 30s。 */
  resetTimeoutMs?: number;
  /** 注入时钟（与 tracker 共享同一 now）。 */
  now?: () => number;
  onStateChange?: (name: string, state: BreakerState) => void;
}

export class CircuitBreaker {
  private stateId: BreakerState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  get name(): string {
    return this.options.name;
  }

  get state(): BreakerState {
    return this.stateId;
  }

  /** 连续可重试失败计数（观测面；验收①的计数断言面）。 */
  get failureCount(): number {
    return this.consecutiveFailures;
  }

  /**
   * 本请求是否放行：closed 必然放行；open 且冷却已过 → 转 half_open 放行
   * 探测；open 未到时限不放行；half_open 放行（探测请求）。
   */
  allowRequest(): boolean {
    const now = this.options.now ?? Date.now;
    if (this.stateId === "closed") return true;
    if (this.stateId === "open") {
      if (now() - this.openedAt >= (this.options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS)) {
        this.transition("half_open");
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.stateId !== "closed") this.transition("closed");
  }

  /** terminal 处置不计数（端点健康）；retryable 计数，达阈值或半开探测再败即开路。 */
  recordFailure(disposition: FailureDisposition): void {
    if (disposition === "terminal") return;
    const now = this.options.now ?? Date.now;
    this.consecutiveFailures += 1;
    if (
      this.stateId === "half_open" ||
      this.consecutiveFailures >= (this.options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD)
    ) {
      this.openedAt = now();
      this.transition("open");
    }
  }

  private transition(state: BreakerState): void {
    this.stateId = state;
    this.options.onStateChange?.(this.options.name, state);
  }
}

// ---------------------------------------------------------------------------
// J18：限流桶（按 provider 计量 + 接近配额提前告知）
// ---------------------------------------------------------------------------

export const DEFAULT_RATE_LIMIT_WARN_PCT = 80;

export interface RateLimitCapture {
  /** 窗口配额总量。 */
  limit: number;
  /** 窗口剩余量。 */
  remaining: number;
  /** 窗口重置秒数（捕获时刻起算；可缺省——无重置信息时余量只报告不倒计时）。 */
  resetSeconds?: number;
}

export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  /** used = max(0, limit - remaining)（hermes 同款）。 */
  used: number;
  /** usage_pct = used / limit × 100（limit ≤ 0 时 0，hermes 同款）。 */
  usagePct: number;
  /** 距窗口重置的秒数（随注入时钟衰减；无重置信息时 undefined）。 */
  resetInSeconds?: number;
}

export interface RateLimitTrackerOptions {
  now?: () => number;
  /** 接近配额的告警阈值（usage_pct）；缺省 80。 */
  warnThresholdPct?: number;
  /** 告警观测口（装配接 logger.warn）。 */
  onWarn?: (info: { provider: string; usagePct: number; remaining: number }) => void;
}

interface BucketRecord {
  limit: number;
  remaining: number;
  /** 重置的绝对时刻（毫秒）；无重置信息时 undefined。 */
  resetAt?: number;
}

export class RateLimitTracker {
  private readonly buckets = new Map<string, BucketRecord>();
  /** edge 触发状态：true = 已在阈值上（已告警过），回落阈值下后重置。 */
  private readonly aboveThreshold = new Map<string, boolean>();

  constructor(private readonly options: RateLimitTrackerOptions = {}) {}

  record(provider: string, capture: RateLimitCapture): RateLimitSnapshot {
    const now = (this.options.now ?? Date.now)();
    const record: BucketRecord = {
      limit: capture.limit,
      remaining: capture.remaining,
      ...(capture.resetSeconds !== undefined
        ? { resetAt: now + capture.resetSeconds * 1000 }
        : {}),
    };
    this.buckets.set(provider, record);
    const snapshot = this.snapshotOf(provider, record);
    // edge 触发告警：自阈值下方上穿时告警一次（J18"接近配额提前告知"）
    const threshold = this.options.warnThresholdPct ?? DEFAULT_RATE_LIMIT_WARN_PCT;
    const wasAbove = this.aboveThreshold.get(provider) === true;
    const isAbove = snapshot.usagePct >= threshold;
    if (isAbove && !wasAbove) {
      this.options.onWarn?.({
        provider,
        usagePct: snapshot.usagePct,
        remaining: snapshot.remaining,
      });
    }
    this.aboveThreshold.set(provider, isAbove);
    return snapshot;
  }

  snapshot(provider: string): RateLimitSnapshot | undefined {
    const record = this.buckets.get(provider);
    if (record === undefined) return undefined;
    return this.snapshotOf(provider, record);
  }

  private snapshotOf(provider: string, record: BucketRecord): RateLimitSnapshot {
    const now = (this.options.now ?? Date.now)();
    const used = Math.max(0, record.limit - record.remaining);
    return {
      limit: record.limit,
      remaining: record.remaining,
      used,
      usagePct: record.limit > 0 ? (used / record.limit) * 100 : 0,
      ...(record.resetAt !== undefined
        ? { resetInSeconds: Math.max(0, (record.resetAt - now) / 1000) }
        : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// J15：故障转移队列（withRetry 之上的组合层）
// ---------------------------------------------------------------------------

export interface FailoverBackend {
  /** 后端名（熔断器的键；观测面用）。 */
  name: string;
  provider: ModelProvider;
  /** 绑定的默认身份（J6 注册表身份——观测面；路由不改请求的 identity）。 */
  identity?: ModelIdentity;
}

export const ALL_BACKENDS_FAILED = "ALL_BACKENDS_FAILED";

/** 全部后端不可用（各自熔断开路或请求最终失败）——类型化错误。 */
export class AllBackendsFailedError extends Error {
  readonly code = ALL_BACKENDS_FAILED;
  constructor(
    readonly failures: ReadonlyArray<{ backend: string; error: unknown }>,
  ) {
    const detail =
      failures.length > 0
        ? failures
            .map((f) => `${f.backend}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
            .join("；")
        : "全部后端熔断开路";
    super(`故障转移队列耗尽（${String(failures.length)} 家）——${detail}`);
    this.name = "AllBackendsFailedError";
  }
}

export interface FailoverOptions {
  /** 传给每家 withRetry 的请求内重试配置（测试传 maxAttempts:1 禁轴）。 */
  retry?: RetryOptions;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  now?: () => number;
  /** 熔断状态变化与转移的观测口（装配接 logger）。 */
  onEvent?: (message: string) => void;
}

export interface FailoverHandle {
  /** 组合后的容错 provider（流形状与单家 provider 完全一致）。 */
  provider: ModelProvider;
  /** 各后端的熔断器（观测/测试面）。 */
  breakers: ReadonlyMap<string, CircuitBreaker>;
  /** 限流桶（J18；provider 侧接 x-ratelimit 头时喂它）。 */
  tracker: RateLimitTracker;
  /** 当前粘住的后端名。 */
  currentBackend(): string;
}

/**
 * 组装容错 provider：请求按队列序（自当前粘住的后端起，环绕）尝试——
 * 熔断 open 的后端跳过、失败的后端按序换下一家、成功即粘住。每家的请求
 * 内重试由 withRetry 承担（分层边界见文件头）。
 */
export function createFailoverProvider(
  backends: readonly FailoverBackend[],
  options: FailoverOptions = {},
): FailoverHandle {
  if (backends.length === 0) throw new Error("故障转移队列不能为空");
  const now = options.now ?? Date.now;
  const breakers = new Map<string, CircuitBreaker>(
    backends.map((b) => [
      b.name,
      new CircuitBreaker({
        name: b.name,
        ...(options.failureThreshold !== undefined
          ? { failureThreshold: options.failureThreshold }
          : {}),
        ...(options.resetTimeoutMs !== undefined
          ? { resetTimeoutMs: options.resetTimeoutMs }
          : {}),
        now,
        onStateChange: (name, state) => {
          options.onEvent?.(`熔断器 ${name} → ${state}`);
        },
      }),
    ]),
  );
  const tracker = new RateLimitTracker({ now });
  let currentIndex = 0;

  const provider: ModelProvider = {
    async *streamChat(req) {
      const failures: Array<{ backend: string; error: unknown }> = [];
      const n = backends.length;
      for (let offset = 0; offset < n; offset++) {
        const index = (currentIndex + offset) % n;
        const backend = backends[index]!;
        const breaker = breakers.get(backend.name)!;
        if (!breaker.allowRequest()) {
          options.onEvent?.(`熔断开路，跳过后端 ${backend.name}`);
          continue;
        }
        let delivered = false;
        try {
          for await (const chunk of withRetry(backend.provider, options.retry).streamChat(req)) {
            delivered = true;
            yield chunk;
          }
          breaker.recordSuccess();
          currentIndex = index; // 成功后粘住
          return;
        } catch (e) {
          breaker.recordFailure(classifyProviderFailure(e));
          if (delivered) throw e; // 增量已送达调用方——不换家（流边界）
          failures.push({ backend: backend.name, error: e });
          options.onEvent?.(
            `后端 ${backend.name} 请求失败，按队列序故障转移（${String(classifyProviderFailure(e))}）`,
          );
        }
      }
      throw new AllBackendsFailedError(failures);
    },
  };

  return {
    provider,
    breakers,
    tracker,
    currentBackend: () => backends[currentIndex]!.name,
  };
}

/** 目录联动辅助（J12 查询面）：把故障转移队列的身份清单喂给 buildModelCatalog。 */
export function failoverIdentities(backends: readonly FailoverBackend[]): ModelIdentity[] {
  return backends
    .map((b) => b.identity)
    .filter((identity): identity is ModelIdentity => identity !== undefined)
    .filter((identity, index, all) => all.findIndex((m) => identityKey(m) === identityKey(identity)) === index);
}
