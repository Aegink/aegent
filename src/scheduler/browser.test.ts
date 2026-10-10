/**
 * S3 浏览器使用测试（T-P2-407）——CDP mock 往返（fake ws 注入）+ 域
 * 白名单 + 显式审批联动（缺省恒拒）+ deadline 超时 + 三工具 schema 与
 * NOTICE 描述文件。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    BrowserApprovalDeniedError,
    BrowserDomainError,
    browserExtract,
    browserNavigate,
    browserScreenshot,
    CdpConnection,
    cdpWsUrlOf,
    CdpProtocolError,
    createBrowserTools,
    domainAllowed,
} from "./browser.js";

/** 最小 fake WebSocket（事件化——测试手动驱动 open/回包）。 */
class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    static OPEN = 1;

    readonly sent: string[] = [];
    readyState = 0;
    private readonly handlers = new Map<string, Array<(payload: unknown) => void>>();

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
    }

    on(event: string, handler: (payload: unknown) => void): void {
        const list = this.handlers.get(event) ?? [];
        list.push(handler);
        this.handlers.set(event, list);
    }

    once(event: string, handler: (payload: unknown) => void): void {
        const wrapped = (payload: unknown): void => {
            this.off(event, wrapped);
            handler(payload);
        };
        this.on(event, wrapped);
    }

    off(event: string, handler: (payload: unknown) => void): void {
        const list = this.handlers.get(event) ?? [];
        const i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
    }

    send(data: string): void {
        this.sent.push(data);
        const parsed = JSON.parse(data) as { id: number; method: string; params?: Record<string, unknown> };
        // 内建响应模拟：三方法各回固定形状（errorText 场景由测试改写）
        this.respond(parsed.id, parsed.method, parsed.params);
    }

    close(): void {
        this.readyState = 0;
        this.emit("close", {});
    }

    emit(event: string, payload: unknown): void {
        for (const h of this.handlers.get(event) ?? []) h(payload);
    }

    respond(id: number, method: string, _params?: Record<string, unknown>): void {
        const results: Record<string, unknown> = {
            "Page.navigate": { frameId: "frame-1" },
            "Page.captureScreenshot": { data: "iVBORw0KGgo=" },
            "Runtime.evaluate": { result: { value: "页面文本" } },
        };
        const result = results[method];
        if (result === undefined) {
            this.emit("message", JSON.stringify({ id, error: { message: `unknown method ${method}` } }));
            return;
        }
        this.emit("message", JSON.stringify({ id, result }));
    }

    /** 测试注入自定义回包（覆盖内建响应）。 */
    replyWith(id: number, payload: object): void {
        this.emit("message", JSON.stringify({ id, ...payload }));
    }
}

let fake_emit: (payload: unknown) => void = () => {};

/**
 * 注入 fake ws 构造器建连：CdpConnection 内部自建实例——测试从 instances
 * 取**连接真正持有的那个**（驱动与监听必须同实例——第一次写错成手动 new，
 * emit 全落无人监听的孤儿实例上，测试超时定位实录）。
 */
async function makeConn(
    respond?: (thisWs: FakeWebSocket, id: number, method: string, params?: Record<string, unknown>) => void,
): Promise<{ conn: CdpConnection; fake: FakeWebSocket }> {
    const conn = new CdpConnection("ws://127.0.0.1:9222/devtools/page/1", 5000, FakeWebSocket as never);
    const fake = FakeWebSocket.instances.at(-1)!;
    fake_emit = (payload: unknown) => fake.emit("message", JSON.stringify(payload));
    if (respond !== undefined) {
        fake.respond = (id, method, params) => respond(fake, id, method, params);
    }
    const openPromise = conn.open();
    fake.readyState = FakeWebSocket.OPEN;
    fake.emit("open", {});
    await openPromise;
    return { conn, fake };
}

describe("domainAllowed", () => {
    it("精确匹配与后缀通配（大小写不敏感）", () => {
        const rules = ["example.com", "*.example.org"];
        expect(domainAllowed("example.com", rules)).toBe(true);
        expect(domainAllowed("EXAMPLE.com", rules)).toBe(true);
        expect(domainAllowed("sub.example.org", rules)).toBe(true);
        expect(domainAllowed("deep.sub.example.org", rules)).toBe(true);
        expect(domainAllowed("evil.com", rules)).toBe(false);
        expect(domainAllowed("notexample.com", rules)).toBe(false);
        expect(domainAllowed("example.org", rules)).toBe(false); // 通配不吃裸域
    });
});

describe("CdpConnection（fake ws 往返）", () => {
    it("send 配平 id 与回包", async () => {
        const { conn } = await makeConn();
        const result = (await conn.send("Page.captureScreenshot", { format: "png" })) as { data?: string };
        expect(result.data).toBe("iVBORw0KGgo=");
        conn.close();
    });

    it("CDP error 回包 → CdpProtocolError", async () => {
        const { conn, fake } = await makeConn();
        const promise = conn.send("Bad.method");
        const sent = JSON.parse(fake.sent[0] ?? "{}") as { id: number };
        fake.replyWith(sent.id, { error: { message: "该方法不存在" } });
        await expect(promise).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
        conn.close();
    });
});

describe("cdpWsUrlOf", () => {
    it("GET /json/version → webSocketDebuggerUrl", async () => {
        const fetchImpl = (async () =>
            new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" }), {
                status: 200,
            })) as typeof fetch;
        expect(await cdpWsUrlOf(9222, fetchImpl)).toBe("ws://127.0.0.1:9222/devtools/page/1");
    });

    it("非 200 / 缺字段 → CdpProtocolError", async () => {
        const fail = (async () => new Response("{}", { status: 500 })) as typeof fetch;
        await expect(cdpWsUrlOf(9222, fail)).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
        const empty = (async () => new Response("{}", { status: 200 })) as typeof fetch;
        await expect(cdpWsUrlOf(9222, empty)).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
    });
});

describe("browserNavigate（审批 + 域白名单）", () => {
    it("审批通过 + 白名单命中 → Page.navigate", async () => {
        const { conn } = await makeConn();
        const approved: string[] = [];
        const result = await browserNavigate(conn, "https://example.com/page", {
            approve: async (a) => (approved.push(a.tool), true),
            allowedDomains: ["example.com"],
        });
        expect(result).toEqual({ frameId: "frame-1", url: "https://example.com/page" });
        expect(approved).toEqual(["browser_navigate"]);
        conn.close();
    });

    it("审批缺省（未提供）/ 返回 false → BrowserApprovalDeniedError（缺省恒拒）", async () => {
        const { conn } = await makeConn();
        await expect(browserNavigate(conn, "https://example.com", {})).rejects.toBeInstanceOf(
            BrowserApprovalDeniedError,
        );
        await expect(
            browserNavigate(conn, "https://example.com", { approve: async () => false }),
        ).rejects.toMatchObject({ code: "BROWSER_APPROVAL_DENIED" });
        conn.close();
    });

    it("审批过后越域 → BrowserDomainError（两闸独立）", async () => {
        const { conn } = await makeConn();
        await expect(
            browserNavigate(conn, "https://evil.com", {
                approve: async () => true,
                allowedDomains: ["example.com"],
            }),
        ).rejects.toBeInstanceOf(BrowserDomainError);
        conn.close();
    });

    it("导航失败（errorText）→ CdpProtocolError", async () => {
        const { conn } = await makeConn((_f, id) => {
            fake_emit({ id, result: { errorText: "ERR_NAME_NOT_RESOLVED" } });
        });
        await expect(
            browserNavigate(conn, "https://no-such.invalid", { approve: async () => true }),
        ).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
        conn.close();
    });
});

describe("browserScreenshot / browserExtract", () => {
    it("截屏返回 base64；抽取返回文本", async () => {
        const { conn } = await makeConn();
        expect(await browserScreenshot(conn)).toBe("iVBORw0KGgo=");
        expect(await browserExtract(conn)).toBe("页面文本");
        expect(await browserExtract(conn, "1 + 1")).toBe("页面文本"); // fake 固定回包——表达式透传断言在 mock 往返
        conn.close();
    });

    it("非字符串回值 → CdpProtocolError（fail-closed）", async () => {
        const { conn } = await makeConn((_f, id) => {
            fake_emit({ id, result: { result: { value: 42 } } });
        });
        await expect(browserExtract(conn)).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
        conn.close();
    });
});

describe("createBrowserTools（工具族形状）", () => {
    it("三工具 schema + 排他执行 + 描述文件含 NOTICE", () => {
        const tools = createBrowserTools({
            connect: async () => {
                throw new Error("不应在 schema 检查时建连");
            },
        });
        expect(tools.map((t) => t.name)).toEqual(["browser_navigate", "browser_screenshot", "browser_extract"]);
        // 排他（未声明 parallel——浏览器有会话状态，fail-closed 缺省）
        expect(tools.every((t) => t.parallel !== true)).toBe(true);
        // NOTICE 风险标注在描述文件（B2 描述与代码分离）
        for (const name of ["browser_navigate", "browser_screenshot", "browser_extract"]) {
            const text = readFileSync(join("plugins/tools-builtin/descriptions", `${name}.txt`), "utf8");
            expect(text).toContain("NOTICE");
        }
    });

    it("execute 链：审批拒绝 → isError 回喂（不上抛——模型可自纠语义）", async () => {
        const tools = createBrowserTools({
            connect: async () => {
                const { conn } = await makeConn();
                return conn;
            },
            approve: async () => false,
        });
        const navigate = tools[0]!;
        const result = (await navigate.execute({ url: "https://example.com" } as never, {
            toolCallId: "c1",
        } as never)) as { isError?: boolean; content: string };
        expect(result.isError).toBe(true);
        expect(result.content).toContain("审批拒绝");
    });
});
