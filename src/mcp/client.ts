/**
 * 最小 MCP 客户端（I3/T-P1-64）——JSON-RPC over stdio（newline 分帧，
 * MCP stdio transport 语义）+ initialize 握手 + tools/list/call。
 * 结构语义取 opencode mcp/index.ts（:391 能力检测 → 列工具、:623 server
 * 名命名空间化、:666 已连接缓存面）；**不引 @modelcontextprotocol/sdk**
 * （仓库运行时依赖只有 better-sqlite3——卡序头约束 4）。
 *
 * 最小面（LIMITATIONS）：
 *   - 只认 tools 能力（sampling/resources/prompts 忽略）；
 *   - stdio transport（HTTP/SSE transport 不做）；
 *   - 协议版本协商：请求 "2024-11-05"，实际以 server 响应为准（回退取值）；
 *   - cursor 分页全部取尽（tools/list 循环）；
 *   - 请求超时 withTimeout 兜底（code=MCP_TIMEOUT，J22 同款 code 判据）。
 */

import { spawn } from "node:child_process";
import { TimeoutError, withTimeout } from "../kernel/timeout.js";

/** MCP 请求默认上界（握手/列工具/调用共用；真 server 挂死兜底）。 */
export const MCP_REQUEST_TIMEOUT_MS = 10_000;
export const MCP_TIMEOUT = "MCP_TIMEOUT";

export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** MCP server 的一个工具描述（tools/list 的 items）。 */
export interface McpToolInfo {
    name: string;
    description?: string;
    inputSchema?: unknown;
}

/** MCP server 的一个 prompt 描述（prompts/list 的 items——T-P3-146 H）。 */
export interface McpPromptInfo {
    name: string;
    description?: string;
    /** 参数声明（位置映射 $1..$N 的序——服务端语义）。 */
    arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface McpServerCapabilities {
    protocolVersion: string;
    tools: boolean;
    /** T-P3-146 H：prompts 原语（prompts/list+get——桥接为模板命令的数据面）。 */
    prompts: boolean;
}

export class McpClient {
    private nextId = 0;
    private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private buffer = "";
    private capabilities: McpServerCapabilities | undefined;
    private ready = false;
    private failed = false;

    constructor(
        private readonly transport: { send(line: string): void; dispose(): void },
        private readonly serverName: string,
        onData: (handler: (line: string) => void) => void,
        onFail: (handler: (reason: string) => void) => void,
    ) {
        onData((line) => this.handleLine(line));
        onFail((reason) => {
            this.failed = true;
            this.ready = false;
            // 崩溃：所有挂起请求类型化失败（不挂 loop）
            for (const p of this.pending.values()) p.reject(new Error(`MCP server failed: ${reason}`));
            this.pending.clear();
        });
    }

    get name(): string {
        return this.serverName;
    }

    get isReady(): boolean {
        return this.ready && !this.failed;
    }

    get capabilitiesInfo(): McpServerCapabilities | undefined {
        return this.capabilities;
    }

    /**
     * initialize 握手（协议版本协商 + capabilities 检测）→ notifications/
     * initialized。幂等——已 ready 直接返回。
     */
    async initialize(timeoutMs: number = MCP_REQUEST_TIMEOUT_MS): Promise<McpServerCapabilities> {
        if (this.ready && this.capabilities !== undefined) return this.capabilities;
        const result = (await this.request(
            "initialize",
            {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: "aegent", version: "0.1.0" },
            },
            timeoutMs,
        )) as { protocolVersion?: string; capabilities?: { tools?: unknown; prompts?: unknown } };
        this.capabilities = {
            protocolVersion: typeof result.protocolVersion === "string" ? result.protocolVersion : MCP_PROTOCOL_VERSION,
            tools: result.capabilities?.tools !== undefined,
            prompts: result.capabilities?.prompts !== undefined,
        };
        this.notify("notifications/initialized");
        this.ready = true;
        return this.capabilities;
    }

    /** 列工具（cursor 分页全部取尽）。server 无 tools 能力 → 空清单。 */
    async listTools(timeoutMs: number = MCP_REQUEST_TIMEOUT_MS): Promise<McpToolInfo[]> {
        if (this.capabilities !== undefined && !this.capabilities.tools) return [];
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined;
        for (;;) {
            const result = (await this.request(
                "tools/list",
                cursor !== undefined ? { cursor } : {},
                timeoutMs,
            )) as { tools?: McpToolInfo[]; nextCursor?: string };
            if (Array.isArray(result.tools)) tools.push(...result.tools);
            if (typeof result.nextCursor === "string" && result.nextCursor !== "") {
                cursor = result.nextCursor;
            } else {
                break;
            }
        }
        return tools;
    }

    /**
     * T-P3-146 H：列 prompts（prompts/list——cursor 分页取尽）。server 无
     * prompts 能力 → 空清单。参数声明透传（name/description/required）。
     */
    async listPrompts(timeoutMs: number = MCP_REQUEST_TIMEOUT_MS): Promise<McpPromptInfo[]> {
        if (this.capabilities !== undefined && !this.capabilities.prompts) return [];
        const prompts: McpPromptInfo[] = [];
        let cursor: string | undefined;
        for (;;) {
            const result = (await this.request(
                "prompts/list",
                cursor !== undefined ? { cursor } : {},
                timeoutMs,
            )) as { prompts?: McpPromptInfo[]; nextCursor?: string };
            if (Array.isArray(result.prompts)) prompts.push(...result.prompts);
            if (typeof result.nextCursor === "string" && result.nextCursor !== "") {
                cursor = result.nextCursor;
            } else {
                break;
            }
        }
        return prompts;
    }

    /**
     * T-P3-146 H：取 prompt 模板正文（prompts/get）——messages 投影为文本
     * （text 项 join，B12 投影面同构）；arguments 按服务端声明回传。
     */
    async getPrompt(
        name: string,
        args: Record<string, string>,
        timeoutMs: number = MCP_REQUEST_TIMEOUT_MS,
    ): Promise<string> {
        const result = (await this.request(
            "prompts/get",
            { name, arguments: args },
            timeoutMs,
        )) as { messages?: Array<{ content?: { type?: string; text?: string } }> };
        return (result.messages ?? [])
            .map((m) => (m.content?.type === "text" && typeof m.content.text === "string" ? m.content.text : ""))
            .filter((t) => t !== "")
            .join("\n\n");
    }

    /** 调用工具：content 数组投影为文本（B12 投影面——text 项 join），isError 透传。
     * T-P3-149 E2：audio/image 等非文本块不静默丢弃——投影为类型化说明行
     * （诚实降级：模型知道曾有音频/图片及容量事实，字节不进请求面）。 */
    async callTool(        name: string,
        args: Record<string, unknown>,
        timeoutMs: number = MCP_REQUEST_TIMEOUT_MS,
    ): Promise<{ content: string; isError: boolean }> {
        const result = (await this.request(
            "tools/call",
            { name, arguments: args },
            timeoutMs,
        )) as { content?: Array<{ type?: string; text?: string; mimeType?: string; data?: string }>; isError?: boolean };
        const parts = (result.content ?? []).map((c) => {
            if (c.type === "text" && typeof c.text === "string") return c.text;
            if (c.type === "audio" || c.type === "image") {
                const kind = c.type === "audio" ? "音频" : "图片";
                const size = typeof c.data === "string" ? Math.ceil((c.data.length * 3) / 4 / 1024) : 0;
                return `[${kind}输出：${c.mimeType ?? "未知格式"}，约 ${size}KB——${kind}内容不进文本请求面]`;
            }
            return "";
        });
        const text = parts.filter((t) => t !== "").join("\n");
        return { content: text, isError: result.isError === true };
    }

    dispose(): void {
        this.failed = true;
        this.ready = false;
        this.transport.dispose();
    }

    /** 带 id 的请求（newline JSON-RPC；id 配对 + deadline 兜底）。 */
    async request(method: string, params: unknown, timeoutMs: number = MCP_REQUEST_TIMEOUT_MS): Promise<unknown> {
        const id = ++this.nextId;
        this.transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        const response = new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        try {
            return await withTimeout(MCP_TIMEOUT, timeoutMs, response);
        } catch (e) {
            this.pending.delete(id);
            if (e instanceof TimeoutError) {
                throw new Error(`MCP 请求在 ${String(timeoutMs)}ms 内未完成（code=${e.code}）`);
            }
            throw e;
        } finally {
            this.pending.delete(id);
        }
    }

    notify(method: string, params?: unknown): void {
        this.transport.send(JSON.stringify(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params }));
    }

    private handleLine(line: string): void {
        const trimmed = line.trim();
        if (trimmed === "") return;
        let message: { id?: unknown; result?: unknown; error?: { message?: string } };
        try {
            message = JSON.parse(trimmed);
        } catch {
            return; // 非法 JSON 行忽略
        }
        if (message.id === undefined || typeof message.id !== "number") return; // 推送忽略
        const p = this.pending.get(message.id);
        if (p === undefined) return;
        this.pending.delete(message.id);
        if (message.error !== undefined && message.error !== null) {
            p.reject(new Error(`MCP server error: ${message.error.message ?? "unknown"}`));
        } else {
            p.resolve(message.result);
        }
    }
}

/**
 * stdio transport：spawn MCP server 子进程，stdin/stdout 按行读写。
 * env 覆盖语义取 opencode（index.ts:340-357 全量继承 + 用户 environment
 * 叠加——同名字段以条目为准）：npx/python 系 server 依赖 PATH/APPDATA 等
 * 运行面，缺省继承宿主环境；显式 env 仅做覆盖，不整包替换。
 */
export function createMcpStdioTransport(
    command: string,
    args: string[],
    env?: Record<string, string>,
): { send(line: string): void; dispose(): void; onLine(handler: (line: string) => void): void; onFail(handler: (reason: string) => void): void } {
    const child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        ...(env !== undefined && Object.keys(env).length > 0 ? { env: { ...process.env, ...env } } : {}),
    });
    let lineHandler: ((line: string) => void) | undefined;
    let failHandler: ((reason: string) => void) | undefined;
    let stdoutBuffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        for (;;) {
            const nl = stdoutBuffer.indexOf("\n");
            if (nl === -1) break;
            const line = stdoutBuffer.slice(0, nl);
            stdoutBuffer = stdoutBuffer.slice(nl + 1);
            lineHandler?.(line);
        }
    });
    child.on("error", (e) => failHandler?.(String(e)));
    child.on("exit", (code) => failHandler?.(`MCP server exited with code ${String(code)}`));
    child.stderr?.on("data", () => {
        /* server 日志忽略 */
    });
    return {
        send(line) {
            child.stdin?.write(`${line}\n`);
        },
        dispose() {
            child.kill();
        },
        onLine(handler) {
            lineHandler = handler;
        },
        onFail(handler) {
            failHandler = handler;
        },
    };
}
