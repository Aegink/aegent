import { describe, expect, it } from "vitest";

import { decisionSeverity } from "./aggregate.js";
import type { PolicyAction } from "./chain.js";
import {
  PermissionIntersectionError,
  intersectPermissionProfiles,
  type CeilingProfile,
} from "./intersect.js";

const ceilings = (
  source: string,
  values: Record<string, PolicyAction>,
  defaultCeiling?: PolicyAction,
): CeilingProfile => ({
  kind: "ceilings",
  source,
  ceilings: values,
  ...(defaultCeiling !== undefined ? { defaultCeiling } : {}),
});

describe("C49 · 可合成 profile 交集生效", () => {
  it("逐工具取更严者：CLI 放行而配置默认拒绝的工具落 deny", () => {
    const merged = intersectPermissionProfiles(
      ceilings("cli", { bash: "allow" }),
      ceilings("config-default", {}, "deny"),
    );
    expect(merged.source).toBe("intersect(cli,config-default)");
    expect(merged.ceilings["bash"]).toBe("deny");
    expect(merged.defaultCeiling).toBe("deny");
  });

  it("各自约束不同工具时逐工具合成，默认上限取更严", () => {
    const merged = intersectPermissionProfiles(
      ceilings("cli", { bash: "ask", write: "allow" }, "allow"),
      ceilings("config", { write: "ask" }, "ask"),
    );
    expect(merged.ceilings["bash"]).toBe("ask"); // ask vs 默认 ask
    expect(merged.ceilings["write"]).toBe("ask"); // allow vs ask → ask
    expect(merged.defaultCeiling).toBe("ask");
  });

  it("交集不比任一方更宽松（穷举小空间性质测试）", () => {
    const actions: PolicyAction[] = ["allow", "ask", "deny"];
    for (const a of actions) {
      for (const b of actions) {
        const merged = intersectPermissionProfiles(
          ceilings("a", { bash: a }),
          ceilings("b", { bash: b }),
        );
        const severity = decisionSeverity(merged.ceilings["bash"]!);
        expect(severity).toBeGreaterThanOrEqual(decisionSeverity(a));
        expect(severity).toBeGreaterThanOrEqual(decisionSeverity(b));
      }
    }
  });
});

describe("C49 · 不可合成组合 fail-closed", () => {
  it("任一方 opaque 即抛错，错误信息含两来源名与原因", () => {
    const merge = () =>
      intersectPermissionProfiles(
        ceilings("cli", { bash: "allow" }),
        {
          kind: "opaque",
          source: "harness-managed",
          reason: "外部强管策略，无法表达为上限",
        },
      );
    expect(merge).toThrow(PermissionIntersectionError);
    try {
      merge();
    } catch (e) {
      const err = e as PermissionIntersectionError;
      expect(err.sources).toEqual(["cli", "harness-managed"]);
      expect(err.message).toContain("cli");
      expect(err.message).toContain("harness-managed");
      expect(err.message).toContain("外部强管策略");
    }
  });

  it("两侧均 opaque 同样抛错（先遇到的给原因）", () => {
    const merge = () =>
      intersectPermissionProfiles(
        { kind: "opaque", source: "sandbox-a", reason: "规则集形态" },
        { kind: "opaque", source: "sandbox-b", reason: "另一种形态" },
      );
    expect(merge).toThrow(PermissionIntersectionError);
  });
});
