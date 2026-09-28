import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createAcpBackend,
    createInProcessBackend,
    IN_PROCESS_BACKEND,
    SubagentBackendError,
    SubagentBackendRegistry,
    type AcpBackendTransport,
    type SubagentBackend,
    type SubagentSpawnRequest,
} from "./subagent-backend.js";
import { createSubagentRunner } from "../kernel/subagent.js";
import { ScriptedProvider } from "../kernel/loop.test-utils.js";
import { SessionStore } from "./store.js";
import type { ModelIdentity } from "../models/identity.js";

const identity: ModelIdentity = { provider: "scripted", modelId: "script-1" };

/** 进程内后端夹具：剧本 provider 直接产出最终答复（一轮完成）。 */
function makeInProcess(): SubagentBackend {
    const root = mkdtempSync(join(tmpdir(), "backend-"));
    const store = new SessionStore();
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "整理结果：事件流是唯一真相" }, { type: "done" }]);
    const runner = createSubagentRunner({
        parentSessionId: "s0",
        store,
        provider,
        identity,
        workspaceRoot: root,
        contextWindow: 200_000,
        parentRules: [],
        depth: 0,
        approvalTimeoutMs: 5_000,
    });
    return createInProcessBackend(runner);
}

/** ACP 内存桥：模拟外部 agent 应答三连 + 文本流。 */
function makeAcpTransport(
    onPrompt?: (write: (line: string) => void) => void,
): { transport: AcpBackendTransport; sent: unknown[] } {
    const sent: unknown[] = [];
    const queue: string[] = [];
    let notify: (() => void) | undefined;
    let closed = false;
    const push = (line: string) => {
        queue.push(line);
        notify?.();
    };
    const write = (line: string): void => {
        const env = JSON.parse(line) as { id?: number; method: string };
        sent.push(env);
        if (env.method === "initialize") {
            push(JSON.stringify({ jsonrpc: "2.0", id: env.id, result: { protocolVersion: 1 } }));
        } else if (env.method === "session/new") {
            push(JSON.stringify({ jsonrpc: "2.0", id: env.id, result: { sessionId: "ext-1" } }));
        } else if (env.method === "session/prompt") {
            onPrompt?.(write);
            // 默认行为：两条文本块 + end_turn 结算
            push(
                JSON.stringify({
                    jsonrpc: "2.0",
                    method: "session/update",
                    params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "外部" } } },
                }),
            );
            push(
                JSON.stringify({
                    jsonrpc: "2.0",
                    method: "session/update",
                    params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "答复" } } },
                }),
            );
            push(JSON.stringify({ jsonrpc: "2.0", id: env.id, result: { stopReason: "end_turn" } }));
        }
    };
    const transport: AcpBackendTransport = {
        write,
        lines: (async function* () {
            for (;;) {
                if (queue.length > 0) {
                    yield queue.shift()!;
                    continue;
                }
                if (closed) return;
                await new Promise<void>((r) => {
                    notify = r;
                });
                notify = undefined;
            }
        })(),
        close: () => {
            closed = true;
            notify?.();
        },
    };
    return { transport, sent };
}

const REQUEST: SubagentSpawnRequest = { prompt: "查一下事件流", description: "调研" };

describe("H6 两后端同语义 —— 同一请求结果形状一致", () => {
    it("InProcessBackend：真子循环往返（completed + output）", async () => {
        const backend = makeInProcess();
        expect(backend.name).toBe(IN_PROCESS_BACKEND);
        const result = await backend.spawn(REQUEST);
        expect(result.stopReason).toBe("completed");
        expect(result.output).toContain("事件流是唯一真相");
        expect(result.sessionId).not.toBe("");
    });

    it("AcpBackend：内存桥往返（initialize→session/new→session/prompt，文本流累积）", async () => {
        const { transport, sent } = makeAcpTransport();
        const backend = createAcpBackend({ transport });
        const result = await backend.spawn(REQUEST);
        expect(result).toMatchObject({ sessionId: "ext-1", stopReason: "completed", output: "外部答复" });
        // 出站方法序断言
        expect((sent as { method: string }[]).map((e) => e.method)).toEqual([
            "initialize",
            "session/new",
            "session/prompt",
        ]);
        // prompt 载荷形状：ACP 文本块
        const prompt = (sent as { method: string; params?: unknown }[]).find((e) => e.method === "session/prompt");
        expect(prompt?.params).toMatchObject({
            sessionId: "ext-1",
            prompt: [{ type: "text", text: REQUEST.prompt }],
        });
    });

    it("两后端结果字段集合一致（事件词汇同源——H2 结算形状收敛）", async () => {
        const inProc = await makeInProcess().spawn(REQUEST);
        const { transport } = makeAcpTransport();
        const acp = await createAcpBackend({ transport }).spawn(REQUEST);
        const keysOf = (r: object) => Object.keys(r).sort().filter((k) => r[k as keyof typeof r] !== undefined);
        expect(keysOf(inProc)).toEqual(keysOf(acp));
        expect(["completed", "failed", "cancelled"]).toContain(acp.stopReason);
        expect(["completed", "failed", "cancelled"]).toContain(inProc.stopReason);
    });
});

describe("AcpBackend —— 拒绝面与 never-reject 结算", () => {
    it("stopReason 映射：cancelled→cancelled、max_tokens→failed", async () => {
        for (const [acpReason, expected] of [
            ["cancelled", "cancelled"],
            ["max_tokens", "failed"],
        ] as const) {
            // 构造只回指定 stopReason 的桥
            const sent: unknown[] = [];
            const queue: string[] = [];
            let notify: (() => void) | undefined;
            const t2: AcpBackendTransport = {
                write: (line) => {
                    const env = JSON.parse(line) as { id?: number; method: string };
                    sent.push(env);
                    if (env.method === "initialize") queue.push(JSON.stringify({ jsonrpc: "2.0", id: env.id, result: {} }));
                    else if (env.method === "session/new") queue.push(JSON.stringify({ jsonrpc: "2.0", id: env.id, result: { sessionId: "e2" } }));
                    else queue.push(JSON.stringify({ jsonrpc: "2.0", id: env.id, result: { stopReason: acpReason } }));
                    notify?.();
                },
                lines: (async function* () {
                    for (;;) {
                        if (queue.length > 0) {
                            yield queue.shift()!;
                            continue;
                        }
                        await new Promise<void>((r) => {
                            notify = r;
                        });
                        notify = undefined;
                    }
                })(),
                close: () => undefined,
            };
            const result = await createAcpBackend({ transport: t2 }).spawn(REQUEST);
            expect(result.stopReason).toBe(expected);
        }
    });

    it("never-reject：外部 agent 断流 → failed 结算（不上抛）；坏行不崩", async () => {
        const broken: AcpBackendTransport = {
            write: () => undefined,
            lines: (async function* () {
                yield "not-json-at-all"; // 坏行：忽略
                return; // 断流
            })(),
            close: () => undefined,
        };
        const result = await createAcpBackend({ transport: broken, timeoutMs: 2_000 }).spawn(REQUEST);
        expect(result.stopReason).toBe("failed");
        expect(result.error).toBeDefined();
    });

    it("超时回收：挂死的外部 agent 在 deadline 内结算 failed", async () => {
        const stuck: AcpBackendTransport = {
            write: () => undefined,
            lines: (async function* () {
                await new Promise(() => undefined); // 永不产出
            })(),
            close: () => undefined,
        };
        const result = await createAcpBackend({ transport: stuck, timeoutMs: 100 }).spawn(REQUEST);
        expect(result.stopReason).toBe("failed");
        expect(result.error).toContain("超时回收");
    });
});

describe("SubagentBackendRegistry —— 按名字选择", () => {
    it("注册/查询/派发；未知后端类型化拒绝（不静默回退缺省）", async () => {
        const registry = new SubagentBackendRegistry();
        const inProc = makeInProcess();
        const un = registry.register(inProc);
        expect(registry.list()).toEqual([IN_PROCESS_BACKEND]);
        // 缺省名派发
        await expect(registry.spawn(undefined, REQUEST)).resolves.toMatchObject({ stopReason: "completed" });
        // 未知名字 → 类型化拒绝
        expect(() => registry.get("codex")).toThrow(SubagentBackendError);
        await expect(registry.spawn("codex", REQUEST)).rejects.toMatchObject({
            code: "SUBAGENT_BACKEND_UNKNOWN",
        });
        un();
        expect(registry.list()).toEqual([]);
        // 缺省后端也不在 → 同样拒绝
        await expect(registry.spawn(undefined, REQUEST)).rejects.toMatchObject({
            code: "SUBAGENT_BACKEND_UNKNOWN",
        });
    });

    it("重名注册拒绝", () => {
        const registry = new SubagentBackendRegistry();
        registry.register(makeInProcess());
        expect(() => registry.register(makeInProcess())).toThrow(/重名/);
    });
});
