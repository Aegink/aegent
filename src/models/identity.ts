/**
 * 模型身份（J4）——身份键永远是 `{provider, modelId}` 二元组，绝不用裸 model 名
 * （形状取 pi·agent-harness.ts 的 ModelIdentity：同名模型跨厂商可区分）。
 * T1-2 契约下沉：接口本体在 core/contracts/models.ts——本文件是构造/键化实现面。
 */

export type { ModelIdentity } from "../core/index.js";
import type { ModelIdentity } from "../core/index.js";

/** 构造身份；字段必须是非空字符串（外部输入校验，启动期即失败） */
export function modelIdentity(provider: string, modelId: string): ModelIdentity {
  if (typeof provider !== "string" || provider.trim() === "") {
    throw new TypeError("模型身份的 provider 必须是非空字符串");
  }
  if (typeof modelId !== "string" || modelId.trim() === "") {
    throw new TypeError("模型身份的 modelId 必须是非空字符串");
  }
  return { provider, modelId };
}

/**
 * 序列化键 `provider:modelId`——只用于日志/显示/临时 Map 键。
 * 边界：provider/modelId 含 ":" 时键有歧义，因此机器匹配一律做对象字段相等，
 * 绝不从 key 反解析身份（P0 不做转义；真出现含 ":" 的厂商 ID 再升级）。
 */
export function identityKey(id: ModelIdentity): string {
  return `${id.provider}:${id.modelId}`;
}
