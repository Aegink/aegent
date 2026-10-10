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

/**
 * T7-2/EP-5 注册面（W4）：provider 注册表——**单外部约束**（sentinel 闭集：
 * builtin 至多一个 + external 至多一个，冲突 fail-closed）。装配层经
 * registerMemoryProvider 注册；system-prompt 的记忆段消费
 * systemPromptBlock（G6 独立段纪律不变）。
 */
export class MemoryProviderRegistry {
  private readonly providers = new Map<MemoryProviderOrigin, MemoryProvider>();

  register(origin: MemoryProviderOrigin, provider: MemoryProvider): this {
    if (this.providers.has(origin)) {
      throw new Error(
        origin === "external"
          ? "记忆 provider 单外部约束：至多一个 external provider（冲突 fail-closed——多 provider 会抢 systemPromptBlock 独立段）"
          : "记忆 provider 重复注册：builtin 已在位",
      );
    }
    this.providers.set(origin, provider);
    return this;
  }

  get(origin: MemoryProviderOrigin): MemoryProvider | undefined {
    return this.providers.get(origin);
  }

  /** 生效的记忆段（external 优先——外部 provider 覆盖内建 MEMORY.md 段）。 */
  systemPromptBlock(): string | undefined {
    return (this.providers.get("external") ?? this.providers.get("builtin"))?.systemPromptBlock();
  }

  /** 全部工具贡献（provider.tools——save_memory 由内建 provider 声明）。 */
  tools(): ToolDef[] {
    return [...this.providers.values()].flatMap((p) => p.tools?.() ?? []);
  }

  async shutdown(): Promise<void> {
    for (const p of this.providers.values()) await p.shutdown();
    this.providers.clear();
  }
}