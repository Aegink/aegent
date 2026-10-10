/**
 * 健康检查（J16/T-P1-107，cc-switch·services/stream_check.rs 的我方同构）——
 * 可达性探测 + 检查日志保留期清理。
 *
 * 探测语义（"可达 ≠ 配置正确"）：GET baseUrl 根路径**仅读响应头**——收到
 * 任意 HTTP 响应（200/4xx/5xx）即"可达"（端口通、网关存活），**不验证鉴权
 * 或模型**；仅 DNS / 连接被拒 / TLS / 超时等网络级错误判"不可达"；延迟 =
 * 收到响应头的耗时（TTFB），超过 degradedThresholdMs 判 degraded。
 *
 * **分域不变量（本卡的核心）**：连通性检查**绝不触碰故障转移熔断器**
 * （cc-switch 原文纪律——"一个返回 403/401 的供应商在本检查里算'可达'，
 * 但它对真实流量是坏的。熔断器只由真实流量的成败驱动"）。结构保证 = 本
 * 模块零 fault-tolerance import（测试以源码 grep 机内化——T-P1-87 证伪
 * 同款），探测结果对象也不含任何可供熔断计数的字段。
 *
 * 检查日志带保留期（"不无限增长"验收）：logs/health.jsonl 专用族 +
 * pruneHealthLogs 按 testedAt 删旧行（tmp→rename 原子重写）。与 Q7 冷压缩
 * 分域记档：压缩白名单不扩 health 族——保留期只删不压。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ProviderConfig } from "./config.js";
import { redactSecrets } from "../core/index.js";

/** 健康状态闭集（cc-switch HealthStatus 的我方对位：unreachable 替代 failed——语义更准）。 */
export type HealthStatus = "operational" | "degraded" | "unreachable";

export interface HealthCheckResult {
  status: HealthStatus;
  /** reachable = true（operational/degraded）；unreachable = false。 */
  success: boolean;
  /** 展示消息（不含鉴权材料——fail-safe 措辞）。 */
  message: string;
  /** TTFB 毫秒（收到响应头；不可达时缺席）。 */
  responseTimeMs?: number;
  /** HTTP 状态码（可达时）。 */
  httpStatus?: number;
  testedAt: number;
}

export interface HealthCheckOptions {
  /** 单次探测超时毫秒（缺省 8000——cc-switch 旧真实请求 45s → 可达性 8s 的同款收紧）。 */
  timeoutMs?: number;
  /** 超时类失败的最大重试次数（缺省 1——cc-switch 同值；仅超时类重试）。 */
  maxRetries?: number;
  /** 降级阈值毫秒：可达但 TTFB 超过判定 degraded（缺省 6000——cc-switch 同值）。 */
  degradedThresholdMs?: number;
  /** fetch 注入（测试钉死剧本/时序）；缺省全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** now 注入（testedAt 可断言）；缺省 Date.now。 */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_DEGRADED_THRESHOLD_MS = 6_000;

/** 从不透明配置提取 baseUrl（health 自用的轻解析——健康探测要求 settingsConfig 携带 baseUrl）。 */
export function providerBaseUrl(config: ProviderConfig): string {
  let raw: unknown;
  try {
    raw = JSON.parse(config.settingsConfig);
  } catch {
    throw new Error("provider 配置不是合法 JSON（应被 parseProviderConfig 前置拦截）");
  }
  const baseUrl =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>)["baseUrl"] : undefined;
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error("健康探测要求配置携带非空 baseUrl");
  }
  return baseUrl.replace(/\/+$/, "");
}

/**
 * 可达性探测（仅对超时类失败重试——连接被拒/DNS 失败立即返回）。
 * 探测绝不触碰熔断器状态（分域不变量见文件头）。
 */
export async function probeProvider(
  input: { provider: string; baseUrl: string },
  opts: HealthCheckOptions = {},
): Promise<HealthCheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const degradedThresholdMs = opts.degradedThresholdMs ?? DEFAULT_DEGRADED_THRESHOLD_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const url = `${input.baseUrl}/`;

  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    const start = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: "GET",
        signal: controller.signal,
        // 探测只关心响应头；body 丢弃（ReadableStream 不消费即释放）
      });
      const ttfb = now() - start;
      const status: HealthStatus = ttfb >= degradedThresholdMs ? "degraded" : "operational";
      return {
        status,
        success: true,
        message:
          status === "degraded"
            ? `可达但响应慢（TTFB ${String(ttfb)}ms ≥ ${String(degradedThresholdMs)}ms）`
            : `可达（TTFB ${String(ttfb)}ms）`,
        responseTimeMs: ttfb,
        httpStatus: res.status,
        testedAt: now(),
      };
    } catch (e) {
      lastError = e;
      const isTimeout = e instanceof Error && e.name === "AbortError";
      // 仅超时/abort 类网络抖动值得重试；连接被拒、DNS 失败等立即返回
      if (!(isTimeout && attempt < maxRetries)) {
        return {
          status: "unreachable",
          success: false,
          message: isTimeout
            ? `探测超时（${String(timeoutMs)}ms，重试 ${String(attempt)} 次后仍超时）`
            : `网络级不可达：${e instanceof Error ? e.message : String(e)}`,
          testedAt: now(),
        };
      }
      void lastError;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** runHealthCheck：探测 + 结果落 logs/health.jsonl（JSON 行、密钥掩码）。 */
export async function runHealthCheck(
  config: ProviderConfig,
  opts: HealthCheckOptions & { logDir?: string } = {},
): Promise<HealthCheckResult> {
  const result = await probeProvider(
    { provider: config.name, baseUrl: providerBaseUrl(config) },
    opts,
  );
  const logDir = opts.logDir ?? "logs";
  const entry = redactSecrets(
    JSON.stringify({
      ts: new Date(result.testedAt).toISOString(),
      provider: config.name,
      status: result.status,
      success: result.success,
      message: result.message,
      ...(result.responseTimeMs !== undefined ? { responseTimeMs: result.responseTimeMs } : {}),
      ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
      testedAt: result.testedAt,
    }),
  );
  mkdirSync(logDir, { recursive: true });
  writeFileSync(`${logDir}/health.jsonl`, `${entry}\n`, { flag: "a" });
  return result;
}

export interface PruneReport {
  kept: number;
  removed: number;
}

/**
 * 保留期清理：按 testedAt 删旧行（"检查日志带保留期，不无限增长"）。
 * 原子性：tmp 文件写入 + rename 覆盖（中途失败旧文件不动）；无可删行时
 * 不重写（零 IO 面优化）。
 */
export function pruneHealthLogs(
  retainDays: number,
  opts: { logDir?: string; now?: () => number } = {},
): PruneReport {
  const logDir = opts.logDir ?? "logs";
  const filePath = `${logDir}/health.jsonl`;
  const now = opts.now ?? Date.now;
  const cutoff = now() - retainDays * 86_400_000;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { kept: 0, removed: 0 }; // 无日志文件 = 无可清理
  }
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  const keptLines: string[] = [];
  let removed = 0;
  for (const line of lines) {
    try {
      const testedAt = (JSON.parse(line) as { testedAt: number }).testedAt;
      if (testedAt >= cutoff) keptLines.push(line);
      else removed += 1;
    } catch {
      keptLines.push(line); // 非法行保留（不静默吞数据——保留期只按事实删）
    }
  }
  if (removed > 0) {
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, keptLines.length > 0 ? `${keptLines.join("\n")}\n` : "", "utf8");
    renameSync(tmp, filePath);
  }
  return { kept: keptLines.length, removed };
}
