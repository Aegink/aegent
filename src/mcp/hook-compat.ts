/**
 * hook 协议兼容层（I7）——既有生态（claude-code / codex 形态）的 command
 * hook 桥接到我方 HookRegistry / toolCall 链。取 dsh·packages/hooks 的
 * 适配器行为："兼容 = 输入/输出映射层"——生态 hook 的 stdin/stdout 契约
 * 与我方链层的截断语义互译；不抄其双包结构与 cordis 装配（我方单域双桥）。
 *
 * 桥接面（方言 × 点位）——两个桥都只桥**工具前后**两个点位：
 *   claude-code：PreToolUse ↔ toolCall 前程；PostToolUse ↔ toolCall 回程。
 *   codex：PreToolUse / PostToolUse 同上（方言差异见下）。
 *
 * 不兼容语义（记档，显式拒绝而非静默忽略——装一半的桥比不装危险）：
 *   - SessionStart / UserPromptSubmit / SubagentStart / SubagentStop：
 *     我方无对应链点位（prompt 提交与子代理边界无洋葱层）——配置里出现
 *     即 UNSUPPORTED 拒绝；完全未知的字符串 UNKNOWN 拒绝。
 *   - Stop：我方 turnEnd 链无"强制继续"通道（CC blocking Stop 会 steer
 *     下一轮——需要 loop 配合），不做。
 *   - CC 的 permissionDecision "ask"：我方审批归 C 族 gate（权限面），
 *     hook 桥不是权限面——ask 放行并告警（CC 语义里 ask 也不拦）。
 *   - updatedInput / additionalContext / systemMessage：告警不兑现
 *     （dsh 同款纪律）。
 *   - codex 方言差异按公开契约钉死：snake_case、每个事件带 model、
 *     turn 作用域带 turn_id、tool_input 恒 {command} 形状、只认 blocking。
 *
 * 执行器注入（EcosystemHookRunner）：真实 shell 执行随装配需要——本卡
 * 交付映射层与注册面，测试以 fake runner 驱动全表面（不做端到端联调）。
 */

import { HookRegistry } from "../kernel/hooks.js";
import type { ChainLayer } from "../kernel/chain.js";
import type { JsonRecord } from "../kernel/events.js";
import type { ToolExecutionResult } from "../kernel/loop.js";
import type { LoopContext, ToolCallPayload } from "../kernel/loop.js";

/** 生态 hook 执行器注入面：命令 + stdin JSON → stdout/stderr/退出码。 */
export type EcosystemHookRunner = (
    command: string,
    stdinJson: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/** 兼容层类型化拒绝（配置形状 / 事件面问题——fail-closed 不静默）。 */
export class HookCompatError extends Error {
    readonly code: "UNKNOWN_ECOSYSTEM_EVENT" | "UNSUPPORTED_EVENT" | "BAD_CONFIG";
    constructor(code: "UNKNOWN_ECOSYSTEM_EVENT" | "UNSUPPORTED_EVENT" | "BAD_CONFIG", message: string) {
        super(message);
        this.name = "HookCompatError";
        this.code = code;
    }
}

/** 生态 hook 的合并意见（最严优先：block > 放行；理由取首个 block）。 */
interface MergedOpinion {
    readonly blocked: boolean;
    readonly reason?: string;
    readonly warned: string[];
}

// ---------------------------------------------------------------------------
// 配置解析（hooks.json 的 hooks 键形状——两生态同构，事件闭集不同）
// ---------------------------------------------------------------------------

interface EcosystemHookEntry {
    readonly command: string;
}
interface EcosystemMatcherGroup {
    readonly matcher?: string;
    readonly hooks: readonly EcosystemHookEntry[];
}
type BridgeableEvent = "PreToolUse" | "PostToolUse";

/** 解析 + 全量校验：未知/不兼容事件即拒绝（返回可桥配置）。 */
function parseHookConfig(
    raw: unknown,
    knownEvents: readonly string[],
    bridgeable: readonly BridgeableEvent[],
    ecosystem: string,
): Map<BridgeableEvent, readonly EcosystemMatcherGroup[]> {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new HookCompatError("BAD_CONFIG", `${ecosystem} 配置必须是 JSON 对象`);
    }
    const out = new Map<BridgeableEvent, EcosystemMatcherGroup[]>();
    for (const [event, groups] of Object.entries(raw)) {
        if (!knownEvents.includes(event)) {
            throw new HookCompatError(
                "UNKNOWN_ECOSYSTEM_EVENT",
                `${ecosystem} 未知事件：${event}`,
            );
        }
        if (!bridgeable.includes(event as BridgeableEvent)) {
            throw new HookCompatError(
                "UNSUPPORTED_EVENT",
                `${ecosystem} 事件 ${event} 在本仓无桥接点位（见 hook-compat 头注释不兼容语义）`,
            );
        }
        if (!Array.isArray(groups)) {
            throw new HookCompatError("BAD_CONFIG", `${ecosystem} ${event} 的配置必须是数组`);
        }
        const parsed: EcosystemMatcherGroup[] = [];
        for (const group of groups) {
            if (group === null || typeof group !== "object") {
                throw new HookCompatError("BAD_CONFIG", `${ecosystem} ${event} 的 matcher 组必须是对象`);
            }
            const g = group as { matcher?: unknown; hooks?: unknown };
            if (g.matcher !== undefined && typeof g.matcher !== "string") {
                throw new HookCompatError("BAD_CONFIG", `${ecosystem} ${event} 的 matcher 必须是字符串`);
            }
            if (!Array.isArray(g.hooks)) {
                throw new HookCompatError("BAD_CONFIG", `${ecosystem} ${event} 的 hooks 必须是数组`);
            }
            const commands: EcosystemHookEntry[] = [];
            for (const hook of g.hooks) {
                if (hook === null || typeof hook !== "object" || typeof (hook as { command?: unknown }).command !== "string") {
                    throw new HookCompatError("BAD_CONFIG", `${ecosystem} ${event} 的 hook 必须有 command 字符串`);
                }
                commands.push({ command: (hook as { command: string }).command });
            }
            parsed.push({ ...(g.matcher !== undefined ? { matcher: g.matcher } : {}), hooks: commands });
        }
        out.set(event as BridgeableEvent, parsed);
    }
    return out;
}

/** CC matcher 语义：regex 字符串对 tool name；缺省/空 = 全匹配。 */
function matcherSelects(matcher: string | undefined, subject: string): boolean {
    if (matcher === undefined || matcher === "" || matcher === "*") return true;
    try {
        return new RegExp(matcher).test(subject);
    } catch {
        return false;
    }
}

/** 工具参数原文 → 方言 payload 的 tool_input（parse 失败给空对象——unparsed 不上桥）。 */
function toolInputOf(argumentsJson: string): JsonRecord {
    try {
        const parsed: unknown = JSON.parse(argumentsJson);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as JsonRecord;
        }
    } catch {
        // 参数不可解析时 payload 降级为空对象——hook 仍可跑（拿得到 tool_name）
    }
    return {};
}

/**
 * 解析单条生态 hook 输出（exit code + stdout JSON 双通道，公开契约钉死）：
 * exit 2 = blocking（stderr 为理由）；stdout JSON 认三形态——
 *   {"hookSpecificOutput":{"hookEventName","permissionDecision":"deny"|"ask"|"allow","permissionDecisionReason"}}
 *   {"decision":"block"|"approve","reason"}
 *   {"continue":false,"stopReason"}。
 */
function parseOutput(
    out: { stdout: string; stderr: string; exitCode: number },
    expectedEvent: string,
): MergedOpinion {
    const warned: string[] = [];
    if (out.exitCode === 2) {
        return { blocked: true, reason: out.stderr.trim() !== "" ? out.stderr.trim() : "blocked by hook (exit 2)", warned };
    }
    const trimmed = out.stdout.trim();
    if (trimmed === "") return { blocked: false, warned };
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        warned.push("hook stdout 不是 JSON（忽略）");
        return { blocked: false, warned };
    }
    if (parsed === null || typeof parsed !== "object") return { blocked: false, warned };
    const o = parsed as Record<string, unknown>;
    // 形态一：hookSpecificOutput（CC 新契约）
    const hso = o.hookSpecificOutput;
    if (hso !== null && typeof hso === "object") {
        const h = hso as Record<string, unknown>;
        if (h.hookEventName !== undefined && h.hookEventName !== expectedEvent) {
            warned.push(`hookSpecificOutput.hookEventName=${String(h.hookEventName)} 与触发事件 ${expectedEvent} 不符（整块忽略）`);
            return { blocked: false, warned };
        }
        const decision = h.permissionDecision;
        if (decision === "deny") {
            return { blocked: true, reason: typeof h.permissionDecisionReason === "string" ? h.permissionDecisionReason : "blocked by hook", warned };
        }
        if (decision === "ask") {
            // 不兼容语义：ask 放行并告警（权限归 C 族 gate——见头注释）
            warned.push("permissionDecision=ask：hook 桥不接管审批（C 族权限面职责），放行");
            return { blocked: false, warned };
        }
        return { blocked: false, warned };
    }
    // 形态二：旧 decision/reason 契约（codex 只认此形态的 block）
    const decision = o.decision;
    if (decision === "block" || decision === "deny") {
        return { blocked: true, reason: typeof o.reason === "string" ? o.reason : "blocked by hook", warned };
    }
    if (decision === "approve" || decision === "allow") return { blocked: false, warned };
    // 形态三：continue=false
    if (o.continue === false) {
        return { blocked: true, reason: typeof o.stopReason === "string" ? o.stopReason : "blocked by hook (continue=false)", warned };
    }
    return { blocked: false, warned };
}

/** 逐组逐 hook 跑命令、合并意见（block 优先；警告收集）。 */
async function runGroups(
    groups: readonly EcosystemMatcherGroup[],
    subject: string,
    payload: Record<string, unknown>,
    runner: EcosystemHookRunner,
    expectedEvent: string,
): Promise<MergedOpinion> {
    let blocked = false;
    let reason: string | undefined;
    const warned: string[] = [];
    for (const group of groups) {
        if (!matcherSelects(group.matcher, subject)) continue;
        for (const hook of group.hooks) {
            const out = await runner(hook.command, JSON.stringify(payload));
            const opinion = parseOutput(out, expectedEvent);
            warned.push(...opinion.warned);
            if (opinion.blocked && !blocked) {
                blocked = true;
                reason = opinion.reason;
            }
        }
    }
    return { blocked, ...(reason !== undefined ? { reason } : {}), warned };
}

// ---------------------------------------------------------------------------
// 两座桥
// ---------------------------------------------------------------------------

export interface HookBridgeOptions {
    readonly runner: EcosystemHookRunner;
    /** payload 基础字段（session_id / cwd 等——装配面提供）。 */
    readonly sessionId?: string;
    readonly cwd?: string;
    /** codex 方言的 model 字段（每事件必带）。 */
    readonly model?: string;
    /** codex 方言的 turn_id（turn 作用域事件必带——装配面注入）。 */
    readonly turnId?: string;
}

/** 桥的产出：toolCall 点位的两层（untrusted 轨注册进 HookRegistry）。 */
export interface HookBridge {
    /** PreToolUse ↔ toolCall 前程（deny 即截断，返回结构化错误结果）。 */
    readonly layerPre: ChainLayer<LoopContext, ToolCallPayload, ToolExecutionResult>;
    /** PostToolUse ↔ toolCall 回程（deny 即替换结果为结构化错误）。 */
    readonly layerPost: ChainLayer<LoopContext, ToolCallPayload, ToolExecutionResult>;
    /** 便捷注册：两桥层以 untrusted trust 挂 toolCall 点位（返回注销函数）。 */
    registerInto(registry: HookRegistry): () => void;
}

function blockedResult(reason: string): ToolExecutionResult {
    return {
        content: reason,
        isError: true,
        error: { name: "HookBlockedError", code: "HOOK_BLOCKED" },
    };
}

/** claude-code 方言桥（事件闭集按 CC 公开契约；仅桥 PreToolUse/PostToolUse）。 */
export function createClaudeCodeHookBridge(rawConfig: unknown, options: HookBridgeOptions): HookBridge {
    const groups = parseHookConfig(
        rawConfig,
        ["PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop"],
        ["PreToolUse", "PostToolUse"],
        "claude-code",
    );
    const base = (event: string): Record<string, unknown> => ({
        session_id: options.sessionId ?? "",
        transcript_path: "",
        cwd: options.cwd ?? process.cwd(),
        hook_event_name: event,
    });
    const prePayload = (e: ToolCallPayload): Record<string, unknown> => ({
        ...base("PreToolUse"),
        tool_name: e.name,
        tool_input: toolInputOf(e.arguments),
        tool_use_id: e.callId,
    });
    const postPayload = (e: ToolCallPayload, response: string): Record<string, unknown> => ({
        ...base("PostToolUse"),
        tool_name: e.name,
        tool_input: toolInputOf(e.arguments),
        tool_use_id: e.callId,
        tool_response: response,
    });
    return buildBridge(groups, options, prePayload, postPayload, "claude-code");
}

/** codex 方言桥（事件闭集五枚；tool_input 恒 {command}；model/turn_id 必带）。 */
export function createCodexHookBridge(rawConfig: unknown, options: HookBridgeOptions): HookBridge {
    const groups = parseHookConfig(
        rawConfig,
        ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"],
        ["PreToolUse", "PostToolUse"],
        "codex",
    );
    const base = (event: string, withTurn: boolean): Record<string, unknown> => ({
        session_id: options.sessionId ?? "",
        transcript_path: null,
        cwd: options.cwd ?? process.cwd(),
        hook_event_name: event,
        model: options.model ?? "",
        ...(withTurn ? { turn_id: options.turnId ?? "0" } : {}),
        permission_mode: "default",
    });
    const commandOf = (args: JsonRecord): Record<string, unknown> =>
        typeof args.command === "string" ? { command: args.command } : { command: "" };
    const prePayload = (e: ToolCallPayload): Record<string, unknown> => ({
        ...base("PreToolUse", true),
        tool_name: e.name,
        tool_input: commandOf(toolInputOf(e.arguments)),
        tool_use_id: e.callId,
    });
    const postPayload = (e: ToolCallPayload, response: string): Record<string, unknown> => ({
        ...base("PostToolUse", true),
        tool_name: e.name,
        tool_input: commandOf(toolInputOf(e.arguments)),
        tool_use_id: e.callId,
        tool_response: response,
    });
    return buildBridge(groups, options, prePayload, postPayload, "codex");
}

/** 两桥共享的层装配（差异只在 payload 方言与事件闭集，映射语义同构）。 */
function buildBridge(
    groups: Map<BridgeableEvent, readonly EcosystemMatcherGroup[]>,
    options: HookBridgeOptions,
    prePayload: (e: ToolCallPayload) => Record<string, unknown>,
    postPayload: (e: ToolCallPayload, response: string) => Record<string, unknown>,
    ecosystem: string,
): HookBridge {
    const preGroups = groups.get("PreToolUse") ?? [];
    const postGroups = groups.get("PostToolUse") ?? [];
    const layerPre: ChainLayer<LoopContext, ToolCallPayload, ToolExecutionResult> = async (_$, e, next) => {
        const opinion = await runGroups(preGroups, e.name, prePayload(e), options.runner, "PreToolUse");
        if (opinion.blocked) return blockedResult(opinion.reason ?? `blocked by ${ecosystem} hook`);
        return next(e);
    };
    const layerPost: ChainLayer<LoopContext, ToolCallPayload, ToolExecutionResult> = async (_$, e, next) => {
        const result = await next(e);
        const opinion = await runGroups(postGroups, e.name, postPayload(e, result.content), options.runner, "PostToolUse");
        if (opinion.blocked) return blockedResult(opinion.reason ?? `blocked by ${ecosystem} hook`);
        return result;
    };
    return {
        layerPre,
        layerPost,
        registerInto: (registry: HookRegistry) => {
            const un1 = registry.on("toolCall", layerPre, { name: `${ecosystem}:PreToolUse`, trust: "untrusted" });
            const un2 = registry.on("toolCall", layerPost, { name: `${ecosystem}:PostToolUse`, trust: "untrusted" });
            return () => {
                un1();
                un2();
            };
        },
    };
}
