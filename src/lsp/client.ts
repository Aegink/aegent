/**
 * 最小 LSP 客户端（B8b/T-P1-60）——stdio JSON-RPC 传输 + initialize 握手 +
 * request/response id 配对。形状取 opencode lsp 工具的语义面（9 操作闭集、
 * 1-based 换算、无 server 类型化错误），协议层手写最小闭环（卡序头约束 4：
 * 不引 @modelcontextprotocol/LSP 运行时依赖——MCP 卡同款纪律）。
 *
 * 已知边界（LIMITATIONS）：
 *   - 单 server 单语言实例（按扩展名解析后复用），不做多 server 并存；
 *   - 不做 watch 文件同步 / 诊断流（diagnostics 推送被忽略）；
 *   - cancellation 不支持（$/cancelRequest 不发）——超时由 M6/withTimeout
 *     的 deadline 兜底（code=LSP_TIMEOUT）。
 *
 * 传输抽象（LspTransport）把"帧读写"与"进程管理"分离：测试注入内存双工
 * 桩，真装配用 createStdioTransport（spawn 子进程）。
 */

import { spawn } from "node:child_process";
import { TimeoutError, withTimeout } from "../kernel/timeout.js";

/** LSP 请求默认上界（桩内不触发；真 server 挂死时的兜底，M6 同构）。 */
export const LSP_REQUEST_TIMEOUT_MS = 10_000;
export const LSP_TIMEOUT = "LSP_TIMEOUT";

// ---------------------------------------------------------------------------
// 分帧（Content-Length: N\r\n\r\n{json}）
// ---------------------------------------------------------------------------

/** 编码一帧 LSP 消息（Content-Length 头 + JSON 体）。 */
export function encodeFrame(body: string): string {
    return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

/**
 * 流式帧解析器：喂任意 chunk（半包/粘包都可能），吐完整 JSON 体。
 * 全程按 Buffer 处理——Content-Length 是 UTF-8 字节数，多字节字符
 * 跨帧/超长 body 都不错位。
 */
export function createFrameParser(onFrame: (body: string) => void): {
    push(chunk: string): void;
} {
    let buffer = Buffer.alloc(0);
    return {
        push(chunk: string): void {
            buffer = Buffer.concat([buffer, Buffer.from(chunk, "utf8")]);
            for (;;) {
                const sep = buffer.indexOf("\r\n\r\n");
                if (sep === -1) return;
                const header = buffer.subarray(0, sep).toString("utf8");
                const match = /Content-Length: (\d+)/i.exec(header);
                if (match === null) {
                    throw new Error(`LSP 帧头缺少 Content-Length：${header}`);
                }
                const length = Number(match[1]);
                const bodyStart = sep + 4;
                if (buffer.length - bodyStart < length) return;
                const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
                buffer = buffer.subarray(bodyStart + length);
                onFrame(body);
            }
        },
    };
}

// ---------------------------------------------------------------------------
// 传输
// ---------------------------------------------------------------------------

export interface LspTransport {
    send(frame: string): void;
    onData(handler: (chunk: string) => void): void;
    onFail(handler: (reason: string) => void): void;
    dispose(): void;
}

/** stdio 传输：spawn 语言 server 子进程，stdin/stdout 按帧读写。 */
export function createStdioTransport(command: string, args: string[]): LspTransport {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let dataHandler: ((chunk: string) => void) | undefined;
    let failHandler: ((reason: string) => void) | undefined;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
        dataHandler?.(chunk);
    });
    child.on("error", (e) => failHandler?.(String(e)));
    child.on("exit", (code) => failHandler?.(`LSP server exited with code ${String(code)}`));
    child.stderr?.on("data", () => {
        /* server 日志忽略 */
    });
    return {
        send(frame) {
            child.stdin?.write(frame);
        },
        onData(handler) {
            dataHandler = handler;
        },
        onFail(handler) {
            failHandler = handler;
        },
        dispose() {
            child.kill();
        },
    };
}

/** 内存双工桩（测试用）：对每个**带 id 的请求帧**按序回吐预编响应；通知不消耗。 */
export function createMemoryTransport(responses: string[]): LspTransport & {
    sent: string[];
} {
    const sent: string[] = [];
    let dataHandler: ((chunk: string) => void) | undefined;
    let index = 0;
    return {
        sent,
        send(frame) {
            sent.push(frame);
            const body = frame.replace(/^Content-Length: \d+\r\n\r\n/, "");
            let parsed: { id?: unknown };
            try {
                parsed = JSON.parse(body);
            } catch {
                return;
            }
            if (parsed.id === undefined) return; // 通知不消耗响应序列
            const response = responses[index];
            index += 1;
            if (response !== undefined) {
                dataHandler?.(response);
            }
        },
        onData(handler) {
            dataHandler = handler;
        },
        onFail() {},
        dispose() {},
    };
}

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

export class LspClient {
    private nextId = 0;
    private readonly pending = new Map<number, (value: unknown) => void>();
    private readonly parser = createFrameParser((body) => this.handleFrame(body));
    private initialized = false;
    /** server 主动通知/响应之外的消息（诊断推送等）忽略——LIMITATIONS。 */
    constructor(
        private readonly transport: LspTransport,
        private readonly serverInfo: { name: string },
    ) {
        transport.onData((chunk) => this.parser.push(chunk));
        transport.onFail((reason) => {
            // server 崩溃：所有挂起请求以类型化失败结算（不挂 loop）
            for (const settle of this.pending.values()) settle(Promise.reject(new Error(reason)));
            this.pending.clear();
            this.initialized = false;
        });
    }

    get isInitialized(): boolean {
        return this.initialized;
    }

    get name(): string {
        return this.serverInfo.name;
    }

    /** initialize 握手（幂等——已初始化直接返回）。 */
    async initialize(rootUri: string): Promise<void> {
        if (this.initialized) return;
        const capabilities = await this.request("initialize", {
            processId: process.pid,
            rootUri,
            capabilities: {},
        });
        void capabilities;
        this.notify("initialized", {});
        this.initialized = true;
    }

    /** 带 id 的请求（响应按 id 配对；超时 deadline 兜底）。 */
    async request(
        method: string,
        params: unknown,
        timeoutMs: number = LSP_REQUEST_TIMEOUT_MS,
    ): Promise<unknown> {
        const id = ++this.nextId;
        const frame = encodeFrame(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        const response = new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, (value) => resolve(value));
            void reject;
        });
        this.transport.send(frame);
        const value = await withTimeout(LSP_TIMEOUT, timeoutMs, response).catch((e) => {
            if (e instanceof TimeoutError) {
                this.pending.delete(id);
                throw new Error(`LSP 请求在 ${String(timeoutMs)}ms 内未完成（code=${e.code}）`);
            }
            throw e;
        });
        this.pending.delete(id);
        if (
            value !== null &&
            typeof value === "object" &&
            "error" in (value as Record<string, unknown>)
        ) {
            const err = (value as { error: { message?: string } }).error;
            throw new Error(`LSP server error: ${err.message ?? "unknown"}`);
        }
        return (value as { result?: unknown }).result;
    }

    /** 无 id 的通知（didOpen/initialized 等——不期待响应）。 */
    notify(method: string, params: unknown): void {
        this.transport.send(encodeFrame(JSON.stringify({ jsonrpc: "2.0", method, params })));
    }

    dispose(): void {
        this.transport.dispose();
        this.initialized = false;
    }

    private handleFrame(body: string): void {
        let message: { id?: number; result?: unknown; error?: unknown };
        try {
            message = JSON.parse(body);
        } catch {
            return; // 非法 JSON 帧忽略（LIMITATIONS：不喂死循环）
        }
        if (typeof message.id === "number") {
            const settle = this.pending.get(message.id);
            if (settle !== undefined) {
                this.pending.delete(message.id);
                settle(message as unknown);
            }
        }
        // 无 id 的 server 推送（诊断等）按 LIMITATIONS 忽略
    }
}
