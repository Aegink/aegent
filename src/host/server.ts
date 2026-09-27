#!/usr/bin/env node
/**
 * node host 进程（K5/T-P1-128）——端间协议的真实传输落点（批次 12 遗留①
 * "真实网络传输层随批次 14 部署形态定形"的兑现面）。形状取 pi·packages
 * 的 transport-neutral 行为：协议层（HostProtocolServer）零改动，传输在
 * 本文件——WS over TCP（本机回环）一行一信封架在 WS 消息上，行纪律在
 * WS 上逐字面保持（MAX_LINE_BYTES 边界不变）。
 *
 * 装配（一进程一面）：SessionStore + AgentHost（registry）+ agent 通道
 * （生产缺省 spawnAgentProcess——CLI 同款内核接线，K5"与 CLI 共用内核"：
 * 两 surface 一 host、同一 AgentRequest/AgentMessage 词汇）+ HostBridge +
 * HTTP server（静态 ui/ 托管与 WS upgrade 同端口）。
 *
 * 会话流镜像：agent 事件经 bridge 广播时同步 append 进 host store（非
 * roster 事件——roster 由 emitRoster 自己落流，跳过防重入）；host store
 * 因此承载"host 视角的会话流"（对话事件镜像 + roster 事实），query
 * op:"events" 恢复视图读它。子进程 db 仍是事件权威（写面），host 镜像
 * 是读面——双写记档（P1 接受；子进程侧经 --db 持久）。
 *
 * WS 连接首行必须是 hello：surfaceId/deliveryKind 由首行预读后注册
 * （connectSurface——连接身份真源在构造期，批次 12 钉死的语义不变；
 * hello 的二次校验在 HostProtocolServer 正常处理中自然通过）。
 */

import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocketServer, type WebSocket } from "ws";

import { spawnAgentProcess } from "../kernel/agent-process.js";
import { createSessionId, isValidSessionId } from "../session/session-id.js";
import { SqliteEventStorage } from "../session/db.js";
import { InMemoryEventStorage, SessionStore, type EventStorage } from "../session/store.js";
import { HostBridge, type AgentChannel } from "./bridge.js";
import { HostRegistry } from "./registry.js";

/** 静态资产扩展名 → content-type（ui/ 资产的最小表）。 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface HostServerOptions {
  /** 会话 id（--session 显式或 createSessionId 生成——N1 规范生成点同款）。 */
  sessionId: string;
  /** HTTP/WS 监听端口（0 = 随机——测试用）。 */
  port: number;
  /** 静态 ui/ 资产目录。 */
  uiDir: string;
  /** agent 通道（测试注入内存桥；生产缺省 spawnAgentProcess）。 */
  agent?: AgentChannel;
  /** 生产 spawn 的子进程入口（agent-child.js）与透传参数。 */
  agentEntryPath?: string;
  childArgs?: readonly string[];
  /** host 面事件存储（镜像 + roster 落流；测试注入 InMemory——bridge.test 先例）。 */
  storage?: EventStorage;
}

/** host 进程运行句柄（start 的产物——stop 收束全部资源）。 */
export interface HostServerHandle {
  readonly port: number;
  stop(): Promise<void>;
}

export class HostServer {
  constructor(private readonly options: HostServerOptions) {}

  async start(): Promise<HostServerHandle> {
    const sessionId = this.options.sessionId;
    if (!isValidSessionId(sessionId)) {
      throw new Error(`会话 id 不合法：${sessionId}`);
    }
    const registry = new HostRegistry();
    const host = registry.register({ sessionId });
    const store = new SessionStore(this.options.storage ?? new InMemoryEventStorage());
    const agent =
      this.options.agent ??
      spawnAgentProcess({
        entryPath: this.options.agentEntryPath ?? "",
        args: ["--session", sessionId, ...(this.options.childArgs ?? [])],
      });
    const bridge = new HostBridge({ host, agent, store });
    // 会话流镜像（host 视角的读面）：非 roster 事件同步 append——
    // SessionStore.append 同步纪律（write-behind 持久化在 storage 端）。
    bridge.onEvent((_sid, event) => {
      if (event.type === "surface/attach" || event.type === "surface/detach") return;
      try {
        store.append(sessionId, [event as never]);
      } catch {
        // 镜像是读面加速：单事件失败不炸 host（错误经 query 读面可见为缺事件）
      }
    });

    const wss = new WebSocketServer({ noServer: true });
    const httpServer: HttpServer = createServer((req, res) => {
      serveStatic(this.options.uiDir, req, res);
    });
    httpServer.on("upgrade", (req, socket, head) => {
      if (!req.url || new URL(req.url, "http://localhost").pathname !== "/ws") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });
    wss.on("connection", (ws: WebSocket) => {
      attachSurface(bridge, ws);
    });

    const port = await new Promise<number>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(this.options.port, "127.0.0.1", () => {
        const address = httpServer.address();
        if (address === null || typeof address === "string") {
          reject(new Error(`监听地址异常：${String(address)}`));
          return;
        }
        resolve(address.port);
      });
    });

    return {
      port,
      stop: async () => {
        for (const client of wss.clients) client.terminate(); // 强制断开（未 close 的测试客户端/慢端）
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        const killable = agent as Partial<{ kill: () => Promise<void> | void }>;
        if (typeof killable.kill === "function") {
          await killable.kill();
        }
      },
    };
  }
}

/**
 * 一个 WS 连接 → 一个 surface：首行预读 hello 拿身份注册（连接身份真源在
 * 构造期），随后所有行（含首行）交 HostProtocolServer 逐行处理。
 */
function attachSurface(bridge: HostBridge, ws: WebSocket): void {
  let registration: ReturnType<HostBridge["connectSurface"]> | undefined;
  let buffered: string[] = [];
  let handshaked = false;

  const feed = (line: string): void => {
    if (registration !== undefined) {
      registration.server.handleLine(line);
      return;
    }
    buffered.push(line);
    if (handshaked) return;
    // 首行预读：只取身份（形状校验权威在 HostProtocolServer——预读容忍
    // 非 hello 形状，交给协议层回类型化错误）
    handshaked = true;
    let surfaceId: string | undefined;
    let deliveryKind: "push" | "poll" | undefined;
    try {
      const first = JSON.parse(line) as Record<string, unknown>;
      if (
        first["type"] === "hello" &&
        typeof first["surfaceId"] === "string" &&
        first["surfaceId"] !== ""
      ) {
        surfaceId = first["surfaceId"];
      }
      if (first["type"] === "hello" && first["deliveryKind"] === "poll") {
        deliveryKind = "poll";
      }
    } catch {
      // 非 JSON 首行：注册匿名 surface，协议层回 PROTOCOL_MALFORMED
    }
    try {
      registration = bridge.connectSurface({
        ...(surfaceId !== undefined ? { surfaceId } : {}),
        ...(deliveryKind !== undefined ? { deliveryKind } : {}),
        write: (out) => ws.send(out),
      });
    } catch (error) {
      // 同 surfaceId 重复连接等注册拒绝：回一行类型化错误后关闭
      const message = error instanceof Error ? error.message : String(error);
      ws.send(
        JSON.stringify({
          type: "response",
          requestId: "(unparsed)",
          ok: false,
          error: { code: "SURFACE_REJECTED", message: message.slice(0, 500) },
        }),
      );
      ws.close();
      return;
    }
    const lines = buffered;
    buffered = [];
    for (const pending of lines) registration.server.handleLine(pending);
  };

  ws.on("message", (data: unknown) => {
    const text = typeof data === "string" ? data : String(Buffer.from(data as Buffer).toString("utf8"));
    // 行纪律在 WS 上逐字面保持：一条 WS 消息按行拆（一行一信封）
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      feed(line);
    }
  });
  ws.on("close", () => {
    registration?.close(); // 断线自动释放租约（SurfaceHub——N7 贯穿）
  });
}

/** 静态资产服务（路径穿越防呆：resolve 后必须落在 uiDir 内）。 */
function serveStatic(uiDir: string, req: IncomingMessage, res: import("node:http").ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const root = path.resolve(uiDir);
  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error !== null) {
      res.writeHead(404).end("not found");
      return;
    }
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
    res.writeHead(200, {
      "content-type": type ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// 生产入口：node dist/src/host/server.js [--session <id>] [--port <n>]
//   [--ui <dir>] [--host-db <path>] [--provider echo|openai] …（透传子进程）
// ---------------------------------------------------------------------------

export interface HostServerArgv {
  sessionId: string;
  port: number;
  uiDir: string;
  hostDbPath?: string;
  childArgs: string[];
}

export function parseHostServerArgv(
  argv: readonly string[],
  defaults: { uiDir: string },
): HostServerArgv {
  let sessionId = createSessionId();
  let port = 8787;
  let uiDir = defaults.uiDir;
  let hostDbPath: string | undefined;
  const childArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--session" && i + 1 < argv.length) {
      sessionId = argv[++i] ?? sessionId;
    } else if (a === "--port" && i + 1 < argv.length) {
      port = Number(argv[++i]);
    } else if (a === "--ui" && i + 1 < argv.length) {
      uiDir = argv[++i] ?? uiDir;
    } else if (a === "--host-db" && i + 1 < argv.length) {
      hostDbPath = argv[++i];
    } else {
      childArgs.push(a);
    }
  }
  if (!isValidSessionId(sessionId)) {
    throw new Error(`--session 不合法：${sessionId}`);
  }
  return { sessionId, port, uiDir, ...(hostDbPath !== undefined ? { hostDbPath } : {}), childArgs };
}

/** 仓库根的 ui/ 缺省位（dist/src/host/server.js 上溯三级）。 */
export function defaultUiDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "ui",
  );
}

/** 仓库根的 agent-child 编译产物位（dist/src/host/server.js 旁：../kernel）。 */
export function defaultAgentChildEntry(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "kernel",
    "agent-child.js",
  );
}

async function main(argv: readonly string[]): Promise<void> {
  const parsed = parseHostServerArgv(argv, { uiDir: defaultUiDir() });
  const storage = parsed.hostDbPath !== undefined
    ? SqliteEventStorage.open({ path: parsed.hostDbPath })
    : new InMemoryEventStorage();
  const server = new HostServer({
    sessionId: parsed.sessionId,
    port: parsed.port,
    uiDir: parsed.uiDir,
    agentEntryPath: defaultAgentChildEntry(),
    childArgs: parsed.childArgs,
    storage,
  });
  const handle = await server.start();
  process.stdout.write(
    `aegent host（会话 ${parsed.sessionId}）：http://127.0.0.1:${handle.port}/ （WS: /ws）\n`,
  );
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (line.trim() === "/exit") {
      rl.close();
      void handle.stop().then(() => process.exit(0));
    }
  });
  const shutdown = (): void => {
    void handle.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// bin 入口：被直接执行时运行（import 时不运行）
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`aegent host 启动失败：${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
