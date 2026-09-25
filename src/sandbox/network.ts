/**
 * 网络策略（T-6-03 · D3）——网络是独立的一档：`NetworkPolicy = allow|deny`
 * 与路径守卫（C7/D1）、权限链（C 层）互不依赖、互不影响。形状取 codex
 * cli/doctor/network.rs 的"网络单列成档"（网络是 DoctorCheck 体系里的
 * 独立维度，可单独禁网而不禁进程）。
 *
 * ── P0 弱承诺（Q17 纪律：不假装已管住）──────────────────────────────
 * 本策略只拦**工具层**经由 guard.fetch 发起的请求。它不承诺管住：
 *   - 任意子进程的自发网络行为（bash 里 curl 的一切照旧发生）；
 *   - 模型接入层（J 层 provider 直连厂商）的流量；
 *   - guard.fetch 之外的网络入口（子进程、原生模块等）。
 * OS 级强制（WFP / 受限令牌）是 P1 的 D6/D16。完整声明见本目录 README
 * （人工确认清单 D3 行的核对对象）。
 *
 * 接线纪律（D4 同款）：网络能力经 guard.fetch 注入面拿，网络类工具不得
 * 直接使用全局 fetch——P0 无网络类工具，本模块先落策略与入口形状。
 */

export type NetworkPolicy = "allow" | "deny";

export const NETWORK_DENIED = "NETWORK_DENIED";

/** 拒绝时给出目标 URL（非敏感信息，供模型自纠）与政策名。 */
export class NetworkDeniedError extends Error {
  override readonly name = "NetworkDeniedError";
  readonly code = NETWORK_DENIED;
  constructor(
    readonly url: string,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = typeof fetch;

/** fetch 首参的结构化形状（Node 类型面不导出 RequestInfo 全局名，用联合替之）。 */
type FetchInput = Request | URL | string;

export interface NetworkGuardOptions {
  readonly policy: NetworkPolicy;
  /** 注入点（测试/替代实现）；缺省 globalThis.fetch。 */
  readonly fetchImpl?: FetchLike;
}

export interface NetworkGuard {
  readonly policy: NetworkPolicy;
  /** 工具层的唯一网络入口：形状与全局 fetch 相同（可直传给期望 fetch 的工具）。 */
  readonly fetch: FetchLike;
}

function targetUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** 网络守卫：deny 档在任何真实 I/O 之前拒绝（被拒请求不发生）；allow 档原样透传。 */
export function createNetworkGuard(options: NetworkGuardOptions): NetworkGuard {
  const fetchImpl = options.fetchImpl ?? fetch;
  const guardedFetch: FetchLike = async (input, init) => {
    const url = targetUrl(input);
    if (options.policy === "deny") {
      throw new NetworkDeniedError(
        url,
        `网络访问被拒绝（network policy = deny）：${url}。当前配置下工具不能发起网络请求；如确需访问，请让用户调整网络策略。`,
      );
    }
    return fetchImpl(input, init);
  };
  return { policy: options.policy, fetch: guardedFetch };
}
