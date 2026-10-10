/**
 * 会话级模型选择状态（J6/J7/J8/J11，T-P1-04/05）——换模请求**立即受理**、
 * 生效点在新 turn；在途 turn 用其启动时捕获的模型跑完。形状取 pi·agent-
 * harness 的 configured 与 captured 分离：`setModel(model, context)` 立即
 * 受理改 configured，`CurrentOperationInfo.capturedModel` 是在途操作的快照
 * （agent-harness.ts:154）。
 *
 * 事务与四态（T-P1-05，grok·agent.rs ModelState 的同名语义映射）：
 *   initial       构造基态：无换模历史
 *   deferred      会话未建立（无 turn 捕获）时受理：**configured 不变**，
 *                 暂存 {target, prev}，首个 turn 捕获时应用（grok
 *                 `deferred_model_switch`："stashed while no session
 *                 exists, applied once the session id arrives"）
 *   pending       换模受理、生效中：configured 已指新模型、尚未被任何
 *                 turn 捕获（grok `model_switch_pending`；我方生效点在
 *                 新 turn，不用它 hold 队列——A2 队列语义不受换模影响）
 *   preference    换模已生效：最近的换模已被某 turn 捕获（grok
 *                 `user_model_preference` 同位）
 *   incompatible  换模生效后请求失败且错误判不兼容：已回滚 prev（grok
 *                 `model_incompatible` 同位；回滚目标 = 事务的 prev，即
 *                 `DeferredModelSwitch.prev_model_id` 纪律）
 *
 * 事务性（J8）：pending/deferred 态的重复换模是**同一事务的修订**——
 * 覆盖 target、prev 保持最初（不把中间模型固定为回滚目标），不产生中间
 * 半态；回滚经 reportRequestFailure（换模生效后请求失败且判不兼容）恢复
 * prev。回滚的可观测面 = lastRollback + phase；落事件流与换模事件统一在
 * T-P1-06 的词汇表扩展（14→15）接入，本卡不落流。
 *
 * 其余边界：
 * - 注册表来源 = 装配注册（createChildAssembly 的 models 选项）——P1 先
 *   装配注册，J12 的配置发现/选择器留后续批次；
 * - captured 是"在途 turn"的单一槽位（单会话单 loop，同时至多一个在途
 *   turn），不养每 turn 一条的历史——历史事实由 T-P1-06 的流内事件承载；
 * - incompatible 判据 P1 最小版 = 显式不兼容错误码（MODEL_INCOMPATIBLE，
 *   清单冻结只追加）；上下文超窗不走此路（F24 downshift 压缩消化，
 *   T-7-06），能力矩阵留后续。
 */

import { identityKey, type ModelIdentity } from "../../index.js";
import type { ModelProvider } from "../../index.js";

/** 注册表条目：身份 + 承载它的 provider + 模型级请求选项（装配时成对注册）。 */
export interface RegisteredModel {
  identity: ModelIdentity;
  provider: ModelProvider;
  /** T-P3-137 三轮：思考档/联网搜索随模型走（spec 透传——每次请求带上）。 */
  options?: ModelRequestOptions;
}

/** 模型级请求选项（settings providers 模型规格 → wire 透传）。 */
export interface ModelRequestOptions {
  /**
   * 思考档（T-P3-137 三轮；T-P3-145 子代理覆盖同通道）——"omit" 哨兵 =
   * 请求不带思考参数（与"缺省不设"的 undefined 语义不同：omit 是显式抹掉，
   * 适配层识别后跳过 reasoning 字段）。
   */
  reasoningEffort?: string;
  webSearch?: boolean;
  /** 单次响应输出上限 token（T-P3-145 子代理 maxTokens——缺省跟随模型）。 */
  maxTokens?: number;
}

/** 一个 turn 的捕获值：该 turn 全程使用的 provider 与身份。 */
export interface TurnModel {
  provider: ModelProvider;
  identity: ModelIdentity;
  options?: ModelRequestOptions;
}

/** J8/J11 换模状态机五态（四态验收对象 = deferred/pending/preference/incompatible）。 */
export type ModelSwitchPhase =
  | "initial"
  | "deferred"
  | "pending"
  | "preference"
  | "incompatible";

/** 状态迁移事件：换模受理 / turn 捕获 / 不兼容失败。 */
export type SwitchEvent = "switch" | "capture" | "incompatible-failure";

/** 非法状态迁移——类型化错误（验收①：非法迁移被拒，不静默）。 */
export class ModelSwitchStateError extends Error {
  readonly code = "MODEL_SWITCH_STATE_ERROR";
  constructor(
    readonly from: ModelSwitchPhase,
    readonly event: SwitchEvent,
  ) {
    super(
      `非法换模状态迁移：${from} 不接受事件 ${event}` +
        "（J8 迁移守卫：状态机外的组合一律拒绝）",
    );
    this.name = "ModelSwitchStateError";
  }
}

/**
 * 迁移守卫（J8，纯函数）——合法迁移返回目标态，表格外组合抛
 * ModelSwitchStateError。合法表：
 *   switch:  initial→deferred|pending（按 hasCapturedTurn）；deferred/pending
 *            自迁移（事务修订）；preference/incompatible→pending（新事务）
 *   capture: deferred→preference（暂存应用）；pending→preference（生效确认）；
 *            其余自迁移
 *   incompatible-failure: pending/preference→incompatible（回滚）
 */
export function nextSwitchPhase(
  from: ModelSwitchPhase,
  event: SwitchEvent,
  hasCapturedTurn: boolean,
): ModelSwitchPhase {
  if (event === "switch") {
    if (from === "initial") return hasCapturedTurn ? "pending" : "deferred";
    if (from === "deferred" || from === "pending") return from;
    if (from === "preference" || from === "incompatible") return "pending";
  }
  if (event === "capture") {
    if (from === "deferred" || from === "pending") return "preference";
    return from; // initial/preference/incompatible 下捕获不迁移
  }
  if (event === "incompatible-failure") {
    if (from === "pending" || from === "preference") return "incompatible";
  }
  throw new ModelSwitchStateError(from, event);
}

/** J11 回滚判据（P1 最小版）：显式不兼容错误码，清单冻结只追加（C10 先例）。 */
export const MODEL_INCOMPATIBLE_CODES: ReadonlySet<string> = new Set([
  "MODEL_INCOMPATIBLE",
]);

/** 一次换模事务（受理时的快照；prev 即回滚目标，grok prev_model_id 同款）。 */
export interface SwitchRecord {
  /** 换模目标（事务修订时被覆盖为最新目标）。 */
  target: ModelIdentity;
  /** 受理事务时的生效模型——整个事务的回滚目标，重复换模不中途改写。 */
  prev: ModelIdentity;
}

/** 一次成功回滚的观测记录（验收③：回滚可观测；落事件流在 T-P1-06）。 */
export interface ModelRollback {
  /** 回滚恢复到的模型（= 事务的 prev）。 */
  rolledBackTo: ModelIdentity;
  /** 被回滚掉的换模目标。 */
  from: ModelIdentity;
  failureCode: string;
  turn: number;
}

/** 换模到未注册模型——类型化错误（不静默）。 */
export class ModelNotRegisteredError extends Error {
  readonly code = "MODEL_NOT_REGISTERED";
  constructor(readonly identity: ModelIdentity) {
    super(
      `模型未注册：${identity.provider}:${identity.modelId} 不在会话模型` +
        "注册表中（J6：换模只能切到装配注册过的模型）",
    );
    this.name = "ModelNotRegisteredError";
  }
}

export interface ModelSwitchOptions {
  /** 初始 configured（必须已注册——装配期即失败，不给静默坏状态）。 */
  initial: ModelIdentity;
  /** 会话级模型注册表（装配注册；构造后不可变）。 */
  models: readonly RegisteredModel[];
  /**
   * J9 落流通道（T-P1-06，装配注入 store.append）：换模/回滚事实以
   * `model/switch` 事件承载（词汇表 15），绝不静默改状态。turn 归属由
   * 装配补（会话级元事件，挂流内最后 turn，空流兜 0）。
   */
  emit?: (emission: {
    from: ModelIdentity;
    to: ModelIdentity;
    reason: "user" | "rollback";
  }) => void;
}

export class ModelSwitchService {
  private readonly registry: ReadonlyMap<string, RegisteredModel>;
  private configuredId: ModelIdentity;
  private phaseId: ModelSwitchPhase = "initial";
  /** 会话建立判据（deferred → pending 的分野：是否有 turn 捕获过）。 */
  private hasCapturedTurn = false;
  private currentSwitch: SwitchRecord | undefined;
  private currentRollback: ModelRollback | undefined;
  private readonly emit: ModelSwitchOptions["emit"];
  /** 在途 turn 的捕获（单槽：同时至多一个在途 turn，语义见文件头）。 */
  private currentCapture: { turn: number; model: TurnModel } | undefined;

  constructor(options: ModelSwitchOptions) {
    this.registry = new Map(
      options.models.map((m) => [identityKey(m.identity), m] as const),
    );
    const initial = this.registry.get(identityKey(options.initial));
    if (!initial) {
      throw new ModelNotRegisteredError(options.initial);
    }
    this.configuredId = initial.identity;
    this.emit = options.emit;
  }

  /** configured 当前值：换模受理即更新（deferred 受理除外——见 switch）。 */
  get configured(): ModelIdentity {
    return this.configuredId;
  }

  /** 状态机当前态（J8 可观测面）。 */
  get phase(): ModelSwitchPhase {
    return this.phaseId;
  }

  /** 最近一次换模事务（target/prev）；无事务时 undefined。 */
  get lastSwitch(): SwitchRecord | undefined {
    return this.currentSwitch;
  }

  /** 最近一次回滚（验收③可观测面）；从未回滚时 undefined。 */
  get lastRollback(): ModelRollback | undefined {
    return this.currentRollback;
  }

  /** 在途 turn 的捕获快照；非在途 turn 返回 undefined。 */
  capturedFor(turn: number): TurnModel | undefined {
    return this.currentCapture?.turn === turn
      ? this.currentCapture.model
      : undefined;
  }

  /**
   * J12/T-P1-22 选择器查询面：注册表内**可换模**的声明清单（构造序）。
   * 目录（buildModelCatalog）的 discovered-only 条目不在此列——它们没有
   * 装配绑定的 provider 实例，switch 到会抛 ModelNotRegisteredError
   * （J6 fail-closed：换模只能切到装配注册过的模型）。
   */
  listSwitchableModels(): ModelIdentity[] {
    return [...this.registry.values()].map((m) => m.identity);
  }

  /**
   * 换模请求受理（事务化）：
   * - 未注册模型抛 ModelNotRegisteredError（不静默，且不进入任何态）；
   * - 会话未建立（无 turn 捕获）→ deferred：暂存 {target, prev}，configured
   *   不变——会话建立（首个 turn 捕获）即应用；
   * - 会话已建立 → pending：configured 立即指新模型（T-P1-04 语义），生效
   *   点在新 turn；
   * - deferred/pending 下的重复受理是同事务修订：覆盖 target、prev 保持
   *   最初——同 turn 重复换模不产生中间半态（验收④）。
   */
  switch(identity: ModelIdentity): void {
    const entry = this.registry.get(identityKey(identity));
    if (!entry) throw new ModelNotRegisteredError(identity);
    const transactional =
      this.phaseId === "deferred" || this.phaseId === "pending";
    const prev = transactional
      ? this.currentSwitch!.prev
      : this.configuredId;
    this.currentSwitch = { target: entry.identity, prev };
    this.phaseId = nextSwitchPhase(
      this.phaseId,
      "switch",
      this.hasCapturedTurn,
    );
    if (this.phaseId === "pending") {
      this.configuredId = entry.identity;
    }
    // J9：受理即落流（deferred 受理也算——用户选择的事实先持久化，进程
    // 崩溃后重启仍可按流重建；deferred 应用不重复落事件，最新 to 已权威）。
    this.emit?.({
      from: { ...prev },
      to: { ...entry.identity },
      reason: "user",
    });
  }

  /**
   * turn 启动捕获（J7）：捕获此刻 configured 作为本 turn 全程的模型；在途
   * turn 中再换模不影响本捕获。同时是状态机的生效确认点：
   * deferred 在此应用（会话建立即生效，验收②）、pending 在此确认生效。
   */
  captureForTurn(turn: number): TurnModel {
    const before = this.phaseId;
    this.phaseId = nextSwitchPhase(before, "capture", this.hasCapturedTurn);
    if (before === "deferred" && this.currentSwitch) {
      // J8 deferred 应用：会话建立即生效——本 turn 就用暂存的新模型
      this.configuredId = this.currentSwitch.target;
    }
    this.hasCapturedTurn = true;
    const entry = this.registry.get(identityKey(this.configuredId));
    if (!entry) {
      // 不可达（configured 只经构造/deferred 应用/switch 赋值，都校验过）——
      // 防御兜底大声失败，绝不静默用坏状态发请求
      throw new ModelNotRegisteredError(this.configuredId);
    }
    const model: TurnModel = {
      provider: entry.provider,
      identity: entry.identity,
      ...(entry.options !== undefined ? { options: entry.options } : {}),
    };
    this.currentCapture = { turn, model };
    return model;
  }

  /**
   * J11 失败报告：换模生效后（pending/preference）的请求失败且错误码判
   * 不兼容 → 回滚 prev 并标记 incompatible；其余失败一律 false（不回滚、
   * 不迁移——transient 错误不是回滚理由）。返回是否发生了回滚。
   */
  reportRequestFailure(turn: number, failure: { code: string }): boolean {
    const eligible =
      (this.phaseId === "pending" || this.phaseId === "preference") &&
      this.currentSwitch !== undefined &&
      MODEL_INCOMPATIBLE_CODES.has(failure.code);
    if (!eligible) return false;
    const record = this.currentSwitch!;
    this.phaseId = nextSwitchPhase(this.phaseId, "incompatible-failure", true);
    this.configuredId = record.prev;
    this.currentRollback = {
      rolledBackTo: record.prev,
      from: record.target,
      failureCode: failure.code,
      turn,
    };
    // J9：回滚本身落事件（T-P1-05 偏离③的兑现——与换模事件同一词汇）。
    this.emit?.({
      from: { ...record.target },
      to: { ...record.prev },
      reason: "rollback",
    });
    return true;
  }
}
