/**
 * 工具注册表（B1/B2）——工具的唯一分发入口与描述载体。
 *
 * 装配关系（T-3-01 三点位决定的连锁约束）：注册表分发是 toolCall 链的
 * **链底 terminal**——loop 的 AgentLoopDeps.executeTool 由 registry.dispatch
 * 充当（T-4-02 接线），阶段 5 权限层挂同一条链的 toolCall 点位。工具执行
 * 不存在绕过链的第二条路径。
 *
 * B2 描述与代码分离：描述文本不写在代码里，按名从 `descriptions/<name>.txt`
 * 读取（opencode 的 .ts 与同名 .txt 成对形状）。改描述 = 改 txt，.ts 零 diff；
 * 不缓存，改完即生效。
 *
 * 错误分层（配平不变量：每个 tool/call 必有 tool/result）：
 *   - 未知工具 / 参数坏 → dispatch 返回 isError 结果（下方两个 code），错误
 *     说明回喂模型可自修（opencode InvalidArgumentsError 的 message 意图）；
 *   - 工具执行崩溃 → 原样上抛，由 loop.dispatchTool 兜底落
 *     TOOL_EXECUTE_FAILED（loop.ts"基础设施崩溃也落成 isError 结果"）。
 * 两层合起来保证走注册表的事件流不会出现"有 call 无 result"。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ChatTool } from "../../core/index.js";
import type { JsonRecord, JsonValue } from "../events.js";
import type { ToolExecutionResult } from "../loop.js";
import { TOOL_TIMEOUT, TimeoutError } from "../timeout.js";
import { Deadline, withDeadline } from "../deadline.js";
import { isContractResult, projectResult, type ContractResult } from "./contract.js";
import type { ExecutionEnv } from "./env.js";
import { DEFAULT_SPILL_DIR, boundedOutput } from "./truncate.js";
import { DEFAULT_SPILL_MAX_FILES, enforceSpillQuota } from "./spill-gc.js";

/** 工具执行体的两种返回：已投影值，或契约富值（B12，dispatch 统一投影）。 */
// T2-4 依赖倒置：ToolExecution/ToolDef 契约下沉 core/contracts/tools.ts（re-export 保兼容）。
export type { ToolDef, ToolDispatchCall, ToolExecution, ToolGuardOutcome } from "../../core/index.js";
import type { ToolContext, ToolDef, ToolDispatchCall, ToolExecution, ToolGuardOutcome } from "../../core/index.js";

// ToolGuardOutcome/ToolDispatchCall 契约已下沉 core/contracts/tools.ts。



export class ToolRegistry {
  private readonly defs = new Map<string, ToolDef>();
  private readonly descriptionsDir: string;
  private readonly env: ExecutionEnv | undefined;
  private readonly sessionId: string | undefined;
  private readonly spillDir: string | undefined;
  private readonly spillMaxFiles: number;
  /** F12 已按名索取过真 schema 的 deferrable 工具（会话生命周期）。 */
  private readonly loadedDeferred = new Set<string>();
  private readonly guard:
    | ((name: string, args: JsonRecord) => Promise<ToolGuardOutcome>)
    | undefined;
  private readonly readGate:
    | import("../../policy/read-gate.js").ReadGateService
    | undefined;

  /**
   * @param descriptionsDir 描述目录；缺省为同目录的 `descriptions/`。
   * 可注入是给测试用临时目录——验收②"改 txt 后 description 变化且 .ts
   * 无 diff"以此为机验形式。
   * @param env 执行环境（D4）：装配处注入 NodeExecutionEnv；缺省 undefined
   * 时执行型工具（bash）落 EXECUTION_ENV_MISSING。
   * @param sessionId / spillDir 喂给 B5/B10 的出口截断（Q13 标记需要会话
   * 身份）；缺省时标记记 "unknown-session"、spill 落 DEFAULT_SPILL_DIR。
   * @param spillMaxFiles 超量触发上限（Q3/T-P1-14）：spill 发生点即配额
   * 执行点，最老先删且只删自动可删者；传 Infinity 显式关闭。缺省
   * DEFAULT_SPILL_MAX_FILES。
   * @param guard 执行前置守卫（C57/T-5-11）：阶段 5 权限层注入，缺省无
   * 守卫（纯工具层单测装配）。
   */
  constructor(options?: {
    descriptionsDir?: string;
    env?: ExecutionEnv;
    sessionId?: string;
    spillDir?: string;
    spillMaxFiles?: number;
    guard?: (name: string, args: JsonRecord) => Promise<ToolGuardOutcome>;
    /** C12/C13 读记账服务（可选装配，T-P1-71）；缺省不启用。 */
    readGate?: import("../../policy/read-gate.js").ReadGateService;
  }) {
    this.descriptionsDir =
      options?.descriptionsDir ??
      path.join(path.dirname(fileURLToPath(import.meta.url)), "descriptions");
    this.env = options?.env;
    this.sessionId = options?.sessionId;
    this.spillDir = options?.spillDir;
    this.spillMaxFiles = options?.spillMaxFiles ?? DEFAULT_SPILL_MAX_FILES;
    this.guard = options?.guard;
    this.readGate = options?.readGate;
  }

  /** 注册一个工具；重名是装配错误，立刻失败。 */
  registerTool(def: ToolDef): void {
    if (this.defs.has(def.name)) {
      throw new Error(`工具重复注册：${def.name}`);
    }
    this.defs.set(def.name, def);
  }

  /**
   * 注销一个工具（T-P3-148 X——动态插件 dispose 的登记面回收）。名字不存在
   * = 幂等 no-op；B16 快照纪律保证在途 step 不受影响（执行策略在 step 开始
   * 已固化）。
   */
  unregisterTool(name: string): void {
    this.defs.delete(name);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  names(): string[] {
    return [...this.defs.keys()];
  }

  /**
   * B17/T-P1-15：并行声明查询（loop 并发分组的数据源）。未注册名 = false
   * （fail-closed：模型幻觉出的工具名按排他处理）。
   */
  isParallelDeclared(name: string): boolean {
    return this.defs.get(name)?.parallel === true;
  }

  /**
   * B16/T-P1-59：工具执行策略快照（parallel 声明 + M6 超时预算）。loop 在
   * step 开始时按广告清单逐名取值固化——"工具调用可能晚跑，用 advertise
   * 它们的那一步的声明"（codex parallel.rs step_context 快照同构）；step
   * 进行中 registerTool 替换声明不影响在途 step。
   */
  runtimeMeta(name: string): { parallel: boolean; timeoutMs: number | undefined } | undefined {
    const def = this.defs.get(name);
    if (def === undefined) return undefined;
    return { parallel: def.parallel === true, timeoutMs: def.timeoutMs };
  }

  /**
   * B2：按名读 `descriptions/<name>.txt`。每次直读不缓存——描述可运行期
   * 改动即时生效（工具数少，装配时才读，无性能压力）。文件缺失即抛：
   * 模型可见的描述不该静默成空串。
   */
  description(name: string): string {
    const def = this.defs.get(name);
    if (def === undefined) {
      throw new Error(`未注册的工具：${name}`);
    }
    if (def.descriptionText !== undefined) {
      return def.descriptionText;
    }
    try {
      return readFileSync(
        path.join(this.descriptionsDir, `${name}.txt`),
        "utf8",
      ).trim();
    } catch {
      throw new Error(`工具 ${name} 缺少描述文件（descriptions/${name}.txt）`);
    }
  }

  /**
   * 装配给模型请求的 ChatTool 清单（request/header.tools 的来源）。
   * F12/F14/T-P1-17：deferrable 工具在被索取（requestToolSchema）前只出现
   * **占位**（name + 延迟标记描述 + 空 schema，形状只从 name/描述派生、
   * 位置 = 注册序），索取后该位置出现真 schema（原地替换，清单长度不变
   * ——pi-mono cache scar 的位置性追加纪律：其他工具的增减绝不动已声明
   * 占位）。非 deferrable 工具与 P0 行为逐字节一致。
   */
  toChatTools(): ChatTool[] {
    return [...this.defs.values()].map((def) => {
      if (def.deferrable !== true || this.loadedDeferred.has(def.name)) {
        return {
          name: def.name,
          description: this.description(def.name),
          parameters: def.parameters ?? { type: "object", properties: {} },
        };
      }
      return {
        name: def.name,
        description: `${this.description(def.name)}\n\n[deferred] 完整参数 schema 未加载——调用 tool_load(name: "${def.name}") 按名索取。`,
        parameters: { type: "object", properties: {} },
      };
    });
  }

  /**
   * F12 按名索取（tool_load 的执行面）：deferrable 工具标记为已加载，
   * 后续 toChatTools 在原位给真 schema。返回值区分两种结果："loaded"
   * （本次真正加载了）与 "visible"（schema 本就在清单——非 deferrable
   * 工具或重复索取，幂等 no-op）。调用方（tool_load）负责对未注册名先落
   * TOOL_NOT_FOUND。
   */
  requestToolSchema(name: string): "loaded" | "visible" {
    const def = this.defs.get(name);
    if (def === undefined) {
      throw new Error(`未注册的工具：${name}`);
    }
    if (def.deferrable !== true || this.loadedDeferred.has(name)) {
      return "visible";
    }
    this.loadedDeferred.add(name);
    return "loaded";
  }

  /**
   * 链底 terminal 的实现：解析参数 → 执行前置守卫（C57，拒绝即不执行、
   * 不产生工具输出）→ 查表 → 构造 ToolContext → 执行 → 出口截断
   * （B5/B10/B11，boundOutput）。返回 isError 而非抛错的几种情况（未知
   * 工具 / 参数坏 / 守卫拒绝）保证 call/result 配平；执行体自身的崩溃
   * 原样上抛交 loop 兜底（分层见头注释）。
   */
  async dispatch(call: ToolDispatchCall): Promise<ToolExecutionResult> {
    const def = this.defs.get(call.name);
    if (!def) {
      return {
        content: `未知的工具：${call.name}`,
        isError: true,
        error: { name: "RegistryError", code: "TOOL_NOT_FOUND" },
      };
    }
    let args: JsonRecord;
    try {
      const parsed = JSON.parse(call.arguments) as JsonValue;
      // 工具参数契约是对象：数组 / 标量 / null 一律拒绝
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return argumentsInvalid(call.name, call.arguments, "参数必须是 JSON 对象");
      }
      args = parsed;
    } catch {
      return argumentsInvalid(call.name, call.arguments, "参数不是合法 JSON");
    }
    // 执行前置守卫（C57/T-5-11）：拦截发生在工具出口（截断/投影）上游，
    // 拒绝时不执行、不产生工具输出
    if (this.guard !== undefined) {
      const outcome = await this.guard(call.name, args);
      if (!outcome.allowed) {
        return {
          content: outcome.reason ?? "权限策略拒绝执行",
          isError: true,
          error: {
            name: "RegistryError",
            code: outcome.code ?? TOOL_PERMISSION_DENIED,
          },
        };
      }
      args = outcome.args;
    }
    // ToolContext 在这里装配（B9：toolCallId 就是配平的 callId）
    const ctx: ToolContext = {
      toolCallId: call.callId,
      ...(this.env !== undefined ? { env: this.env } : {}),
      ...(call.report ? { reportProgress: call.report } : {}),
      ...(call.signal ? { signal: call.signal } : {}),
      ...(this.readGate !== undefined ? { readGate: this.readGate } : {}),
    };
    // M6：工具声明 timeoutMs 则在执行外包总预算——超时转结构化 isError
    // 结果（code=TOOL_TIMEOUT，dsh toolTimeoutResult 同构：模型看到的是
    // 可路由的错误码而非静默失败）。内层工具 promise 不被抛弃（withDeadline
    // 纪律），迟到结算被丢弃且零 unhandled rejection；code 判据保持 J22
    // 作用域纪律——内层自有码的超时不在此误捕。B16：call.runtimeMeta 是
    // step 开始时的快照——提供时优先于 def 现值。M7：预算以 deadline token
    // 表达（可查询/可组合的共享原语），不再是裸 setTimeout。
    const effectiveTimeoutMs = call.runtimeMeta?.timeoutMs ?? def.timeoutMs;
    const budget =
      effectiveTimeoutMs !== undefined
        ? Deadline.fromTimeoutMs(TOOL_TIMEOUT, effectiveTimeoutMs)
        : undefined;
    const raw = withDeadline(budget, Promise.resolve(def.execute(args, ctx)));
    let executed: ToolExecution;
    try {
      executed = await raw;
    } catch (e) {
      if (effectiveTimeoutMs !== undefined && e instanceof TimeoutError && e.code === TOOL_TIMEOUT) {
        executed = {
          content: `工具执行在 ${String(e.timeoutMs)}ms 内未完成，已被终止`,
          isError: true,
          error: { name: "ToolTimeoutError", code: TOOL_TIMEOUT },
        };
      } else {
        throw e;
      }
    }
    // B12：契约富值（含 value/render）在此投影成落盘形状——富值不出本函数
    const result = isContractResult(executed)
      ? await projectResult(args, executed)
      : executed;
    return await this.boundOutput(call, result);
  }

  /**
   * B5/B10：统一出口的输出截断——所有工具一次接入（工具本体零感知）。
   * 截断事实写 meta（truncated/truncatedBy/spillPath，opencode 同款形状），
   * 与工具自带的 meta 字段合并；完整输出路径在 content 尾部告知模型。
   */
  private async boundOutput(
    call: ToolDispatchCall,
    result: ToolExecutionResult,
  ): Promise<ToolExecutionResult> {
    if (typeof result.content !== "string" || result.content === "") return result;
    // T-P3-174 批次 1：自带双层预算的结果（bash/pwsh/task_output 的
    // shell-output 格式化——96KB 预算 + workspace scratch spill）跳过本通用
    // 出口——否则 96KB 会被 50KB 二次截断、spill 落两处。
    if (
      result.meta !== null &&
      typeof result.meta === "object" &&
      !Array.isArray(result.meta) &&
      (result.meta as Record<string, unknown>)["outputBounded"] === true
    ) {
      return result;
    }
    const bounded = await boundedOutput(result.content, {
      sessionId: this.sessionId ?? "unknown-session",
      tool: call.name,
      callId: call.callId,
      ...(this.spillDir !== undefined ? { spillDir: this.spillDir } : {}),
    });
    if (!bounded.truncated) return result;
    // Q3 超量触发（T-P1-14）：spill 发生点即配额执行点——N 次截断后目录内
    // own-marker 文件数有界（最老先删、只删自动可删者）。删除失败收集进
    // 报告不抛：不掩盖本次截断结果，配额缺口留给下次 spill 再收。
    await enforceSpillQuota(
      this.spillDir ?? DEFAULT_SPILL_DIR,
      this.spillMaxFiles,
    );
    const baseMeta: JsonRecord =
      result.meta !== undefined &&
      typeof result.meta === "object" &&
      !Array.isArray(result.meta) &&
      result.meta !== null
        ? result.meta
        : {};
    return {
      ...result,
      content: bounded.text,
      meta: {
        ...baseMeta,
        truncated: true,
        truncatedBy: bounded.truncatedBy ?? "bytes",
        spillPath: bounded.spilled?.path ?? "",
      },
    };
  }
}

/** 执行前置守卫拒绝（C57）的缺省错误码。 */
export const TOOL_PERMISSION_DENIED = "TOOL_PERMISSION_DENIED";

function argumentsInvalid(
  name: string,
  raw: string,
  reason: string,
): ToolExecutionResult {
  return {
    content: `工具 ${name} 的${reason}，收到：${raw}`,
    isError: true,
    error: {
      name: "RegistryError",
      code: "TOOL_ARGUMENTS_INVALID",
      reason,
    },
  };
}
