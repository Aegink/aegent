/**
 * 进程外插件（I4）——websocket 传输的插件宿主面。
 *
 * 取 pi-desktop·plugin-websocket 的行为（🔴 只学行为零代码摘取）："插件
 * 永不持有 socket 对象、每个连接有界、socket 随插件死、transport 可注入"
 * ——宿主是唯一持有 ws 连接的一方，插件进程只经消息信封表达意图；断线
 * 降级（插件缺席不崩内核——能力注销 + 失败报告，不冒泡）。不抄其
 * Electron 面。握手复用 host/protocol 的 hello 面（{type:"hello",version}
 * → 版本不符 hello_error，PROTOCOL_VERSION 锁定——协议版本化的风险面）；
 * K4 ACP 同款行协议纪律（JSON 信封、每消息一帧）。
 *
 * 不可信边界：进程外即隔离（无共享内存——沙箱面不做二次加固，记档）。
 * ws 插件自报的身份不采信：其登记的工具 trust 恒 "untrusted"（宿主标注，
 * 与插件的自我声明无关），且注册必须经 onToolRegistration 审批回调——
 * "不受信来源默认 deny"的 C 族策略消费点在装配面，本模块只把审批位
 * 留出并如实回执（tool_rejected）。重连面缺省不做（记档——一次性会话
 * 模型：断线即能力注销，恢复由调用方重新 connect）。
 *
 * 消息有界（pi-desktop 行为）：握手与调用往返都套 deadline 原语（M7）——
 * 挂死的插件进程拖不垮宿主；ws 层 maxPayload 断超大帧。
 */

import { WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../host/protocol.js";
import { Deadline, withDeadline, TimeoutError } from "../kernel/deadline.js";
import { EVENT_TYPES, type SessionEvent, type JsonValue, type JsonRecord } from "../kernel/events.js";
import type { PluginToolDef, PluginToolEntry, PluginDeliveryReport } from "./plugin-sdk.js";

/** 握手与工具调用的缺省预算：插件进程是不可信外部——挂死必须可回收。 */
export const WS_PLUGIN_HANDSHAKE_TIMEOUT_MS = 5_000;
export const WS_PLUGIN_TOOL_TIMEOUT_MS = 10_000;

/** 握手/信封层面的类型化拒绝（区别于工具层的 TimeoutError）。 */
export class WsPluginError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "WsPluginError";
        this.code = code;
    }
}

/** 插件进程 → 宿主的信封闭集（hello 三枚复用 host/protocol 形状）。 */
export type WsPluginServerEnvelope =
    | { type: "hello_ack"; name: string }
    | { type: "register_tool"; tool: { name: string; parameters?: JsonValue } }
    | { type: "subscribe"; types: readonly string[] }
    | { type: "tool_result"; callId: string; content: string; isError?: boolean };

/** 宿主 → 插件进程的信封闭集。 */
export type WsPluginClientEnvelope =
    | { type: "hello"; version: typeof PROTOCOL_VERSION }
    | { type: "tool_registered"; name: string }
    | { type: "tool_rejected"; name: string; error: string }
    | { type: "subscribed"; types: readonly string[] }
    | { type: "event"; event: SessionEvent }
    | { type: "tool_invoke"; callId: string; name: string; args: JsonRecord }
    | { type: "protocol_error"; error: { code: string; message: string } };

/** 审批回调：ws 插件的工具注册必经（不受信来源——装配面接 C 族规则）。 */
export type ToolRegistrationGate = (tool: {
    readonly name: string;
    readonly parameters?: JsonValue;
}) => boolean;

export interface WsPluginHandle {
    /** 插件自报名（仅作显示标识——信任判定不依据它）。 */
    readonly name: string;
    /** 已登记工具（trust 恒 "untrusted"——宿主标注；execute 是进程外往返）。 */
    readonly tools: readonly PluginToolEntry[];
    /** 向插件投递事件（只投其订阅过的类型；断线/未订阅如实报告）。 */
    deliver(event: SessionEvent): Promise<PluginDeliveryReport>;
    /** 收摊（幂等）：关闭连接 + 能力注销；此后 deliver 失败报告。 */
    dispose(): Promise<void>;
    readonly disposed: boolean;
}

export interface WsPluginHostOptions {
    /** 握手预算（缺省 5s）；插件进程挂死时 connect 按此超时拒绝。 */
    readonly handshakeTimeoutMs?: number;
    /** 工具调用往返预算（缺省 10s）。 */
    readonly toolTimeoutMs?: number;
    /** 工具注册审批位（缺省全拒——不受信来源默认 deny 的最保守缺省）。 */
    readonly onToolRegistration?: ToolRegistrationGate;
    /** 断线回调（能力注销完成后触发；重连由调用方决定）。 */
    readonly onDisconnected?: (reason: string) => void;
    /** 坏信封观察位（不崩——记数 + 回 protocol_error；测试断言用）。 */
    readonly onBadFrame?: (error: WsPluginError) => void;
}

/**
 * 连接一个 ws 插件进程：open → hello（PROTOCOL_VERSION）→ 等 hello_ack
 * （deadline 预算）→ 句柄。版本不符（hello_error）与超时都是类型化拒绝。
 */
export function connectWsPlugin(url: string, options: WsPluginHostOptions = {}): Promise<WsPluginHandle> {
    const handshakeMs = options.handshakeTimeoutMs ?? WS_PLUGIN_HANDSHAKE_TIMEOUT_MS;
    const toolMs = options.toolTimeoutMs ?? WS_PLUGIN_TOOL_TIMEOUT_MS;
    return new Promise<WsPluginHandle>((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(url, { maxPayload: 1024 * 1024 });
        const fail = (error: WsPluginError) => {
            if (settled) return;
            settled = true;
            try {
                ws.terminate();
            } catch {
                // 收摊尽力而为：僵死的 socket 不得阻塞调用方
            }
            reject(error);
        };
        ws.on("error", (err: Error) => fail(new WsPluginError("CONNECT_FAILED", err.message)));
        ws.on("open", () => {
            ws.send(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION } satisfies WsPluginClientEnvelope));
            const handshake = new Promise<{ name: string }>((res, rej) => {
                const onMessage = (raw: Buffer) => {
                    let env: unknown;
                    try {
                        env = JSON.parse(raw.toString());
                    } catch {
                        rej(new WsPluginError("BAD_HANDSHAKE", "握手帧不是 JSON"));
                        return;
                    }
                    const e = env as WsPluginServerEnvelope;
                    if (e?.type === "hello_ack" && typeof e.name === "string") {
                        res({ name: e.name });
                    } else if ((e as { type?: string })?.type === "hello_error") {
                        rej(new WsPluginError("PROTOCOL_VERSION_MISMATCH", "插件侧拒绝协议版本"));
                    } else {
                        rej(new WsPluginError("BAD_HANDSHAKE", `握手阶段收到非 hello_ack 信封：${JSON.stringify((e as { type?: unknown })?.type) ?? "非对象"}`));
                    }
                };
                ws.once("message", onMessage);
            });
            withDeadline(Deadline.fromTimeoutMs("WS_PLUGIN_HANDSHAKE", handshakeMs), handshake)
                .then(({ name }) => {
                    if (settled) return;
                    settled = true;
                    resolve(buildHandle(ws, name, toolMs, options));
                })
                .catch((e: unknown) => {
                    if (e instanceof TimeoutError) {
                        fail(new WsPluginError("HANDSHAKE_TIMEOUT", `插件握手在 ${String(handshakeMs)}ms 内未完成`));
                    } else {
                        fail(e instanceof WsPluginError ? e : new WsPluginError("BAD_HANDSHAKE", String(e)));
                    }
                });
        });
        // 插件侧拒绝版本：hello_error 形状（host/protocol 同款 code）
        ws.on("close", (code: number) => fail(new WsPluginError("CONNECT_FAILED", `连接在握手前关闭（code=${String(code)}）`)));
    });
}

/** 握手成功后的运行面：信封派发 + 工具登记/执行 + 事件投递 + 断线注销。 */
function buildHandle(
    ws: WebSocket,
    name: string,
    toolMs: number,
    options: WsPluginHostOptions,
): WsPluginHandle {
    const tools: PluginToolEntry[] = [];
    const subscribed = new Set<string>();
    const pending = new Map<string, (r: { content: string; isError?: boolean }) => void>();
    let alive = true;
    let disconnectReason: string | undefined;

    const send = (env: WsPluginClientEnvelope): boolean => {
        if (!alive || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(env));
        return true;
    };
    let invokeSeq = 1;

    ws.on("message", (raw: Buffer) => {
        if (!alive) return;
        let env: unknown;
        try {
            env = JSON.parse(raw.toString());
        } catch {
            const err = new WsPluginError("BAD_FRAME", "信封不是 JSON");
            options.onBadFrame?.(err);
            send({ type: "protocol_error", error: { code: err.code, message: err.message } });
            return;
        }
        if (env === null || typeof env !== "object" || typeof (env as WsPluginServerEnvelope).type !== "string") {
            const err = new WsPluginError("BAD_FRAME", "信封缺少 type 字段");
            options.onBadFrame?.(err);
            send({ type: "protocol_error", error: { code: err.code, message: err.message } });
            return;
        }
        const e = env as WsPluginServerEnvelope;
        switch (e.type) {
            case "register_tool": {
                const tool = e.tool;
                if (tool === null || typeof tool !== "object" || typeof (tool as { name?: unknown }).name !== "string"
                    || (tool as { name: string }).name.trim() === "") {
                    const err = new WsPluginError("BAD_FRAME", "register_tool 的 tool 形状非法");
                    options.onBadFrame?.(err);
                    send({ type: "protocol_error", error: { code: err.code, message: err.message } });
                    return;
                }
                const def: PluginToolDef = {
                    name: tool.name,
                    ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
                    execute: (args) =>
                        invokeTool(tool.name, args),
                };
                if (tools.some((t) => t.def.name === tool.name)) {
                    send({ type: "tool_rejected", name: tool.name, error: "工具重名" });
                    return;
                }
                const allowed = options.onToolRegistration?.(tool) ?? false;
                if (!allowed) {
                    send({ type: "tool_rejected", name: tool.name, error: "审批拒绝" });
                    return;
                }
                tools.push({ pluginName: name, trust: "untrusted", def });
                send({ type: "tool_registered", name: tool.name });
                return;
            }
            case "subscribe": {
                const unknown = e.types.filter((t) => !(EVENT_TYPES as readonly string[]).includes(t));
                if (unknown.length > 0) {
                    send({ type: "protocol_error", error: { code: "BAD_FRAME", message: `订阅了未知事件类型：${unknown.join(", ")}` } });
                    return;
                }
                for (const t of e.types) subscribed.add(t);
                send({ type: "subscribed", types: [...e.types] });
                return;
            }
            case "tool_result": {
                const settle = pending.get(e.callId);
                if (settle !== undefined) {
                    pending.delete(e.callId);
                    settle({ content: e.content, ...(e.isError === true ? { isError: true } : {}) });
                }
                return;
            }
            case "hello_ack":
                // 迟到的重复 hello_ack：握手已过，按坏信封处理不崩
                options.onBadFrame?.(new WsPluginError("BAD_FRAME", "握手后收到 hello_ack"));
                return;
            default: {
                const err = new WsPluginError("BAD_FRAME", `未知信封类型：${String((e as { type: string }).type)}`);
                options.onBadFrame?.(err);
                send({ type: "protocol_error", error: { code: err.code, message: err.message } });
            }
        }
    });

    const invokeTool = (toolName: string, args: JsonRecord): Promise<{ content: string; isError?: boolean }> => {
        if (!alive) return Promise.reject(new WsPluginError("DISCONNECTED", "插件已断线"));
        const callId = `call-${String(invokeSeq++)}`;
        return new Promise((resolve, reject) => {
            withDeadline(
                Deadline.fromTimeoutMs("WS_PLUGIN_TOOL", toolMs),
                new Promise<{ content: string; isError?: boolean }>((resolve2) => {
                    pending.set(callId, resolve2);
                    if (!send({ type: "tool_invoke", callId, name: toolName, args })) {
                        pending.delete(callId);
                        reject(new WsPluginError("DISCONNECTED", "插件已断线"));
                    }
                }),
            ).then(resolve, reject);
        });
    };

    ws.on("close", () => {
        if (!alive) return;
        alive = false;
        tools.length = 0;
        subscribed.clear();
        const reason = disconnectReason ?? "连接关闭";
        for (const [, settle] of pending) settle({ content: reason, isError: true });
        pending.clear();
        options.onDisconnected?.(reason);
    });
    ws.on("error", (err: Error) => {
        if (!alive) return;
        disconnectReason = `连接错误：${err.message}`;
    });

    return {
        name,
        get tools(): readonly PluginToolEntry[] {
            return alive ? [...tools] : [];
        },
        get disposed(): boolean {
            return !alive;
        },
        deliver: async (event) => {
            if (!alive) return { pluginName: name, ok: false, error: "插件已断线" };
            if (!subscribed.has(event.type)) return { pluginName: name, ok: true };
            if (!send({ type: "event", event })) {
                return { pluginName: name, ok: false, error: "发送失败" };
            }
            return { pluginName: name, ok: true };
        },
        dispose: async () => {
            if (!alive) return;
            alive = false;
            tools.length = 0;
            subscribed.clear();
            await new Promise<void>((resolve) => {
                ws.close(1000, "host dispose");
                // close 回调已挂能力注销；预算兜底防僵死连接挂住 dispose
                const timer = setTimeout(resolve, 1_000);
                ws.once("close", () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        },
    };
}
