/**
 * 洋葱链骨架（I12 / Q14）——每层 `($, e, next)`：进去前做事、`return next(e)` 后
 * 做事、不调 next 即截断。形状取 claude-official·mods（tier + return next(e) 的
 * 洋葱形态；🔴 专有，只学行为不摘代码）。链底不是层，是引擎自身动作（terminal）——
 * claude-official 链底规则 "nothing is beneath them: unanswered call throws" 在
 * 我方的对应物是：最内层 next(e) 的落点就是 terminal，不存在无人应答的调用。
 *
 * ── P0 三个点位（Q14 约束"只挂 3 个"；决定全文见 plan-p0.md T-3-01 卡）──
 *
 *   toolCall        包住"工具分发执行"。阶段 4/5 消费：权限层挂这里（C9 策略
 *                   求值在工具执行前、不变量 3 默认 ask；截断 = 拒绝执行）。
 *   modelRequest    包住"模型请求"（T-2-02 的 provider 调用）。阶段 7 消费：
 *                   上下文装配挂这里——next(e2) 换载荷正是该点位的必备能力。
 *   turnEnd         包住"turn 收尾"。阶段 7 消费：压缩挂这里（F9 压缩在 turn
 *                   边界可断言；层自选在 next 前后做压缩，即相对 turn/end 事件的次序）。
 *
 * 载荷形状由 loop（T-3-02）与各消费阶段定形，本骨架只定链形：
 *   toolCall ~ { callId, name, arguments }（与 tool/call 事件载荷同源）
 *   modelRequest ~ { turn, step, ...请求体 }（T-2-02 ModelProvider 入参侧）
 *   turnEnd ~ { turn }
 *
 * 排除项（防后来者加点位）：step 级不挂（F10 压力测量是观察非干预，loop 直接
 * 测量+落事件）；权限不挂 modelRequest（对象错位）；压缩不挂 modelRequest
 * （与上下文装配互踩）。另开点位 = 改设计，走待澄清。
 *
 * ── P1/P2 槽位 ──
 *   I13  next.trace / next.budget —— T-P1-07 已填实：trace 记录走过层的
 *        序号+名字（层名经 namedLayer 附加，未命名层记 layer#<index>）；
 *        budget 按墙钟时间衰减（composeChain 传 budgetMs 才启用，缺省恒空
 *        槽 = 零行为变化），时钟注入（T-2-03 纪律）可测。
 *   I14  next.to(e, tier) 跨层跳 —— P2，不预留 API 形状。
 *   signal —— claude-official 把 AbortSignal 挂在 next 上；T-3-04 已定：我方
 *   取消是 loop 内的协作式置槽检查（promise 风格，见 loop.ts cancel()），
 *   P0 不需要 next.signal 槽。
 *
 * ── L10：链底无人应答 ──
 * mods 的链底规则"a call they leave unanswered throws, naming its event"在我
 * 方的落点：terminal 缺省时到达链底的 next 调用抛错并点名点位事件——
 * composeChain 不传 terminal 即启用（P0 三链都传，零行为变化）。
 */

// ---------------------------------------------------------------------------
// 点位与槽位类型
// ---------------------------------------------------------------------------

/** P0 的三个链点位（封闭清单；Q14"只挂 3 个"）。 */
export const CHAIN_POINTS = ["toolCall", "modelRequest", "turnEnd"] as const;

export type ChainPoint = (typeof CHAIN_POINTS)[number];

/** I13（P1 已填实）：分派轨迹条目——层调 next 时本层入列。 */
export interface ChainTraceEntry {
  /** 走过的层序号（0 起，外层在前）。 */
  layer: number;
  /** 层名（namedLayer 附加；未命名层 = `layer#<index>`）。 */
  name: string;
}

/** I13（P1 已填实）：本次分派的轨迹——层看到的 = 在它之前走过的层（不含自己）。 */
export type ChainTrace = readonly ChainTraceEntry[];

/**
 * I13（P1 已填实）槽位：单层预算。composeChain 传 budgetMs 时启用——
 * remaining = 预算减去本次分派已耗墙钟毫秒（进入本层时点计，负值 = 已超支，
 * 保留真实值供诊断）；缺省恒为空槽 `{}`（零行为变化）。
 */
export interface ChainBudget {
  /** 剩余额度（毫秒；负值 = 已超支）。 */
  readonly remaining?: number;
}

// ---------------------------------------------------------------------------
// 层 / 链
// ---------------------------------------------------------------------------

/**
 * 一层洋葱：进去前做事 → `return next(e2)`（e2 可换载荷）→ 出来后做事；
 * 不调 next 直接 return 即截断。约定：调了 next 就必须返回（或 await）其
 * 结果——丢弃 next 的 promise 属编程错误，内层会脱管继续跑。
 */
export type ChainLayer<C, E, R> = (
  $: C,
  e: E,
  next: ChainNext<E, R>,
) => R | Promise<R>;

export interface ChainNext<E, R> {
  /** 交棒下一层；每层至多一次，第二次调用抛错（防同一动作双重执行）。 */
  (e: E): Promise<R>;
  /** 本分派的点位名（对齐 claude-official 的 next.event）。 */
  readonly point: ChainPoint;
  /** I13（P1）槽位：分派轨迹。P0 恒为空数组。 */
  readonly trace: ChainTrace;
  /** I13（P1）槽位：单层预算。P0 恒为空槽。 */
  readonly budget: ChainBudget;
  /**
   * I14（T-P2-308）跨层跳：跳到名为 target 的层继续本分派——中间层**零
   * 执行零回程**（进与出都不经过），目标层及其内层正常执行并回程，结果
   * 直接返回本层（claude-official 的 `next.to(e, tier)` 语义：continues
   * this dispatch at a tier——🔴 只学语义零代码摘取）。
   *
   * 跳层是**显式声明面**（fail-closed 三重闸）：①只有 composeChain 的
   * skippableLayers 白名单内的层名**可以**被跳过（缺省空名单 = 无跳层
   * 能力）；②审批层（UNSKIPPABLE_LAYER_NAMES）恒不可跳——即使误配置进
   * 白名单也拒绝（C 族不变量）；③target 层名必须存在（从本层向内首个
   * 匹配；找不到拒绝）。三种拒绝都是类型化 ChainJumpError——配置错误
   * 大声失败不静默。to 与 next 共用"每层至多一次"配额（跳层也是一次
   * 交棒）。
   */
  to?: (e: E, target: string) => Promise<R>;
}

/** I14 跨层跳的类型化拒绝（配置错误 fail-closed——不静默降级为普通 next）。 */
export class ChainJumpError extends Error {
  readonly code: "JUMP_TARGET_NOT_FOUND" | "JUMP_TARGET_NOT_ALLOWED" | "JUMP_LAYER_PROTECTED";
  constructor(
    code: "JUMP_TARGET_NOT_FOUND" | "JUMP_TARGET_NOT_ALLOWED" | "JUMP_LAYER_PROTECTED",
    message: string,
  ) {
    super(message);
    this.name = "ChainJumpError";
    this.code = code;
  }
}

/**
 * I14 跳层调用入口：无 to 的 next 上跳层 = 类型化拒绝（不静默 undefined）。
 */
export function jumpTo<E, R>(next: ChainNext<E, R>, e: E, target: string): Promise<R> {
  if (next.to === undefined) {
    throw new ChainJumpError(
      "JUMP_TARGET_NOT_ALLOWED",
      `本 next 未装配跳层能力（跳向 ${target}）——composeChain 装配的链恒带 to；` +
        "手工构造的 next 需显式装配（I14 显式声明面）",
    );
  }
  return next.to(e, target);
}

/**
 * I14 审批层硬保护名单（C 族不变量）：这些名字的层**恒不可被跳过**——
 * 即使装配方误把它们写进 skippableLayers 也拒绝（权限判定不可被跳层
 * 绕过；fail-closed 纪律的机制面兑现）。
 */
export const UNSKIPPABLE_LAYER_NAMES = ["gate"] as const;

/** 链底：引擎自身动作（工具真的执行 / 请求真的发出 / turn 真的收尾）。 */
export type ChainTerminal<C, E, R> = ($: C, e: E) => R | Promise<R>;

/**
 * 一次分派的结果。截断是预期控制流（如权限拒绝），用标记表达、不抛错——
 * 调用方（loop）按 outcome.truncated 分支，而不是按异常分支。
 */
export interface ChainOutcome<R> {
  /** true = 链底动作没发生（任一层未调 next，标记跨层向外传播）。 */
  readonly truncated: boolean;
  /** 走到底 = terminal 返回值经各层透传；截断 = 截断层返回值。 */
  readonly value: R;
}

export interface ChainExecutor<C, E, R> {
  readonly point: ChainPoint;
  /** 跑一遍洋葱（layers[0] 最外层）。层序即优先级（阶段 5：托管 > 用户 > 核心）。 */
  run($: C, e: E): Promise<ChainOutcome<R>>;
}

/**
 * I13：给层附加名字（trace 记录层名用）。直接在层函数上定义只读属性——
 * 层通常单点构造、单处命名；重复命名以最后一次为准（configurable 允许）。
 */
export function namedLayer<C, E, R>(
  name: string,
  layer: ChainLayer<C, E, R>,
): ChainLayer<C, E, R> {
  Object.defineProperty(layer, "chainLayerName", {
    value: name,
    configurable: true,
  });
  return layer;
}

function layerNameOf(layer: unknown, index: number): string {
  const named = (layer as { chainLayerName?: string }).chainLayerName;
  return named ?? `layer#${String(index)}`;
}

/**
 * 组装洋葱链。每层拿到的 next 只暴露纯 R 值——截断标记在层间不可见
 * （层看到的世界与"内层正常执行完"无异），只在 run 的结果里浮出。
 *
 * terminal 缺省（L10）= 到达链底的 next 调用抛错并点名点位事件；P0 三链
 * 都传 terminal，缺省仅服务于"纯 hook 链"形态（链底无人应答必须大声失败，
 * 不能静默）。
 */
export function composeChain<C, E, R>(options: {
  point: ChainPoint;
  terminal?: ChainTerminal<C, E, R>;
  layers: ReadonlyArray<ChainLayer<C, E, R>>;
  /** I13：本次分派的时间预算（毫秒）；缺省 = budget 恒空槽（零行为变化）。 */
  budgetMs?: number;
  /** 时钟注入（T-2-03 纪律：可测性优于读全局钟）；缺省 Date.now。 */
  now?: () => number;
  /**
   * I14：可被跳过的层名白名单（`next.to` 的授权面）。缺省空名单 = 无跳层
   * 能力（to 恒拒绝——零行为变化 + fail-closed 缺省）；审批层名单
   * （UNSKIPPABLE_LAYER_NAMES）在本名单之上硬保护，列出也恒拒。
   */
  skippableLayers?: readonly string[];
}): ChainExecutor<C, E, R> {
  const { point, terminal, layers } = options;
  const nowFn = options.now ?? Date.now;
  const skippable = options.skippableLayers ?? [];

  const dispatch = async (
    index: number,
    $: C,
    e: E,
    walked: ChainTraceEntry[],
    startedAt: number,
  ): Promise<ChainOutcome<R>> => {
    const layer = layers[index];
    if (layer === undefined) {
      if (terminal === undefined) {
        // L10：链底无人应答——错误点名事件（mods 同名语义）。
        throw new Error(
          `洋葱链底无人应答（point=${point}）——terminal 缺失时到达链底的 ` +
            "next 调用即无人应答，大声失败不静默",
        );
      }
      return { truncated: false, value: await terminal($, e) };
    }
    let nextCalled = false;
    // 内层的截断要向外传播：truncated 的语义是"链底动作没发生"，
    // 与截断发生在哪一层无关（外层透传不算洗白）。
    let innerTruncated = false;
    const budget: ChainBudget =
      options.budgetMs === undefined
        ? Object.freeze({})
        : Object.freeze({
            remaining: options.budgetMs - (nowFn() - startedAt),
          });
    const runFrom = (startIndex: number, e2: E): Promise<R> =>
      dispatch(
        startIndex,
        $,
        e2,
        [...walked, { layer: index, name: layerNameOf(layer, index) }],
        startedAt,
      ).then((inner) => {
        innerTruncated = inner.truncated;
        return inner.value;
      });
    const next: ChainNext<E, R> = Object.assign(
      (e2: E) => {
        if (nextCalled) {
          throw new Error(
            `洋葱链第 ${index} 层重复调用 next/to（point=${point}）——每层至多一次`,
          );
        }
        nextCalled = true;
        return runFrom(index + 1, e2);
      },
      {
        point,
        trace: Object.freeze([...walked]) as ChainTrace,
        budget,
        to: (e2: E, target: string) => {
          if (nextCalled) {
            throw new Error(
              `洋葱链第 ${index} 层重复调用 next/to（point=${point}）——每层至多一次`,
            );
          }
          nextCalled = true;
          // 目标解析：从本层向内首个名字匹配的层（同名多层确定性地取最近）
          let targetIndex = -1;
          for (let i = index + 1; i < layers.length; i++) {
            if (layerNameOf(layers[i], i) === target) {
              targetIndex = i;
              break;
            }
          }
          if (targetIndex === -1) {
            throw new ChainJumpError(
              "JUMP_TARGET_NOT_FOUND",
              `跨层跳目标不存在：${target}（point=${point}，本层 index=${String(index)}——从本层向内无此名）`,
            );
          }
          // 中间层三重闸：显式命名 → 硬保护（审批层）→ 白名单授权
          for (let i = index + 1; i < targetIndex; i++) {
            const name = layerNameOf(layers[i], i);
            if ((layers[i] as { chainLayerName?: string }).chainLayerName === undefined) {
              throw new ChainJumpError(
                "JUMP_TARGET_NOT_ALLOWED",
                `跳层经过未命名层（layer#${String(i)}）——跳层是显式声明面，` +
                  `被跳层必须显式命名（point=${point}）`,
              );
            }
            if ((UNSKIPPABLE_LAYER_NAMES as readonly string[]).includes(name)) {
              throw new ChainJumpError(
                "JUMP_LAYER_PROTECTED",
                `跳层经过受保护层「${name}」——审批层不可被跳过（C 族不变量，point=${point}）`,
              );
            }
            if (!skippable.includes(name)) {
              throw new ChainJumpError(
                "JUMP_TARGET_NOT_ALLOWED",
                `跳层经过未授权层「${name}」——不在 skippableLayers 白名单（point=${point}；` +
                  `已授权：${skippable.length > 0 ? skippable.join(", ") : "无（缺省无跳层能力）"}）`,
              );
            }
          }
          return runFrom(targetIndex, e2);
        },
      },
    );
    const value = await layer($, e, next);
    return { truncated: nextCalled ? innerTruncated : true, value };
  };

  return {
    point,
    run: ($, e) =>
      dispatch(0, $, e, [], options.budgetMs === undefined ? 0 : nowFn()),
  };
}
