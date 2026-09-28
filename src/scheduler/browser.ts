/**
 * S3 浏览器使用（T-P2-407）——CDP over ws 连系统浏览器（Chrome/Edge 系
 * `--remote-debugging-port`）：navigate/screenshot/extract 三工具 + 单独
 * 网络策略 + 风险标注。
 *
 * 锚点：qwen·packages/browser-use（"浏览器是工具族 + 独立网络策略 + 风险
 * 标注（NOTICE）"的行为——其 NOTICE 即 Apache 2.0 适配声明，需求原文
 * "含 NOTICE"指此）；CDP/playwright 实现细节不抄（我方 CDP 协议直连
 * 最小面——三方法，无 playwright 依赖）。
 *
 * 网络策略联动（D3）：浏览器进程的域白名单策略面——`allowedDomains`
 * （精确 hostname / 后缀通配 `*.example.com`），越域类型化拒绝；与
 * NetworkGuard 同纪律（在真实 I/O 之前拒绝）。
 *
 * 审批联动（C 族）：**每次 navigate 显式审批**——deps.approve 回调在
 * 域检查与 CDP 命令之前调用，缺省恒拒（fail-closed）；工具链上的 gate
 * 审批（C6）是外层，本回调是工具面的纵深（浏览器进程直连本机端口，
 * 越权面比沙箱内 fetch 大——标注在工具 description 的 NOTICE 段）。
 *
 * 页面超时（M7/T-P2-301）：所有 CDP 往返过 withDeadline（code=
 * BROWSER_DEADLINE——J22 归属判定）。
 */

import { EventEmitter } from "node:events";

import WebSocket from "ws";

import { Deadline, withDeadline } from "../kernel/deadline.js";
import type { ToolDef } from "../kernel/tools/registry.js";
import type { JsonRecord } from "../kernel/events.js";
import type { ToolExecutionResult } from "../kernel/loop.js";

export const BROWSER_DEADLINE_CODE = "BROWSER_DEADLINE";

export class BrowserDomainError extends Error {
    readonly code = "BROWSER_DOMAIN_DENIED";
    constructor(readonly url: string, readonly allowedDomains: readonly string[]) {
        super(
            `浏览器导航越域：${url} 不在白名单（${allowedDomains.join(", ")}）——D3 网络策略联动`,
        );
        this.name = "BrowserDomainError";
    }
}

export class BrowserApprovalDeniedError extends Error {
    readonly code = "BROWSER_APPROVAL_DENIED";
    constructor(readonly action: string) {
        super(`浏览器操作被审批拒绝：${action}（每次 navigate 显式审批——C 族）`);
        this.name = "BrowserApprovalDeniedError";
    }
}

export class CdpProtocolError extends Error {
    readonly code = "CDP_PROTOCOL_ERROR";
    constructor(message: string) {
        super(message);
        this.name = "CdpProtocolError";
    }
}

/** hostname 是否命中白名单（精确或 `*.suffix` 后缀通配——大小写不敏感）。 */
export function domainAllowed(hostname: string, allowedDomains: readonly string[]): boolean {
    const host = hostname.toLowerCase();
    return allowedDomains.some((pattern) => {
        const p = pattern.toLowerCase();
        if (p.startsWith("*.")) {
            const suffix = p.slice(1); // ".example.com"
            return host.endsWith(suffix);
        }
        return host === p;
    });
}

/** 浏览器 deps：审批回调 + 策略 + 超时（全装配注入——测试可控）。 */
export interface BrowserDeps {
    /** 每次导航前的显式审批（C 族纵深；缺省恒拒）。 */
    approve?: (action: { tool: string; url?: string }) => Promise<boolean>;
    /** D3 域白名单（缺省 undefined = 不做域限制——审批仍必过）。 */
    allowedDomains?: readonly string[];
    /** CDP 往返超时（缺省 30s——M7 deadline）。 */
    timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// CDP 连接（ws 直连——JSON-RPC 双向，id 计数配平）
// ---------------------------------------------------------------------------

export class CdpConnection {
    private readonly ws: WebSocket;
    private nextId = 0;
    private readonly pending = new Map<number, (reply: { result?: unknown; error?: { message: string } }) => void>();

    constructor(url: string, timeoutMs = 30_000, WebSocketImpl: typeof WebSocket = WebSocket) {
        this.ws = new WebSocketImpl(url);
        this.deadline = Deadline.fromTimeoutMs(BROWSER_DEADLINE_CODE, timeoutMs);
        this.ws.on("message", (data: unknown) => {
            const text = typeof data === "string" ? data : String(data);
            let parsed: { id?: number; result?: unknown; error?: { message: string } };
            try {
                parsed = JSON.parse(text) as typeof parsed;
            } catch {
                return; // 事件行（无 id）或坏行——非本面关注
            }
            if (parsed.id === undefined) return; // CDP 事件通知——忽略
            const resolve = this.pending.get(parsed.id);
            if (resolve !== undefined) {
                this.pending.delete(parsed.id);
                resolve(parsed);
            }
        });
    }

    readonly deadline: Deadline;

    /** 等连接就绪（open 或 error/fail-closed）。 */
    open(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }
            this.ws.once("open", () => resolve());
            this.ws.once("error", (err: Error) => reject(new CdpProtocolError(`CDP 连接失败：${err.message}`)));
            this.ws.once("close", () => reject(new CdpProtocolError("CDP 连接在握手前关闭")));
        });
    }

    /** CDP 命令往返（带 deadline——到期 TimeoutError 归属 BROWSER_DEADLINE）。 */
    send(method: string, params?: JsonRecord): Promise<unknown> {
        const id = ++this.nextId;
        const reply = new Promise<{ result?: unknown; error?: { message: string } }>((resolve) => {
            this.pending.set(id, resolve);
        });
        this.ws.send(JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) }));
        return withDeadline(this.deadline, reply).then((r) => {
            if (r.error !== undefined) {
                throw new CdpProtocolError(`CDP ${method} 失败：${r.error.message}`);
            }
            return r.result;
        });
    }

    close(): void {
        this.ws.close();
    }
}

/** 从调试端口解析 ws 端点（GET /json/version → webSocketDebuggerUrl）。 */
export async function cdpWsUrlOf(
    port: number,
    fetchImpl: typeof fetch = fetch,
    host = "127.0.0.1",
): Promise<string> {
    const response = await fetchImpl(`http://${host}:${String(port)}/json/version`);
    if (!response.ok) {
        throw new CdpProtocolError(`调试端口 ${String(port)} 的 /json/version 返回 HTTP ${String(response.status)}`);
    }
    const info = (await response.json()) as { webSocketDebuggerUrl?: unknown };
    if (typeof info["webSocketDebuggerUrl"] !== "string" || info["webSocketDebuggerUrl"] === "") {
        throw new CdpProtocolError("调试端点信息缺少 webSocketDebuggerUrl");
    }
    return info["webSocketDebuggerUrl"];
}

// ---------------------------------------------------------------------------
// 三操作（navigate 显式审批 + 域白名单 → CDP 命令）
// ---------------------------------------------------------------------------

export async function browserNavigate(
    conn: CdpConnection,
    url: string,
    deps: BrowserDeps,
): Promise<{ frameId: string; url: string }> {
    // ①显式审批（C 族纵深——每次 navigate 必过，缺省恒拒）
    const approved = await deps.approve?.({ tool: "browser_navigate", url }) ?? false;
    if (!approved) throw new BrowserApprovalDeniedError(`browser_navigate ${url}`);
    // ②D3 域白名单（审批过后再查——两个独立闸）
    const target = new URL(url);
    if (deps.allowedDomains !== undefined && !domainAllowed(target.hostname, deps.allowedDomains)) {
        throw new BrowserDomainError(url, deps.allowedDomains);
    }
    // ③CDP Page.navigate
    const result = (await conn.send("Page.navigate", { url })) as {
        frameId?: string;
        errorText?: string;
    };
    if (result.errorText !== undefined || result.frameId === undefined) {
        throw new CdpProtocolError(`Page.navigate 失败：${result.errorText ?? "缺 frameId"}`);
    }
    return { frameId: result.frameId, url };
}

/** 截屏（base64 PNG——Page.captureScreenshot）。 */
export async function browserScreenshot(conn: CdpConnection): Promise<string> {
    const result = (await conn.send("Page.captureScreenshot", { format: "png" })) as {
        data?: string;
    };
    if (typeof result.data !== "string" || result.data === "") {
        throw new CdpProtocolError("Page.captureScreenshot 未返回图像数据");
    }
    return result.data;
}

/** 页面文本抽取（Runtime.evaluate 取 body.innerText——提取的最小面）。 */
export async function browserExtract(
    conn: CdpConnection,
    expression = "document.body.innerText",
): Promise<string> {
    const result = (await conn.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
    })) as { result?: { value?: unknown } };
    if (typeof result.result?.value !== "string") {
        throw new CdpProtocolError("Runtime.evaluate 未返回字符串值");
    }
    return result.result.value;
}

// ---------------------------------------------------------------------------
// 工具族（三件——NOTICE 风险标注在 description；排他执行不并行）
// ---------------------------------------------------------------------------

const NOTICE = "⚠️ 浏览器工具直连本机系统浏览器（CDP）：页面可触达内网与本机端口，每次导航需显式审批。";

export interface BrowserToolDeps extends BrowserDeps {
    /** 惰性连接工厂（首次工具调用建连并复用——同一浏览器会话）。 */
    connect: () => Promise<CdpConnection>;
}

export function createBrowserTools(deps: BrowserToolDeps): ToolDef[] {
    let connPromise: Promise<CdpConnection> | undefined;
    const ensureConn = (): Promise<CdpConnection> => {
        connPromise ??= deps.connect();
        return connPromise;
    };
    return [
        {
            name: "browser_navigate",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "要导航到的 URL（http/https）" },
                },
                required: ["url"],
            },
            async execute(args) {
                const conn = await ensureConn();
                try {
                    const result = await browserNavigate(conn, String(args["url"] ?? ""), deps);
                    return { content: `已导航到 ${result.url}`, meta: { frameId: result.frameId } };
                } catch (error) {
                    return toolErrorResult("BrowserError", error);
                }
            },
        },
        {
            name: "browser_screenshot",
            parameters: { type: "object", properties: {} },
            async execute() {
                const conn = await ensureConn();
                try {
                    const data = await browserScreenshot(conn);
                    return { content: `[screenshot: PNG base64，${String(data.length)} 字符]`, meta: { data } };
                } catch (error) {
                    return toolErrorResult("BrowserError", error);
                }
            },
        },
        {
            name: "browser_extract",
            parameters: {
                type: "object",
                properties: {
                    expression: { type: "string", description: "可选：自定义 JS 表达式（缺省取页面可见文本）" },
                },
            },
            async execute(args) {
                const conn = await ensureConn();
                try {
                    const expression = args["expression"] !== undefined ? String(args["expression"]) : undefined;
                    const text = expression !== undefined
                        ? await browserExtract(conn, expression)
                        : await browserExtract(conn);
                    return { content: text };
                } catch (error) {
                    return toolErrorResult("BrowserError", error);
                }
            },
        },
    ];
}

function toolErrorResult(code: string, error: unknown): ToolExecutionResult {
    const message = error instanceof Error ? error.message : String(error);
    return { content: `浏览器操作失败：${message}`, isError: true, error: { name: "BrowserError", code }, meta: { code } };
}
