/**
 * OAuth 独立模块（J17/T-P2-517）——device flow + token 刷新 + 凭据存储，
 * 不侵入内核（models 域内闭环：import 面只有 node 内置与本域 auth/identity
 * ——源码证伪断言在测试，architecture requires 零新增）。
 *
 * 行为锚 kimi·packages/oauth（🔴 行为四件：独立模块 / device flow / 刷新 /
 * 安全存储；其厂商端点与包结构不取——端点由构造参数给出，known-diffs.md 记档）。
 *
 * Device flow 按 RFC 8628 语义（requestDeviceAuthorization → 用户打开
 * verification_uri → pollDeviceToken 轮询；authorization_pending 继续等、
 * slow_down 按规范 +5s）。凭据存储环境变量优先（卡面定形）：env 提供 token
 * 时不落任何文件；文件存储由调用方给出 private/ 路径（gitignore 域——全局
 * 约束 3：文档只写掩码）。authResolverFromTokens 把 token 对适配到 J13 的
 * AuthResolver 接口（provider 每请求前 resolve，过期即刷新）。
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

import type { AuthMaterial, AuthResolver } from "./auth.js";
import type { ModelIdentity } from "./identity.js";

// ---------------------------------------------------------------------------
// 类型与错误
// ---------------------------------------------------------------------------

/** device authorization 响应（RFC 8628 §3.2）。 */
export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** 可选的完整验证 URL（含预填码）。 */
  verificationUriComplete?: string;
  /** 轮询间隔（秒，RFC 缺省 5）。 */
  intervalSeconds: number;
  expiresIn: number;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  /** 过期时刻（epoch ms）——now + expires_in；端点未给 expires_in 时缺席。 */
  expiresAt?: number;
  tokenType?: string;
}

/** OAuth 流程错误（端点 4xx/协议错误——非网络故障）。 */
export class OAuthError extends Error {
  override readonly name = "OAuthError";
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface OAuthEndpoints {
  /** device authorization 端点（表单 POST——由配置给出，不硬编码厂商端点）。 */
  deviceAuthorizationUrl: string;
  /** token 端点（表单 POST）。 */
  tokenUrl: string;
}

export interface OAuthClientConfig {
  endpoints: OAuthEndpoints;
  clientId: string;
  /** 请求实现注入（测试走 http-mock；缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// 表单 POST helper
// ---------------------------------------------------------------------------

async function postForm(
  url: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  } catch (e) {
    throw new OAuthError(`OAuth 请求网络失败：${e instanceof Error ? e.message : String(e)}`, "network_error");
  }
  const text = await res.text();
  if (res.status !== 200) {
    throw new OAuthError(`OAuth 端点 HTTP ${res.status}：${text.slice(0, 200)}`, "http_error");
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new OAuthError("OAuth 端点响应不是 JSON", "bad_response");
  }
}

// ---------------------------------------------------------------------------
// Device flow（RFC 8628）
// ---------------------------------------------------------------------------

export async function requestDeviceAuthorization(
  config: OAuthClientConfig,
): Promise<DeviceAuthorization> {
  const data = await postForm(
    config.endpoints.deviceAuthorizationUrl,
    { client_id: config.clientId },
    config.fetchImpl ?? fetch,
  );
  // 必填字段校验（fail-closed——缺字段不猜测）
  const deviceCode = data["device_code"];
  const userCode = data["user_code"];
  const verificationUri = data["verification_uri"];
  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUri !== "string") {
    throw new OAuthError("device authorization 响应缺必填字段", "bad_response");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(typeof data["verification_uri_complete"] === "string"
      ? { verificationUriComplete: data["verification_uri_complete"] as string }
      : {}),
    intervalSeconds: typeof data["interval"] === "number" ? data["interval"] : 5,
    expiresIn: typeof data["expires_in"] === "number" ? data["expires_in"] : 600,
  };
}

const SLOW_DOWN_DELTA_MS = 5_000; // RFC 8628 §3.5：slow_down 增量

export interface PollOptions {
  maxAttempts?: number;
  /** 轮询间隔（毫秒）——缺省取 device authorization 给的 interval。 */
  intervalMs?: number;
  /** 休眠实现注入（测试零时延）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 时钟注入。 */
  now?: () => number;
}

/** 轮询 token 端点直到授权完成（authorization_pending 等待 / slow_down 退避）。 */
export async function pollDeviceToken(
  config: OAuthClientConfig,
  deviceCode: string,
  options: PollOptions = {},
): Promise<OAuthToken> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  let intervalMs = options.intervalMs ?? 5_000;
  const maxAttempts = options.maxAttempts ?? 60;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const data = await postForm(
      config.endpoints.tokenUrl,
      { client_id: config.clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
      fetchImpl,
    );
    const error = data["error"];
    if (error === "authorization_pending") {
      await sleep(intervalMs);
      continue;
    }
    if (error === "slow_down") {
      intervalMs += SLOW_DOWN_DELTA_MS;
      await sleep(intervalMs);
      continue;
    }
    if (typeof error === "string") {
      throw new OAuthError(`device flow 终态错误：${error}`, error);
    }
    const accessToken = data["access_token"];
    if (typeof accessToken !== "string") {
      throw new OAuthError("token 响应缺 access_token", "bad_response");
    }
    const expiresIn = typeof data["expires_in"] === "number" ? data["expires_in"] : undefined;
    return {
      accessToken,
      ...(typeof data["refresh_token"] === "string" ? { refreshToken: data["refresh_token"] as string } : {}),
      ...(expiresIn !== undefined ? { expiresAt: now() + expiresIn * 1_000 } : {}),
      ...(typeof data["token_type"] === "string" ? { tokenType: data["token_type"] as string } : {}),
    };
  }
  throw new OAuthError(`device flow 轮询超过最大尝试次数（${maxAttempts}）`, "exhausted");
}

// ---------------------------------------------------------------------------
// Token 刷新
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  config: OAuthClientConfig,
  refreshToken: string,
  options: { now?: () => number } = {},
): Promise<OAuthToken> {
  const now = options.now ?? Date.now;
  const data = await postForm(
    config.endpoints.tokenUrl,
    { client_id: config.clientId, refresh_token: refreshToken, grant_type: "refresh_token" },
    config.fetchImpl ?? fetch,
  );
  const error = data["error"];
  if (typeof error === "string") {
    throw new OAuthError(`刷新终态错误：${error}`, error);
  }
  const accessToken = data["access_token"];
  if (typeof accessToken !== "string") {
    throw new OAuthError("刷新响应缺 access_token", "bad_response");
  }
  const expiresIn = typeof data["expires_in"] === "number" ? data["expires_in"] : undefined;
  return {
    accessToken,
    // 端点未返回新 refresh_token 时沿用旧的（RFC 8628 §3.4 语义）
    ...(typeof data["refresh_token"] === "string" ? { refreshToken: data["refresh_token"] as string } : { refreshToken }),
    ...(expiresIn !== undefined ? { expiresAt: now() + expiresIn * 1_000 } : {}),
    ...(typeof data["token_type"] === "string" ? { tokenType: data["token_type"] as string } : {}),
  };
}

// ---------------------------------------------------------------------------
// 凭据存储（环境变量优先 → private/ 文件）
// ---------------------------------------------------------------------------

/** 掩码显示面（文档/日志只写掩码——全局约束 3）。 */
export function maskToken(token: string): string {
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}(${token.length})`;
}

export interface OAuthTokenStore {
  load(): Promise<OAuthToken | null>;
  save(token: OAuthToken): Promise<void>;
}

/** 环境变量存储（优先面——token 只在进程内，零落盘）。 */
export class EnvTokenStore implements OAuthTokenStore {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly accessTokenVar = "AEGENT_OAUTH_ACCESS_TOKEN",
    private readonly refreshTokenVar = "AEGENT_OAUTH_REFRESH_TOKEN",
  ) {}
  async load(): Promise<OAuthToken | null> {
    const accessToken = this.env[this.accessTokenVar];
    if (accessToken === undefined || accessToken === "") return null;
    return {
      accessToken,
      ...(this.env[this.refreshTokenVar] !== undefined ? { refreshToken: this.env[this.refreshTokenVar] } : {}),
    };
  }
  async save(): Promise<void> {
    // env 面无写回——save 是 no-op（凭据轮换由用户改环境变量）
  }
}

/** 文件存储（调用方给 private/ 路径——gitignore 域；0600 写权限 + tmp 原子替换）。 */
export class FileTokenStore implements OAuthTokenStore {
  private readonly filePath: string;
  constructor(
    rootDir: string,
    private readonly name: string,
  ) {
    this.filePath = path.join(rootDir, `${name.replace(/[^\w.-]/g, "_")}.json`);
  }
  async load(): Promise<OAuthToken | null> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch {
      return null; // 文件不存在 = 无凭据（非错误）
    }
    return JSON.parse(text) as OAuthToken;
  }
  async save(token: OAuthToken): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(token), { mode: 0o600 });
    await rename(tmp, this.filePath);
  }
  get path(): string {
    return this.filePath;
  }
}

// ---------------------------------------------------------------------------
// AuthResolver 适配（J13 面——provider 每请求前 resolve，过期即刷新）
// ---------------------------------------------------------------------------

export interface OAuthAuthResolverOptions {
  config: OAuthClientConfig;
  store: OAuthTokenStore;
  /** 绑定的模型身份（J13/J8 纪律：刷新试图换身份即类型化拒绝——本实现绑定固定，防御面在位）。 */
  bound: ModelIdentity;
  /** 刷新前提前量（ms）——expiresAt 临近即刷新，缺省 60s。 */
  refreshLeadMs?: number;
  now?: () => number;
}

/**
 * OAuth → AuthResolver（auth.ts 接口的 OAuth 实现）：每次 resolve 出
 * Bearer 材料；过期（含提前量）且可刷新即刷新并回存。assertAuthIdentityUnchanged
 * 的对应面：OAuth 材料永不变更绑定身份（resolve 只供材料）——防御面保留。
 */
export function createOAuthAuthResolver(options: OAuthAuthResolverOptions): AuthResolver {
  const { config, store, bound } = options;
  const lead = options.refreshLeadMs ?? 60_000;
  const now = options.now ?? Date.now;
  return {
    async resolve(): Promise<AuthMaterial> {
      let token = await store.load();
      if (token === null) {
        throw new OAuthError("无 OAuth 凭据——先完成 device flow 或配置环境变量", "no_credentials");
      }
      const expired = token.expiresAt !== undefined && token.expiresAt - now() < lead;
      if (expired && token.refreshToken !== undefined) {
        token = await refreshAccessToken(config, token.refreshToken, { now });
        await store.save(token);
      }
      // J13/J8 防御面的对应面：OAuth 材料永不变更绑定身份——refreshAccessToken
      // 只返回 token 对（无身份字段），resolve 只供材料（结构上不可换身份）。
      return { apiKey: token.accessToken };
    },
  };
}
