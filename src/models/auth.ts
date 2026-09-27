/**
 * 鉴权刷新（J13/T-P1-106）——"鉴权刷新不得改变模型身份；刷新 token/header
 * 后断言模型身份未变"。zcode·model/runner.ts:348 `assertSameBoundModel`
 *（"Runtime header refresh changed the bound model identity."）的纪律面。
 *
 * 我方落法：**结构保证 + 契约面双层**。
 * - 结构保证：AuthResolver 的产物（AuthMaterial）只有 apiKey/headers——
 *   结构上不含身份字段；req.identity 由 loop 的捕获值（J7）传入 provider，
 *   刷新路径摸不到它。openai-compat 适配层零身份可变性 = 不变量自动成立。
 * - 契约面：AuthRefreshIdentityError + assertAuthIdentityUnchanged 供 J5
 *   第二厂商适配层（如 Anthropic 的"解析即返回 resolved model"形态——
 *   鉴权与模型解析纠缠的实现）作为防御性断言点；当前 openai-compat 结构
 *   上不可达，函数存在即契约（形状被测试钉死）。
 *
 * 消费边界：agent-child 装配不接（真实消费方 = 令牌轮换/安全配置重读
 * 场景——接口面先行，YAGNI 边界与 J12 目录查询同款）；刷新调度（OAuth
 * 令牌生命周期）属 J17 P2 域，本模块不做。
 */

import type { ModelIdentity } from "./identity.js";

/** 每次请求现取的鉴权材料（apiKey 换 Bearer；headers 为额外头——原样并请求头）。 */
export interface AuthMaterial {
  apiKey?: string;
  headers?: Record<string, string>;
}

/** 鉴权解析器：provider 每次请求前调用（令牌轮换/DPAPI 安全配置重读的接口面）。 */
export interface AuthResolver {
  resolve(): Promise<AuthMaterial>;
}

export const AUTH_REFRESH_IDENTITY_CHANGED = "AUTH_REFRESH_IDENTITY_CHANGED";

/** 刷新试图改变绑定模型身份时的类型化拒绝（assertSameBoundModel 同构）。 */
export class AuthRefreshIdentityError extends Error {
  override readonly name = "AuthRefreshIdentityError";
  readonly code = AUTH_REFRESH_IDENTITY_CHANGED;
  constructor(readonly bound: ModelIdentity, readonly attempted: ModelIdentity) {
    super(
      `鉴权刷新改变了绑定模型身份：${bound.provider}:${bound.modelId} → ` +
        `${attempted.provider}:${attempted.modelId}（刷新只允许换鉴权材料）`,
    );
    this.name = "AuthRefreshIdentityError";
  }
}

/**
 * 鉴权刷新前后的身份断言（J5 适配层的防御性调用点——zcode
 * assertSameBoundModel 同构：刷新结果携带/暗示的身份 ≠ 绑定身份即类型化拒绝）。
 */
export function assertAuthIdentityUnchanged(
  bound: ModelIdentity,
  attempted: ModelIdentity,
): void {
  if (bound.provider !== attempted.provider || bound.modelId !== attempted.modelId) {
    throw new AuthRefreshIdentityError(bound, attempted);
  }
}
