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

import { createServer, type Server as HttpServer } from "node:http";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocketServer, type WebSocket } from "ws";

import { spawnAgentProcess } from "../kernel/agent-process.js";
import { createSessionId, isValidSessionId } from "../session/session-id.js";
import { SqliteEventStorage } from "../session/db.js";
import { InMemoryEventStorage, SessionStore, type EventStorage } from "../session/store.js";import { loadSettings, resolveChildLaunchArgv, defaultSettingsPath } from "../session/settings.js";
import { createCredentialStore } from "../session/credentials.js";
import { FileSettingsGateway } from "./settings-gateway.js";
import { HostBridge, type AgentChannel } from "./bridge.js";
import { serveStatic } from "./static-files.js";
import { parseHostServerArgv, type HostServerArgv } from "./argv.js";
import { NotificationHub } from "./notify.js";
import { HostRegistry } from "./registry.js";


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
  /** U14/T-P3-103 settings 直答网关（生产 = FileSettingsGateway；测试注入内存面）。 */
  settingsGateway?: import("./settings-gateway.js").SettingsGateway;
  /** U3/T-P3-105 会话清单库（SQLite 事件库本体——op:"sessions" 数据面）。 */
  sessionsLibrary?: SqliteEventStorage;
  /** U10/T-P3-109 workspace 根（op:"files" 扫描面——缺省进程 cwd）。 */
  workspaceRoot?: string;
  /** U12/T-P3-111 上下文窗口 token 数（op:"usage" 占比分母——缺省 200_000）。 */
  contextWindow?: number;
  /**
   * U13/T-P3-112 N5 分类通知面（提供时 bridge 分类发布 + 全端以
   * notification name="n5" 广播——UI 通知中心的数据源；生产 main 创建）。
   */
  notifyHub?: NotificationHub;
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
    const bridge = new HostBridge({
      host,
      agent,
      store,
      ...(this.options.settingsGateway !== undefined ? { settingsGateway: this.options.settingsGateway } : {}),
      ...(this.options.sessionsLibrary !== undefined ? { sessionsLibrary: this.options.sessionsLibrary } : {}),
      ...(this.options.workspaceRoot !== undefined ? { workspaceRoot: this.options.workspaceRoot } : {}),
      ...(this.options.contextWindow !== undefined ? { contextWindow: this.options.contextWindow } : {}),
      ...(this.options.notifyHub !== undefined ? { notifyHub: this.options.notifyHub } : {}),
    });
    // U13/T-P3-112：N5 分类通知 → 全端 WS 广播（notification name="n5"——
    // UI 通知中心数据源）；unsub 在 stop 收束。
    const hubUnsub = this.options.notifyHub?.subscribe((n) => {
      bridge.notifyAll("n5", n);
    });
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
        if (hubUnsub !== undefined) hubUnsub(); // U13：通知订阅随 stop 收束
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

// ---------------------------------------------------------------------------
// 生产入口：node dist/src/host/server.js [--session <id>] [--port <n>]
//   [--ui <dir>] [--host-db <path>] [--provider echo|openai] …（透传子进程）
// ---------------------------------------------------------------------------

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

export async function main(argv: readonly string[]): Promise<void> {
  // T-P3-146 修：--help/-h 打印用法即退出（此前未识别旗标被静默忽略——
  // 实测坑：--help 起完整服务占缺省 8787，僵尸进程顶掉壳自起 host，
  // 壳 UI 连到旧代码 host 后新 settings op 全部静默失联）
  if (argv.some((a) => a === "--help" || a === "-h")) {
    process.stdout.write(
      [
        "aegent host —— 端间协议传输落点（WS over TCP）",
        "用法：host.cjs [--port <n>] [--session <id>] [--ui <dir>] [--host-db <path>]",
        "       [--workspace <dir>] [--settings <path>] [--agent-entry <path>]",
        "       [--context-window <n>] （其余旗标透传 agent 子进程）",
      ].join("\n") + "\n",
    );
    return;
  }
  const parsed = parseHostServerArgv(argv, { uiDir: defaultUiDir() });
  // U1/T-P3-101：settings 装配（CLI 同款三入口共用面——损坏 fail-closed
  // 直达启动失败出口）。host 的 childArgs 与 CLI 同走 resolveChildLaunchArgv。
  const { settings } = await loadSettings(parsed.settingsPath);
  // U2/T-P3-102：凭据装配——CLI 同款（仅文件档条目会被选中时提前 decrypt）。
  const providerFree =
    !parsed.childArgs.includes("--provider") &&
    (process.env["AEGENT_PROVIDER"] === undefined || process.env["AEGENT_PROVIDER"] === "");
  let credentialKey: string | undefined;
  if (providerFree && settings.defaultProvider !== undefined) {
    credentialKey = await createCredentialStore().getKey(settings.defaultProvider);
  }
  const { args: launchArgs } = resolveChildLaunchArgv(parsed.childArgs, process.env, settings, { credentialKey });
  const storage = parsed.hostDbPath !== undefined    ? SqliteEventStorage.open({ path: parsed.hostDbPath })
    : new InMemoryEventStorage();
  // U14/T-P3-103：settings 直答网关（生产 = 真文件——UI 改 → 文件变 → 重启
  // 生效）。U3：SQLite 库在位时一并交给网关（会话删除的 target 库）。
  const sqliteStorage = storage instanceof SqliteEventStorage ? storage : undefined;
  // U22/T-P3-125：workspace 根交给网关（技能管理面的扫描/写入根——与
  // op:"files" 同源：最终 launchArgs 的 --workspace > 进程 cwd）
  const workspaceRoot = (() => {
    const i = launchArgs.indexOf("--workspace");
    return i >= 0 && i + 1 < launchArgs.length ? launchArgs[i + 1] : process.cwd();
  })();
  const settingsGateway = new FileSettingsGateway(
    parsed.settingsPath ?? defaultSettingsPath(),
    createCredentialStore(),
    undefined,
    sqliteStorage,
    workspaceRoot,
  );
  const server = new HostServer({
    sessionId: parsed.sessionId,
    port: parsed.port,
    uiDir: parsed.uiDir,
    agentEntryPath: parsed.agentEntryPath ?? defaultAgentChildEntry(),
    childArgs: [...launchArgs, ...(parsed.settingsPath !== undefined ? ["--settings", parsed.settingsPath] : [])],
    storage,
    settingsGateway,
    sessionsLibrary: sqliteStorage,
    // U10/T-P3-109：workspace 根与子进程同源——最终 launchArgs 的
    // --workspace（含 settings 档注入）> 进程 cwd（子进程缺省语义同款）。
    workspaceRoot,
    // U12/T-P3-111：上下文窗口与子进程同源（--context-window > 200_000 缺省）。
    contextWindow: (() => {
      const i = launchArgs.indexOf("--context-window");
      return i >= 0 && i + 1 < launchArgs.length
        ? Number(launchArgs[i + 1]) || 200_000
        : 200_000;
    })(),
    // U13/T-P3-112：N5 分类通知面（bridge 发布 + 全端 WS 广播）。
    notifyHub: new NotificationHub(),
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
