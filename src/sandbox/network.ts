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

/**
 * C37 IMDS/带外回调主机黑名单命中（T-P1-83）——**独立于 allow/deny 档**：
 * 用户放开网络 ≠ 可达云元数据（SSRF 语义）。独立错误码让模型/审计面
 * 区分"策略禁网"与"目标命中防护清单"。
 */
export const NETWORK_IMDS_DENIED = "NETWORK_IMDS_DENIED";

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

export class NetworkImdsDeniedError extends Error {
  override readonly name = "NetworkImdsDeniedError";
  readonly code = NETWORK_IMDS_DENIED;
  constructor(
    readonly url: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * IMDS 与带外回调主机闭集（C37，qwen·classifier-prompts/system-prompt.ts:56
 * 清单对应物）：AWS IMDS（IPv4 + IPv6 字面量）、GCP、阿里云 + 环回/链路
 * 本地段。collaborator 式回调服务（request-bin 等）是无限开放集合，无法
 * 闭集枚举——防护面承诺只覆盖本清单与链路本地段（已知边界，卡内记档）。
 */
export const IMDS_HOSTS = [
  "169.254.169.254",
  "fd00:ec2::254",
  "metadata.google.internal",
  "100.100.100.200",
] as const;

/** IPv4 链路本地网段前缀（169.254.0.0/16——qwen network-policy.ts BlockList 对应物）。 */
const LINK_LOCAL_V4_PREFIX = "169.254.";

/**
 * IMDS 黑名单判定：host 小写比对 + IPv6 方括号形态 + 链路本地字面前缀。
 * 与档位无关——allow 档同样拦截（SSRF 语义）。
 */
export function isImdsTarget(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if ((IMDS_HOSTS as readonly string[]).includes(host)) return true;
  if (host.startsWith(LINK_LOCAL_V4_PREFIX)) return true;
  return false;
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

/** 重定向自管跟随上限（webfetch 同值——防循环）。 */
const MAX_GUARD_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** C37 补口（核对 B2）：守卫默认接管重定向跟随——此前透传 fetch（默认
 * redirect:"follow"），30x 跳转目标不再复检 IMDS，SSRF 防护可被可控重定向
 * 绕过。自管循环每跳重过黑名单；显式传 redirect:"manual" 的调用方
 * （webfetch 自管同源跳转且每跳重过本守卫）原样透传，行为不变。
 * 跟随请求一律 GET 无 body（工具面全为 GET；301/302/303 的 GET 化即
 * 浏览器语义，307/308 的方法保留场景工具面不存在——记档）。 */
async function guardedFollow(
  fetchImpl: FetchLike,
  url: string,
  input: FetchInput,
  init: RequestInit | undefined,
): Promise<Response> {
  let current = url;
  let currentInput: FetchInput = input;
  for (let hop = 0; hop <= MAX_GUARD_REDIRECTS; hop++) {
    const response = await fetchImpl(currentInput, {
      ...(init ?? {}),
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (location === null || location === "") return response;
    const next = new URL(location, current);
    checkImds(next.href, next.hostname); // 每跳复检（本修复的核心）
    if (hop === MAX_GUARD_REDIRECTS) return response; // 超限：返回最后 3xx（调用方可见 location）
    current = next.href;
    currentInput = current; // 跟随请求一律 GET（body 不重发——见头注释）
    init = { ...(init ?? {}), method: "GET", body: undefined };
  }
  return fetchImpl(current, init); // 不可达（循环内 return），类型满足
}

/** IMDS 黑名单判定（allow 档入口与每跳共用）——命中/不可解析都 fail-closed。 */
function checkImds(url: string, hostname: string | undefined): void {
  if (hostname === undefined || isImdsTarget(hostname)) {
    throw new NetworkImdsDeniedError(
      url,
      hostname === undefined
        ? `目标 URL 无法解析（fail-closed）：${url}。C37 网络侧防护要求目标可验证后才可发起请求。`
        : `目标命中 IMDS/带外回调主机防护清单（C37）：${url}。云实例元数据端点不允许工具访问（防 SSRF 式外带）。`,
    );
  }
}

/** 网络守卫：deny 档在任何真实 I/O 之前拒绝（被拒请求不发生）；allow 档先过
 * C37 IMDS 黑名单面（独立于档位——SSRF 防护），命中即拒、URL 无法解析
 * fail-closed，通过才透传；默认接管重定向跟随并逐跳复检（B2 补口）。 */
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
    // C37 IMDS 黑名单面：独立于 allow/deny 档（放开网络 ≠ 可达元数据）
    let hostname: string | undefined;
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = undefined;
    }
    checkImds(url, hostname);
    if (init?.redirect === "manual") {
      return fetchImpl(input, init); // 自管方（webfetch）——每跳重过本守卫
    }
    return guardedFollow(fetchImpl, url, input, init);
  };
  return { policy: options.policy, fetch: guardedFetch };
}
