import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { connectWsPlugin } from "./ws-plugin.js";
import { GuardRegistry, createRepeatToolReminder } from "./guard.js";
import { loadPlugin } from "./plugin-sdk.js";
import { createClaudeCodeHookBridge } from "./hook-compat.js";
import { HookRegistry } from "../kernel/hooks.js";
import type { SessionEvent } from "../kernel/events.js";

/**
 * T-P2-311 快照即规格（批次 15c）：ws 插件注册工具走审批全链一条——
 * 真实 ws 内存桥（测试扮演插件进程）→ 握手 → register_tool 过审批位 →
 * 登记带 untrusted 标记 → 执行往返 → 事件投递；治理插件（I11）在链外
 * 观察 tool/call 出建议（**不拦截**）；断线 → 能力注销。本批四张 mcp 卡
 * （I5 SDK / I4 ws / I7 兼容桥 / I11 治理）的接缝在此一条链上钉死。
 */

const servers: { close(): Promise<void> }[] = [];

async function startFakePlugin(
    script: (env: { type: string; [k: string]: unknown }, send: (e: unknown) => void, socket: WsSocket) => void,
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
            script(JSON.parse(String(raw)) as { type: string }, (e) => ws.send(JSON.stringify(e)), ws);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    const entry = {
        url: `ws://127.0.0.1:${String(addr.port)}`,
        socketRef: () => client,
        close: () =>
            new Promise<void>((resolve) => {
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
        await servers.pop()!.close();
    }
});

function toolCallEvent(seq: number, name: string): SessionEvent {
    return { type: "tool/call", seq, ts: seq, turn: 1, step: 1, callId: `c${String(seq)}`, name, arguments: "{}" } as SessionEvent;
}

describe("T-P2-311 快照：ws 插件注册工具走审批全链（15c 接缝）", () => {
    it("握手 → 审批注册（untrusted）→ 执行往返 → 治理建议不拦截 → 断线注销", async () => {
        // —— 插件进程（测试扮演）：握手应答 + 按需注册工具 + 应答调用
        const p = await startFakePlugin((env, send) => {
            if (env.type === "hello") {
                send({ type: "hello_ack", name: "ext-15c" });
            } else if (env.type === "tool_invoke") {
                send({ type: "tool_result", callId: env.callId, content: "远端执行完成" });
            }
        });

        // —— ① 审批位（C 族消费点）：不受信来源默认 deny 的最保守缺省演示——
        // 第一枚注册被拒（审批回调 false），第二枚放行（模拟规则命中 allow）
        const approvals: { name: string; allowed: boolean }[] = [];
        let allowSecond = false;
        const handle = await connectWsPlugin(p.url, {
            onToolRegistration: (tool) => {
                const allowed = allowSecond;
                approvals.push({ name: tool.name, allowed });
                return allowed;
            },
        });
        expect(handle.name).toBe("ext-15c");

        const socket = p.socketRef()!;
        socket.send(JSON.stringify({ type: "register_tool", tool: { name: "ext_run" } }));
        await new Promise((r) => setTimeout(r, 20));
        // 审批拒绝：零登记（不受信来源默认 deny）
        expect(approvals).toEqual([{ name: "ext_run", allowed: false }]);
        expect(handle.tools).toHaveLength(0);

        // —— ② 审批放行：登记带宿主标注的 untrusted 标记（自报身份不采信）
        allowSecond = true;
        socket.send(JSON.stringify({ type: "register_tool", tool: { name: "ext_run" } }));
        await new Promise((r) => setTimeout(r, 20));
        expect(approvals).toHaveLength(2);
        expect(handle.tools).toHaveLength(1);
        expect(handle.tools[0]).toMatchObject({
            pluginName: "ext-15c",
            trust: "untrusted",
            def: { name: "ext_run" },
        });

        // —— ③ 执行往返：内核调 execute → tool_invoke → 插件应答 → 结果回传
        const executed = await handle.tools[0]!.def.execute({ q: 1 });
        expect(executed).toEqual({ content: "远端执行完成" });

        // —— ④ 治理建议不拦截（I11）：重复调用达档 → 建议产出，但工具执行面
        // 零触碰（dispatch 只读事件、不改写、不否决）
        const guard = new GuardRegistry();
        guard.register(createRepeatToolReminder({ thresholds: [2] }));
        const ev = toolCallEvent(1, "ext_run");
        const before = JSON.stringify(ev);
        guard.dispatch(ev);
        const report = guard.dispatch(toolCallEvent(2, "ext_run"));
        expect(report.advices).toHaveLength(1);
        expect(report.advices[0]).toMatchObject({ kind: "repeat_tool_reminder", severity: "info", tool: "ext_run" });
        expect(JSON.stringify(ev)).toBe(before); // 治理派发零改写执行事实
        // 被建议"重复"的工具仍可照常执行（建议非强制）
        await expect(handle.tools[0]!.def.execute({ q: 2 })).resolves.toEqual({ content: "远端执行完成" });

        // —— ⑤ 断线：能力注销（tools 清空 + deliver 失败报告）
        let disconnected = false;
        void disconnected;
        socket.terminate();
        await new Promise((r) => setTimeout(r, 30));
        expect(handle.disposed).toBe(true);
        expect(handle.tools).toHaveLength(0);
        const deliver = await handle.deliver(toolCallEvent(3, "ext_run"));
        expect(deliver).toMatchObject({ ok: false, error: "插件已断线" });
    });

    it("I5 进程内 SDK × I7 兼容桥同链共存（插件面与生态桥不互扰）", async () => {
        // 进程内 SDK 插件（受限能力 token）
        const seen: string[] = [];
        const sdk = await loadPlugin(
            {
                manifest: { name: "audit-ext", trust: "untrusted", capabilities: ["events"] },
                onActivate: (caps) => {
                    caps.subscribe(["tool/call"]);
                },
                onEvent: (e) => {
                    seen.push(e.type);
                },
            },
            { availableCapabilities: ["events"] },
        );
        // 生态桥（CC 方言 → toolCall 链层，untrusted 轨注册）
        const bridge = createClaudeCodeHookBridge(
            { PreToolUse: [{ hooks: [{ type: "command", command: "guard.sh" }] }] },
            { runner: async () => ({ stdout: "", stderr: "", exitCode: 0 }) },
        );
        const hooks = new HookRegistry();
        const un = bridge.registerInto(hooks);
        expect(hooks.has("toolCall")).toBe(true);
        // 两者互不干扰：SDK 投递零影响桥注册；注销桥后 SDK 照常
        const r = await sdk.deliver(toolCallEvent(9, "ext_run"));
        expect(r.ok).toBe(true);
        expect(seen).toEqual(["tool/call"]);
        un();
        expect(hooks.has("toolCall")).toBe(false);
        await sdk.dispose();
        expect(sdk.disposed).toBe(true);
    });
});
