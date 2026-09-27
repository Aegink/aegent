/**
 * 会话配置分层（B21/T-P1-63）——"可热刷新字段 vs 会话内静态设置"两类
 * 分法（codex session/tests.rs 的 refresh_runtime_config 语义：热刷新更新
 * 白名单字段、**会话内静态设置被保持**）。
 *
 * 两类闭集：
 *   - **可热刷新**（REFRESHABLE_CONFIG_KEYS 白名单）：运行面参数——审批
 *     答复上界、队列上限（均为既有装配可配项的运行时面）。经显式刷新
 *     通道（协议命令 config/refresh）生效，生效即观测（getter 面读取）。
 *   - **静态**：模型身份、权限规则、工具清单、沙箱配置等会话构造时捕获
 *     的决策——**刷新载荷出现任何非白名单键 → 整包类型化拒绝**（fail-
 *     closed：部分应用会让人"以为刷新成功了"；codex 同款断言 model 等
 *     静态字段在刷新后不动）。
 *
 * 生效点语义（与 J7 capturedModel 同构）：refresh 立即更新 store 内部值、
 * **在途 turn 不受影响**（在途消费方持旧值），新构造/新调用读新值。
 */

import type { JsonRecord } from "./events.js";

/** 可热刷新字段白名单（闭集，冻结只追加——C10 先例）。 */
export const REFRESHABLE_CONFIG_KEYS = ["approvalTimeoutMs", "queueMaxSize"] as const;

export type RefreshableConfigKey = (typeof REFRESHABLE_CONFIG_KEYS)[number];

export const STATIC_CONFIG_IMMUTABLE = "STATIC_CONFIG_IMMUTABLE";

export class StaticConfigImmutableError extends Error {
  override readonly name = "StaticConfigImmutableError";
  readonly code = STATIC_CONFIG_IMMUTABLE;
  constructor(readonly key: string) {
    super(
      `配置键 "${key}" 是会话内静态设置，不可热刷新（B21：热刷新只作用于白名单 ${REFRESHABLE_CONFIG_KEYS.join("/")}）`,
    );
  }
}

export interface SessionConfigValues {
  /** 审批答复上界（毫秒）——question/escalation 等审批通道的等待上界。 */
  approvalTimeoutMs?: number;
  /** 输入队列上限（条）——PromptQueue maxSize 同语义。 */
  queueMaxSize?: number;
}

export class SessionConfigStore {
  private values: {
    approvalTimeoutMs: number | undefined;
    queueMaxSize: number | undefined;
  };

  constructor(
    private readonly sessionId: string,
    initial?: SessionConfigValues,
  ) {
    this.values = {
      approvalTimeoutMs: initial?.approvalTimeoutMs,
      queueMaxSize: initial?.queueMaxSize,
    };
  }

  get approvalTimeoutMs(): number | undefined {
    return this.values.approvalTimeoutMs;
  }

  get queueMaxSize(): number | undefined {
    return this.values.queueMaxSize;
  }

  /**
   * 热刷新：patch 只含白名单键且值类型合法 → 逐键应用并返回 applied；
   * 出现任何非白名单键（静态设置）→ 抛类型化错误且**整包拒绝**（零应用）。
   */
  refresh(patch: JsonRecord): { applied: RefreshableConfigKey[] } {
    const keys = Object.keys(patch);
    const illegal = keys.filter(
      (k) => !(REFRESHABLE_CONFIG_KEYS as readonly string[]).includes(k),
    );
    if (illegal.length > 0) {
      throw new StaticConfigImmutableError(illegal[0] as string);
    }
    const applied: RefreshableConfigKey[] = [];
    for (const key of keys) {
      const value = patch[key];
      if (key === "approvalTimeoutMs") {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          throw new StaticConfigImmutableError(key);
        }
        this.values.approvalTimeoutMs = value;
        applied.push(key);
      } else if (key === "queueMaxSize") {
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
          throw new StaticConfigImmutableError(key);
        }
        this.values.queueMaxSize = value;
        applied.push(key);
      }
    }
    return { applied };
  }
}
