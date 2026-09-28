import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
    loadPlugin,
    PluginSdkError,
    PLUGIN_EVENT_TIMEOUT_MS,
    type AegentPlugin,
    type PluginCapabilities,
} from "./plugin-sdk.js";
import { PluginManifestError } from "../kernel/plugin-manifest.js";
import { EVENT_TYPES, type SessionEvent } from "../kernel/events.js";

const CAPS = ["tools", "events"] as const;

/** 最小可用插件：激活时订阅并登记，事件回调记录收到的快照。 */
function goodPlugin(overrides: Partial<AegentPlugin> = {}, received: SessionEvent[] = []): AegentPlugin {
    return {
        manifest: { name: "hello", trust: "untrusted", capabilities: ["events", "tools"] },
        onActivate: (caps) => {
            caps.registerTool({ name: "hello_tool", execute: () => ({ content: "hi" }) });
            caps.subscribe(["tool/call", "user/message"]);
        },
        onEvent: (e) => {
            received.push(e);
        },
        ...overrides,
    };
}

function evt(type: SessionEvent["type"], seq: number): SessionEvent {
    return { type, seq, ts: 1_000 + seq, turn: 1, payload: { hello: `n${String(seq)}` } } as SessionEvent;
}

describe("loadPlugin —— 加载面校验（P1 地基复用）", () => {
    it("好插件装载成功：清单过校验、onActivate 被调、登记与订阅生效", async () => {
        const received: SessionEvent[] = [];
        const handle = await loadPlugin(goodPlugin({}, received), { availableCapabilities: CAPS });
        expect(handle.manifest.name).toBe("hello");
        expect(handle.disposed).toBe(false);
        // 登记：trust 随清单（untrusted），装配面按 I6 分轨消费
        expect(handle.tools).toHaveLength(1);
        expect(handle.tools[0]).toMatchObject({ pluginName: "hello", trust: "untrusted", def: { name: "hello_tool" } });
        // 订阅生效：tool/call 投递到达
        const report = await handle.deliver(evt("tool/call", 1));
        expect(report).toMatchObject({ pluginName: "hello", ok: true });
        expect(received).toHaveLength(1);
    });

    it("坏 manifest 类型化拒绝（PluginManifestError——P1 纪律：缺字段/未实现能力/闭集外字段）", async () => {
        await expect(
            loadPlugin(goodPlugin({ manifest: { trust: "untrusted", capabilities: ["events"] } }), {
                availableCapabilities: CAPS,
            }),
        ).rejects.toBeInstanceOf(PluginManifestError);
        await expect(
            loadPlugin(goodPlugin({ manifest: { name: "x", trust: "untrusted", capabilities: ["time-travel"] } }), {
                availableCapabilities: CAPS,
            }),
        ).rejects.toThrow(/未实现的能力/);
        await expect(
            loadPlugin(goodPlugin({ manifest: { name: "x", trust: "untrusted", capabilities: [], hacker: true } }), {
                availableCapabilities: CAPS,
            }),
        ).rejects.toThrow(/闭集外字段/);
    });

    it("SDK 契约拒绝：onActivate 缺失 / onEvent 提供了但不是函数", async () => {
        await expect(
            loadPlugin(goodPlugin({ onActivate: undefined as unknown as AegentPlugin["onActivate"] }), {
                availableCapabilities: CAPS,
            }),
        ).rejects.toBeInstanceOf(PluginSdkError);
        await expect(
            loadPlugin(goodPlugin({ onEvent: "not-a-function" as unknown as AegentPlugin["onEvent"] }), {
                availableCapabilities: CAPS,
            }),
        ).rejects.toBeInstanceOf(PluginSdkError);
    });

    it("能力 token 属性闭集：只有 registerTool 与 subscribe（无内核句柄面）", async () => {
        let seen: string[] = [];
        await loadPlugin(
            goodPlugin({
                onActivate: (caps: PluginCapabilities) => {
                    seen = Object.keys(caps).sort();
                },
            }),
            { availableCapabilities: CAPS },
        );
        expect(seen).toEqual(["registerTool", "subscribe"]);
    });

    it("源码证伪：SDK 模块不 import 工具注册表/会话存储/沙箱（内核句柄不外泄）", () => {
        const source = readFileSync(new URL("./plugin-sdk.ts", import.meta.url), "utf8");
        const imports = source
            .split("\n")
            .filter((line) => line.trim().startsWith("import "))
            .join("\n");
        for (const forbidden of ["tools/registry", "tools/context", "session/store", "sandbox"]) {
            expect(imports.includes(forbidden), `import 面不得引用 ${forbidden}`).toBe(false);
        }
    });
});

describe("SDK 能力面 —— 登记/订阅的受限纪律", () => {
    it("工具重名拒绝（同名覆盖会让不可信代码静默换掉可信工具）", async () => {
        const plugin = goodPlugin({
            onActivate: (caps) => {
                caps.registerTool({ name: "t", execute: () => ({ content: "a" }) });
                caps.registerTool({ name: "t", execute: () => ({ content: "b" }) });
            },
        });
        await expect(loadPlugin(plugin, { availableCapabilities: CAPS })).rejects.toThrow(/重名/);
    });

    it("订阅未知事件类型类型化拒绝（⊆ EVENT_TYPES 闭集）", async () => {
        const plugin = goodPlugin({
            onActivate: (caps) => {
                caps.subscribe(["tool/call", "galaxy/destroy" as never]);
            },
        });
        await expect(loadPlugin(plugin, { availableCapabilities: CAPS })).rejects.toThrow(/未知事件类型/);
        // 闭集内全部合法
        const ok = goodPlugin({
            onActivate: (caps) => {
                caps.subscribe([...EVENT_TYPES]);
            },
        });
        await expect(loadPlugin(ok, { availableCapabilities: CAPS })).resolves.toBeDefined();
    });

    it("只投已订阅类型：未订阅事件 ok 且 onEvent 零触达", async () => {
        const received: SessionEvent[] = [];
        const handle = await loadPlugin(goodPlugin({}, received), { availableCapabilities: CAPS });
        const report = await handle.deliver(evt("turn/start", 9));
        expect(report).toEqual({ pluginName: "hello", ok: true });
        expect(received).toHaveLength(0);
    });

    it("快照投递：收到的对象与内核事件不是同一引用，改快照不影响内核对象", async () => {
        const received: SessionEvent[] = [];
        const handle = await loadPlugin(goodPlugin({}, received), { availableCapabilities: CAPS });
        const original = evt("tool/call", 2);
        await handle.deliver(original);
        expect(received[0]).not.toBe(original);
        expect(received[0]).toEqual(original);
    });
});

describe("生命周期序 —— 激活 → 投递 → 收摊", () => {
    it("dispose：onDispose 被调、工具注销、订阅失效、deliver 拒绝、幂等", async () => {
        const received: SessionEvent[] = [];
        let disposed = false;
        const handle = await loadPlugin(
            goodPlugin({ onDispose: () => {
                disposed = true;
            } }, received),
            { availableCapabilities: CAPS },
        );
        await handle.deliver(evt("tool/call", 1));
        await handle.dispose();
        expect(disposed).toBe(true);
        expect(handle.disposed).toBe(true);
        expect(handle.tools).toHaveLength(0);
        const after = await handle.deliver(evt("tool/call", 2));
        expect(after).toMatchObject({ ok: false, error: "插件已收摊" });
        expect(received).toHaveLength(1);
        await expect(handle.dispose()).resolves.toBeUndefined();
        expect(disposed).toBe(true);
    });

    it("事件回调带超时预算（deadline 原语）：挂死的插件不拖垮投递方", async () => {
        const handle = await loadPlugin(
            goodPlugin({ onEvent: () => new Promise<void>(() => undefined) }),
            { availableCapabilities: CAPS, eventTimeoutMs: 30 },
        );
        const report = await handle.deliver(evt("tool/call", 3));
        expect(report.ok).toBe(false);
        expect(report.error).toContain("PLUGIN_EVENT_TIMEOUT");
    });

    it("事件回调抛错不冒泡：报告 ok:false、内核照常拿到结果", async () => {
        const handle = await loadPlugin(
            goodPlugin({ onEvent: () => {
                throw new Error("plugin boom");
            } }),
            { availableCapabilities: CAPS },
        );
        const report = await handle.deliver(evt("tool/call", 4));
        expect(report).toMatchObject({ ok: false, error: "plugin boom" });
    });

    it("激活抛错视为装载失败（fail-closed，不产出半激活句柄）", async () => {
        await expect(
            loadPlugin(
                goodPlugin({ onActivate: () => {
                    throw new Error("activate failed");
                } }),
                { availableCapabilities: CAPS },
            ),
        ).rejects.toThrow("activate failed");
    });

    it("缺省超时常量在位（experimental 面的护栏值）", () => {
        expect(PLUGIN_EVENT_TIMEOUT_MS).toBe(5_000);
    });
});
