/**
 * 子代理执行后端可插（H6）——后端是接口 + 注册表选择；五种后端（ACP /
 * CC / Codex / DSH-SDK / 进程内 fork）中只实落两种（进程内 fork = P0 H2
 * 面；ACP = 批次 12 协议形状复用），其余三种接口留位（无锚实现价值，
 * YAGNI 记档——装配方按同一接口补即可）。
 *
 * ACP 编解码的放置（架构纪律）：**协议形状**（initialize / session/new /
 * session/prompt / session/update 通知的字段契约）复用 src/acp 域，
 * JSON-RPC 行的编解码在本文件最小自实现——不 import acp 域：①session →
 * acp 会引入新依赖环（forbidCycles）与深导入（acp 公开入口只有 main.ts）；
 * ②acp 域有"仅 8 个文件"的硬约束不能加共享件。语义一致性由协议契约
 * 测试钉住（出站方法序与载荷形状断言）。
 *
 * 取 dsh·subagent-* 的行为："后端是接口 + 注册表选择"（其 subagent-acp /
 * subagent-claude-code / subagent-codex / subagent-dsh-sdk 四包同挂一个
 * seam；out-of-process 的 never-reject 结算与能力广告纪律同构）；不抄其
 * 六包结构（我方单域文件）。
 *
 * 关键纪律（事件流形状收敛——卡面风险条）：
 *   - 所有后端收敛到同一 `SubagentRunResult`（E5/H2 的既有形状——
 *     sessionId / stopReason / output / error?，**事件词汇同源**：ACP 侧
 *     的 session/update 文本流在回来时收敛为 output 字符串，不引入第二套
 *     事件形状）；
 *   - **never-reject 结算**（dsh out-of-process 同款）：spawn 的失败
 *     （进程死/超时/协议坏）转类型化 failed 结算而非上抛——父 step 的
 *     结算通道绝不被子代理基础设施故障炸掉（H2 runner 的 catch 同款）；
 *   - 超时套 deadline 原语（M7——`Deadline.fromTimeoutMs`，挂死的外部
 *     agent 可回收）；
 *   - 外部后端的 process 机制（spawn/env 擦除/进程树回收）归各自实现面
 *     ——本模块交付接口/注册表/两实现与 transport 注入点（真实 ACP 进程
 *     联调列人工确认）。
 */

import { Deadline, withDeadline, TimeoutError } from "../kernel/deadline.js";
import type { SubagentRunResult, SubagentStopReason } from "../kernel/subagent.js";
import type { createSubagentRunner } from "../kernel/subagent.js";

/** 一次子代理派发请求（后端无关的输入面——E5/H2 的 run 参数形状）。 */
export interface SubagentSpawnRequest {
  readonly prompt: string;
  readonly description: string;
  readonly signal?: AbortSignal;
}

/** 执行后端接口：一个后端 = 一种"起子会话并结算"的机制。 */
export interface SubagentBackend {
  /** 后端名（注册表键 + 诊断——如 "in-process" / "acp"）。 */
  readonly name: string;
  /** 派发并等结算（never-reject：失败面转 SubagentRunResult，不上抛）。 */
  spawn(request: SubagentSpawnRequest): Promise<SubagentRunResult>;
}

/** 未知/重名后端的类型化拒绝。 */
export class SubagentBackendError extends Error {
  readonly code: "SUBAGENT_BACKEND_UNKNOWN" | "SUBAGENT_BACKEND_DUPLICATE";
  constructor(code: "SUBAGENT_BACKEND_UNKNOWN" | "SUBAGENT_BACKEND_DUPLICATE", message: string) {
    super(message);
    this.name = "SubagentBackendError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 实现一：进程内 fork（P0 H2 面包装——零逻辑复制）
// ---------------------------------------------------------------------------

/** 进程内后端名（task 工具 --backend 的缺省选择）。 */
export const IN_PROCESS_BACKEND = "in-process";

/**
 * 包一个 H2 runner（kernel/subagent.ts 的 createSubagentRunner 产物）为
 * 后端——零逻辑复制：深度检查/降级规则/取消联动全在 runner 内。
 */
export function createInProcessBackend(
  runner: ReturnType<typeof createSubagentRunner>,
  name: string = IN_PROCESS_BACKEND,
): SubagentBackend {
  return {
    name,
    spawn: async (request) => {
      const outcome = await runner.run(request.prompt, request.description, {
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
      });
      // H6 后端语义 = 前台同步结算（后台面走 task 工具直调 runner）——
      // outcome 联合在此收敛为 foreground（in-process 后端不发起后台）
      if (outcome.kind === "background") {
        return {
          sessionId: outcome.childSessionId,
          stopReason: "failed" as const,
          output: "",
          error: "in-process 后端不支持后台启动（内部错误）",
        };
      }
      return outcome.result;
    },
  };
}

// ---------------------------------------------------------------------------
// 实现二：ACP 后端（client 侧连外部 ACP agent 进程）
// ---------------------------------------------------------------------------

/** ACP 后端的传输注入面（测试用内存桥；真实进程经 spawnAcpTransport）。 */
export interface AcpBackendTransport {
  /** 出站一行（JSON-RPC）。 */
  write(line: string): void;
  /** 入站行流（一行一 JSON）。 */
  readonly lines: AsyncIterable<string>;
  /** 收摊（进程杀/流关——幂等）。 */
  close(): void;
}

export interface AcpBackendOptions {
  readonly transport: AcpBackendTransport;
  /** 后端名（缺省 "acp"）。 */
  readonly name?: string;
  /** 单次派发预算（缺省 10 分钟——子代理是长任务；挂死可回收）。 */
  readonly timeoutMs?: number;
}

/**
 * 入站行解析（client 侧，JSON-RPC 2.0 最小面自持）：response（无 method、
 * 有 id）与 request/notification（有 method）三分；坏行返回 undefined
 * （不崩——K4 纪律同款）。协议形状与 acp 域一致（见头注释的放置理由）。
 */
type IncomingLine =
  | { kind: "response"; id: number | string; result?: unknown; error?: { code: number; message: string } }
  | { kind: "request"; id: number | string; method: string; params?: unknown }
  | { kind: "notification"; method: string; params?: unknown }
  | undefined;

function parseLine(line: string): IncomingLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (record["jsonrpc"] !== "2.0") return undefined;
  const method = record["method"];
  if (typeof method !== "string" || method === "") {
    // response：无 method，靠 id + result/error 判别
    if (record["id"] === undefined) return undefined;
    const error = record["error"];
    return {
      kind: "response",
      id: record["id"] as number | string,
      ...(record["result"] !== undefined ? { result: record["result"] } : {}),
      ...(error !== null && typeof error === "object"
        ? { error: error as { code: number; message: string } }
        : {}),
    };
  }
  const params = record["params"];
  return record["id"] === undefined
    ? { kind: "notification", method, ...(params !== undefined ? { params } : {}) }
    : { kind: "request", id: record["id"] as number | string, method, ...(params !== undefined ? { params } : {}) };
}

/** 出站行编码（JSON-RPC 2.0 request 最小面）。 */
function encodeLine(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/** ACP stopReason 三值映射（事件词汇同源：收敛到 H2 的结算词汇）。 */
function settleFromAcpStopReason(stopReason: unknown): SubagentStopReason {
  if (stopReason === "end_turn") return "completed";
  if (stopReason === "cancelled") return "cancelled";
  return "failed";
}

/**
 * ACP 后端：initialize → session/new → session/prompt（长请求等 response），
 * 沿途 session/update 的文本块累积为 output。失败面（transcript 断流/超时/
 * 协议错/应答缺失）一律转 failed/cancelled 结算（never-reject）。
 */
export function createAcpBackend(options: AcpBackendOptions): SubagentBackend {
  const name = options.name ?? "acp";
  const timeoutMs = options.timeoutMs ?? 600_000;
  let nextId = 1;

  return {
    name,
    spawn: async (request) => {
      try {
        return await withDeadline(
          Deadline.fromTimeoutMs("ACP_SUBAGENT_TIMEOUT", timeoutMs),
          runAcpSpawn(options.transport, request, () => nextId++),
        );
      } catch (e) {
        if (e instanceof TimeoutError) {
          return {
            sessionId: "",
            stopReason: "failed",
            output: "",
            error: `ACP 子代理在 ${String(timeoutMs)}ms 内未结算（超时回收）`,
          };
        }
        return {
          sessionId: "",
          stopReason: request.signal?.aborted === true ? "cancelled" : "failed",
          output: "",
          error: e instanceof Error ? e.message : String(e),
        };
      } finally {
        try {
          options.transport.close();
        } catch {
          // 收摊尽力而为：僵死的传输不得阻塞结算
        }
      }
    },
  };
}

/** 单次 ACP 派发全链（拆出便于超时包装与测试直达）。 */
async function runAcpSpawn(
  transport: AcpBackendTransport,
  request: SubagentSpawnRequest,
  nextId: () => number,
): Promise<SubagentRunResult> {
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const chunks: string[] = [];
  let externalSessionId = "";
  let promptResponse: { stopReason?: unknown } | undefined;
  let promptSettled: ((v: { stopReason?: unknown }) => void) | undefined;
  let transportError: Error | undefined;

  // 入站泵：response 按 id 配对；session/update 通知累积文本。
  const pump = (async () => {
    for await (const line of transport.lines) {
      const incoming = parseLine(line);
      if (incoming === undefined) continue; // 坏行不崩（K4 纪律——ACP 侧同款）
      if (incoming.kind === "request") {
        // client 侧收到 agent→client 请求（如 request_permission）：最小面
        // 不支持——回错误并继续（真实权限桥随联调，卡面记档）。
        transport.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: incoming.id,
            error: { code: -32601, message: "子代理后端未支持 agent→client 请求" },
          }),
        );
        continue;
      }
      if (incoming.kind === "notification") {
        if (incoming.method === "session/update") {
          const params = incoming.params as
            | { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } }
            | undefined;
          const update = params?.update;
          if (
            update?.sessionUpdate === "agent_message_chunk" &&
            update.content?.type === "text" &&
            typeof update.content.text === "string"
          ) {
            chunks.push(update.content.text);
          }
        }
        continue;
      }
      // response
      if (incoming.kind !== "response") continue;
      const waiter = pending.get(incoming.id as number);
      if (waiter === undefined) continue;
      pending.delete(incoming.id as number);
      if (incoming.error !== undefined) {
        waiter.reject(new Error(`ACP ${String(incoming.error.code)}: ${incoming.error.message}`));
      } else {
        waiter.resolve(incoming.result);
      }
    }
  })()
    .then(() => {
      // 流正常结束但轮未结算（外部 agent 静默退出）：按失败收口
      // （never-reject——由 spawn 的 catch 转结算）。
      promptSettled?.({ stopReason: undefined });
    })
    .catch((e: unknown) => {
      transportError = e instanceof Error ? e : new Error(String(e));
      for (const [, waiter] of pending) waiter.reject(transportError);
      promptSettled?.({ stopReason: undefined });
    });

  const rpc = (method: string, params: unknown): Promise<unknown> => {
    // 死流守卫：流已断时不再入队（否则挂死到 deadline 兜底）
    if (transportError !== undefined) return Promise.reject(transportError);
    const id = nextId();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      transport.write(encodeLine(id, method, params));
    });
  };

  await rpc("initialize", { protocolVersion: 1, clientCapabilities: {} });
  const created = (await rpc("session/new", {})) as { sessionId?: string } | undefined;
  externalSessionId = created?.sessionId ?? "";

  // session/prompt 是长请求：response 在轮结束时到达；取消经信号透传。
  const promptDone = new Promise<void>((resolve) => {
    promptSettled = () => {
      resolve();
    };
  });
  const promptP = rpc("session/prompt", {
    sessionId: externalSessionId,
    prompt: [{ type: "text", text: request.prompt }],
  }).then(
    (v) => {
      promptResponse = v as { stopReason?: unknown };
      promptSettled?.({ stopReason: promptResponse.stopReason });
    },
    (e: unknown) => {
      transportError = e instanceof Error ? e : new Error(String(e));
      promptSettled?.({ stopReason: undefined });
    },
  );
  if (request.signal !== undefined) {
    request.signal.addEventListener("abort", () => promptSettled?.({ stopReason: "cancelled" }), {
      once: true,
    });
  }
  await promptDone;
  await promptP.catch(() => undefined);

  if (transportError !== undefined && promptResponse === undefined) {
    throw transportError;
  }
  const stopReason = settleFromAcpStopReason(promptResponse?.stopReason);
  const output = chunks.join("");
  return {
    sessionId: externalSessionId,
    stopReason,
    output,
    ...(stopReason !== "completed"
      ? {
          error: `ACP 子代理未完成（stopReason=${
            promptResponse?.stopReason === undefined ? "缺失（外部 agent 未结算）" : String(promptResponse.stopReason)
          }）`,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 注册表（按名字选择——task 工具 --backend 参数面）
// ---------------------------------------------------------------------------

/**
 * 后端注册表：重名拒绝；未知名字类型化拒绝（fail-closed——不静默回退
 * 缺省后端，拼错后端名必须大声失败）。`spawn(name | undefined, request)`
 * 是 task 工具的消费入口：缺省名由 defaultName 决定。
 */
export class SubagentBackendRegistry {
  private readonly backends = new Map<string, SubagentBackend>();
  constructor(private readonly defaultName: string = IN_PROCESS_BACKEND) {}

  register(backend: SubagentBackend): () => void {
    if (this.backends.has(backend.name)) {
      throw new SubagentBackendError(
        "SUBAGENT_BACKEND_DUPLICATE",
        `子代理后端重名：${backend.name}`,
      );
    }
    this.backends.set(backend.name, backend);
    return () => {
      this.backends.delete(backend.name);
    };
  }

  get(name: string): SubagentBackend {
    const backend = this.backends.get(name);
    if (backend === undefined) {
      throw new SubagentBackendError(
        "SUBAGENT_BACKEND_UNKNOWN",
        `未知子代理后端：${name}（可用：${[...this.backends.keys()].join(" | ") || "无"}）`,
      );
    }
    return backend;
  }

  list(): readonly string[] {
    return [...this.backends.keys()];
  }

  /** 按名字派发（undefined = 缺省后端——不在注册表同样类型化拒绝）。 */
  async spawn(name: string | undefined, request: SubagentSpawnRequest): Promise<SubagentRunResult> {
    return this.get(name ?? this.defaultName).spawn(request);
  }
}
