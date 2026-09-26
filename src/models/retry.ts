/**
 * 重试显式分类（J26）——形状取 kimi·retry.ts：可重试 status 显式枚举、
 * 指数退避 + jitter、unknown 不重试。
 *
 * Retry-After 响应头是 J26 验收要点自加项（kimi 的 retryAfterMs 在其上游
 * 错误对象里、未解析 HTTP 头；我方从 ProviderHttpError.retryAfter 直读），
 * 服务端明确给出的等待时间覆盖本地退避。
 *
 * 重试边界（D15 的流侧版本）：只重试"响应头阶段"失败（ProviderHttpError 且
 * status 在枚举内）；一旦流产出过增量，任何错误都不再自动重试——增量已送达
 * 调用方，重试必然重复产出。未知错误种类（wire 破坏/网络中断/流中断等非
 * ProviderHttpError）按 kimi 的 `case 'unknown'` 纪律一次都不打。
 */

import { ProviderHttpError, type ModelProvider } from "./provider.js";

/**
 * A5/T-P1-51 重试尝试留痕载荷（kimi·retry.ts:68-74 retryErrorFields 同构：
 * errorName/errorMessage/statusCode 供事件/日志消费）——provider 内部重试
 * 不进模型历史 = 不落流自洽（assistant/attempt 只承载"模型消息级失败"），
 * "事件留记录"落 logger.warn 结构化字段。
 */
export interface RetryAttemptFields {
  errorName: string;
  errorMessage: string;
  statusCode?: number;
}

export interface RetryObservation {
  /** 第几次尝试失败后重试（0-based：0 = 首次请求失败）。 */
  attempt: number;
  /** 本次重试前的等待毫秒（Retry-After 优先，否则默认退避）。 */
  delayMs: number;
  /** 失败错误的结构化字段（kimi retryErrorFields 同构）。 */
  error: RetryAttemptFields;
}

/** kimi·retry.ts 同款枚举：显式清单之外的 status 一律不重试。 */
export const RETRYABLE_STATUS_CODES: readonly number[] = [
  408, 409, 429, 500, 502, 503, 504, 529,
];

export const DEFAULT_MAX_ATTEMPTS = 10;

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 32_000;
const JITTER_FACTOR = 0.25;

export interface RetryOptions {
  /** 总尝试次数上限（含首次；>=1）。kimi 默认 10。 */
  maxAttempts?: number;
  /** 等待实现可注入——测试的"mock 时间"：记录时长而不真睡。 */
  sleep?: (ms: number) => Promise<void>;
  /** jitter 随机源可注入（返回 0..1；测试钉死 0/1 取区间两端）。 */
  rand?: () => number;
  /**
   * A5/T-P1-51：每次重试尝试的留痕钩子——attempt/delayMs/错误结构化字段。
   * 装配缺省接线 logger.warn（结构化字段可检索）；不接 = 零行为变化。
   */
  onRetry?: (observation: RetryObservation) => void;
}

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.includes(status);
}

/**
 * 第 attempt 次失败（0-based）后的默认退避：min(500·2^attempt, 32s) + U(0,25%)·base。
 * kimi·retry.ts 的 retryBackoffDelay 同款参数。
 */
export function backoffDelayMs(attempt: number, rand: number = Math.random()): number {
  const base = Math.min(BASE_DELAY_MS * 2 ** Math.max(attempt, 0), MAX_DELAY_MS);
  return base + rand * JITTER_FACTOR * base;
}

/**
 * Retry-After 头（delta-seconds 或 HTTP 日期）→ 等待毫秒。
 * 缺失/非法/非正值返回 undefined（回落默认退避），语义对齐 kimi 的
 * readRetryAfterMs（仅 >0 生效）。
 */
export function parseRetryAfterMs(
  value: string | undefined | null,
  now: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    return sec > 0 ? sec * 1000 : undefined;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  const delta = date - now;
  return delta > 0 ? delta : undefined;
}

/**
 * 给 provider 套上显式分类重试。只认"响应头阶段的 ProviderHttpError 且
 * status 在枚举内"；Retry-After 头优先于默认退避。
 */
export function withRetry(provider: ModelProvider, opts?: RetryOptions): ModelProvider {
  const maxAttempts = Math.max(opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 1);
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rand = opts?.rand ?? Math.random;
  const onRetry = opts?.onRetry;
  return {
    async *streamChat(req) {
      for (let attempt = 0; ; attempt++) {
        let produced = false;
        try {
          for await (const chunk of provider.streamChat(req)) {
            produced = true;
            yield chunk;
          }
          return;
        } catch (e) {
          if (produced || !isRetryable(e) || attempt + 1 >= maxAttempts) throw e;
          const delayMs = pickDelayMs(e, attempt, rand);
          if (onRetry) {
            onRetry({
              attempt,
              delayMs,
              error: retryErrorFields(e),
            });
          }
          await sleep(delayMs);
        }
      }
    },
  };
}

/** kimi·retry.ts:68-74 retryErrorFields 同构：错误的结构化字段（供留痕）。 */
function retryErrorFields(e: unknown): RetryAttemptFields {
  if (e instanceof ProviderHttpError) {
    return {
      errorName: "ProviderHttpError",
      errorMessage: e.message,
      statusCode: e.status,
    };
  }
  return {
    errorName: e instanceof Error ? e.name : typeof e,
    errorMessage: e instanceof Error ? e.message : String(e),
  };
}

function isRetryable(e: unknown): boolean {
  return e instanceof ProviderHttpError && isRetryableStatus(e.status);
}

function pickDelayMs(e: unknown, attempt: number, rand: () => number): number {
  const retryAfter =
    e instanceof ProviderHttpError
      ? parseRetryAfterMs(e.retryAfter, Date.now())
      : undefined;
  return retryAfter ?? backoffDelayMs(attempt, rand());
}
