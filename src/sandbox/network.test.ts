/**
 * 网络策略测试（T-6-03 · D3）：
 * - deny 档：工具内 fetch 在任何真实 I/O 之前被拦，错误码 NETWORK_DENIED、
 *   报错含目标 URL（验收①）；
 * - allow 档：放行（对 localhost 真端口——验收②）；
 * - 独立一档：与路径守卫互不影响（验收③的独立性表达）；
 * - README 弱承诺声明在位（人工确认清单 D3 行的机验部分）。
 */

import { describe, expect, it, vi } from "vitest";
import { HttpMock } from "../test-support/http-mock.js";
import {
  NETWORK_DENIED,
  NETWORK_IMDS_DENIED,
  NetworkDeniedError,
  NetworkImdsDeniedError,
  createNetworkGuard,
} from "./network.js";
import { PathGuard } from "./path-guard.js";

describe("NetworkGuard · deny 档", () => {
  it("字符串 / URL / Request 输入全拒：错误码正确、报错含目标、真实请求零发生", async () => {
    const fetchImpl = vi.fn();
    const guard = createNetworkGuard({ policy: "deny", fetchImpl: fetchImpl as unknown as typeof fetch });
    for (const input of [
      "https://example.com/api",
      new URL("https://example.com/api"),
      new Request("https://example.com/api"),
    ]) {
      const err = await guard.fetch(input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetworkDeniedError);
      expect((err as NetworkDeniedError).code).toBe(NETWORK_DENIED);
      expect((err as Error).message).toContain("https://example.com/api");
      expect((err as Error).message).toContain("network policy = deny");
    }
    expect(fetchImpl).not.toHaveBeenCalled(); // 被拒请求不发生
  });
});

describe("NetworkGuard · allow 档", () => {
  it("放行对 localhost 的请求（真端口 HttpMock，缺省走全局 fetch）", async () => {
    const mock = new HttpMock();
    const base = await mock.start();
    try {
      mock.mountSequence([{ status: 200, body: "pong" }]);
      const guard = createNetworkGuard({ policy: "allow" });
      const res = await guard.fetch(`${base}/ping`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("pong");
    } finally {
      await mock.stop();
    }
  });

  it("透传语义：fetchImpl 收到原样 input/init，响应原样返回", async () => {
    const marker = new Response("body-here", { status: 201 });
    const fetchImpl = vi.fn(async (_input: Request | URL | string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe("payload");
      return marker;
    });
    const guard = createNetworkGuard({ policy: "allow", fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await guard.fetch("https://example.com/api", { method: "POST", body: "payload" });
    expect(res).toBe(marker);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("网络独立一档（D3：可单独禁网而不禁进程/文件）", () => {
  it("deny 网络 + 路径守卫组合：网络拒不影响写边界判定，二者互不引用", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-net-"));
    try {
      const guard = createNetworkGuard({ policy: "deny", fetchImpl: async () => new Response("") });
      const paths = PathGuard.forWorkspace(dir);
      await paths.write(path.join(dir, "ok.txt"), "写不受网络档影响");
      expect((await paths.read(path.join(dir, "ok.txt")))).toBe("写不受网络档影响");
      await expect(guard.fetch("https://example.com")).rejects.toMatchObject({ code: NETWORK_DENIED });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("D3 弱承诺 · README 声明在位（人工确认清单的机验部分）", () => {
  it("src/sandbox/README.md 醒目声明：只拦工具层 fetch、不承诺管住任意子进程", async () => {
    const { readFileSync } = await import("node:fs");
    const readme = readFileSync("src/sandbox/README.md", "utf8");
    expect(readme).toContain("只在工具层生效");
    expect(readme).toContain("不承诺");
    expect(readme).toContain("子进程");
    expect(readme).toContain("不要把 deny 档当成网络隔离的承诺");
  });
});

describe("C37 · IMDS 与带外回调主机黑名单（T-P1-83）", () => {
  const imdsFetch = vi.fn();
  function allowGuard() {
    return createNetworkGuard({ policy: "allow", fetchImpl: imdsFetch as unknown as typeof fetch });
  }

  it("四主机清单各一拒绝（AWS/GCP/阿里云 + IPv6 字面量），黑名单在 fetchImpl 之前", async () => {
    const guard = allowGuard();
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://100.100.100.200/latest/meta-data/",
      "http://[fd00:ec2::254]/latest/meta-data/",
    ]) {
      const err = await guard.fetch(url).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetworkImdsDeniedError);
      expect((err as NetworkImdsDeniedError).code).toBe(NETWORK_IMDS_DENIED);
      expect((err as Error).message).toContain("C37");
    }
    expect(imdsFetch).not.toHaveBeenCalled();
  });

  it("链路本地网段（169.254.0.0/16）字面前缀拒绝；大小写不敏感", async () => {
    const guard = allowGuard();
    for (const url of [
      "http://169.254.1.2/nms",
      "http://169.254.254.254/x",
      "http://METADATA.GOOGLE.INTERNAL/y",
    ]) {
      const err = await guard.fetch(url).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetworkImdsDeniedError);
    }
    // 非链路本地相似前缀不误伤（169.253.x / 169.255.x 放行到 fetchImpl）
    await allowGuard().fetch("http://169.253.0.1/x").catch(() => undefined);
    expect(imdsFetch).toHaveBeenCalled();
  });

  it("allow 档同样拦截（黑名单独立于档位——SSRF 语义）；URL 无法解析 fail-closed", async () => {
    const guard = allowGuard();
    // allow 档 + 黑名单主机 → 拒（上面已验）；此处验 URL 解析失败面
    const err = await guard.fetch("not-a-url-at-all").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkImdsDeniedError);
    expect((err as Error).message).toContain("无法解析");
  });

  it("正常公网 URL 照常放行（零误伤）；deny 档既有语义不变", async () => {
    const mock = new HttpMock();
    const base = await mock.start();
    try {
      mock.mountSequence([{ status: 200, body: "ok" }]);
      const guard = createNetworkGuard({ policy: "allow" });
      const res = await guard.fetch(`${base}/public`);
      expect(res.status).toBe(200);
      // deny 档：任何 URL（含非黑名单）照旧 NETWORK_DENIED
      const denyGuard = createNetworkGuard({ policy: "deny", fetchImpl: vi.fn() as unknown as typeof fetch });
      const denied = await denyGuard.fetch("https://example.com/api").catch((e: unknown) => e);
      expect((denied as NetworkDeniedError).code).toBe(NETWORK_DENIED);
    } finally {
      await mock.stop();
    }
  });
});

describe("C37 补口（B2）：守卫接管重定向跟随并逐跳复检 IMDS", () => {
  const makeGuard = (responder: (url: string) => Response) => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: Request | URL | string) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push(url);
      return responder(url);
    });
    const guard = createNetworkGuard({ policy: "allow", fetchImpl: fetchImpl as unknown as typeof fetch });
    return { guard, calls };
  };

  it("302 跳到 IMDS 主机：逐跳复检命中 → NetworkImdsDeniedError（修复目标）", async () => {
    const { guard } = makeGuard((url) =>
      url === "https://evil.example/start"
        ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
        : new Response("secret", { status: 200 }),
    );
    await expect(guard.fetch("https://evil.example/start")).rejects.toMatchObject({
      code: "NETWORK_IMDS_DENIED",
    });
  });

  it("302 跳到正常主机：跟随成功且每跳重过守卫（黑名单外不拦截）", async () => {
    const { guard, calls } = makeGuard((url) =>
      url === "https://a.example/old"
        ? new Response(null, { status: 302, headers: { location: "/new" } })
        : new Response("final-body", { status: 200 }),
    );
    const res = await guard.fetch("https://a.example/old");
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("final-body");
    expect(calls).toEqual(["https://a.example/old", "https://a.example/new"]);
  });

  it("跟随请求强制 GET 无 body（重定向 GET 化——307/308 方法保留不承诺，记档）", async () => {
    const seenInits: RequestInit[] = [];
    const fetchImpl = vi.fn(async (input: Request | URL | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "https://a.example/2") seenInits.push(init ?? {});
      return url === "https://a.example/1"
        ? new Response(null, { status: 307, headers: { location: "https://a.example/2" } })
        : new Response("ok", { status: 200 });
    });
    const guard = createNetworkGuard({ policy: "allow", fetchImpl: fetchImpl as unknown as typeof fetch });
    await guard.fetch("https://a.example/1", { method: "POST", body: "x" });
    expect(seenInits).toHaveLength(1);
    expect(seenInits[0]?.method).toBe("GET");
    expect(seenInits[0]?.body).toBeUndefined();
  });

  it("重定向超 5 跳：返回最后一个 3xx 响应（不无限循环）", async () => {
    let n = 0;
    const { guard, calls } = makeGuard((url) => {
      n += 1;
      return new Response(null, { status: 302, headers: { location: `https://a.example/next-${n}` } });
    });
    const res = await guard.fetch("https://a.example/start");
    expect(res.status).toBe(302);
    expect(calls.length).toBeLessThanOrEqual(7); // 首跳 + ≤5 跟随（含超限判定）
  });

  it("显式 redirect:'manual' 调用方直透（webfetch 契约不破坏——302 原样返回不跟随）", async () => {
    const { guard, calls } = makeGuard(() =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } }),
    );
    const res = await guard.fetch("https://a.example/old", { redirect: "manual" });
    expect(res.status).toBe(302); // 不跟随——IMDS 目标由调用方每跳重过守卫时拦
    expect(calls).toHaveLength(1);
  });
});
