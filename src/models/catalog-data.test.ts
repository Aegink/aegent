/**
 * W18 内置模型目录：lookupBuiltinModelSpec（精确/尾段命中）+
 * applyCatalogDefaults（用户显式优先/目录兜底/verified 不兜底/未知零变化）。
 */
import { describe, expect, it } from "vitest";

import {
  applyCatalogDefaults,
  lookupBuiltinModelSpec,
} from "./catalog.js";
import { CATALOG_DATA_OVERRIDES } from "./catalog-data.js";
import { CATALOG_GENERATED } from "./catalog.generated.js";

describe("内置模型目录（W18 数据化）", () => {
  it("生成产物与数据源同步（覆盖层条目全部在 generated 中且优先）", () => {
    for (const override of CATALOG_DATA_OVERRIDES) {
      const key = (e: { id: string; adapter?: string }) => `${e.adapter ?? "*"}::${e.id}`;
      const hit = CATALOG_GENERATED.find((e) => key(e) === key(override));
      expect(hit, `覆盖层条目 ${override.id} 应在 generated 中`).toBeDefined();
      expect(hit?.verified).toBe(override.verified); // 覆盖层 verified 保留
    }
    expect(CATALOG_GENERATED.length).toBeGreaterThan(CATALOG_DATA_OVERRIDES.length);
  });

  it("lookup：精确 id 命中（覆盖层优先）；尾段命中中转前缀；未知 undefined", () => {
    // 精确命中覆盖层条目
    const opus = lookupBuiltinModelSpec("claude-opus-4-5");
    expect(opus?.contextWindow).toBe(200_000);
    expect(opus?.verified).toBe(true);
    // 尾段命中（中转自定义前缀——ui catalogLookup 同语义）
    const viaRelay = lookupBuiltinModelSpec("cline-pass/claude-sonnet-4-5");
    expect(viaRelay?.id).toBe("claude-sonnet-4-5");
    // 大数据条目（机器来源 verified:false）
    const big = CATALOG_GENERATED.find((e) => e.verified === false);
    if (big !== undefined) {
      expect(lookupBuiltinModelSpec(big.id)?.verified).toBe(false);
    }
    expect(lookupBuiltinModelSpec("no-such-model-xyz")).toBeUndefined();
  });

  it("applyCatalogDefaults：用户显式字段永远优先；缺省字段由目录兜底", () => {
    // 用户只填 id——contextWindow/reasoning/thinkingLevels 全部兜底
    const bare = applyCatalogDefaults({ id: "claude-sonnet-4-5" });
    expect(bare).toMatchObject({
      id: "claude-sonnet-4-5",
      contextWindow: 200_000,
      reasoning: "high",
      imageInput: true,
    });
    // 用户显式 contextWindow 优先（厂商上调场景）
    const explicit = applyCatalogDefaults({ id: "gpt-4o", contextWindow: 999_999 });
    expect(explicit.contextWindow).toBe(999_999);
    // adapter 不兜底（装配决策）——目录条目带 adapter 也不写进用户条目
    expect("adapter" in applyCatalogDefaults({ id: "gpt-4o" })).toBe(false);
  });

  it("applyCatalogDefaults：verified 不兜底（目录可信度 ≠ 用户实测）", () => {
    // 用户未实测：无 verified 字段（目录 verified 不冒充用户实测）
    const bare = applyCatalogDefaults({ id: "gpt-4o" }) as { verified?: boolean };
    expect("verified" in bare).toBe(false);
    // 用户实测过：保留用户值
    const tested = applyCatalogDefaults({ id: "gpt-4o", verified: true }) as { verified?: boolean };
    expect(tested.verified).toBe(true);
  });

  it("applyCatalogDefaults：未知模型零变化（原样返回）", () => {
    const spec = { id: "my-private-model", contextWindow: 8_192 };
    expect(applyCatalogDefaults(spec)).toEqual(spec);
  });

  it("尾段歧义安全：跨 provider 同尾段时精确命中优先于尾段命中", () => {
    // 精确 id 恒优先——尾段匹配只在无精确命中时启用
    const exact = lookupBuiltinModelSpec("gpt-4o");
    expect(exact?.id).toBe("gpt-4o");
  });
});
