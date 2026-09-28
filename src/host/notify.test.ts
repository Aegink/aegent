/**
 * N5 推送测试（T-P2-405）——四类分型发布 + poll 游标补投 + push 端即时
 * 回调 + HostBridge 三类归类集成（挂起/轮结算/端面变化——既有广播零变化）。
 */

import { describe, expect, it } from "vitest";

import { NotificationHub, NOTIFICATION_KINDS, type NotificationPayload } from "./notify.js";
import { HostBridge, type AgentChannel } from "./bridge.js";
import { HostRegistry } from "./registry.js";
import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import { InMemoryEventStorage, SessionStore } from "../session/store.js";

describe("NOTIFICATION_KINDS", () => {
    it("五类分型闭集（…+surface_changed+computer_operation——K9/T-P2-409）", () => {
        expect([...NOTIFICATION_KINDS]).toEqual([
            "approval_pending",
            "turn_settled",
            "job_settled",
            "surface_changed",
            "computer_operation",
        ]);
    });

    it("computer_operation 分型发布（S4 notify 桥接点的消费契约）", () => {
        const hub = new NotificationHub();
        hub.publish("computer_operation", { operation: "click", requestId: "c1" });
        const notifications = hub.poll(0);
        expect(notifications).toHaveLength(1);
        expect(notifications[0]?.kind).toBe("computer_operation");
        expect(notifications[0]?.data).toMatchObject({ operation: "click" });
    });
});

describe("NotificationHub", () => {
    it("publish 四类分型：seq 单调 + 载荷形状", () => {
        const hub = new NotificationHub();
        const a = hub.publish("approval_pending", { requestId: "call-1" });
        const b = hub.publish("job_settled", { jobId: "job-1", status: "completed" });
        const c = hub.publish("surface_changed", { surfaceId: "web-1" });
        const d = hub.publish("turn_settled", { turn: 3 });
        expect(a.kind).toBe("approval_pending");
        expect([a.seq, b.seq, c.seq, d.seq]).toEqual([1, 2, 3, 4]);
        expect(b.data).toEqual({ jobId: "job-1", status: "completed" });
        expect(a.at).toBeGreaterThan(0);
    });

    it("未知分型拒绝（闭集 fail-closed）", () => {
        const hub = new NotificationHub();
        expect(() => hub.publish("random_kind" as never)).toThrow();
    });

    it("push 端订阅：即时回调 + 取消订阅", () => {
        const hub = new NotificationHub();
        const received: NotificationPayload[] = [];
        const unsubscribe = hub.subscribe((n) => received.push(n));
        hub.publish("turn_settled", { turn: 1 });
        unsubscribe();
        hub.publish("turn_settled", { turn: 2 });
        expect(received).toHaveLength(1);
        expect(received[0]?.data).toEqual({ turn: 1 });
    });

    it("push 端监听器异常不毒化发布方与其它监听器", () => {
        const hub = new NotificationHub();
        const received: NotificationPayload[] = [];
        hub.subscribe(() => {
            throw new Error("bad listener");
        });
        hub.subscribe((n) => received.push(n));
        expect(() => hub.publish("job_settled")).not.toThrow();
        expect(received).toHaveLength(1);
    });

    it("poll 端游标补投：只取 seq > cursor 的存量", () => {
        const hub = new NotificationHub();
        for (let i = 0; i < 5; i++) hub.publish("turn_settled", { turn: i });
        expect(hub.poll(0)).toHaveLength(5);
        expect(hub.poll(3)).toHaveLength(2);
        expect(hub.poll(5)).toHaveLength(0);
        expect(hub.poll(999)).toHaveLength(0);
        // 补投条目带原 seq（游标推进由调用方以最大 seq 表达——重放安全）
        expect(hub.poll(3).map((n) => n.seq)).toEqual([4, 5]);
    });

    it("环形缓冲：超容量丢最旧（poll 补投只保最近）", () => {
        const hub = new NotificationHub({ bufferSize: 3 });
        for (let i = 1; i <= 5; i++) hub.publish("turn_settled", { turn: i });
        expect(hub.poll(0).map((n) => (n.data as { turn: number }).turn)).toEqual([3, 4, 5]);
        expect(hub.oldestSeq()).toBe(3);
    });

    it("空缓冲 poll 返回空 + oldestSeq 兜底当前 seq", () => {
        const hub = new NotificationHub();
        expect(hub.poll(0)).toEqual([]);
        expect(hub.oldestSeq()).toBe(0);
    });
});

/** 内存桥（bridge.test 同款：消息泵可控注入）。 */
class FakeAgentChannel implements AgentChannel {
    readonly messages: AsyncIterable<AgentMessage>;
    readonly sent: AgentRequestLike[] = [];
    private listeners: Array<(m: AgentMessage) => void> = [];

    constructor() {
        const self = this;
        this.messages = {
            [Symbol.asyncIterator]() {
                return {
                    next: () =>
                        new Promise<IteratorResult<AgentMessage>>((resolve) => {
                            self.listeners.push((m: AgentMessage) => resolve({ value: m, done: false }));
                        }),
                };
            },
        };
    }

    send(request: AgentRequest): void {
        this.sent.push(request as AgentRequestLike);
    }

    /** 测试注入一条 agent 消息。 */
    emit(message: AgentMessage): void {
        for (const l of [...this.listeners]) l(message);
    }
}

type AgentRequestLike = { type: string } & Record<string, unknown>;

describe("HostBridge × N5 三类归类集成", () => {
    it("审批挂起 → approval_pending（既有 notification 广播零变化）", async () => {
        const hub = new NotificationHub();
        const agent = new FakeAgentChannel();
        const bridge = new HostBridge({
            host: new HostRegistry().register({ sessionId: "s1" }),
            agent,
            store: new SessionStore(new InMemoryEventStorage()),
            notifyHub: hub,
        });
        const notified: Array<{ type?: string; name?: string }> = [];
        const handle = bridge.connectSurface({
            surfaceId: "web-1",
            write: (out) => notified.push(JSON.parse(out) as { name: string }),
        });
        agent.emit({
            type: "approval_requested",
            requestId: "call-1",
            tool: "bash",
            args: {},
            timeoutMs: 30_000,
            category: "tool",
        });
        await Promise.resolve();
        // connectSurface 先发布过 surface/attach 分型——按 kind 过滤断言
        const notifications = hub.poll(0).filter((n) => n.kind === "approval_pending");
        expect(notifications).toHaveLength(1);
        expect(notifications[0]?.data).toMatchObject({ sessionId: "s1", name: "approval_requested" });
        // 既有广播零变化：notification 信封照发
        expect(notified.some((n) => n.type === "notification" && n.name === "approval_requested")).toBe(true);
        handle.close();
        void bridge;
    });

    it("turn/end 事件 → turn_settled 分型", async () => {
        const hub = new NotificationHub();
        const agent = new FakeAgentChannel();
        const bridge = new HostBridge({
            host: new HostRegistry().register({ sessionId: "s1" }),
            agent,
            store: new SessionStore(new InMemoryEventStorage()),
            notifyHub: hub,
        });
        agent.emit({
            type: "event",
            event: { type: "turn/end", seq: 1, ts: 1, turn: 0, reason: { kind: "completed" } } as never,
        });
        await Promise.resolve();
        const notifications = hub.poll(0);
        expect(notifications).toHaveLength(1);
        expect(notifications[0]?.kind).toBe("turn_settled");
        expect(notifications[0]?.data).toMatchObject({ sessionId: "s1", turn: 0 });
        void bridge;
    });

    it("surface 进退 → surface_changed 分型", () => {
        const hub = new NotificationHub();
        const agent = new FakeAgentChannel();
        const bridge = new HostBridge({
            host: new HostRegistry().register({ sessionId: "s1" }),
            agent,
            store: new SessionStore(new InMemoryEventStorage()),
            notifyHub: hub,
        });
        const handle = bridge.connectSurface({
            surfaceId: "web-1",
            write: () => {},
        });
        handle.close();
        const notifications = hub.poll(0);
        expect(notifications.map((n) => n.kind)).toEqual(["surface_changed", "surface_changed"]);
        expect((notifications[0]?.data as { type: string }).type).toBe("surface/attach");
        expect((notifications[1]?.data as { type: string }).type).toBe("surface/detach");
    });

    it("无 notifyHub 时零发布（既有行为完全不变）", async () => {
        const agent = new FakeAgentChannel();
        const bridge = new HostBridge({
            host: new HostRegistry().register({ sessionId: "s1" }),
            agent,
            store: new SessionStore(new InMemoryEventStorage()),
        });
        agent.emit({
            type: "event",
            event: { type: "turn/end", seq: 1, ts: 1, turn: 0, reason: { kind: "completed" } } as never,
        });
        await Promise.resolve();
        expect(true).toBe(true); // 不炸即通过
        void bridge;
    });

    it("U13/T-P3-112 分型消费：bridge.notifyAll 把 hub 转发的 n5 通知广播到端（wire 面）", async () => {
        const hub = new NotificationHub();
        const agent = new FakeAgentChannel();
        const bridge = new HostBridge({
            host: new HostRegistry().register({ sessionId: "s1" }),
            agent,
            store: new SessionStore(new InMemoryEventStorage()),
            notifyHub: hub,
        });
        const notified: Array<{ type?: string; name?: string; payload?: { kind?: string; data?: { turn?: number } } }> = [];
        const handle = bridge.connectSurface({
            surfaceId: "web-1",
            write: (out) => notified.push(JSON.parse(out)),
        });
        // server.ts start() 的接线形状：hub.subscribe → bridge.notifyAll("n5", n)
        const unsub = hub.subscribe((n) => bridge.notifyAll("n5", n));
        agent.emit({
            type: "event",
            event: { type: "turn/end", seq: 1, ts: 1, turn: 1, reason: { kind: "completed" } } as never,
        });
        await Promise.resolve();
        const n5 = notified.filter((n) => n.type === "notification" && n.name === "n5");
        expect(n5).toHaveLength(1);
        expect(n5[0]?.payload?.kind).toBe("turn_settled");
        expect(n5[0]?.payload?.data?.turn).toBe(1);
        unsub();
        handle.close();
        void bridge;
    });
});
