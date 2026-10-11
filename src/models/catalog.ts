/**
 * 模型目录（J12，T-P1-22）——装配 models 注册表的发现面。取 hermes
 * model_catalog.py 的三条纪律：
 *   ①去重——provider:model 二元组（J4 既有身份）同身份只一行，声明行
 *     优先于发现行（identityKey 相等即同一模型）；
 *   ②每厂商上限——下拉面一次渲染全部行，行数有界（hermes
 *     ACP_MAX_MODELS_PER_PROVIDER 同款 200；**当前模型始终保留**——
 *     fallback insert 的我方形态 = 超限过滤时当前行原地豁免）；
 *   ③discovery 兜底——声明清单在 /models 不可用时仍可用（"some endpoints
 *     have no /models route"——hermes 原文；发现失败只影响增量面，绝不
 *     吞掉声明行）。
 *
 * 边界（J6 fail-closed）：目录是查询面——discovered-only 条目没有装配
 * 绑定的 provider 实例，换模到它会抛 ModelNotRegisteredError（换模只能
 * 切到装配注册过的模型）；选择声明条目 = 既有 switch()（J6 联动）。
 */

import { identityKey, type ModelIdentity } from "./identity.js";
import { CATALOG_GENERATED } from "./catalog.generated.js";
import type { BuiltinModelSpec } from "./catalog-data.js";

/** 每厂商行数上限（hermes 同款；不是总量上限）。 */
export const MAX_MODELS_PER_PROVIDER = 200;

export type { BuiltinModelSpec } from "./catalog-data.js";
export { CATALOG_DATA_OVERRIDES } from "./catalog-data.js";
export { CATALOG_GENERATED } from "./catalog.generated.js";

/**
 * 内置目录查询（W18）：精确 id 优先，尾段兜底（split("/").pop()——中转
 * 自定义前缀 `cline-pass/deepseek-v4.1-flash` 按尾段命中同名条目，与
 * ui 设置页 catalogLookup 同语义）。未命中 = undefined（调用方零兜底）。
 */
export function lookupBuiltinModelSpec(modelId: string): BuiltinModelSpec | undefined {
  const exact = CATALOG_GENERATED.find((e) => e.id === modelId);
  if (exact !== undefined) return exact;
  const tail = modelId.split("/").pop() ?? modelId;
  if (tail === modelId) return undefined;
  return CATALOG_GENERATED.find((e) => e.id === tail);
}

/**
 * 内置目录缺省兜底（W18 运行时语义）：用户 settings models[] 条目的缺省
 * 字段由目录补齐——**用户显式字段永远优先**（`spec.x ?? catalog.x` 逐字段）。
 * adapter 不兜底（装配决策非模型知识）。未知模型零变化（原样返回）。
 *
 * 泛型入参对齐 ProviderModelSpec 形状（settings.ts）——models 域不 import
 * session（requires=["core"]），字段集以结构类型约束。
 */
export function applyCatalogDefaults<T extends object>(spec: T): T {
  const catalog = lookupBuiltinModelSpec(
    typeof (spec as { id?: unknown }).id === "string" ? (spec as { id: string }).id : "",
  );
  if (catalog === undefined) return spec;
  // verified 不兜底：目录的 verified 是"数据来源可信度"，settings 的
  // verified 是"该用户真实发消息实测过"（provider-test 落档）——两个语义
  // 同名不同义，冒充会让 UI 把未实测模型显示成已实测。
  const { verified: _catalogVerified, ...defaults } = catalog;
  return { ...defaults, ...spec } as T;
}

/** 目录条目：来源 declared（装配声明）/ discovered（/models 实时发现）。 */
export interface ModelCatalogEntry {
  identity: ModelIdentity;
  source: "declared" | "discovered";
}

export interface ModelCatalogOptions {
  /** 声明清单（装配 models 注册表的身份集；兜底锚）。 */
  declared: readonly ModelIdentity[];
  /**
   * 实时发现函数（按厂商探测 /models）：失败（404/网络错）即该厂商兜底
   * 声明行。发现结果的归属按 provider 校验（串厂发现行丢弃）。
   */
  discover?: (provider: string) => Promise<readonly ModelIdentity[]>;
  /** 每厂商上限；缺省 MAX_MODELS_PER_PROVIDER。 */
  maxPerProvider?: number;
  /** 当前生效模型（超限过滤时豁免——hermes "current is always kept"）。 */
  current?: ModelIdentity;
}

export async function buildModelCatalog(
  options: ModelCatalogOptions,
): Promise<readonly ModelCatalogEntry[]> {
  const max = options.maxPerProvider ?? MAX_MODELS_PER_PROVIDER;

  // ①声明行：去重 + 保持声明序
  const rows: ModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const identity of options.declared) {
    const key = identityKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ identity, source: "declared" });
  }

  // ③discovery 合并：每个声明过的厂商探测一次；失败 = 该厂商只剩声明行
  //（兜底纪律），成功 = 增量发现行去重后并入
  const providers = [...new Set(options.declared.map((m) => m.provider))];
  if (options.discover !== undefined) {
    for (const provider of providers) {
      let discovered: readonly ModelIdentity[];
      try {
        discovered = await options.discover(provider);
      } catch {
        continue; // 兜底：/models 缺失（404）或网络错——声明模型仍可用
      }
      for (const identity of discovered) {
        if (identity.provider !== provider) continue; // 归属校验：防串厂
        const key = identityKey(identity);
        if (seen.has(key)) continue; // 声明行优先
        seen.add(key);
        rows.push({ identity, source: "discovered" });
      }
    }
  }

  // ②每厂商上限：行序声明先于发现，超限裁剪；当前模型豁免（原地保留）
  const currentKey = options.current !== undefined ? identityKey(options.current) : undefined;
  const kept: ModelCatalogEntry[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const provider = row.identity.provider;
    const count = counts.get(provider) ?? 0;
    const isCurrent =
      currentKey !== undefined && identityKey(row.identity) === currentKey;
    if (count >= max && !isCurrent) continue;
    counts.set(provider, count + 1);
    kept.push(row);
  }
  return kept;
}
