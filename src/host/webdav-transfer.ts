/**
 * WebDAV 云同步（T-P3-174 批次 4——cc-switch·webdav.rs/webdav_sync.rs 行为
 * 锚，JS/TS host 侧自写 HTTP 原语零新依赖）：
 *
 * 传输层五原语（cc-switch reqwest 同构——Node fetch 的 method 接受扩展方法）：
 *  - PROPFIND Depth 0（连通性/存在性检查；207 也算成功）；
 *  - MKCOL 逐级建目录（405/409 歧义回退 PROPFIND 验证——"比 PROPFIND-first
 *    省一半往返"的同款乐观策略）；
 *  - PUT 上传 / GET 下载（404 = 语义值"远端为空"返回 null 而非报错）。
 *
 * 同步模型 = 整库快照替换（不做双向合并）：artifact = 配置包（export-
 * settings 产物——零凭据纪律天然成立：配置包永不携带 apiKey）+ manifest
 * （sha256/size/deviceName/createdAt）。上传序 = artifact 先、manifest 后
 * （manifest 未写成功则远端不算新快照——best-effort 原子性）；下载逐项校验
 * sha256+size。冲突策略 = 两段式询问（探测远端信息 → UI 确认"覆盖远端/
 * 恢复到本地"——cc-switch 的用户确认覆盖模型，"本地优先/远端优先"即用户
 * 的方向选择本身）。
 *
 * 凭据面：密码走凭据库（provider="webdav"——DPAPI 加密落盘，优于参考仓的
 * settings 明文）；url/username/remoteRoot 在 settings.webdav 段；同步状态
 * （lastSyncAt/lastError）由 op 层回写 settings 持久化。
 */

import { createHash } from "node:crypto";
import type { CredentialStore } from "../session/credentials.js";

/** 请求超时（探测与传输统一 60s——配置包体量小，300s 传输超时是 cc-switch 的 db.sql 面才需要）。 */
const DAV_TIMEOUT_MS = 60_000;

export interface WebdavConfig {
  url: string;
  username?: string;
  remoteRoot?: string;
  password?: string;
}

export interface WebdavArtifactMeta {
  sha256: string;
  size: number;
}

export interface WebdavManifest {
  format: string;
  version: number;
  deviceName: string;
  createdAt: string;
  artifacts: Record<string, WebdavArtifactMeta>;
}

export const WEBDAV_MANIFEST_FORMAT = "aegent-webdav-sync";
export const WEBDAV_PROTOCOL_VERSION = 1;

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function basicAuthHeader(config: WebdavConfig): Record<string, string> {
  if (config.username === undefined || config.username === "") return {};
  const token = Buffer.from(`${config.username}:${config.password ?? ""}`, "utf8").toString("base64");
  return { Authorization: `Basic ${token}` };
}

/** 错误文案（cc-switch webdav.rs 状态码映射同构——认证/权限/超时分型）。 */
export function describeDavStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "认证失败（401/403）——请检查 WebDAV 用户名、密码及目录读写权限";
  }
  if (status === 404) return "远端目录不存在（404）";
  if (status >= 500) return `WebDAV 服务端错误（${status}）`;
  return `WebDAV 请求失败（HTTP ${status}）`;
}

function urlJoin(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}/${path.replace(/^\/+/, "")}`;
}

/** 同步远端布局：`<url>/<remoteRoot>/aegent/v1/<name>`。 */
export function davObjectUrl(config: WebdavConfig, name: string): string {
  const root = config.remoteRoot !== undefined && config.remoteRoot !== "" ? config.remoteRoot : "aegent-sync";
  const segs = [...root.split("/").filter((s) => s !== ""), "aegent", `v${WEBDAV_PROTOCOL_VERSION}`, name];
  return urlJoin(config.url, segs.map(encodeURIComponent).join("/"));
}

async function davFetch(url: string, config: WebdavConfig, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...basicAuthHeader(config), ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(DAV_TIMEOUT_MS),
  });
}

/** PROPFIND Depth 0（存在性/连通性检查；2xx 与 207 都是"目录在"）。 */
export async function davPropfind(
  config: WebdavConfig,
  url: string,
): Promise<{ ok: true } | { ok: false; status?: number; message: string }> {
  try {
    const resp = await davFetch(url, config, { method: "PROPFIND", headers: { Depth: "0" } });
    if (resp.status === 404) return { ok: false, status: 404, message: "远端目录不存在（404）" };
    if (!resp.ok && resp.status !== 207) {
      return { ok: false, status: resp.status, message: describeDavStatus(resp.status) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** MKCOL 逐级建目录（405/409 回退 PROPFIND 验证——目录已在 = 成功）。 */
export async function davMkcolRecursive(config: WebdavConfig, objectUrl: string): Promise<{ ok: true } | { ok: false; message: string }> {
  // 逐级目录 URL（对象 URL 去掉最后一段文件名）
  const withoutFile = objectUrl.replace(/\/[^/]*$/, "");
  const base = config.url.endsWith("/") ? config.url.slice(0, -1) : config.url;
  const remotePath = withoutFile.startsWith(base) ? withoutFile.slice(base.length) : withoutFile;
  const segs = remotePath.split("/").filter((s) => s !== "");
  let current = base;
  for (const seg of segs) {
    current = `${current}/${seg}`;
    try {
      const resp = await davFetch(`${current}/`, config, { method: "MKCOL" });
      if (resp.ok || resp.status === 201) continue;
      if (resp.status === 405 || resp.status === 409 || (resp.status >= 300 && resp.status < 400)) {
        // 歧义：目录可能已存在——PROPFIND 验证
        const probe = await davPropfind(config, `${current}/`);
        if (probe.ok) continue;
        return { ok: false, message: `${describeDavStatus(resp.status)}（建目录失败：${current}）` };
      }
      return { ok: false, message: `${describeDavStatus(resp.status)}（建目录失败：${current}）` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: true };
}

/** GET 下载（404 = 远端为空 → null；Content-Length 超限 fail-closed）。 */
export async function davGet(
  config: WebdavConfig,
  url: string,
  maxBytes: number,
): Promise<{ ok: true; body: string } | { ok: true; body: null } | { ok: false; message: string }> {
  try {
    const resp = await davFetch(url, config, { method: "GET" });
    if (resp.status === 404) return { ok: true, body: null };
    if (!resp.ok) return { ok: false, message: describeDavStatus(resp.status) };
    const lenHeader = resp.headers.get("content-length");
    if (lenHeader !== null && Number(lenHeader) > maxBytes) {
      return { ok: false, message: `远端对象超过大小上限（${lenHeader} > ${maxBytes} 字节）——拒绝下载` };
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return { ok: false, message: `远端对象超过大小上限（${buf.byteLength} > ${maxBytes} 字节）——拒绝下载` };
    }
    return { ok: true, body: Buffer.from(buf).toString("utf8") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** PUT 上传（2xx = 成功）。 */
export async function davPut(
  config: WebdavConfig,
  url: string,
  body: string,
): Promise<{ ok: true } | { ok: false; status?: number; message: string }> {
  try {
    const resp = await davFetch(url, config, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
    if (!resp.ok) return { ok: false, status: resp.status, message: describeDavStatus(resp.status) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** manifest 解析（坏 manifest fail-closed——format/version 不符拒绝）。 */
export function parseWebdavManifest(raw: string): { ok: true; manifest: WebdavManifest } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "远端 manifest 不是合法 JSON——同步数据损坏" };
  }
  const m = parsed as Partial<WebdavManifest> | null;
  if (m === null || typeof m !== "object" || m.format !== WEBDAV_MANIFEST_FORMAT) {
    return { ok: false, message: "远端 manifest 格式不符（非 aegent 同步数据）" };
  }
  if (m.version !== WEBDAV_PROTOCOL_VERSION) {
    return { ok: false, message: `同步协议版本不符（远端 v${String(m.version)}，本端 v${WEBDAV_PROTOCOL_VERSION}）` };
  }
  if (typeof m.deviceName !== "string" || typeof m.createdAt !== "string" || m.artifacts === null || typeof m.artifacts !== "object") {
    return { ok: false, message: "远端 manifest 缺字段（deviceName/createdAt/artifacts）" };
  }
  return { ok: true, manifest: parsed as WebdavManifest };
}

// ---------------------------------------------------------------------------
// 同步编排（op 层消费面）
// ---------------------------------------------------------------------------

export interface WebdavDeps {
  config: WebdavConfig;
  credentials: CredentialStore;
  /** 本地配置包文本（export-settings 产物——调用方在 getSettings 后生成）。 */
  buildLocalPackage: () => Promise<string>;
  /** 应用远端配置包文本（导入面复用——resolveImportedPackage 在 gateway 层）。 */
  applyRemotePackage: (packageText: string) => Promise<void>;
  /** 设备名（缺省 os.hostname()——测试可注入）。 */
  deviceName?: string;
  now?: () => number;
}

export const WEBDAV_MAX_OBJECT_BYTES = 8 * 1024 * 1024; // 配置包 8MB 上限（3MB 背景图域已证余量充足）

async function loadPassword(deps: WebdavDeps): Promise<WebdavConfig> {
  const password = await deps.credentials.getKey("webdav");
  return { ...deps.config, ...(password !== undefined ? { password } : {}) };
}

/** 连通性测试：PROPFIND 同步根（404 也算"通"——目录可自动创建）。 */
export async function webdavTest(deps: WebdavDeps): Promise<{ ok: boolean; message: string }> {
  const config = await loadPassword(deps);
  const probe = await davPropfind(config, davObjectUrl(config, "manifest.json").replace(/\/[^/]*$/, "/"));
  return probe.ok
    ? { ok: true, message: "连接成功" }
    : probe.status === 404
      ? { ok: true, message: "连接成功（远端目录尚不存在——首次同步自动创建）" }
      : { ok: false, message: probe.message };
}

/** 远端探测（两段式第一步——UI 确认框的数据源）。 */
export async function webdavFetchRemoteInfo(
  deps: WebdavDeps,
): Promise<{ ok: true; remote: WebdavManifest | null } | { ok: false; message: string }> {
  const config = await loadPassword(deps);
  const got = await davGet(config, davObjectUrl(config, "manifest.json"), WEBDAV_MAX_OBJECT_BYTES);
  if (!got.ok) return { ok: false, message: got.message };
  if (got.body === null) return { ok: true, remote: null };
  const parsed = parseWebdavManifest(got.body);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  return { ok: true, remote: parsed.manifest };
}

/** 上传（本地优先——覆盖远端）。artifact 先、manifest 后。 */
async function webdavUpload(deps: WebdavDeps, config: WebdavConfig): Promise<{ ok: true; manifest: WebdavManifest } | { ok: false; message: string }> {
  const packageText = await deps.buildLocalPackage();
  const artifactMeta: WebdavArtifactMeta = { sha256: sha256Hex(packageText), size: Buffer.byteLength(packageText, "utf8") };
  const mkcol = await davMkcolRecursive(config, davObjectUrl(config, "manifest.json"));
  if (!mkcol.ok) return { ok: false, message: mkcol.message };
  const putArtifact = await davPut(config, davObjectUrl(config, "settings.json"), packageText);
  if (!putArtifact.ok) return { ok: false, message: `上传配置包失败：${putArtifact.message}` };
  const manifest: WebdavManifest = {
    format: WEBDAV_MANIFEST_FORMAT,
    version: WEBDAV_PROTOCOL_VERSION,
    deviceName: deps.deviceName ?? (await import("node:os")).hostname(),
    createdAt: new Date((deps.now ?? Date.now)()).toISOString(),
    artifacts: { "settings.json": artifactMeta },
  };
  const putManifest = await davPut(config, davObjectUrl(config, "manifest.json"), JSON.stringify(manifest, null, 2));
  if (!putManifest.ok) return { ok: false, message: `上传 manifest 失败：${putManifest.message}` };
  return { ok: true, manifest };
}

/** 下载（远端优先——恢复到本地）：校验 sha256+size 后走应用面。 */
async function webdavDownload(deps: WebdavDeps, config: WebdavConfig, manifest: WebdavManifest): Promise<{ ok: true } | { ok: false; message: string }> {
  const meta = manifest.artifacts["settings.json"];
  if (meta === undefined) return { ok: false, message: "远端 manifest 不含 settings.json artifact——同步数据不完整" };
  const got = await davGet(config, davObjectUrl(config, "settings.json"), WEBDAV_MAX_OBJECT_BYTES);
  if (!got.ok) return { ok: false, message: got.message };
  if (got.body === null) return { ok: false, message: "远端配置包不存在（manifest 在而 artifact 缺）——同步数据不完整" };
  if (got.body.length !== meta.size || sha256Hex(got.body) !== meta.sha256) {
    return { ok: false, message: "远端配置包校验失败（sha256/size 不符）——传输损坏，拒绝应用" };
  }
  await deps.applyRemotePackage(got.body);
  return { ok: true };
}

export type WebdavSyncAction = "up" | "down";
export type WebdavSyncOutcome =
  | { ok: true; message: string; manifest: WebdavManifest }
  | { ok: false; message: string };

/** 立即同步（两段式第二步——UI 确认后执行；状态回写由 op 层做）。 */
export async function webdavSyncNow(deps: WebdavDeps, action: WebdavSyncAction, remote: WebdavManifest | null): Promise<WebdavSyncOutcome> {
  const config = await loadPassword(deps);
  if (action === "up") {
    const result = await webdavUpload(deps, config);
    return result.ok
      ? { ok: true, message: `已上传到云端（${result.manifest.createdAt}）`, manifest: result.manifest }
      : result;
  }
  if (remote === null) {
    return { ok: false, message: "远端没有可下载的同步数据（未同步过）" };
  }
  const result = await webdavDownload(deps, config, remote);
  return result.ok
    ? { ok: true, message: `已从云端恢复（${remote.deviceName} · ${remote.createdAt}）`, manifest: remote }
    : result;
}
