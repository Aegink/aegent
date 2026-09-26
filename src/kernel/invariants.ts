/**
 * 会话流不变量服务（O12，T-P1-30）——"包自己拥有不变量，可自动断言防回归"
 * （dsh·schedule/src/invariant.ts：包自有 `validate(events, fail)` + invariants
 * 服务统一安装执行）。
 *
 * 事件流是 kernel 域的事实，流不变量由本域拥有（dsh 的 schedule 包拥有
 * schedule 流不变量同构）：turn 作用域 / step·tool 配平 / 终态恰一三个
 * 不变量器从 test-support/event-asserts 迁入（该文件 re-export 保持既有测试
 * import 面零改动），注册表把"逐个手工调"升级为"注册后一键全跑"。
 *
 * 失败收集纪律（dsh InvariantFailure 同构）：校验器用 fail(message) 报告，
 * 或直接 throw（人话 Error——O7 风格断言器原样兼容，注册时经 adaptThrowing
 * 适配）；注册表逐个捕获收集——一个不变量崩溃不吞错、不炸其他不变量，
 * 一次报全失败清单。
 *
 * 运行时默认关闭：装配 invariants 选项显式启用时对既有流跑一轮，失败落
 * logger.warn（诊断面不是运行时前置条件——坏流照常按 Q5 对账恢复）。
 */

import type { SessionEvent } from "./events.js";

/** 失败报告器（dsh InvariantFailure 同构）：收集人话失败，不抛出。 */
export type InvariantFail = (message: string) => void;

/** 一个包自有不变量：有名字的完整流校验器。 */
export interface Invariant {
  readonly name: string;
  validate(events: readonly SessionEvent[], fail: InvariantFail): void;
}

/** 单个不变量的检查结果。 */
export interface InvariantReport {
  readonly name: string;
  readonly ok: boolean;
  readonly failures: readonly string[];
}

/** throw 风格断言器 → fail 收集器的适配（O7 断言器原样入服务）。 */
function adaptThrowing(
  fn: (events: readonly SessionEvent[]) => void,
): (events: readonly SessionEvent[], fail: InvariantFail) => void {
  return (events, fail) => {
    try {
      fn(events);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };
}

/**
 * turn 作用域不变量：turn 从 1 连续编号、不嵌套、不悬挂；turn 作用域事件
 * 归属当前开启的轮；轮内 step 从 1 连续递增。session/revert、model/switch、
 * todo/update 与 goal/set 是会话级元事件，不参与本检查；compaction /
 * checkpoint / request/header 只声明 turn 归属、不要求轮开启（与投影器
 * applyValidation 的判定一致——压缩合法地落在轮外，如 turn 收尾后的
 * PreTurn 压缩）。
 */
export function expectTurnScoped(events: readonly SessionEvent[]): void {
  let expectedTurn = 0;
  let openTurn: number | null = null;
  const stepCounters = new Map<number, number>();
  for (const e of events) {
    if (
      e.type === "session/revert" ||
      e.type === "model/switch" ||
      e.type === "todo/update" ||
      e.type === "goal/set"
    ) {
      continue;
    }
    if (e.type === "turn/start") {
      if (openTurn !== null) {
        throw new Error(
          `turn ${e.turn} 的 turn/start（seq=${e.seq}）落在未闭合的 turn ${openTurn} 内——用户轮不允许嵌套`,
        );
      }
      expectedTurn += 1;
      if (e.turn !== expectedTurn) {
        throw new Error(
          `turn/start 跳号：期望 turn ${expectedTurn}，实际 turn ${e.turn}（seq=${e.seq}）——轮号必须从 1 连续递增`,
        );
      }
      openTurn = e.turn;
      stepCounters.set(e.turn, 0);
      continue;
    }
    if (e.type === "turn/end") {
      if (openTurn !== e.turn) {
        throw new Error(
          `turn/end（seq=${e.seq}）要闭合 turn ${e.turn}，但当前开启的是 ${openTurn ?? "（无）"}——闭合必须针对开启中的轮`,
        );
      }
      openTurn = null;
      continue;
    }
    if (e.type === "step/start") {
      if (openTurn !== e.turn) {
        throw new Error(
          `事件 ${e.type}（seq=${e.seq}）声称属于 turn ${e.turn}，但当前开启的是 ${openTurn ?? "（无）"}——轮作用域事件必须归属已开启的轮`,
        );
      }
      const expectedStep = (stepCounters.get(e.turn) ?? 0) + 1;
      if (e.step !== expectedStep) {
        throw new Error(
          `turn ${e.turn} 的 step/start 跳号：期望 step ${expectedStep}，实际 ${e.step}（seq=${e.seq}）——轮内 step 必须从 1 连续递增`,
        );
      }
      stepCounters.set(e.turn, expectedStep);
      continue;
    }
    // step 作用域的其余事件（step/end / message / tool.*）要求轮开启；
    // compaction / checkpoint / request/header 只带 turn 归属、不要求轮开启。
    const requiresOpenTurn =
      e.type === "step/end" ||
      e.type === "user/message" ||
      e.type === "system/message" ||
      e.type === "assistant/message" ||
      e.type === "assistant/attempt" ||
      e.type === "tool/call" ||
      e.type === "tool/result";
    if (requiresOpenTurn && openTurn !== e.turn) {
      throw new Error(
        `事件 ${e.type}（seq=${e.seq}）声称属于 turn ${e.turn}，但当前开启的是 ${openTurn ?? "（无）"}——轮作用域事件必须归属已开启的轮`,
      );
    }
  }
  if (openTurn !== null) {
    throw new Error(
      `事件流结束时 turn ${openTurn} 仍开启（没有 turn/end）——悬挂轮；崩溃残留应由恢复路径以 interrupted 闭合`,
    );
  }
}

/**
 * 成对不变量。openType="step/start"：step/start ↔ step/end 按 turn+step 配平；
 * openType="tool/call"：tool/call ↔ tool/result 按 callId 配平。
 */
export function expectPaired(
  events: readonly SessionEvent[],
  openType: "step/start" | "tool/call",
): void {
  if (openType === "step/start") {
    const open = new Map<string, number>();
    for (const e of events) {
      if (e.type === "step/start") {
        const key = `${e.turn}:${e.step}`;
        if (open.has(key)) {
          throw new Error(
            `step ${e.step}（turn ${e.turn}）重复开启：seq=${open.get(key)} 与 seq=${e.seq}——同一 step 不能开两次`,
          );
        }
        open.set(key, e.seq);
      } else if (e.type === "step/end") {
        const key = `${e.turn}:${e.step}`;
        if (!open.has(key)) {
          throw new Error(
            `step/end（turn ${e.turn} step ${e.step}，seq=${e.seq}）没有对应的 step/start——step 事件必须成对出现`,
          );
        }
        open.delete(key);
      }
    }
    if (open.size > 0) {
      const detail = [...open.entries()]
        .map(([k, seq]) => `turn/step ${k}（开启于 seq=${seq}）`)
        .join("、");
      throw new Error(
        `${open.size} 个 step 未闭合：${detail}——step/start 与 step/end 必须成对`,
      );
    }
    return;
  }

  const open = new Map<string, { seq: number; name: string }>();
  for (const e of events) {
    if (e.type === "tool/call") {
      if (open.has(e.callId)) {
        throw new Error(
          `callId=${e.callId} 的 tool/call 重复（seq=${e.seq}）——同一调用只应记录一次`,
        );
      }
      open.set(e.callId, { seq: e.seq, name: e.name });
    } else if (e.type === "tool/result") {
      if (!open.has(e.callId)) {
        throw new Error(
          `tool/result 的 callId=${e.callId}（seq=${e.seq}）没有前置 tool/call——调用与结果必须按 callId 配平`,
        );
      }
      open.delete(e.callId);
    }
  }
  if (open.size > 0) {
    const detail = [...open.values()]
      .map((v) => `${v.name}（开启于 seq=${v.seq}）`)
      .join("、");
    throw new Error(
      `${open.size} 个工具调用没有收到结果：${detail}——tool/call 与 tool/result 必须按 callId 配平`,
    );
  }
}

/**
 * 终态恰一：指定轮（缺省全流）恰有一条 turn/end，且它是该轮最后一条事件。
 * 中断/错误只改终态的 reason，绝不追加第二条终态。
 */
export function expectSingleTerminal(
  events: readonly SessionEvent[],
  turn?: number,
): void {
  const terminals = events.filter(
    (e) => e.type === "turn/end" && (turn === undefined || e.turn === turn),
  );
  const scope = turn === undefined ? "事件流" : `turn ${turn}`;
  if (terminals.length === 0) {
    throw new Error(
      `${scope}没有 turn/end 终态记录——每个用户轮必须恰好一条终止事件`,
    );
  }
  if (terminals.length > 1) {
    const seqs = terminals.map((t) => `seq=${t.seq}`).join("、");
    throw new Error(
      `${scope}出现 ${terminals.length} 条 turn/end（${seqs}）——终止记录必须恰一条（中断/错误只改 reason，不追加终态）`,
    );
  }
  const terminal = terminals[0]!;
  const after = events.filter((e) => e.seq > terminal.seq && e.turn === terminal.turn);
  if (after.length > 0) {
    const detail = after
      .map((e) => `${e.type}@seq=${e.seq}`)
      .join("、");
    throw new Error(
      `turn ${terminal.turn} 的终态（seq=${terminal.seq}）之后仍有 ${after.length} 条同轮事件：${detail}——终态必须是该轮最后一条事件`,
    );
  }
}

/** 终态恰一的按轮形态（服务内建）：流内每个开过的轮各查一次——多轮会话不能误报。 */
export function expectSingleTerminalPerTurn(events: readonly SessionEvent[]): void {
  const turns = [...new Set(events.filter((e) => e.type === "turn/start").map((e) => e.turn))].sort(
    (a, b) => a - b,
  );
  for (const turn of turns) {
    expectSingleTerminal(events, turn);
  }
}

/**
 * 不变量注册表：注册/检查分离（dsh invariant companion 的安装面同构）。
 * check 逐个独立执行——一个不变量崩溃被收集为它的失败清单，不炸其他
 * 不变量，也不上抛（调用方拿全量报告自行决定处理）。
 */
export class InvariantRegistry {
  private readonly invariants = new Map<string, Invariant>();

  register(invariant: Invariant): this {
    if (this.invariants.has(invariant.name)) {
      throw new Error(`不变量「${invariant.name}」重复注册——名字是不变量的一等身份`);
    }
    this.invariants.set(invariant.name, invariant);
    return this;
  }

  has(name: string): boolean {
    return this.invariants.has(name);
  }

  /** 全量执行收集失败（不首错即抛——测试要的是全部失败清单）。 */
  check(events: readonly SessionEvent[]): InvariantReport[] {
    const reports: InvariantReport[] = [];
    for (const invariant of this.invariants.values()) {
      const failures: string[] = [];
      try {
        invariant.validate(events, (message) => failures.push(message));
      } catch (error) {
        // fail 收集器之外的异常（编程错误）也归入该不变量的失败——不吞错。
        failures.push(error instanceof Error ? error.message : String(error));
      }
      reports.push({ name: invariant.name, ok: failures.length === 0, failures });
    }
    return reports;
  }
}

/** 内建注册表：kernel 域自有的四个流不变量（event-asserts 三断言器的服务形态）。 */
export function createDefaultRegistry(): InvariantRegistry {
  return new InvariantRegistry()
    .register({ name: "turn-scoped", validate: adaptThrowing(expectTurnScoped) })
    .register({
      name: "paired-steps",
      validate: adaptThrowing((events) => expectPaired(events, "step/start")),
    })
    .register({
      name: "paired-tool-calls",
      validate: adaptThrowing((events) => expectPaired(events, "tool/call")),
    })
    .register({
      name: "single-terminal-per-turn",
      validate: adaptThrowing(expectSingleTerminalPerTurn),
    });
}
