/**
 * 端点安全护栏（T-P3-149 C2）——STT/TTS 端点由用户自配，而 settings 可经
 * 导入面（transfer 深链）被第三方内容写入，存在被注入恶意 URL 后借 host
 * 出网面探测/投递的攻击面。护栏取舍（与 qwen voice-transcriber 的差异）：
 * 我方是本地优先应用，私网端点（局域网 whisper 网关 / NAS 自建服务）是
 * **合法主流场景**，故只硬拦"纯攻击面"——云元数据地址（169.254.0.0/16、
 * 100.100.100.200、fd00:ec2::254）与链路本地 IPv6；协议闭集 http(s) +
 * 凭据内嵌拒绝；DNS 解析复核（rebinding 第一道——解析结果落元数据段即拦）。
 * 错误面零回显原始 URL 细节（防注入者借报错探测）。
 */

import { lookup } from "node:dns/promises";

export class EndpointBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointBlockedError";
  }
}

/** 云厂商元数据端点（SSRF 头号目标——借它偷宿主凭据）。 */
const BLOCKED_IPV4S = new Set(["169.254.169.254", "100.100.100.200"]);

/** 元数据/链路本地段（IPv4 169.254/16 全段 + IPv6 链路本地 fe80::/10）。 */
function isBlockedAddress(ip: string): boolean {
  if (BLOCKED_IPV4S.has(ip)) return true;
  if (ip.startsWith("169.254.")) return true;
  const lower = ip.toLowerCase();
  if (lower === "::1") return false; // 环回 = 本地服务合法形态
  if (lower.startsWith("fe80:") || lower.startsWith("fd00:ec2:")) return true;
  return false;
}

function isIpLiteral(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(":");
}

/** DNS 解析注入面（测试用——真实解析器默认走 node:dns lookup all）。 */
export type LookupFn = (host: string, options: { all: true }) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (host, options) => lookup(host, options);

/**
 * 校验端点 URL 可用于出网请求；不合法即抛 EndpointBlockedError。
 * code 由调用方给定（STT_ENDPOINT_BLOCKED / TTS_ENDPOINT_BLOCKED——错误信封
 * 沿用各自的类型化错误族）。lookupImpl 可注入（测试面——DNS 复核用例不依赖
 * 真实解析器）。
 */
export async function assertEndpointAllowed(
  rawUrl: string,
  opts: {
    code: string;
    lookupImpl?: LookupFn;
  },
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw blocked(opts.code, "端点不是合法 URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw blocked(opts.code, "端点协议只允许 http(s)");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw blocked(opts.code, "端点不允许内嵌凭据（key 走凭据库）");
  }
  const host = parsed.hostname;
  if (isIpLiteral(host)) {
    if (isBlockedAddress(host)) throw blocked(opts.code, "端点指向被禁地址段");
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return;
  // 域名：DNS 解析复核（解析结果全是字面检查——防 rebinding 指向元数据段）
  try {
    const records = await (opts.lookupImpl ?? defaultLookup)(host, { all: true });
    for (const record of records) {
      if (isBlockedAddress(record.address)) {
        throw blocked(opts.code, "端点域名解析到被禁地址段");
      }
    }
  } catch (e) {
    if (e instanceof EndpointBlockedError) throw e;
    // 解析失败放行——让后续 fetch 产生自己的网络错误（错误归一化到调用方）
  }
}

function blocked(code: string, message: string): EndpointBlockedError {
  const error = new EndpointBlockedError(message);
  (error as unknown as { code: string }).code = code;
  return error;
}
