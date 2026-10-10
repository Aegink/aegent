import { describe, expect, it } from "vitest";
import {
    createClaudeCodeHookBridge,
    createCodexHookBridge,
    HookCompatError,
    type EcosystemHookRunner,
    type HookBridge,
} from "./hook-compat.js";
import { HookRegistry } from "../kernel/hooks.js";
import type { ToolCallPayload } from "../core/primitives/loop/loop.js";
import type { ToolExecutionResult } from "../core/primitives/loop/loop.js";

/** 真实生态脚本样本（claude-code hooks.json 的 hooks 键形态）。 */
const CC_CONFIG = {
    PreToolUse: [
        {
            matcher: "Bash|Write",
            hooks: [{ type: "command", command: "python3 ~/.claude/hooks/protect.py" }],
        },
        {
            // 无 matcher = 全匹配（CC 语义）
            hooks: [{ type: "command", command: "node ~/.claude/hooks/audit.js" }],
        },
    ],
};

const CODEX_CONFIG = {
    PreToolUse: [
        { matcher: "shell", hooks: [{ type: "command", command: "~/.codex/hooks/guard.sh" }] },
    ],
};

function payload(name = "Bash", args = '{"command":"ls -la"}'): ToolCallPayload {
    return { turn: 3, step: 2, callId: "call-01", name, arguments: args };
}

/** fake runner：按命令路由预置应答，并记录收到的 stdin（映射往返断言用）。 */
function fakeRunner(
    replies: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>,
    received: { command: string; stdin: unknown }[] = [],
): EcosystemHookRunner {
    return async (command, stdinJson) => {
        received.push({ command, stdin: JSON.parse(stdinJson) });
        const r = replies[command] ?? {};
        return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.exitCode ?? 0 };
    };
}

const LOOP_CTX = { sessionId: "s-main" };
/** 完整 ChainNext 形状（point/trace/budget 同 composeChain 的装配）。 */
function passthrough(result: ToolExecutionResult = { content: "ran" }) {
    const next = async () => result;
    return Object.assign(next, {
        point: "toolCall" as const,
        trace: Object.freeze([]),
        budget: Object.freeze({}),
    });
}

describe("claude-code 桥 —— 映射往返", () => {
    it("allow：payload 是 CC 方言逐字段、matcher 命中后 next 放行", async () => {
        const received: { command: string; stdin: unknown }[] = [];
        const bridge = createClaudeCodeHookBridge(CC_CONFIG, {
            runner: fakeRunner({}, received),
            sessionId: "s-1",
            cwd: "/proj",
        });
        const out = await bridge.layerPre(LOOP_CTX, payload(), passthrough());
        expect(out).toEqual({ content: "ran" });
        // 两个命令都命中（组一 matcher 命中 + 组二全匹配）
        expect(received).toHaveLength(2);
        const first = received[0]!.stdin as Record<string, unknown>;
        expect(first).toMatchObject({
            session_id: "s-1",
            transcript_path: "",
            cwd: "/proj",
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: "ls -la" },
            tool_use_id: "call-01",
        });
    });

    it("deny（hookSpecificOutput.permissionDecision）→ 截断 + 结构化错误 + 理由透传", async () => {
        const bridge = createClaudeCodeHookBridge(CC_CONFIG, {
            runner: fakeRunner({
                "python3 ~/.claude/hooks/protect.py": {
                    stdout: JSON.stringify({
                        hookSpecificOutput: {
                            hookEventName: "PreToolUse",
                            permissionDecision: "deny",
                            permissionDecisionReason: "main 分支禁止直接写",
                        },
                    }),
                },
            }),
        });
        let nextCalled = false;
        const out = await bridge.layerPre(LOOP_CTX, payload(), Object.assign(async () => {
            nextCalled = true;
            return { content: "ran" };
        }, { point: "toolCall" as const, trace: Object.freeze([]), budget: Object.freeze({}) }));
        expect(nextCalled).toBe(false);
        expect(out).toMatchObject({ isError: true, content: "main 分支禁止直接写", error: { code: "HOOK_BLOCKED" } });
    });

    it("ask → 放行（hook 桥不接管审批——C 族权限面职责，记档语义）", async () => {
        const bridge = createClaudeCodeHookBridge(CC_CONFIG, {
            runner: fakeRunner({
                "python3 ~/.claude/hooks/protect.py": {
                    stdout: JSON.stringify({
                        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "建议人工看" },
                    }),
                },
            }),
        });
        await expect(bridge.layerPre(LOOP_CTX, payload(), passthrough())).resolves.toEqual({ content: "ran" });
    });

    it("exit 2 → blocking（stderr 为理由）；旧 decision:block 同效", async () => {
        const bridge = createClaudeCodeHookBridge(CC_CONFIG, {
            runner: fakeRunner({
                "python3 ~/.claude/hooks/protect.py": { stderr: "盘符越界", exitCode: 2 },
                "node ~/.claude/hooks/audit.js": { stdout: JSON.stringify({ decision: "block", reason: "审计拒绝" }) },
            }),
        });
        const out = await bridge.layerPre(LOOP_CTX, payload(), passthrough());
        expect(out.isError).toBe(true);
        // 第一个命令已 block——合并意见取首个理由（最严优先）
        expect((out as { content: string }).content).toBe("盘符越界");
    });

    it("PostToolUse 回程：deny 替换结果、allow 原样；payload 带 tool_response", async () => {
        const received: { command: string; stdin: unknown }[] = [];
        const bridge = createClaudeCodeHookBridge(
            { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "post.sh" }] }] },
            { runner: fakeRunner({ "post.sh": { stdout: JSON.stringify({ decision: "block", reason: "输出含密钥，已拦回" }) } }, received) },
        );
        const inner: ToolExecutionResult = { content: "SECRET=1 done" };
        const out = await bridge.layerPost(LOOP_CTX, payload(), Object.assign(async () => inner, { point: "toolCall" as const, trace: Object.freeze([]), budget: Object.freeze({}) }));
        expect(out).toMatchObject({ isError: true, content: "输出含密钥，已拦回" });
        expect((received[0]!.stdin as Record<string, unknown>).tool_response).toBe("SECRET=1 done");
        // allow 路径：原结果透传
        const bridge2 = createClaudeCodeHookBridge(
            { PostToolUse: [{ hooks: [{ type: "command", command: "post.sh" }] }] },
            { runner: fakeRunner({}) },
        );
        await expect(bridge2.layerPost(LOOP_CTX, payload(), Object.assign(async () => inner, { point: "toolCall" as const, trace: Object.freeze([]), budget: Object.freeze({}) }))).resolves.toBe(inner);
    });

    it("matcher 不命中：带 matcher 的组零调用、无 matcher 组照常、next 放行", async () => {
        const received: { command: string; stdin: unknown }[] = [];
        const bridge = createClaudeCodeHookBridge(CC_CONFIG, { runner: fakeRunner({}, received) });
        const out = await bridge.layerPre(LOOP_CTX, payload("Read", "{}"), passthrough());
        expect(out).toEqual({ content: "ran" });
        // "Bash|Write" 组跳过；无 matcher 组（全匹配）照常跑
        expect(received.map((r) => r.command)).toEqual(["node ~/.claude/hooks/audit.js"]);
    });
});

describe("codex 桥 —— 方言差异钉死", () => {
    it("payload 是 codex 方言：model/turn_id/permission_mode/transcript_path:null/tool_input 恒 {command}", async () => {
        const received: { command: string; stdin: unknown }[] = [];
        const bridge = createCodexHookBridge(CODEX_CONFIG, {
            runner: fakeRunner({}, received),
            sessionId: "s-2",
            model: "gpt-5-codex",
            turnId: "3",
        });
        await bridge.layerPre(LOOP_CTX, payload("shell", '{"command":"git push","other":1}'), passthrough());
        const stdin = received[0]!.stdin as Record<string, unknown>;
        expect(stdin).toMatchObject({
            session_id: "s-2",
            transcript_path: null,
            hook_event_name: "PreToolUse",
            model: "gpt-5-codex",
            turn_id: "3",
            permission_mode: "default",
            tool_name: "shell",
            tool_input: { command: "git push" },
        });
    });

    it("只认 blocking：decision:block 截断；无 ask 语义", async () => {
        const bridge = createCodexHookBridge(CODEX_CONFIG, {
            runner: fakeRunner({
                "~/.codex/hooks/guard.sh": { stdout: JSON.stringify({ decision: "block", reason: "force-push 禁止" }) },
            }),
        });
        const out = await bridge.layerPre(LOOP_CTX, payload("shell"), passthrough());
        expect(out).toMatchObject({ isError: true, content: "force-push 禁止" });
    });

    it("codex 事件闭集：SubagentStart → UNSUPPORTED 拒绝", () => {
        expect(() => createCodexHookBridge({ SubagentStart: [] }, { runner: fakeRunner({}) })).toThrow(HookCompatError);
    });
});

describe("配置校验 —— 未知事件类型化拒绝", () => {
    it("完全未知的字符串 → UNKNOWN_ECOSYSTEM_EVENT", () => {
        expect(() => createClaudeCodeHookBridge({ PreCompact: [] }, { runner: fakeRunner({}) })).toThrow(
            expect.objectContaining({ code: "UNKNOWN_ECOSYSTEM_EVENT" }),
        );
    });

    it("CC 已知但无桥接点位（SessionStart）→ UNSUPPORTED_EVENT（装一半的桥比不装危险）", () => {
        expect(() => createClaudeCodeHookBridge({ SessionStart: [] }, { runner: fakeRunner({}) })).toThrow(
            expect.objectContaining({ code: "UNSUPPORTED_EVENT" }),
        );
    });

    it("坏形状（非对象 / 组非数组 / hook 缺 command）→ BAD_CONFIG", () => {
        expect(() => createClaudeCodeHookBridge([], { runner: fakeRunner({}) })).toThrow(HookCompatError);
        expect(() => createClaudeCodeHookBridge({ PreToolUse: "x" }, { runner: fakeRunner({}) })).toThrow(HookCompatError);
        expect(() =>
            createClaudeCodeHookBridge({ PreToolUse: [{ hooks: [{ timeout: 1 }] }] }, { runner: fakeRunner({}) }),
        ).toThrow(/command/);
    });
});

describe("registerInto —— untrusted 轨注册进 HookRegistry", () => {
    it("两桥层挂 toolCall 点位（trust untrusted）+ 注销后零注册", async () => {
        const bridge: HookBridge = createClaudeCodeHookBridge(CC_CONFIG, { runner: fakeRunner({}) });
        const registry = new HookRegistry();
        const unregister = bridge.registerInto(registry);
        expect(registry.has("toolCall")).toBe(true);
        // 注册面走真实 HookRegistry：trust 分轨在 I6 观察轨侧可查
        unregister();
        expect(registry.has("toolCall")).toBe(false);
    });
});
