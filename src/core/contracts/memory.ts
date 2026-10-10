/**
 * 记忆 provider 契约（T2-5 / EP-5，纯类型不接线——hermes 核心子集形状，
 * W4/T7-2 落注册面 + 单外部约束 + 内建 provider 整体搬迁）。
 *
 * 纪律（G6 护栏锚点）：systemPromptBlock 产出**记忆独立段**——不参与
 * 小节合并（system-prompt.ts 的独立段语义，禁遵循指令警告同款）。
 */

import type { ToolDef } from "./tools.js";

export interface MemoryProvider {
  /** 装配期初始化（provider 目录/索引加载；失败即 provider 不可用，fail-closed）。 */
  initialize(): Promise<void>;
  /**
   * 系统提示的记忆独立段（每轮装配时取；undefined = 本 provider 无记忆段
   * ——缺省语义，不是空字符串占位）。
   */
  systemPromptBlock(): string | undefined;
  /**
   * 回合前召回（hermes prefetch 语义——按当前输入检索相关记忆；缺省实现
   * 可返回 undefined = 无追加召回内容）。异步面需超时兜底（hermes 8s/5s）。
   */
  prefetch?(query: string): Promise<string | undefined>;
  /**
   * 回合后同步（把本回合可记忆事实写入 provider 存储；失败不阻塞回合——
   * 记忆是增强面不是承重墙）。
   */
  syncTurn?(context: { sessionId: string; userMessage: string; assistantMessage: string }): Promise<void>;
  /** provider 贡献的工具（如 save_memory——工具由 provider 声明，内核不点名）。 */
  tools?(): ToolDef[];
  /** 卸载（flush + 释放资源；注册面下线时调用）。 */
  shutdown(): Promise<void>;
}

/**
 * provider 来源哨兵（单外部约束的记账键）：builtin = 内建 MEMORY.md 实现；
 * 注册面允许**至多一个非 builtin** provider，冲突 fail-closed（T7-2）。
 */
export type MemoryProviderOrigin = "builtin" | "external";
