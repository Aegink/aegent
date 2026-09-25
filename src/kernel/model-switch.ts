/**
 * 会话级模型选择状态（J6/J7，T-P1-04）——换模请求**立即受理**、生效点在
 * 新 turn；在途 turn 用其启动时捕获的模型跑完。形状取 pi·agent-harness 的
 * configured 与 captured 分离：`setModel(model, context)` 立即受理改
 * configured，`CurrentOperationInfo.capturedModel` 是在途操作的快照
 * （agent-harness.ts:154）。
 *
 * 结构位置与边界：
 * - 注册表来源 = 装配注册（createChildAssembly 的 models 选项）——P1 先
 *   装配注册，J12 的配置发现/选择器留后续批次（卡面风险栏决定）；
 * - 换模不落事件：词汇表 14 事件无换模落点，`model/switch` 事件在
 *   T-P1-06 走词汇表扩展流程（14→15）后接入，本卡状态只驻进程内存；
 * - captured 是"在途 turn"的单一槽位（单会话单 loop，同时至多一个在途
 *   turn），不养每 turn 一条的历史——换模的历史事实由 T-P1-06 的流内
 *   事件承载（不变量 1：状态是事件的投影，不养第二份历史）；
 * - J8/J11 的四态状态机与失败回滚（deferred / prev_model_id）在
 *   T-P1-05 扩展本文件，本卡只落"受理 + 捕获"最小面。
 */

import { identityKey, type ModelIdentity } from "../models/identity.js";
import type { ModelProvider } from "../models/provider.js";

/** 注册表条目：身份 + 承载它的 provider（装配时成对注册）。 */
export interface RegisteredModel {
  identity: ModelIdentity;
  provider: ModelProvider;
}

/** 一个 turn 的捕获值：该 turn 全程使用的 provider 与身份。 */
export interface TurnModel {
  provider: ModelProvider;
  identity: ModelIdentity;
}

/** 换模到未注册模型——类型化错误（验收②：不静默）。 */
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
}

export class ModelSwitchService {
  private readonly registry: ReadonlyMap<string, RegisteredModel>;
  private configuredId: ModelIdentity;
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
  }

  /** configured 当前值：换模请求立即受理即更新（验收③可观测面之一）。 */
  get configured(): ModelIdentity {
    return this.configuredId;
  }

  /** 在途 turn 的捕获快照（验收③可观测面之二）；非在途 turn 返回 undefined。 */
  capturedFor(turn: number): TurnModel | undefined {
    return this.currentCapture?.turn === turn
      ? this.currentCapture.model
      : undefined;
  }

  /**
   * 换模请求立即受理：更新 configured。未注册模型抛 ModelNotRegistered
   * Error（不静默）；生效点在新 turn——本方法绝不触碰 currentCapture。
   */
  switch(identity: ModelIdentity): void {
    const entry = this.registry.get(identityKey(identity));
    if (!entry) throw new ModelNotRegisteredError(identity);
    this.configuredId = entry.identity;
  }

  /**
   * turn 启动捕获（J7）：捕获此刻 configured 作为本 turn 全程的模型。
   * 在途 turn 中再换模不影响本捕获（卡面验收①的 captured 断言依据）。
   */
  captureForTurn(turn: number): TurnModel {
    const entry = this.registry.get(identityKey(this.configuredId));
    if (!entry) {
      // 不可达（configured 只经构造/switch 赋值，两者都校验过注册）——
      // 防御兜底大声失败，绝不静默用坏状态发请求
      throw new ModelNotRegisteredError(this.configuredId);
    }
    const model: TurnModel = {
      provider: entry.provider,
      identity: entry.identity,
    };
    this.currentCapture = { turn, model };
    return model;
  }
}
