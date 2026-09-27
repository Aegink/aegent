/**
 * ToolContext（D4）——工具执行上下文。类型面保证工具拿不到裸进程 API
 * （不变量 2）：进程能力只在 env 实现层（env.ts），本接口不含任何裸进程
 * API 词汇；键集合是封闭清单，多出任何键（含想塞进程句柄字段的口子）都
 * 会被 env.test 的类型级测试编译期拦下。
 *
 * P0 面：
 *   - env      执行环境（可选：纯 fs 工具不需要；bash 等执行型工具缺失时
 *              落 EXECUTION_ENV_MISSING isError）；
 *   - toolCallId  本次调用的 callId（B9 贯穿：与 tool/call、tool/result
 *              的 callId 配平，不造第二套词汇）；
 *   - signal   取消信号槽（A7）；P0 装配未接，形状先行。
 *   - reportProgress  进度上报通道（B7/T-P1-16）：仅本次工具执行期间可得
 *              （loop 按调用注入，registry 经 ToolDispatchCall 转进 ctx）；
 *              上报落 `tool/progress` 事件，best-effort 不反压执行。
 * policy（阶段 5 权限裁决）随对应阶段接入——P0 先落会留空字段（YAGNI）。
 */

import type { ExecutionEnv } from "./env.js";
import type { ReadGateService } from "../../policy/read-gate.js";

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
  readonly readGate?: ReadGateService;
}
