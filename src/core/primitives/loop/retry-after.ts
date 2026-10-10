/**
 * Retry-After 头解析（J26 重试层的 wire 语义——loop 流恢复与 models 重试共用）。
 * T3-2 自 src/models/retry.ts 迁入（依赖倒置——models 反向 import 本文件）。
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

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.includes(status);
}

export const RETRYABLE_STATUS_CODES: readonly number[] = [
  408, 409, 429, 500, 502, 503, 504, 529,
];
