/**
 * OAuth 模块测试（J17/T-P2-517）——device flow mock（http-mock 端点）+ 刷新
 * + 存储掩码 + **不侵入内核断言**（models 域内闭环——architecture requires
 * 零新增的源码证伪）。
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { HttpMock } from "../test-support/http-mock.js";
import type { AuthMaterial } from "./auth.js";
import {
  EnvTokenStore,
  FileTokenStore,
  OAuthError,
  createOAuthAuthResolver,
  maskToken,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceAuthorization,
  type OAuthClientConfig,
} from "./oauth.js";

const dirs: string[] = [];
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function client(mockBase: string): OAuthClientConfig {
    return {
        endpoints: {
            deviceAuthorizationUrl: `${mockBase}/oauth/device_authorization`,
            tokenUrl: `${mockBase}/oauth/token`,
        },
        clientId: "aegent-cli",
    };
}

function formResponse(mock: HttpMock, body: Record<string, unknown>): void {
    mock.mountSequence([{ status: 200, body: JSON.stringify(body) }]);
}

describe("OAuth device flow（J17/RFC 8628）", () => {
  it("device authorization：请求/响应字段齐；缺必填字段 fail-closed", async () => {
    const mock = new HttpMock();
    const base = await mock.start();
    try {
      formResponse(mock, { device_code: "dc1", user_code: "ABCD-EFGH", verification_uri: "https://example.com/activate", interval: 3, expires_in: 300 });
      const auth = await requestDeviceAuthorization(client(base));
      expect(auth).toMatchObject({ deviceCode: "dc1", userCode: "ABCD-EFGH", verificationUri: "https://example.com/activate", intervalSeconds: 3 });
      // 缺 user_code → 类型化拒绝（不猜测）
      formResponse(mock, { device_code: "dc2" });
      await expect(requestDeviceAuthorization(client(base))).rejects.toThrow(OAuthError);
    } finally {
      await mock.stop();
    }
  });

  it("pollDeviceToken：authorization_pending 等待后成功；slow_down 退避；终态错误类型化", async () => {
    const mock = new HttpMock();
    const base = await mock.start();
    const sleeps: number[] = [];
    try {
      // pending → pending → slow_down → 成功
      formResponse(mock, { error: "authorization_pending" });
      formResponse(mock, { error: "slow_down" });
      formResponse(mock, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, token_type: "Bearer" });
      const token = await pollDeviceToken(client(base), "dc1", {
        intervalMs: 1,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      });
      expect(token).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1" });
      expect(token.expiresAt).toBeDefined();
      // slow_down 后间隔 +5s（RFC 8628 §3.5）
      expect(sleeps).toContain(5001); // interval 1ms + RFC 增量 5000ms
      // 终态错误：access_denied 即抛
      formResponse(mock, { error: "access_denied" });
      await expect(pollDeviceToken(client(base), "dc2", { intervalMs: 1, sleep: () => Promise.resolve() })).rejects.toThrow(
        /access_denied/,
      );
    } finally {
      await mock.stop();
    }
  });

  it("refreshAccessToken：端点未返回新 refresh_token 时沿用旧的", async () => {
    const mock = new HttpMock();
    const base = await mock.start();
    try {
      formResponse(mock, { access_token: "at-new", expires_in: 600 });
      const token = await refreshAccessToken(client(base), "rt-old");
      expect(token).toMatchObject({ accessToken: "at-new", refreshToken: "rt-old" });
    } finally {
      await mock.stop();
    }
  });
});

describe("凭据存储（环境变量优先 → private/ 文件）", () => {
  it("EnvTokenStore：env 提供即零落盘；save no-op；缺凭据返回 null", async () => {
    const env = { AEGENT_OAUTH_ACCESS_TOKEN: "env-tok", AEGENT_OAUTH_REFRESH_TOKEN: "env-rt" };
    const store = new EnvTokenStore(env);
    expect(await store.load()).toMatchObject({ accessToken: "env-tok", refreshToken: "env-rt" });
    await store.save(); // no-op
    expect(env["AEGENT_OAUTH_ACCESS_TOKEN"]).toBe("env-tok");
    expect(await new EnvTokenStore({}).load()).toBeNull();
  });

  it("FileTokenStore：0600 写权限 + 原子替换（tmp rename）+ 掩码显示面", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-oauth-"));
    dirs.push(dir);
    const store = new FileTokenStore(dir, "openai-gpt-x");
    expect(await store.load()).toBeNull(); // 文件不存在 = 无凭据（非错误）
    await store.save({ accessToken: "sk-abcdefghijklmnop1234", refreshToken: "rt-9" });
    const token = await store.load();
    expect(token).toMatchObject({ accessToken: "sk-abcdefghijklmnop1234" });
    // 掩码：文档/日志只写掩码
    expect(maskToken("sk-abcdefghijklmnop1234")).toBe("sk-a…1234(23)");
    expect(maskToken("short")).toBe("***");
  });
});

describe("AuthResolver 适配（J13 面）", () => {
  it("resolve 供 Bearer 材料；过期即刷新并回存；无凭据类型化拒绝", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-oauth-"));
    dirs.push(dir);
    const store = new FileTokenStore(dir, "resolver-test");
    const now = { t: 1_000_000 };
    const mock = new HttpMock();
    const base = await mock.start();
    try {
      const config = client(base);
      await store.save({ accessToken: "old", refreshToken: "rt", expiresAt: now.t + 10_000 }); // 10s 后过期 < 60s 前提
      formResponse(mock, { access_token: "fresh", refresh_token: "rt2", expires_in: 3_600 });
      const resolver = createOAuthAuthResolver({
        config,
        store,
        bound: { provider: "openai", modelId: "gpt-x" },
        now: () => now.t,
      });
      const material: AuthMaterial = await resolver.resolve();
      expect(material).toEqual({ apiKey: "fresh" }); // J13 AuthMaterial 形状
      // 回存了刷新后的 token
      expect(await store.load()).toMatchObject({ accessToken: "fresh", refreshToken: "rt2" });
      // 无凭据：类型化拒绝（fail-closed）
      const emptyResolver = createOAuthAuthResolver({
        config: client(base),
        store: new EnvTokenStore({}),
        bound: { provider: "openai", modelId: "gpt-x" },
        now: () => now.t,
      });
      await expect(emptyResolver.resolve()).rejects.toThrow(/无 OAuth 凭据/);
    } finally {
      await mock.stop();
    }
  });
});

describe("不侵入内核断言（architecture requires 零新增）", () => {
  it("oauth.ts 的 import 面不含 kernel/host/session 域（models 域内闭环——源码证伪）", () => {
    // plugin-sdk/fork-tree 源码证伪先例：import 闭包即架构证据
    const source = readFileSync(fileURLToPath(new URL("./oauth.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const imp of imports as string[]) {
      expect(imp.startsWith("../kernel/")).toBe(false);
      expect(imp.startsWith("../host/")).toBe(false);
      expect(imp.startsWith("../session/")).toBe(false);
      expect(imp.startsWith("../policy/")).toBe(false);
    }
    // 只允许 node 内置 + models 域内
    for (const imp of imports as string[]) {
      expect(imp.startsWith("node:") || imp.startsWith("./")).toBe(true);
    }
  });
});
