/**
 * EP-10 装配数据化（T5-4，dsh 形状）：装配从"顺序调用"改为**按 id 寻址的
 * 注册清单**——一张数据表 + 单一 apply；依赖按 provides/requires 声明
 * （apply 前缺项检测 fail-closed + requires 拓扑排序——**顺序无关**）。
 *
 * 六注册域：tools（工具来源）/ channels（渠道）/ sandbox（沙箱后端）/
 * scheduler（调度器）/ lsp / mcp。
 */

/** 六注册域闭集（EP-10——冻结只追加）。 */
export type RegistrationKind = "tools" | "channels" | "sandbox" | "scheduler" | "lsp" | "mcp";

/** apply 上下文（宿主装配面注入——注册项经它取依赖、落能力）。 */
export interface RuntimeApplyContext {
  /** 按能力位取先到依赖（apply 拓扑序保证 requires 已就绪）。 */
  capability<T>(provides: string): T | undefined;
  /** 落能力位（后续项的 requires 数据源）。 */
  provide(provides: string, value: unknown): void;
  /** 装配日志（缺项/覆盖等治理事件的宿主出口）。 */
  log(message: string): void;
}

export interface RegistrationEntry {
  /** 注册 id（按 id 寻址——顺序无关的唯一键）。 */
  readonly id: string;
  readonly kind: RegistrationKind;
  /** 提供的能力位（如 "sandbox.local"、"tools.builtin"）。 */
  readonly provides: string;
  /** 依赖的能力位（apply 前检测——缺项 fail-closed）。 */
  readonly requires?: readonly string[];
  /** 装配动作（宿主上下文内执行——只接线不藏逻辑）。 */
  apply(ctx: RuntimeApplyContext): void | Promise<void>;
}

/** 重名/未知能力位的类型化拒绝。 */
export class RegistrationError extends Error {
  constructor(
    readonly code: "REGISTRATION_DUPLICATE" | "REGISTRATION_REQUIREMENT_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

/** 依赖拓扑排序（Kahn——顺序无关的 apply 序；环 fail-closed）。 */
function topoSort(entries: readonly RegistrationEntry[]): RegistrationEntry[] {
  const byProvides = new Map(entries.map((e) => [e.provides, e]));
  const indegree = new Map(entries.map((e) => [e.id, (e.requires ?? []).filter((r) => byProvides.has(r)).length]));
  const dependents = new Map<string, string[]>();
  for (const e of entries) {
    for (const r of e.requires ?? []) {
      const dep = byProvides.get(r);
      if (dep === undefined) continue;
      dependents.set(dep.id, [...(dependents.get(dep.id) ?? []), e.id]);
    }
  }
  const order: RegistrationEntry[] = [];
  const ready = entries.filter((e) => (indegree.get(e.id) ?? 0) === 0).map((e) => e.id);
  while (ready.length > 0) {
    const id = ready.shift()!;
    const entry = entries.find((e) => e.id === id)!;
    order.push(entry);
    for (const next of dependents.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }
  if (order.length < entries.length) {
    const remaining = entries.filter((e) => !order.includes(e)).map((e) => e.id);
    throw new RegistrationError(
      "REGISTRATION_REQUIREMENT_MISSING",
      `注册依赖成环或缺项：${remaining.join(", ")}`,
    );
  }
  return order;
}

export class RegistrationList {
  private readonly entries = new Map<string, RegistrationEntry>();

  /** 注册（重名 id 类型化拒绝——按 id 寻址的唯一性是数据表的前提）。 */
  register(entry: RegistrationEntry): this {
    if (this.entries.has(entry.id)) {
      throw new RegistrationError("REGISTRATION_DUPLICATE", `注册 id 重复：${entry.id}`);
    }
    this.entries.set(entry.id, entry);
    return this;
  }

  /** 已注册 id 清单（观测面）。 */
  ids(): readonly string[] {
    return [...this.entries.keys()];
  }

  /**
   * 单一 apply：requires 拓扑排序（顺序无关）→ 逐项执行——缺项 fail-closed
   * （requirement 在位检查先行于任何 apply）。
   */
  async applyAll(ctx: RuntimeApplyContext): Promise<void> {
    const entries = [...this.entries.values()];
    // 缺项检测（fail-closed——先于任何 apply）
    const provided = new Set(entries.map((e) => e.provides));
    for (const e of entries) {
      for (const r of e.requires ?? []) {
        if (!provided.has(r)) {
          throw new RegistrationError(
            "REGISTRATION_REQUIREMENT_MISSING",
            `注册 ${e.id} 依赖的能力位 ${r} 无提供方（缺项 fail-closed）`,
          );
        }
      }
    }
    const order = topoSort(entries);
    for (const entry of order) {
      await entry.apply(ctx);
    }
  }
}
