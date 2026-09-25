/**
 * 规则作用域（C22）——turn-override 档的载体。
 *
 * C22 四档：project / user（配置文件里的规则，随 T-7-09 与规则集装配
 * 存在）· session-runtime（会话批准产生，载体是 ApprovalScopeCache——
 * 进程内存、随会话灭，结构上不落配置文件）· turn-override（本文件：
 * 只在产生它的 turn 内有效，turn 结束即失效）。
 *
 * turn-override 的语义：同一 turn 内"问过一次就不再问"的短作用域放行
 * ——比 session 更短的生命周期，用于审批人愿意"这轮内别再打断我"但
 * 不愿意"整个会话都放行"的场景。失效机制是**显式推进 turn**：
 * endTurn(turn) 剪除该 turn 及更早的记录——之后任何 isApproved 都查
 * 不到（比"查询时对比当前 turn 号"更彻底，记录本身被清掉，不占内存
 * 也不留审计歧义）。
 *
 * 与 C47 的关系：C47 管"批准记多久"（once/session/...），本文件是
 * turn 档批准的**存储与生命周期**；产生面（审批 UX 提供 scope=turn）
 * 接线后 record 即生效，能力面先行。
 */

/** turn-override 作用域规则集（C22 的第四档载体）。 */
export class TurnScopeRules {
  /** ruleRaw → 仍在效的 turn 号集合（同一规则可跨多次 turn 被记录）。 */
  private readonly active = new Map<string, Set<number>>();

  /** 记录一次 turn 级放行：只在 turn 号仍存活时生效。 */
  record(turn: number, ruleRaw: string): void {
    let turns = this.active.get(ruleRaw);
    if (turns === undefined) {
      turns = new Set();
      this.active.set(ruleRaw, turns);
    }
    turns.add(turn);
  }

  isApproved(turn: number, ruleRaw: string): boolean {
    return this.active.get(ruleRaw)?.has(turn) ?? false;
  }

  /**
   * turn 收尾：剪除该 turn（及所有更早 turn）的记录——其后 isApproved
   * 一律 false（C22 验收④：turn-override 在 turn 结束失效）。
   */
  endTurn(turn: number): void {
    for (const [ruleRaw, turns] of this.active) {
      for (const t of turns) {
        if (t <= turn) turns.delete(t);
      }
      if (turns.size === 0) this.active.delete(ruleRaw);
    }
  }

  /** 存活记录数（诊断/测试面）。 */
  size(): number {
    return this.active.size;
  }
}
