/**
 * C36 保护清单只追加机制测试（T-P1-70）——运行时冻结证伪 +
 * extendProtectedNames 唯一追加入口（追加生效/原清单不变/幂等）。
 */
import { describe, expect, it } from "vitest";

import {
  PROTECTED_METADATA_PATH_NAMES,
  extendProtectedNames,
  findProtectedMetadataSegment,
} from "./protected-names.js";

describe("C36 · 保护清单运行时冻结（T-P1-70）", () => {
  it("freeze 证伪：清单 mutate 直接 throw（只追加不能替换的运行时面）", () => {
    expect(() =>
      (PROTECTED_METADATA_PATH_NAMES as string[]).push(".evil"),
    ).toThrow();
    expect(() => {
      "use strict";
      (PROTECTED_METADATA_PATH_NAMES as string[]).pop();
    }).toThrow();
  });

  it("验收①：extendProtectedNames 追加生效且原清单不变", () => {
    const extended = extendProtectedNames(PROTECTED_METADATA_PATH_NAMES, [
      ".terraform",
    ]);
    expect(extended).toContain(".terraform");
    expect([...extended]).toEqual([...PROTECTED_METADATA_PATH_NAMES, ".terraform"]);
    // 原清单保持三值（返回新清单，不 mutate）
    expect(PROTECTED_METADATA_PATH_NAMES).toHaveLength(3);
    // 扩展清单对消费面参数化入口生效（findProtectedMetadataSegment 第二参）
    expect(findProtectedMetadataSegment("/a/.terraform/x")).toBeUndefined();
    expect(findProtectedMetadataSegment("/a/.terraform/x", extended)).toBe(".terraform");
  });

  it("验收②：重复追加幂等（大小写不敏感，与段匹配方言一致）；空串忽略", () => {
    const once = extendProtectedNames(PROTECTED_METADATA_PATH_NAMES, [".Terraform"]);
    const twice = extendProtectedNames(once, [".terraform", "  .TERRAFORM  "]);
    expect([...twice]).toEqual([...once]);
    expect(extendProtectedNames(PROTECTED_METADATA_PATH_NAMES, ["", "  "])).toEqual(
      PROTECTED_METADATA_PATH_NAMES,
    );
    // 返回清单同样冻结（只追加纪律延续）
    expect(() => (twice as string[]).push(".x")).toThrow();
  });
});
