import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    BUILTIN_PERSONAS,
    PersonaError,
    renderPersona,
    resolvePersona,
} from "./persona.js";
import { createChildAssembly } from "../kernel/assembly.js";
import { composeChain } from "../kernel/chain.js";
import {SessionEventStore, type SessionStore} from "./store.js";

describe("resolvePersona —— 预设选择", () => {
    it("undefined = 未选择（返回 undefined——装配零变化，不注入人格段）", () => {
        expect(resolvePersona(undefined)).toBeUndefined();
    });

    it("内置两例命中：default / coder（id/name/模板形状）", () => {
        const d = resolvePersona("default")!;
        const c = resolvePersona("coder")!;
        expect(d.id).toBe("default");
        expect(d.name.length).toBeGreaterThan(0);
        expect(d.systemPromptTemplate).toContain("{{workspace}}");
        expect(c.id).toBe("coder");
        expect(c.systemPromptTemplate).toContain("{{workspace}}");
        expect(BUILTIN_PERSONAS).toHaveLength(2);
    });

    it("未知 id 类型化拒绝（UNKNOWN_PERSONA，fail-closed 不静默降级）", () => {
        try {
            resolvePersona("nope");
            expect.unreachable("未知预设必须抛错");
        } catch (e) {
            expect(e).toBeInstanceOf(PersonaError);
            expect((e as PersonaError).code).toBe("UNKNOWN_PERSONA");
            expect((e as PersonaError).message).toContain("default | coder");
        }
    });
});

describe("renderPersona —— 模板渲染", () => {
    const p = resolvePersona("default")!;

    it("{{key}} 占位符按 vars 替换", () => {
        const out = renderPersona(p, { workspace: "/proj/a" });
        expect(out).toContain("平衡协作（/proj/a）");
        expect(out).not.toContain("{{workspace}}");
    });

    it("vars 缺 key 保留字面（温和降级）；多余 vars 忽略", () => {
        const out = renderPersona(p, {});
        expect(out).toContain("{{workspace}}");
        const out2 = renderPersona(p, { workspace: "/w", unused: "x" });
        expect(out2).toContain("（/w）");
        expect(out2).not.toContain("unused");
    });

    it("非 \\w 形状视为普通文本（{{a.b}} 不解析）", () => {
        const out = renderPersona({ id: "t", name: "t", systemPromptTemplate: "x {{a.b}} y" }, { "a.b": "v" });
        expect(out).toBe("x {{a.b}} y");
    });
});

describe("装配消费面 —— 人格段进首落 system/message", () => {
    function make(root: string, personaId?: string) {
        const store = new SessionEventStore();
        const asm = createChildAssembly({
            sessionId: "s0",
            store,
            workspaceRoot: root,
            contextWindow: 100_000,
            approvalTimeoutMs: 5_000,
            ...(personaId !== undefined ? { personaId } : {}),
        });
        const contextLayer = asm.layers.modelRequest![asm.layers.modelRequest!.length - 1]!;
        const executor = composeChain({
            point: "modelRequest",
            layers: [contextLayer],
            terminal: async () => ({ content: "", toolCalls: [], timed: [] }),
        });
        return { store, executor };
    }

    async function runFirstTurn(root: string, personaId?: string): Promise<string> {
        const { store, executor } = make(root, personaId);
        // system/message 要求开启的 turn+step（词汇表校验）——先落轮/步开启
        store.append("s0", [
            { type: "turn/start", turn: 1 },
            { type: "step/start", turn: 1, step: 1 },
        ]);
        await executor.run(
            { sessionId: "s0" },
            { turn: 1, step: 1, identity: { provider: "echo", modelId: "m1" }, messages: [] },
        );
        const system = store.load("s0").find((e) => e.type === "system/message");
        expect(system).toBeDefined();
        return (system as { message: { content: string } }).message.content;
    }

    it("personaId: coder → 首落系统提示含渲染后人格段（{{workspace}} 已替换）", async () => {
        const root = mkdtempSync(join(tmpdir(), "persona-"));
        const content = await runFirstTurn(root, "coder");
        expect(content).toContain("编码专注");
        expect(content).toContain(`（${root}）`);
        expect(content).not.toContain("{{workspace}}");
    });

    it("未提供 personaId → 首落系统提示零人格段（既有装配零变化）", async () => {
        const root = mkdtempSync(join(tmpdir(), "persona-"));
        const content = await runFirstTurn(root);
        expect(content).not.toContain("编码专注");
        expect(content).not.toContain("平衡协作");
    });

    it("未知 personaId → 装配期 PersonaError（启动即败，不静默跳过）", async () => {
        const root = mkdtempSync(join(tmpdir(), "persona-"));
        const store = new SessionEventStore();
        expect(() =>
            createChildAssembly({
                sessionId: "s0",
                store,
                workspaceRoot: root,
                contextWindow: 100_000,
                approvalTimeoutMs: 5_000,
                personaId: "nope",
            }),
        ).toThrow(PersonaError);
    });
});
