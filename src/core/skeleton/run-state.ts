/**
 * 运行态服务（A3）——idle/busy 可脱离 loop 判定。
 *
 * 取 opencode·run-state 的**形状**：运行态是独立服务，按会话记录状态，
 * loop 在生命周期边界通知它（onBusy/onIdle 回调的同构物）——服务**不读
 * loop 内部变量**，loop 也不查服务以外的任何私有状态。Effect 依赖栈不抄。
 *
 * 崩溃可判定（A3 验收本体）：markBusy 在 runTurn 一开始就落，markIdle 只在
 * turn/end **成功落盘后**才落（closeTurn 尾部，唯一通知点）。loop 半途崩溃
 * （异常逃出 runTurn，含错误处理路径自身的二次异常）时 markIdle 不会到达，
 * 状态停在 busy——由恢复路径（T-8 resume）显式归位 idle。宁可误报 busy，
 * 绝不误报 idle：idle 是"该会话当前没有在途 turn"的承诺。
 *
 * P0 为进程内 Map（每会话一格，默认 idle）。跨进程观察（T9 的 agent 在
 * 子进程里跑）由 T-3-06 的协议层转发状态事实，本服务仍只管本进程视图。
 */

export type RunStateValue = "idle" | "busy";

export interface RunStateSnapshot {
  state: RunStateValue;
}

export class RunState {
  private readonly states = new Map<string, RunStateValue>();

  /** 未知会话视为 idle（默认空闲——没有记录过 busy 就没有在途工作）。 */
  get(sessionId: string): RunStateSnapshot {
    return { state: this.states.get(sessionId) ?? "idle" };
  }

  /** runTurn 一开始调用（turn 尝试开始即 busy，先于任何事件落盘）。 */
  markBusy(sessionId: string): void {
    this.states.set(sessionId, "busy");
  }

  /** turn/end 成功落盘后由 loop 的 closeTurn 唯一通知点调用。 */
  markIdle(sessionId: string): void {
    this.states.set(sessionId, "idle");
  }
}
