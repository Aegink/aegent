/**
 * S4 计算机使用（T-P2-408）——屏幕/输入控制四操作（screenshot/click/
 * type/key），风险最高 → **最强审批**。
 *
 * 锚点：codex·computer_use_config.rs（配置面 + 审批强度行为——其
 * allow/deny per-app 的 Windows AUMID/exe 配置面不抄：我方单用户场景，
 * 审批粒度 = 每操作人决）。🔴 操作执行面（屏幕捕获/注入）Windows 专属
 * ——win32-helper Rust 子进程扩展（T9 语言边界即进程边界）：动作
 * `computer`，请求经 stdin JSON（helper 既有协议同款）。真实屏幕操作
 * 的 Win32 实现（SendInput/BitBlt）为存根（NOT_IMPLEMENTED 结构化
 * fail-closed）——Windows 会话环境依赖 → 人工确认清单。
 *
 * 最强审批（C 族 forced-approval 级）三层：
 *   ①**unattended 恒拒**——无人值守模式下屏幕控制永不放行（在审批
 *     之前检查——即使用户规则/回调放行也拒）；
 *   ②**每操作显式审批**——deps.approve 回调每操作必过（缺省恒拒，
 *     fail-closed）——链上 gate（C6）是外层，本回调是工具面纵深；
 *   ③**操作审计全落流**（L2 面）——每次执行（含拒绝）记 AuditLogRecord
 *     结构（kind="computer_use"，与审批审计同表检索面）。
 */

import type { ToolDef } from "../kernel/tools/registry.js";
import type { JsonRecord, JsonValue } from "../kernel/events.js";
import type { ToolExecutionResult } from "../kernel/loop.js";

export type ComputerOperation = "screenshot" | "click" | "type" | "key";

export const COMPUTER_OPERATIONS: readonly ComputerOperation[] = [
    "screenshot",
    "click",
    "type",
    "key",
];

/** helper 的请求面（stdin JSON——T9 只传可序列化值）。 */
export interface ComputerUseRequest {
    readonly operation: ComputerOperation;
    /** click：屏幕坐标。 */
    readonly x?: number;
    readonly y?: number;
    /** click：鼠标键。 */
    readonly button?: "left" | "right" | "middle";
    /** type：要注入的文本。 */
    readonly text?: string;
    /** key：键序（如 "ctrl+c"——helper 侧解析）。 */
    readonly key?: string;
}

/** helper 的响应面（stdout JSON）。 */
export interface ComputerUseResponse {
    readonly ok: boolean;
    /** screenshot：base64 PNG；其余操作：人类可读结果描述。 */
    readonly data?: string;
    readonly error?: { code: string; message: string };
}

export type ComputerRefusalCode = "COMPUTER_APPROVAL_DENIED" | "COMPUTER_UNATTENDED_DENIED";

export class ComputerRefusalError extends Error {
    constructor(
        readonly code: ComputerRefusalCode,
        message: string,
    ) {
        super(message);
        this.name = "ComputerRefusalError";
    }
}

export interface ComputerDeps {
    /** helper 执行面（生产装配接 win32-helper spawn；测试注入 fake）。 */
    run: (request: ComputerUseRequest) => Promise<ComputerUseResponse>;
    /**
     * 每操作显式审批（C 族纵深）——返回 true 才放行；缺省恒拒。
     * 返回值即 approver 标识进审计（string | false）。
     */
    approve?: (request: ComputerUseRequest) => Promise<string | false>;
    /** 无人值守状态（装配面注入——恒拒判据；缺省 false）。 */
    isUnattended?: () => boolean;
    /**
     * K9 通知桥接点（N5 computer_operation 分型的发布面——装配方桥到
     * NotificationHub.publish；操作回显：截图/动作标注 → 画中画渲染）。
     */
    notify?: (payload: JsonValue) => void;
    /** L2 审计面（AuditLogRecord 结构——recordAudit 接线随装配域）。 */
    audit?: (record: {
        kind: string;
        phase: string;
        requestId: string;
        tool: string;
        surface: string;
        approver: string;
        at: number;
        payload?: JsonValue;
    }) => void;
    now?: () => number;
}

/**
 * 执行一次计算机操作：unattended 恒拒 → 每操作显式审批 → helper 执行 →
 * 审计。拒绝也审计（拒绝事实与执行事实同权——L2 全落流）。
 */
export async function computerExecute(
    toolCallId: string,
    request: ComputerUseRequest,
    deps: ComputerDeps,
): Promise<ComputerUseResponse> {
    const at = deps.now?.() ?? Date.now();
    const tool = `computer_${request.operation}`;
    const audit = (phase: string, approver: string, payload: JsonValue): void => {
        deps.audit?.({
            kind: "computer_use",
            phase,
            requestId: toolCallId,
            tool,
            surface: "computer",
            approver,
            at,
            payload,
        });
    };

    // ①unattended 恒拒（forced-approval 级——先于审批，回调放行也拒）
    if (deps.isUnattended?.() === true) {
        audit("unattended-denied", "(unattended)", { request } as unknown as JsonValue);
        throw new ComputerRefusalError(
            "COMPUTER_UNATTENDED_DENIED",
            "无人值守模式下计算机操作恒拒（屏幕/输入控制不允许在无人监视下执行）",
        );
    }

    // ②每操作显式审批（缺省恒拒）
    const approver = deps.approve !== undefined ? await deps.approve(request) : false;
    if (approver === false) {
        audit("denied", "(denied)", { request } as unknown as JsonValue);
        throw new ComputerRefusalError(
            "COMPUTER_APPROVAL_DENIED",
            `计算机操作 ${request.operation} 被审批拒绝（最强审批——每操作显式人决）`,
        );
    }

    // ③helper 执行（T9 子进程边界）
    const response = await deps.run(request);
    audit("executed", approver, { request, ok: response.ok, error: response.error } as unknown as JsonValue);
    // K9 联动：操作回显推送（画中画消费端——N5 computer_operation 分型）
    deps.notify?.({
        operation: request.operation,
        requestId: toolCallId,
        at,
        ...(response.data !== undefined ? { data: response.data } : {}),
    } as unknown as JsonValue);
    return response;
}

// ---------------------------------------------------------------------------
// 四工具族（描述经 B2 descriptions/computer_*.txt；排他执行）
// ---------------------------------------------------------------------------

export interface ComputerToolDeps extends ComputerDeps {}

export function createComputerTools(deps: ComputerToolDeps): ToolDef[] {
    const executeFor =
        (operation: ComputerOperation, build: (args: JsonRecord) => ComputerUseRequest) =>
        async (args: JsonRecord, ctx: { toolCallId: string }): Promise<ToolExecutionResult> => {
            try {
                const response = await computerExecute(ctx.toolCallId, build(args), deps);
                if (!response.ok) {
                    return {
                        content: `计算机操作失败：${response.error?.message ?? "未知错误"}`,
                        isError: true,
                        error: {
                            name: "ComputerError",
                            code: response.error?.code ?? "COMPUTER_UNKNOWN",
                        },
                        meta: { code: response.error?.code ?? null },
                    };
                }
                const summary =
                    operation === "screenshot"
                        ? `[screenshot: PNG base64，${String(response.data?.length ?? 0)} 字符]`
                        : (response.data ?? "已完成");
                return (operation === "screenshot"
                    ? { content: summary, meta: { data: response.data } }
                    : { content: summary }) as ToolExecutionResult;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const code =
                    error instanceof ComputerRefusalError
                        ? error.code
                        : "COMPUTER_UNKNOWN";
                return { content: message, isError: true, error: { name: "ComputerError", code }, meta: { code } };
            }
        };

    return [
        {
            name: "computer_screenshot",
            parameters: { type: "object", properties: {} },
            async execute(args, ctx) {
                return executeFor("screenshot", () => ({ operation: "screenshot" }))(args, ctx);
            },
        },
        {
            name: "computer_click",
            parameters: {
                type: "object",
                properties: {
                    x: { type: "number", description: "屏幕横坐标" },
                    y: { type: "number", description: "屏幕纵坐标" },
                    button: { type: "string", enum: ["left", "right", "middle"], description: "鼠标键（缺省 left）" },
                },
                required: ["x", "y"],
            },
            async execute(args, ctx) {
                return executeFor("click", (a) => ({
                    operation: "click",
                    x: Number(a["x"]),
                    y: Number(a["y"]),
                    ...(a["button"] !== undefined ? { button: a["button"] as "left" | "right" | "middle" } : {}),
                }))(args, ctx);
            },
        },
        {
            name: "computer_type",
            parameters: {
                type: "object",
                properties: { text: { type: "string", description: "要注入的文本" } },
                required: ["text"],
            },
            async execute(args, ctx) {
                return executeFor("type", (a) => ({ operation: "type", text: String(a["text"] ?? "") }))(args, ctx);
            },
        },
        {
            name: "computer_key",
            parameters: {
                type: "object",
                properties: { key: { type: "string", description: "键序（如 ctrl+c）" } },
                required: ["key"],
            },
            async execute(args, ctx) {
                return executeFor("key", (a) => ({ operation: "key", key: String(a["key"] ?? "") }))(args, ctx);
            },
        },
    ];
}
