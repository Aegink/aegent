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
import type { ChatTool } from "../../models/provider.js";
import type { JsonRecord, JsonValue } from "../events.js";
import type { ToolExecutionResult } from "../loop.js";
import { isContractResult, projectResult, type ContractResult } from "./contract.js";
import type { ToolContext } from "./context.js";
import type { ExecutionEnv } from "./env.js";
import { DEFAULT_SPILL_DIR, boundedOutput } from "./truncate.js";
import { DEFAULT_SPILL_MAX_FILES, enforceSpillQuota } from "./spill-gc.js";

/** 工具执行体的两种返回：已投影值，或契约富值（B12，dispatch 统一投影）。 */
export type ToolExecution =
  | ToolExecutionResult
  | ContractResult;

/** 一个工具的注册定义：执行体在此，描述在 descriptions/<name>.txt（B2）。 */
export interface ToolDef {
  /** 工具名：模型调用名，同时是描述文件名。 */
  name: string;
  /**
   * JSON Schema 形状的参数描述（原样透传厂商）。缺省给空 object schema——
   * ChatTool.parameters 对 wire 是必填的。
   */
  parameters?: JsonValue;
  /**
   * 执行体：已解析的参数对象 + 执行上下文（ToolContext，D4——进程能力只在
   * ctx.env 实现层）。不需要 ctx 的工具可以少收参数（TS 方法兼容）。
   * 返回纯投影值或契约富值（B12：{value, render}，富值经 render 投影落盘）。
   */
  execute(
    args: JsonRecord,
    ctx: ToolContext,
  ): ToolExecution | Promise<ToolExecution>;
}

/** 工具执行前置守卫（C57 执行点重算的接线面）：政策层实现，registry 在
 * 解析参数后、执行前调用。拒绝即不执行。 */
export interface ToolGuardOutcome {
  readonly allowed: boolean;
  /** 放行时给回（可能已剥除决策标记）的执行参数。 */
  readonly args: JsonRecord;
  readonly reason?: string;
  readonly code?: string;
}

/** dispatch 的入参（与 tool/call 事件载荷、loop 的 executeTool 入参同源）。 */
export interface ToolDispatchCall {
  callId: string;
  name: string;
  /** 模型产出的原始 arguments JSON 串，unparsed（B12）。 */
  arguments: string;
}

export class ToolRegistry {
  private readonly defs = new Map<string, ToolDef>();
  private readonly descriptionsDir: string;
  private readonly env: ExecutionEnv | undefined;
  private readonly sessionId: string | undefined;
  private readonly spillDir: string | undefined;
  private readonly spillMaxFiles: number;
  private readonly guard:
    | ((name: string, args: JsonRecord) => Promise<ToolGuardOutcome>)
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
  }) {
    this.descriptionsDir =
      options?.descriptionsDir ??
      path.join(path.dirname(fileURLToPath(import.meta.url)), "descriptions");
    this.env = options?.env;
    this.sessionId = options?.sessionId;
    this.spillDir = options?.spillDir;
    this.spillMaxFiles = options?.spillMaxFiles ?? DEFAULT_SPILL_MAX_FILES;
    this.guard = options?.guard;
  }

  /** 注册一个工具；重名是装配错误，立刻失败。 */
  registerTool(def: ToolDef): void {
    if (this.defs.has(def.name)) {
      throw new Error(`工具重复注册：${def.name}`);
    }
    this.defs.set(def.name, def);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  names(): string[] {
    return [...this.defs.keys()];
  }

  /**
   * B2：按名读 `descriptions/<name>.txt`。每次直读不缓存——描述可运行期
   * 改动即时生效（工具数少，装配时才读，无性能压力）。文件缺失即抛：
   * 模型可见的描述不该静默成空串。
   */
  description(name: string): string {
    if (!this.defs.has(name)) {
      throw new Error(`未注册的工具：${name}`);
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

  /** 装配给模型请求的 ChatTool 清单（request/header.tools 的来源）。 */
  toChatTools(): ChatTool[] {
    return [...this.defs.values()].map((def) => ({
      name: def.name,
      description: this.description(def.name),
      parameters: def.parameters ?? { type: "object", properties: {} },
    }));
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
    };
    const executed = await def.execute(args, ctx);
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
