/**
 * 网络边界 mock（O2）——本机真端口 HTTP server + 脚本化响应序列。
 * 取 codex `mount_sse_sequence` 的形状：脚本按序消费，每次模型调用吃掉一个，
 * 请求多于脚本即报错（同时断言了调用次数）。跑真实 HTTP 路径、真实 SSE 解析、
 * 真实 fetch——只有"对面的模型"是假的。
 *
 * SSE 线格式按 OpenAI 约定（`data: {...}\n\n` + `data: [DONE]\n\n`），
 * 阶段 2 适配层若与真实厂商 wire 不符再改（假 provider 改起来无成本）。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

/** 裸 HTTP 响应脚本：非 200 / 自定义头（重试、错误码用例，阶段 2 消费）。 */
export interface RawScript {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

/** SSE 响应脚本：events 逐条序列化为 `data: {...}`，默认追加 `data: [DONE]`。 */
export interface SseScript {
  status?: number;
  events: unknown[];
  includeDone?: boolean;
}

export type MockScript = RawScript | SseScript;

function isSseScript(script: MockScript): script is SseScript {
  return "events" in script;
}

export class HttpMock {
  private server: Server | null = null;
  private scripts: MockScript[] = [];
  private callIndex = 0;
  private readonly recorded: RecordedRequest[] = [];
  private baseUrl = "";

  /** 起服务器（127.0.0.1 随机端口），返回 base URL。 */
  async start(): Promise<string> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const addr = this.server!.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${addr.port}`;
    return this.baseUrl;
  }

  /** 追加脚本序列；请求按到达顺序逐个消费，耗尽后的请求收 500。 */
  mountSequence(scripts: MockScript[]): void {
    this.scripts.push(...scripts);
  }

  /** 便捷封装：全部按 SSE 200 出。 */
  mountSseSequence(scripts: SseScript[]): void {
    this.mountSequence(scripts);
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      this.recorded.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf-8"),
      });
      const script = this.scripts[this.callIndex];
      this.callIndex += 1;
      if (!script) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `no scripted response for call #${this.callIndex}` } }));
        return;
      }
      if (isSseScript(script)) {
        res.writeHead(script.status ?? 200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        for (const event of script.events) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        if (script.includeDone !== false) res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(script.status, { "content-type": "application/json", ...script.headers });
      res.end(script.body);
    });
  }

  /** 已消费的脚本数（= 已到达的模型调用数）。 */
  get calls(): number {
    return this.callIndex;
  }

  requests(): readonly RecordedRequest[] {
    return this.recorded;
  }

  // ---------------------------------------------------------------------------
  // 计数先行访问器（O13/O20，T-P1-31）——先断言模型调用次数再取值，结构
  // 错了给可读失败（codex·responses.rs ResponseMock：single_request 数量非 1
  // 即 panic "expected 1 request, got N"；compact.rs:2361 带说明计数断言）。
  // why 必填——不带说明的计数断言写不出来（O20"带说明"的字面兑现）。
  // ---------------------------------------------------------------------------

  private expectCount(n: number, why: string): void {
    const actual = this.recorded.length;
    if (actual !== n) {
      throw new Error(
        `「${why}」——期待 ${n} 次模型调用，实际 ${actual} 次（expected ${n}, got ${actual}）。` +
          "结构错了先修调用次数，再看请求内容——计数先行给可读失败",
      );
    }
  }

  /** 断言恰有 n 次调用（why 必填），通过后返回全部记录。 */
  expectCalls(n: number, why: string): readonly RecordedRequest[] {
    this.expectCount(n, why);
    return this.recorded;
  }

  /** 断言恰有 1 次调用并取之（codex single_request 同构）。 */
  singleRequest(why: string): RecordedRequest {
    this.expectCount(1, why);
    return this.recorded[0]!;
  }

  /** 取第 i 个请求；i 越界给可读失败（总量断言请用 expectCalls——本访问器只管索引）。 */
  requestAt(i: number, why: string): RecordedRequest {
    const actual = this.recorded.length;
    if (i >= actual || i < 0) {
      throw new Error(
        `「${why}」——请求序号 ${i} 越界：实际 ${actual} 条记录（expected index ${i}, got ${actual} records）`,
      );
    }
    return this.recorded[i]!;
  }

  /** 断言至少 1 次调用并取最后一个请求（多调用场景的尾断言）。 */
  lastRequest(why: string): RecordedRequest {
    if (this.recorded.length === 0) {
      throw new Error(`「${why}」——期待至少 1 次模型调用，实际 0 次：没有记录可供断言`);
    }
    return this.recorded[this.recorded.length - 1]!;
  }

  url(path = "/v1/chat/completions"): string {
    return `${this.baseUrl}${path}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }
}

/** 把 SSE 正文拆成 data 载荷列表（[DONE] 保留原样），供测试断言逐条事件。 */
export function parseSse(body: string): string[] {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length));
}
