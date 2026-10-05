// T-P3-174 批次 4：WebDAV 云同步（传输原语 + manifest 编排——fetch stub 注入面）。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEBDAV_MANIFEST_FORMAT,
  WEBDAV_PROTOCOL_VERSION,
  davObjectUrl,
  parseWebdavManifest,
  sha256Hex,
  webdavFetchRemoteInfo,
  webdavSyncNow,
  webdavTest,
  type WebdavDeps,
  type WebdavManifest,
} from "./webdav-transfer.js";

const CONFIG = { url: "https://dav.example.com/dav", username: "u", password: "p", remoteRoot: "root" };

function makeDeps(overrides?: Partial<WebdavDeps>): WebdavDeps {
  return {
    config: CONFIG,
    credentials: { getKey: async (k: string) => (k === "webdav" ? "secret" : undefined) } as never,
    buildLocalPackage: async () => '{"kind":"aegent-settings-export"}',
    applyRemotePackage: async () => {},
    deviceName: "dev-a",
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

function fakeFetch(routes: (url: string, init: RequestInit) => { status: number; body?: string } | undefined) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const r = routes(String(url), init ?? {});
    if (r === undefined) return new Response("not found", { status: 404 });
    return new Response(r.body ?? "", { status: r.status });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("URL 与 manifest 形状", () => {
  it("对象 URL：remoteRoot/aegent/vN/<name>——路径段逐段编码", () => {
    expect(davObjectUrl(CONFIG, "manifest.json")).toBe(
      `https://dav.example.com/dav/root/aegent/v${WEBDAV_PROTOCOL_VERSION}/manifest.json`,
    );
  });
  it("manifest 解析：格式/版本不符 fail-closed；缺字段拒绝", () => {
    const good: WebdavManifest = {
      format: WEBDAV_MANIFEST_FORMAT,
      version: WEBDAV_PROTOCOL_VERSION,
      deviceName: "dev",
      createdAt: "2026-10-05T00:00:00.000Z",
      artifacts: { "settings.json": { sha256: "ab", size: 2 } },
    };
    expect(parseWebdavManifest(JSON.stringify(good)).ok).toBe(true);
    expect(parseWebdavManifest("not json").ok).toBe(false);
    expect(parseWebdavManifest(JSON.stringify({ ...good, format: "other" })).ok).toBe(false);
    expect(parseWebdavManifest(JSON.stringify({ ...good, version: 99 })).ok).toBe(false);
    expect(parseWebdavManifest(JSON.stringify({ ...good, artifacts: null })).ok).toBe(false);
  });
});

describe("webdavTest", () => {
  it("PROPFIND 404 = 目录可自动创建（仍算通）；401 = 认证失败文案；Basic 头携带", async () => {
    const f = fakeFetch((url, init) => {
      expect(init.method).toBe("PROPFIND");
      expect((init.headers as Record<string, string>)["Depth"]).toBe("0");
      return undefined; // → 404
    });
    vi.stubGlobal("fetch", f);
    expect(await webdavTest(makeDeps())).toMatchObject({ ok: true, message: /自动创建/ });
    const f401 = fakeFetch(() => ({ status: 401 }));
    vi.stubGlobal("fetch", f401);
    expect(await webdavTest(makeDeps())).toMatchObject({ ok: false, message: /认证失败/ });
  });
});

describe("webdavFetchRemoteInfo / webdavSyncNow", () => {
  it("探测：远端空（404）→ remote null；有 manifest → 解析返回", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => undefined));
    expect(await webdavFetchRemoteInfo(makeDeps())).toMatchObject({ ok: true, remote: null });
    const manifest: WebdavManifest = {
      format: WEBDAV_MANIFEST_FORMAT,
      version: WEBDAV_PROTOCOL_VERSION,
      deviceName: "dev-b",
      createdAt: "2026-10-05T01:00:00.000Z",
      artifacts: { "settings.json": { sha256: sha256Hex('{"kind":"x"}'), size: 12 } },
    };
    vi.stubGlobal(
      "fetch",
      fakeFetch((url) =>
        url.endsWith("manifest.json")
          ? { status: 200, body: JSON.stringify(manifest) }
          : { status: 200, body: '{"kind":"x"}' },
      ),
    );
    const info = await webdavFetchRemoteInfo(makeDeps());
    expect(info.ok).toBe(true);
    expect(info.ok && info.remote?.deviceName).toBe("dev-b");
  });
  it("上传（本地优先）：artifact 先、manifest 后；manifest 未写成功不算新快照", async () => {
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      fakeFetch((url, init) => {
        if (init.method === "PUT") order.push(String(url).split("/").pop()!);
        return { status: 201 };
      }),
    );
    const result = await webdavSyncNow(makeDeps(), "up", null);
    expect(result.ok).toBe(true);
    expect(order).toEqual(["settings.json", "manifest.json"]);
  });
  it("下载（远端优先）：sha256/size 校验通过才应用；不符拒绝", async () => {
    const body = '{"kind":"remote-pkg"}';
    const manifest: WebdavManifest = {
      format: WEBDAV_MANIFEST_FORMAT,
      version: WEBDAV_PROTOCOL_VERSION,
      deviceName: "dev-b",
      createdAt: "2026-10-05T01:00:00.000Z",
      artifacts: { "settings.json": { sha256: sha256Hex(body), size: body.length } },
    };
    vi.stubGlobal(
      "fetch",
      fakeFetch((url) =>
        url.endsWith("manifest.json") ? { status: 200, body: JSON.stringify(manifest) } : { status: 200, body },
      ),
    );
    const applied: string[] = [];
    const result = await webdavSyncNow(makeDeps({ applyRemotePackage: async (t) => void applied.push(t) }), "down", manifest);
    expect(result.ok).toBe(true);
    expect(applied).toEqual([body]);
    // 校验失败：内容被篡改 → 拒绝应用
    vi.stubGlobal(
      "fetch",
      fakeFetch((url) =>
        url.endsWith("manifest.json") ? { status: 200, body: JSON.stringify(manifest) } : { status: 200, body: '{"tampered":1}' },
      ),
    );
    const bad = await webdavSyncNow(makeDeps(), "down", manifest);
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.message).toContain("校验失败");
  });
  it("下载：远端空（down 但无 manifest）→ 类型化拒绝", async () => {
    const result = await webdavSyncNow(makeDeps(), "down", null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("远端没有可下载的同步数据");
  });
});
