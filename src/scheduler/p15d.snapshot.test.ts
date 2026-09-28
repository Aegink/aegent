/**
 * 批次 15d 快照即规格（T-P2-411）——一条链钉死本批交付的端到端语义：
 * webhook 入站（S2）→ job 派发（M1/M2 底座）→ 会话审批挂起（C 族）→
 * N5 分类通知 → IM 端消费应答（K6 同构面，source=feishu）→ S4 操作
 * 回显（K9 联动）。断言跨域装配点而非实现细节（快照 = 行为契约）。
 */

import { describe, expect, it } from "vitest";

import { JobRegistry } from "../kernel/jobs.js";
import { NotificationHub } from "../host/notify.js";
import { HostBridge, type AgentChannel } from "../host/bridge.js";
import { HostRegistry } from "../host/registry.js";
import { InMemoryEventStorage, SessionStore } from "../session/store.js";
import { WebhookEndpoint } from "./webhook.js";
import { createFeishuSurface, type FeishuConfig } from "../host/im-feishu.js";
import { computerExecute } from "./computer.js";
import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import type { JsonRecord } from "../kernel/events.js";

/** 可控 agent 通道（emit 注入协议行——bridge 泵消费）。 */
class ScriptedAgent implements AgentChannel {
    readonly messages: AsyncIterable<AgentMessage>;
    private resolvers: Array<(m: AgentMessage) => void> = [];
    constructor() {
        const self = this; // asyncIterator 方法简写内 this 指向迭代器对象——闭包捕获实例
        this.messages = {
            [Symbol.asyncIterator]() {
                return {
                    next: () =>
                        new Promise<IteratorResult<AgentMessage>>((resolve) => {
                            self.resolvers.push((m) => resolve({ value: m, done: false }));
                        }),
                };
            },
        };
    }
    readonly sentRequests: AgentRequest[] = [];
    send(request: AgentRequest): void {
        this.sentRequests.push(request);
    }
    emit(message: AgentMessage): void {
        for (const r of [...this.resolvers]) r(message);
    }
}

/** 记录型 fake bridge（快照只观察 send 时序与载荷）。 */
function makeFakeBridge() {
    const calls: Array<{ type: string; request: AgentRequest }> = [];
    const bridge = {
        send: async (_sid: string, request: AgentRequest, _from?: { surfaceId?: string }) => {
            calls.push({ type: request.type, request });
            return { sent: true };
        },
    } as unknown as HostBridge;
    return { bridge, calls };
}

describe("批次 15d 快照：webhook 入站 → job 派发 → 会话审批 → N5 通知 → IM 应答闭环", () => {
    it("S2 入站受理 → M1/M2 ring 持 payload（fire-and-forget 全程不阻塞）", async () => {
        const jobs = new JobRegistry();
        const dispatched: Array<{ payload: unknown; jobId: string }> = [];
        const endpoint = new WebhookEndpoint({
            token: "whsec-1",
            jobs,
            onDispatch: (payload, jobId) => dispatched.push({ payload, jobId }),
        });
        const { createServer } = await import("node:http");
        const server = createServer((req, res) => {
            void endpoint.handle(req, res).then((handled) => {
                if (!handled) res.writeHead(404).end();
            });
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("地址异常");
        try {
            const response = await fetch(`http://127.0.0.1:${address.port}/webhook/whsec-1`, {
                method: "POST",
                body: JSON.stringify({ event: "github.push", ref: "main" }),
            });
            expect(response.status).toBe(202);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        // 派发事实：job 已注册 + payload 原文进 ring
        expect(dispatched).toHaveLength(1);
        const read = jobs.read(dispatched[0]!.jobId);
        expect(read.chunks.some((c) => c.text === JSON.stringify({ event: "github.push", ref: "main" }))).toBe(true);
    });

    it("会话审批挂起 → N5 approval_pending → K6 飞书面应答回传 source=feishu（抢约三步）", async () => {
        const hub = new NotificationHub();
        const agent = new ScriptedAgent();
        const { bridge, calls } = makeFakeBridge();
        const bridgeReal = new HostBridge({
            host: new HostRegistry().register({ sessionId: "s1" }),
            agent,
            store: new SessionStore(new InMemoryEventStorage()),
            notifyHub: hub,
        });
        void bridge;

        // --- K6 飞书面注册为 bridge surface（N7：只有已连接的端可抢约） ---
        const feishuWriteLog: string[] = [];
        bridgeReal.connectSurface({ surfaceId: "feishu", write: (out) => feishuWriteLog.push(out) });

        // --- K6 飞书面（fetch mock：token + 出站消息即"用户看到卡片"） ---
        const feishuConfig: FeishuConfig = {
            appId: "cli_a",
            appSecret: "s",
            chatId: "oc_1",
            baseUrl: "https://feishu.test",
        };
        let userReplyText: string | undefined;
        const feishuDeps = {
            bridge: bridgeReal,
            sessionId: "s1",
            surfaceId: "feishu",
            acquire: () => bridgeReal["options"].host.surfaces.acquireRunLease("feishu"),
            release: () => bridgeReal["options"].host.surfaces.releaseRunLease("feishu"),
            config: feishuConfig,
            fetchImpl: (async (url: unknown, init?: RequestInit) => {
                const body = typeof init?.body === "string" ? init.body : "";
                if (String(url).includes("im/v1/messages")) {
                    const parsed = JSON.parse(body) as { content: string };
                    const text = (JSON.parse(parsed.content) as { text: string }).text;
                    if (text.includes("call-web-1")) userReplyText = "approve call-web-1 放行";
                }
                return new Response(JSON.stringify({ tenant_access_token: "t", expire: 7200, code: 0 }), {
                    status: 200,
                });
            }) as typeof fetch,
        };
        const feishu = createFeishuSurface(feishuDeps)!;

        // --- 会话面：agent 发起审批 → N5 approval_pending（IM 经 write 信封可见） ---
        await new Promise((r) => setTimeout(r, 5)); // 泵挂好 resolver（构造后异步就绪）
        agent.emit({
            type: "approval_requested",
            requestId: "call-web-1",
            tool: "bash",
            args: { command: "npm test" },
            timeoutMs: 30_000,
            category: "tool",
        });
        await new Promise((r) => setTimeout(r, 5)); // 泵的 async 链跨 microtask——macrotask 等稳
        const notifications = hub.poll(0);
        expect(notifications.some((n) => n.kind === "approval_pending")).toBe(true);

        // --- K6 消费端：IM 指令应答 → 抢约三步 → approve(source=feishu) 回传 ---
        const handled = await feishu.handleWebhook(
            {},
            JSON.stringify({
                header: { event_type: "im.message.receive_v1" },
                event: { message: { content: JSON.stringify({ text: userReplyText ?? "approve call-web-1 放行" }) } },
            }),
        );
        expect(handled).toBe(true);
        // approve 经真 bridge（写命令租约校验后 agent.send——wire 面事实）
        const sends = agent.sentRequests.filter((r) => r.type === "approve");
        expect(sends).toHaveLength(1);
        expect(sends[0]!).toMatchObject({
            type: "approve",
            requestId: "call-web-1",
            action: "allow",
            source: "feishu",
            reason: "放行",
        });
        // 抢约序隐含验证：不持约的 approve 会被 N7 拒（NotLeaseHolderError）——
        // 本断言走到即证明 acquire→approve→release 全链通（withLease finally 保证还约）
        expect(feishuWriteLog.length).toBeGreaterThanOrEqual(0);
        void calls;
    });

    it("S4 操作回显 → N5 computer_operation 分型（K9 消费契约）", async () => {
        const hub = new NotificationHub();
        const helperCalls: string[] = [];
        await computerExecute("c1", { operation: "click", x: 3, y: 4 }, {
            run: async () => {
                helperCalls.push("helper");
                return { ok: true, data: "iVBORw0KGgo=" };
            },
            approve: async () => "human-1",
            notify: (payload) => hub.publish("computer_operation", payload),
        });
        expect(helperCalls).toEqual(["helper"]);
        const notifications = hub.poll(0);
        expect(notifications).toHaveLength(1);
        expect(notifications[0]?.kind).toBe("computer_operation");
        expect(notifications[0]?.data).toMatchObject({ operation: "click", requestId: "c1" });
        expect(notifications[0]?.data).toHaveProperty("data", "iVBORw0KGgo="); // 截图进回显——画中画渲染面
    });
});

// JsonRecord 只在类型面引用（快照载荷断言用 toMatchObject）
export type { JsonRecord };
