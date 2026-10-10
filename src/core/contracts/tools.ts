/**
 * 工具契约（T2-4 自 src/kernel/tools/{registry,context,contract}.ts 与
 * loop.ts 下沉类型面——执行/调度/审批三处共读的声明面；实现面（ToolRegistry
 * 类、ToolContext 装配、projectResult 函数）留在 kernel/tools，批 3 迁
 * core/primitives/tools/）。
 *
 * 形状取 zcode 工具契约（最优评估 §6）：声明式元数据 + toContracts() 单向
 * 投影——元数据只写一处，三处共读；缺声明 = 从严（fail-closed）。
 */

import type { JsonRecord, JsonValue } from "../skeleton/events.js";
import type { ExecutionEnv } from "./env.js";
import type { ReadGatePort } from "./policy.js";

/** 一个工具的执行结算（会话持久形状——content/isError/error/meta 全 JSON 安全）。 */
export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
  error?: { name: string; code: string; reason?: string };
  /** 工具私有展示载荷，对内核不透明；append 时由 assertJsonSafe 兜底（C14）。 */
  meta?: JsonValue;
}

/**
 * 执行期富值契约（B12，dsh·canonical-tool-output）：value 是工具的真实产物
 * （可以是任意东西——类实例、函数、大对象），render 是它进入事件流的唯一
 * 通道。持久化只存投影产物 content + error + meta，富值本身绝不落盘。
 */
export interface ContractResult<V = unknown> {
  value: V;
  /**
   * 显式投影：把富值渲染成模型可见、可持久化的 content 字符串。
   * 只见 args 与 value——不暴露 ctx / store / 进程对象。
   */
  render(args: JsonRecord, value: V): string | Promise<string>;
  /** 工具私有展示载荷（与 ToolExecutionResult.meta 同形状）。 */
  meta?: JsonValue;
  isError?: boolean;
  error?: { name: string; code: string; reason?: string };
}

/** 工具执行返回：纯投影值或契约富值（B12——dispatch 统一识别并投影）。 */
export type ToolExecution = ToolExecutionResult | ContractResult;

/** 工具执行上下文（D4——进程能力只在 ctx.env 实现层）。 */
export interface ToolContext {
  readonly env?: ExecutionEnv;
  readonly toolCallId: string;
  readonly signal?: AbortSignal;
  /** B7 进度上报：message 进 `tool/progress` 事件（所属 tool/call 未闭合期间有效）。 */
  readonly reportProgress?: (message: string) => void;
  /**
   * C12/C13 编辑前必须先读（T-P1-71）：会话内观察态记账服务。可选装配
   * ——缺省 undefined = 不启用（C13 整体丢弃，工具照常用）；提供时
   * read 记账、edit/write/apply_patch 校验。
   */
  readonly readGate?: ReadGatePort;
}

/**
 * 一个工具的注册定义（声明面）：执行体在此，描述在 descriptions/<name>.txt
 * （B2）。W5 元数据字段（readOnly/destructive 等）在 T3-6 加入本接口。
 */
export interface ToolDef {
  /** 工具名：模型调用名，同时是描述文件名。 */
  name: string;
  /**
   * JSON Schema 形状的参数描述（原样透传厂商）。缺省给空 object schema——
   * ChatTool.parameters 对 wire 是必填的。
   */
  parameters?: JsonValue;
  /**
   * 执行体：已解析的参数对象 + 执行上下文。不需要 ctx 的工具可以少收参数
   * （TS 方法兼容）。返回纯投影值或契约富值（B12）。
   */
  execute(
    args: JsonRecord,
    ctx: ToolContext,
  ): ToolExecution | Promise<ToolExecution>;

  /**
   * B17 并行声明：true = 只读类工具，声明后才可在 parallel 模式（B6）下
   * 与其他执行并发（持读锁）；**缺省 false = 排他**（未声明即不可并行，
   * fail-closed——持写锁与一切互斥）。写类工具与有状态工具一律缺省。
   */
  parallel?: boolean;

  /**
   * F12 延迟加载声明：true = 该工具的**真参数 schema 不进默认工具清单**，
   * wire 上只出现占位（name + 延迟标记描述 + 空 schema）；模型经 tool_load
   * 按名索取后，后续请求的清单才出现真 schema。缺省 false = 全量进清单
   * （P0 行为）。F14 纪律：占位首请求即声明（位置稳定），其他工具的增减
   * 不动已声明占位——前缀稳定（pi-mono cache scar 的位置性追加同款）。
   */
  deferrable?: boolean;

  /**
   * M6 工具级超时预算（毫秒）：声明后 dispatch 层武装 deadline——超时以
   * 结构化 isError 结果（code=TOOL_TIMEOUT）返回，**工具 promise 不被抛弃**
   * （dsh timeout-policy "without racing or abandoning the tool promise"：
   * 迟到的自然结算被静默丢弃，零 unhandled rejection）。缺省 undefined =
   * 不武装（零行为变化）。
   */
  timeoutMs?: number;

  /**
   * I3/T-P1-64：内联描述（MCP 工具用——描述随协议 tools/list 到达，没有
   * descriptions/<name>.txt 文件）。提供时 description() 优先读它；缺省
   * 走 B2 的按名读文件路径（builtin 行为不变）。
   */
  descriptionText?: string;
}

/**
 * W5 工具契约元数据（zcode 形状，最优评估 §6——T3-6 接入 ToolDef 与消费点；
 * 本形状先行为三处共读的声明锚）。全部可选：**缺声明 = 从严**（fail-closed
 * ——按名兜底回落现闭集，绝不默认放行）。
 */
export interface ToolMetadata {
  /** true = 只读（无文件效果）；调度器并行分组与审批按名兜底的声明源。 */
  readOnly?: boolean;
  /** true = 破坏性操作（不可逆——删除/覆盖系统面）。 */
  destructive?: boolean;
  /** 副作用范围闭集：none = 纯读；workspace = 工作区内可写；system = 出工作区。 */
  sideEffectScope?: "none" | "workspace" | "system";
  /** true = 执行前需要用户审批（policy 审批链消费）。 */
  needsApproval?: boolean;
  /** 风险档（审批 UI 与审计的粗档标尺）。 */
  riskLevel?: "low" | "medium" | "high";
  /** 单次输出字节上限（声明级——truncate 默认之外的收紧面）。 */
  maxOutputBytes?: number;
  /** true = 并发安全（与 parallel 互补：parallel 是调度声明，本字段是能力声明）。 */
  concurrentSafe?: boolean;
  /**
   * true = 成功即终态工具（executor 读取——"工具的内在能力声明，由 executor
   * 读取而不是在调用点按工具名猜测"，zcode types.ts:82-88）。
   */
  stopTurnOnSuccess?: boolean;
}

/** toContracts() 单向投影产物（声明即契约——执行器/调度器/审批三处共读）。 */
export interface ModelToolContract extends ToolMetadata {
  name: string;
  description?: string;
}

/** 工具执行前置守卫结果（C57 执行点重算的接线面）：政策层实现，registry 在
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
  /**
   * B7 进度上报通道（T-P1-16）：loop 按调用注入（闭包内记 seqInCall 与
   * 条数上限），registry 原样转进 ToolContext.reportProgress——只有正在
   * 执行的工具拿得到。缺省 undefined = 该调用无进度通道（零新事件）。
   */
  report?: (message: string) => void;
  /**
   * T-P1-43 取消信号（A7/T-P1-16 同款通道纪律）：loop 按调用注入本 turn
   * 的 AbortSignal，registry 原样转进 ToolContext.signal——只有正在执行的
   * 工具拿得到。缺省 undefined = 该调用无取消信号（工具自行决定是否消费）。
   */
  signal?: AbortSignal;
  /**
   * B16/T-P1-59：本 step 的执行策略快照（loop 从 step 开始时的声明固化）。
   * 提供时 timeoutMs 以快照为准（在途 step 用 advertise 它们的那一步的
   * 声明，中途 registerTool 替换不影响）；缺省 undefined = 按 def 现值
   * （零行为变化）。
   */
  runtimeMeta?: { parallel?: boolean; timeoutMs?: number };
}

/** loop 执行上下文（hook 载荷与工具链共用的最小会话标识）。 */
export interface LoopContext {
  sessionId: string;
}

/** toolCall 点位载荷（policy 链与工具执行共读——B12 arguments unparsed）。 */
export interface ToolCallPayload {
  turn: number;
  step: number;
  callId: string;
  name: string;
  /** 模型产出的原始 arguments JSON 串，unparsed（B12）。 */
  arguments: string;
  /**
   * B7 进度上报通道（T-P1-16）：loop 在进入链前按调用注入（createProgress
   * Reporter 闭包——seqInCall 单调、条数有上限），经 terminal 流进
   * ToolContext.reportProgress。链层替换载荷时丢失即无进度（best-effort）。
   */
  report?: (message: string) => void;
  /**
   * T-P1-43：本 turn 的取消信号（A7 槽位的 AbortSignal 面）——工具可选
   * 消费（task 用它联动子循环取消）；经 registry 转进 ToolContext.signal。
   */
  signal?: AbortSignal;
}
