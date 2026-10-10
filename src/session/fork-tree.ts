/**
 * fork 树（E6，T-P2-106）——谱系元数据 + 未知边界不创建。
 *
 * 行为锚：pi-desktop·docs/adr/0023-independent-conversation-session-fork.md
 * （协议命令 + host 所有权）与 pi·storage.fork(ForkOptions)（同一套抽象）
 * ——取"**同一套抽象不写两套** + 谱系可查 + 未知边界拒绝"三行为；🔴 不抄
 * ADR 的 Electron 面（我方 wire 命令 E5 已落）。
 *
 * 同一抽象（不写两套）：本模块**不实现第二套 fork**——谱系完全从 E5
 * `store.fork` 写入的 `session/fork` 事件重建（流内事实，不变量 1：重启
 * 后谱系仍可按流重建）；本模块只读 store 流，零建表零落流（"fork-tree
 * 只读 store 流不另建表"的验收）。
 *
 * **本会话自己的血统标记 = 流内最后一条 `session/fork`**（关键细节）：
 * E5 的 fork 把源流前缀整段复制进子流——源流若是被 fork 出来的，其血统
 * 标记会随前缀落进子流的**中段**；子流自己的标记紧随其后追加（子流头部
 * 的"新事件起点"）。故解析取 `findLast`——取第一条会把父辈的父辈
 * （祖父）误读成本会话的父（三层树的错误在测试中会被当场抓住）。
 *
 * 未知边界不创建：
 * - 动作面：fork 的源/目标不存在由 E5 store.fork 既有类型化拒绝承载
 *   （FORK_SOURCE_MISSING / FORK_TARGET_EXISTS / FORK_BAD_TARGET——本模块
 *   不复制这些检查，只在树上读取其产出）。
 * - 读取面：本模块对未知会话 id 类型化拒绝（ForkTreeError UNKNOWN_SESSION）
 *   ——绝不静默返回空树/凭空新建节点；谱系数据里引用了"不在已知集"的父
 *   （父已被归档/未装载）也不凭空造父节点：子作新根 + 悬空引用进
 *   `danglingParents()` 诊断面（事实如实，不猜）。
 *
 * 跨库边界记档：归档会话（Q8）从主库移出后不在 store 内存序——归档会话
 * 天然不可作 fork 源（store.fork 的源要求在内存序中，fail-closed 是结构性
 * 的）；从归档档恢复谱系随需要（readArchivedSession 的 events 可喂
 * fromStreams）。
 */

import type { SessionEvent } from "../core/index.js";
import type { SessionStore } from "./store.js";

export type ForkTreeErrorCode = "UNKNOWN_SESSION";

export class ForkTreeError extends Error {
  constructor(
    readonly code: ForkTreeErrorCode,
    readonly sessionId: string,
  ) {
    super(`fork 树里没有会话 ${sessionId}（未知边界不创建——不静默返回空树）`);
    this.name = "ForkTreeError";
  }
}

/** 树重建的输入单元：一个会话的 id 与其完整事件流（只读）。 */
export interface ForkTreeStream {
  sessionId: string;
  events: readonly SessionEvent[];
}

/** 树视图（treeOf 产物——只读快照形状）。 */
export interface ForkTreeSnapshot {
  sessionId: string;
  /** 根会话 id（沿父链上溯；父悬空时本节点即根）。 */
  root: string;
  /** 祖先链（从根到父，不含自身）。 */
  ancestors: string[];
  /** 深度（根 = 0）。 */
  depth: number;
  /** 直接子会话 id（升序）。 */
  children: string[];
  /** 全部子孙（先序深度优先——稳定序）。 */
  descendants: string[];
}

/** 悬空引用（声明的父不在已知集——不凭空造父节点，如实记录）。 */
export interface DanglingParent {
  sessionId: string;
  unknownParent: string;
}

export class ForkTree {
  private constructor(
    private readonly known: ReadonlySet<string>,
    /** 子 → 自己声明的父（仅已知父；悬空父不入此表）。 */
    private readonly parentOf: ReadonlyMap<string, string>,
    /** 已知父 → 直接子（升序）。 */
    private readonly childrenOfMap: ReadonlyMap<string, readonly string[]>,
    private readonly dangling: readonly DanglingParent[],
  ) {}

  /**
   * 从事件流集合重建谱系（纯函数——输入只读，输出新结构）。
   * 每个会话的血统 = 流内**最后**一条 session/fork（见头注释）。
   */
  static fromStreams(streams: Iterable<ForkTreeStream>): ForkTree {
    const known = new Set<string>();
    const declared = new Map<string, string>();
    for (const stream of streams) {
      known.add(stream.sessionId);
      for (let i = stream.events.length - 1; i >= 0; i -= 1) {
        const event = stream.events[i]!;
        if (event.type === "session/fork") {
          declared.set(stream.sessionId, event.parentSessionId);
          break;
        }
      }
    }
    return ForkTree.build(known, declared);
  }

  /** 从 store 内存序重建（读 sessionIds + load；零落流零建表）。 */
  static fromStore(store: SessionStore): ForkTree {
    return ForkTree.fromStreams(
      store.sessionIds().map((id) => ({ sessionId: id, events: store.load(id) })),
    );
  }

  private static build(known: Set<string>, declared: Map<string, string>): ForkTree {
    const parentOf = new Map<string, string>();
    const dangling: DanglingParent[] = [];
    for (const [child, parent] of declared) {
      if (known.has(parent)) {
        parentOf.set(child, parent);
      } else {
        dangling.push({ sessionId: child, unknownParent: parent });
      }
    }
    const childrenOfMap = new Map<string, string[]>();
    for (const [child, parent] of parentOf) {
      const list = childrenOfMap.get(parent) ?? [];
      list.push(child);
      childrenOfMap.set(parent, list);
    }
    for (const list of childrenOfMap.values()) list.sort();
    return new ForkTree(known, parentOf, childrenOfMap, dangling);
  }

  /** 已知会话 id 清单（升序——稳定序）。 */
  sessionIds(): string[] {
    return [...this.known].sort();
  }

  /** 直接子会话（升序）；未知父 → ForkTreeError（不静默返回空）。 */
  childrenOf(parentId: string): string[] {
    if (!this.known.has(parentId)) throw new ForkTreeError("UNKNOWN_SESSION", parentId);
    return [...(this.childrenOfMap.get(parentId) ?? [])];
  }

  /** 沿父链上溯到根（父悬空/无父 → 自身）。未知会话 → ForkTreeError。 */
  rootOf(sessionId: string): string {
    this.mustKnow(sessionId);
    let current = sessionId;
    for (;;) {
      const parent = this.parentOf.get(current);
      if (parent === undefined) return current;
      current = parent;
    }
  }

  /** 树视图（自身 + 祖先链 + 子孙）；未知会话 → ForkTreeError。 */
  treeOf(sessionId: string): ForkTreeSnapshot {
    this.mustKnow(sessionId);
    const ancestors: string[] = [];
    let cursor = sessionId;
    for (;;) {
      const parent = this.parentOf.get(cursor);
      if (parent === undefined) break;
      ancestors.unshift(parent);
      cursor = parent;
    }
    const descendants: string[] = [];
    const walk = (id: string): void => {
      for (const child of this.childrenOfMap.get(id) ?? []) {
        descendants.push(child);
        walk(child);
      }
    };
    walk(sessionId);
    return {
      sessionId,
      root: ancestors[0] ?? sessionId,
      ancestors,
      depth: ancestors.length,
      children: [...(this.childrenOfMap.get(sessionId) ?? [])],
      descendants,
    };
  }

  /** 根清单（无已知父的会话，含悬空父的子——升序）。 */
  roots(): string[] {
    return [...this.known].filter((id) => !this.parentOf.has(id)).sort();
  }

  /** 悬空引用清单（声明的父不在已知集——谱系完整性诊断面）。 */
  danglingParents(): DanglingParent[] {
    return [...this.dangling];
  }

  private mustKnow(sessionId: string): void {
    if (!this.known.has(sessionId)) throw new ForkTreeError("UNKNOWN_SESSION", sessionId);
  }
}
