/**
 * 治理逻辑可插拔（I11）——重复工具提醒、超时策略等治理规则做成挂在事件流
 * 上的插件，不在核心里硬编码。取 dsh·packages/guard 的形态："治理 = 挂在
 * 事件流上的规则插件（可注册/可卸载）"（其 repeat-tool-reminder 与
 * timeout-policy 两包正是本需求点名的两例）；不抄其 cordis 插件机制与具体
 * 规则文本（我方注册面自定形，提醒文本卡内措辞）。
 *
 * 与策略的分界（本模块的第一纪律）：**治理建议非强制**——GuardAdvice 是
 * 供宿主消费的提醒/建议（注入上下文、诊断展示），**不拦截、不改写、不否决**
 * 任何工具调用（工具照常执行）；强制路径归 C 族策略（gate 的 allow/deny/ask）。
 * dsh 同款措辞："enriches decisions with logged model context without vetoing
 * or rewriting calls"。
 *
 * 事件订阅形状复用 I5 SDK 契约（events 订阅 ⊆ EVENT_TYPES 闭集 + onEvent
 * 同签名回调）——进程内治理插件与 I5 插件共享同一事件方言；ws 插件的建议
 * 回传（进程外治理）需要建议通道扩展，记档不做。
 *
 * 隔离：插件抛错/超时不崩宿主（dispatch 收集错误如实报告）；重名注册与
 * 订阅闭集外类型类型化拒绝（fail-closed）；卸载后该插件零触达。
 */

import { EVENT_TYPES, type SessionEvent, type SessionEventType } from "../kernel/events.js";

/** 宿主可见的一条治理建议（提醒/建议面——非强制，不携带任何决策权）。 */
export interface GuardAdvice {
    /** 建议分型（自由字符串——内置两例用固定值；宿主按 kind 分发展示）。 */
    readonly kind: string;
    /** 提醒文本（注入上下文/展示用）。 */
    readonly message: string;
    /** 关联工具名（诊断用，可缺省）。 */
    readonly tool?: string;
    readonly severity: "info" | "warn";
}

/** 一个治理插件：订阅事件 → 产出建议（与 I5 的 onEvent 同签名契约）。 */
export interface GuardPlugin {
    readonly name: string;
    /** 订阅的事件类型（⊆ EVENT_TYPES 闭集，注册期校验）。 */
    readonly events: readonly SessionEventType[];
    /** 收到订阅内事件 → 建议（0..n 条；返回空 = 无意见）。 */
    advise(event: SessionEvent): GuardAdvice | readonly GuardAdvice[] | undefined | void;
}

/** dispatch 报告：建议 + 插件错误（错误不冒泡——治理缺席不崩内核）。 */
export interface GuardDispatchReport {
    readonly advices: readonly GuardAdvice[];
    readonly errors: readonly { readonly plugin: string; readonly message: string }[];
}

export class GuardError extends Error {
    readonly code: "DUPLICATE_GUARD" | "UNKNOWN_EVENT";
    constructor(code: "DUPLICATE_GUARD" | "UNKNOWN_EVENT", message: string) {
        super(message);
        this.name = "GuardError";
        this.code = code;
    }
}

/** 治理插件注册面（可注册/可卸载；建议收集而不干预执行）。 */
export class GuardRegistry {
    private readonly plugins: GuardPlugin[] = [];

    /** 注册（重名/订阅闭集外类型类型化拒绝）；返回卸载函数（幂等）。 */
    register(plugin: GuardPlugin): () => void {
        if (this.plugins.some((p) => p.name === plugin.name)) {
            throw new GuardError("DUPLICATE_GUARD", `治理插件重名：${plugin.name}`);
        }
        const unknown = plugin.events.filter(
            (t) => !(EVENT_TYPES as readonly string[]).includes(t),
        );
        if (unknown.length > 0) {
            throw new GuardError(
                "UNKNOWN_EVENT",
                `治理插件「${plugin.name}」订阅了未知事件类型：${unknown.join(", ")}`,
            );
        }
        this.plugins.push(plugin);
        return () => {
            const i = this.plugins.indexOf(plugin);
            if (i !== -1) this.plugins.splice(i, 1);
        };
    }

    /** 向所有订阅了该事件类型的插件派发（建议按注册次序收集；错误隔离）。 */
    dispatch(event: SessionEvent): GuardDispatchReport {
        const advices: GuardAdvice[] = [];
        const errors: { plugin: string; message: string }[] = [];
        for (const plugin of [...this.plugins]) {
            if (!plugin.events.includes(event.type)) continue;
            try {
                const out = plugin.advise(event);
                if (out === undefined) continue;
                if (Array.isArray(out)) {
                    advices.push(...(out as readonly GuardAdvice[]));
                } else {
                    advices.push(out as GuardAdvice);
                }
            } catch (e) {
                errors.push({ plugin: plugin.name, message: e instanceof Error ? e.message : String(e) });
            }
        }
        return { advices, errors };
    }

    /** 当前注册的插件名（诊断/测试用）。 */
    list(): readonly string[] {
        return this.plugins.map((p) => p.name);
    }
}

// ---------------------------------------------------------------------------
// 内置两例（dsh guard 两包的行为对应面——内容卡内措辞）
// ---------------------------------------------------------------------------

/** 参数规范化（dsh deep key-sort 行为）：深度键排序后序列化——键序不同的同义参数归同。 */
function canonicalize(argumentsJson: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(argumentsJson);
    } catch {
        return argumentsJson;
    }
    const sortValue = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(sortValue);
        if (v !== null && typeof v === "object") {
            const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
                a < b ? -1 : a > b ? 1 : 0,
            );
            return Object.fromEntries(entries.map(([k, val]) => [k, sortValue(val)]));
        }
        return v;
    };
    return JSON.stringify(sortValue(parsed));
}

export interface RepeatToolReminderOptions {
    /** 连续重复计数达哪些档位出提醒（缺省 [3, 5, 8]；非升序整数数组校验）。 */
    readonly thresholds?: readonly number[];
    /** 提醒文本里引用参数的最大字符数（缺省 500——不随大载荷无界入上下文）。 */
    readonly argumentsPreviewChars?: number;
}

/**
 * 内置例一：重复工具提醒——观测 tool/call 的「工具名 + 规范化参数」连续
 * 重复，达档位产出提醒（首档温和、后续档详细列明工具/次数/参数预览）；
 * 不同调用即重置。**建议非强制**：只产出 GuardAdvice，不触碰任何执行面。
 */
export function createRepeatToolReminder(
    options: RepeatToolReminderOptions = {},
): GuardPlugin {
    const thresholds = [...(options.thresholds ?? [3, 5, 8])].sort((a, b) => a - b);
    if (thresholds.length === 0 || thresholds.some((t) => !Number.isInteger(t) || t < 2)) {
        throw new GuardError("DUPLICATE_GUARD", "thresholds 必须是非空、≥2 的整数数组");
    }
    const previewChars = options.argumentsPreviewChars ?? 500;
    let lastKey: string | undefined;
    let count = 0;
    return {
        name: "repeat-tool-reminder",
        events: ["tool/call", "user/message"],
        advise(event) {
            // A16（T-P2-509）：输入排空点 = user/message 落流（drainQueue 注入
            // 与常规输入同形状）——新输入即复位连续计数，上一轮的重复计数
            // 不污染新任务的判断。
            if (event.type === "user/message") {
                lastKey = undefined;
                count = 0;
                return undefined;
            }
            if (event.type !== "tool/call") return undefined;
            const key = `${event.name}\u0000${canonicalize(event.arguments)}`;
            count = key === lastKey ? count + 1 : 1;
            lastKey = key;
            if (!thresholds.includes(count)) return undefined;
            const preview = key.slice(0, previewChars);
            if (count === thresholds[0]) {
                return {
                    kind: "repeat_tool_reminder",
                    severity: "info",
                    tool: event.name,
                    message:
                        "检测到连续重复的工具调用（相同参数）。再次调用前请仔细分析上一次的结果：" +
                        "若任务未完成，换一种方法或换参数，不要原样重复。",
                };
            }
            return {
                kind: "repeat_tool_reminder",
                severity: "warn",
                tool: event.name,
                message:
                    `重复工具调用：tool=${event.name}，consecutive_calls=${String(count)}，` +
                    `arguments=${preview}。这些重复调用没有推进任务——请检查最新结果，` +
                    "换一个动作/参数，或在证据足够时收束任务。",
            };
        },
    };
}

export interface TimeoutBudgetAdvisorOptions {
    /** 同一工具累计超时多少次出建议（缺省 2）。 */
    readonly timeoutThreshold?: number;
}

/**
 * 内置例二：超时预算建议——观测 tool/result 的结构化超时错误
 * （error.code === "TOOL_TIMEOUT"）按工具累计，达阈值产出"考虑调大
 * timeoutMs / 拆分任务"的建议（附该工具的调用/超时统计）。
 */
export function createTimeoutBudgetAdvisor(
    options: TimeoutBudgetAdvisorOptions = {},
): GuardPlugin {
    const threshold = options.timeoutThreshold ?? 2;
    if (!Number.isInteger(threshold) || threshold < 1) {
        throw new GuardError("DUPLICATE_GUARD", "timeoutThreshold 必须是 ≥1 的整数");
    }
    const stats = new Map<string, { calls: number; timeouts: number }>();
    const calls = new Map<string, string>(); // callId → tool（结果事件不带工具名）
    return {
        name: "timeout-budget-advisor",
        events: ["tool/call", "tool/result"],
        advise(event) {
            if (event.type === "tool/call") {
                calls.set(event.callId, event.name);
                const s = stats.get(event.name) ?? { calls: 0, timeouts: 0 };
                s.calls += 1;
                stats.set(event.name, s);
                return undefined;
            }
            if (event.type !== "tool/result") return undefined;
            if (event.error?.code !== "TOOL_TIMEOUT") return undefined;
            const tool = calls.get(event.callId) ?? "unknown";
            const s = stats.get(tool) ?? { calls: 1, timeouts: 0 };
            s.timeouts += 1;
            stats.set(tool, s);
            if (s.timeouts === threshold || s.timeouts % threshold === 0) {
                return {
                    kind: "timeout_budget_advice",
                    severity: "warn",
                    tool,
                    message:
                        `工具「${tool}」已累计超时 ${String(s.timeouts)} 次` +
                        `（共调用 ${String(s.calls)} 次）——考虑调大该工具的 timeoutMs、` +
                        "拆分任务，或检查该工具的阻塞原因。",
                };
            }
            return undefined;
        },
    };
}
