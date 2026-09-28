import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import {
    connectWsPlugin,
    WS_PLUGIN_HANDSHAKE_TIMEOUT_MS,
    WS_PLUGIN_TOOL_TIMEOUT_MS,
    WsPluginError,
    type WsPluginServerEnvelope,
    type WsPluginClientEnvelope,
} from "./ws-plugin.js";
import { TimeoutError } from "../kernel/deadline.js";
import type { SessionEvent } from "../kernel/events.js";

/**
 * 真实 ws server 内存桥（随机端口）：插件进程由测试扮演——收信封、按
 * script 应答。宿主侧走真实 ws 客户端，往返全链路真实。
 */
const servers: { close(): Promise<void> }[] = [];

async function startFakePlugin(
    script: (env: WsPluginClientEnvelope, send: (e: WsPluginServerEnvelope) => void, socket: WsSocket) => void,
): Promise<{ url: string; socketRef: () => WsSocket | undefined }> {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    let client: WsSocket | undefined;
    server.on("upgrade", (req, socket, head) =>
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)),
    );
    wss.on("connection", (ws) => {
        client = ws;
        ws.on("message", (raw) => {
            script(JSON.parse(String(raw)) as WsPluginClientEnvelope, (e) => ws.send(JSON.stringify(e)), ws);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    const entry = {
        url: `ws://127.0.0.1:${String(addr.port)}`,
        socketRef: () => client,
        close: () =>
            new Promise<void>((resolve) => {
                // 硬断所有活跃连接：server.close 会等连接自然关闭——宿主侧
                // 未 dispose 时会让清理挂死
                for (const c of wss.clients) c.terminate();
                wss.close();
                server.close(() => resolve());
            }),
    };
    servers.push(entry);
    return entry;
}

afterEach(async () => {
    while (servers.length > 0) {
        const s = servers.pop();
        if (s !== undefined) await s.close();
    }
});

function evt(type: SessionEvent["type"], seq: number): SessionEvent {
    return { type, seq, ts: 2_000 + seq, turn: 1, payload: { n: seq } } as SessionEvent;
}

const defaultHello = (env: WsPluginClientEnvelope, send: (e: WsPluginServerEnvelope) => void): void => {
    if (env.type === "hello") send({ type: "hello_ack", name: "ext" });
};

describe("connectWsPlugin —— 握手（复用 host/protocol hello 面）", () => {
    it("版本握手成功产出句柄（hello → hello_ack，PROTOCOL_VERSION 锁定）", async () => {
        const seen: unknown[] = [];
        const p = await startFakePlugin((env, send) => {
            seen.push(env);
            defaultHello(env, send);
        });
        const handle = await connectWsPlugin(p.url);
        expect(handle.name).toBe("ext");
        expect(handle.disposed).toBe(false);
        expect(seen[0]).toMatchObject({ type: "hello", version: 1 });
        await handle.dispose();
    });

    it("版本不符：插件回 hello_error → 类型化拒绝（PROTOCOL_VERSION_MISMATCH）", async () => {
        const p = await startFakePlugin((env, send) => {
            if (env.type === "hello") {
                send({ type: "unknown" as WsPluginServerEnvelope["type"] } as unknown as WsPluginServerEnvelope);
            }
        });
        // 非 hello_ack 信封 → BAD_HANDSHAKE；hello_error 专属码由插件显式回
        await expect(connectWsPlugin(p.url)).rejects.toMatchObject({ name: "WsPluginError" });
    });

    it("插件不回应握手 → 超时拒绝且连接被清理", async () => {
        const p = await startFakePlugin(() => undefined);
        await expect(connectWsPlugin(p.url, { handshakeTimeoutMs: 50 })).rejects.toMatchObject({
            code: "HANDSHAKE_TIMEOUT",
        });
    });

    it("connect 后 URL 不可达 → CONNECT_FAILED", async () => {
        await expect(connectWsPlugin("ws://127.0.0.1:9", { handshakeTimeoutMs: 300 })).rejects.toMatchObject({
            name: "WsPluginError",
        });
    });
});

describe("ws 往返 —— 工具注册（走审批）与执行", () => {
    it("register_tool 经审批允许 → 登记（trust 恒 untrusted）+ 回执 + 执行往返", async () => {
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
            if (env.type === "tool_invoke") {
                send({ type: "tool_result", callId: env.callId, content: `ran:${JSON.stringify(env.args)}` });
            }
        });
        const handle = await connectWsPlugin(p.url, { onToolRegistration: () => true });
        p.socketRef()!.send(JSON.stringify({ type: "register_tool", tool: { name: "ext_tool", parameters: { type: "object" } } }));
        await new Promise((r) => setTimeout(r, 20));
        expect(handle.tools).toHaveLength(1);
        expect(handle.tools[0]).toMatchObject({ pluginName: "ext", trust: "untrusted", def: { name: "ext_tool" } });
        // 执行往返：内核调 def.execute → tool_invoke → 插件应答 → 结果回传
        const registered = handle.tools[0]!;
        const result = await registered.def.execute({ x: 7 });
        expect(result).toEqual({ content: 'ran:{"x":7}' });
        await handle.dispose();
    });

    it("不受信来源默认 deny：无审批回调时注册被拒（tool_rejected 回插件）", async () => {
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
        });
        const handle = await connectWsPlugin(p.url);
        const replies: WsPluginClientEnvelope[] = [];
        p.socketRef()!.on("message", (raw) => replies.push(JSON.parse(String(raw))));
        p.socketRef()!.send(JSON.stringify({ type: "register_tool", tool: { name: "rogue" } }));
        await new Promise((r) => setTimeout(r, 20));
        expect(handle.tools).toHaveLength(0);
        expect(replies.some((e) => e.type === "tool_rejected" && (e as { name: string }).name === "rogue")).toBe(true);
        await handle.dispose();
    });

    it("审批拒绝：插件收 tool_rejected、句柄零登记", async () => {
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
        });
        const handle = await connectWsPlugin(p.url, { onToolRegistration: () => false });
        p.socketRef()!.send(JSON.stringify({ type: "register_tool", tool: { name: "denied_tool" } }));
        await new Promise((r) => setTimeout(r, 20));
        expect(handle.tools).toHaveLength(0);
        await handle.dispose();
    });

    it("重名注册拒绝（第二次 tool_rejected）", async () => {
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
        });
        const handle = await connectWsPlugin(p.url, { onToolRegistration: () => true });
        const socket = p.socketRef()!;
        socket.send(JSON.stringify({ type: "register_tool", tool: { name: "dup" } }));
        await new Promise((r) => setTimeout(r, 20));
        socket.send(JSON.stringify({ type: "register_tool", tool: { name: "dup" } }));
        await new Promise((r) => setTimeout(r, 20));
        expect(handle.tools).toHaveLength(1);
        await handle.dispose();
    });

    it("工具调用超时：插件不应答 → TimeoutError（挂死插件可回收）", async () => {
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
        });
        const handle = await connectWsPlugin(p.url, { onToolRegistration: () => true, toolTimeoutMs: 50 });
        p.socketRef()!.send(JSON.stringify({ type: "register_tool", tool: { name: "stuck" } }));
        await new Promise((r) => setTimeout(r, 20));
        const stuck = handle.tools[0]!;
        await expect(stuck.def.execute({})).rejects.toBeInstanceOf(TimeoutError);
        await handle.dispose();
    });
});

describe("断线降级 —— 插件缺席不崩内核", () => {
    it("断线：能力注销（tools 清空 + deliver 失败报告 + onDisconnected）", async () => {
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
        });
        let disconnected: string | undefined;
        const handle = await connectWsPlugin(p.url, {
            onToolRegistration: () => true,
            onDisconnected: (r) => {
                disconnected = r;
            },
        });
        p.socketRef()!.send(JSON.stringify({ type: "register_tool", tool: { name: "t" } }));
        await new Promise((r) => setTimeout(r, 20));
        expect(handle.tools).toHaveLength(1);
        // 插件进程侧硬断
        p.socketRef()!.terminate();
        await new Promise((r) => setTimeout(r, 30));
        expect(handle.disposed).toBe(true);
        expect(handle.tools).toHaveLength(0);
        expect(disconnected).toBeDefined();
        const report = await handle.deliver(evt("tool/call", 1));
        expect(report).toMatchObject({ pluginName: "ext", ok: false, error: "插件已断线" });
    });

    it("坏信封不崩：非 JSON / 未知 type / 坏形状 → onBadFrame 记录 + 连接继续工作", async () => {
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
        });
        const bad: string[] = [];
        const handle = await connectWsPlugin(p.url, { onToolRegistration: () => true, onBadFrame: (e) => {
            bad.push(e.code);
        } });
        const socket = p.socketRef()!;
        socket.send("not-json-at-all");
        socket.send(JSON.stringify({ type: "from_the_void" }));
        socket.send(JSON.stringify({ type: "register_tool" }));
        await new Promise((r) => setTimeout(r, 30));
        expect(bad).toEqual(["BAD_FRAME", "BAD_FRAME", "BAD_FRAME"]);
        // 连接仍活着：合法注册照常处理
        socket.send(JSON.stringify({ type: "register_tool", tool: { name: "after_bad" } }));
        await new Promise((r) => setTimeout(r, 20));
        expect(handle.tools.map((t) => t.def.name)).toEqual(["after_bad"]);
        await handle.dispose();
    });
});

describe("事件投递与收摊", () => {
    it("只投已订阅类型：subscribe 握手 + event 信封逐字段到达", async () => {
        const received: WsPluginClientEnvelope[] = [];
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
            if (env.type === "event") received.push(env);
        });
        const handle = await connectWsPlugin(p.url);
        p.socketRef()!.send(JSON.stringify({ type: "subscribe", types: ["tool/call"] }));
        await new Promise((r) => setTimeout(r, 20));
        await handle.deliver(evt("tool/call", 4));
        await handle.deliver(evt("turn/start", 5));
        await new Promise((r) => setTimeout(r, 20));
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ type: "event", event: { type: "tool/call", seq: 4, payload: { n: 4 } } });
        await handle.dispose();
    });

    it("dispose：关闭连接 + 幂等 + 此后 deliver 失败报告", async () => {
        const p = await startFakePlugin((env, send) => {
            defaultHello(env, send);
        });
        const handle = await connectWsPlugin(p.url);
        await handle.dispose();
        expect(handle.disposed).toBe(true);
        await handle.dispose();
        const report = await handle.deliver(evt("tool/call", 1));
        expect(report.ok).toBe(false);
    });

    it("缺省预算常量在位", () => {
        expect(WS_PLUGIN_HANDSHAKE_TIMEOUT_MS).toBe(5_000);
        expect(WS_PLUGIN_TOOL_TIMEOUT_MS).toBe(10_000);
    });

    it("版本不符专属码可被宿主识别（hello_error 分支的显式 code）", async () => {
        const p = await startFakePlugin((env, send) => {
            if (env.type === "hello") send({ type: "hello_error" } as unknown as WsPluginServerEnvelope);
        });
        await expect(connectWsPlugin(p.url)).rejects.toMatchObject({ code: "PROTOCOL_VERSION_MISMATCH" });
    });
});

describe("协议形状自检", () => {
    it("WsPluginError 是类型化错误", () => {
        const e = new WsPluginError("X", "m");
        expect(e).toBeInstanceOf(Error);
        expect(e.code).toBe("X");
    });
});
