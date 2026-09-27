import { describe, expect, it } from "vitest";

import {
  EMPTY_ACTIVATION,
  isToolActive,
  isToolActiveComposed,
  type ToolActivationLayers,
} from "./tool-activation.js";

describe("C25 · 工具激活与批准分离（T-P1-76）", () => {
  it("isToolActive：disabled 命中 → 不可用（通配支持）", () => {
    expect(isToolActive({ disabled: ["bash"] }, "bash")).toBe(false);
    expect(isToolActive({ disabled: ["github__*"] }, "github__issues")).toBe(false);
    // 通配 `*` 跨任意字符（wildcardMatch 方言）："bash*" 命中 bashx
    expect(isToolActive({ disabled: ["bash*"] }, "bashx")).toBe(false);
    // 锚定全串：纯字面 "bash" 不命中 "bashx"
    expect(isToolActive({ disabled: ["bash"] }, "bashx")).toBe(true);
  });

  it("isToolActive：enabled 白名单非空且不含 → 不可用；含 → 可用", () => {
    expect(isToolActive({ enabled: ["read", "write"] }, "bash")).toBe(false);
    expect(isToolActive({ enabled: ["read", "write"] }, "write")).toBe(true);
    // enabled 缺席/空数组 = 该层白名单不设限（只看 disabled）
    expect(isToolActive({ enabled: [] }, "bash")).toBe(true);
    expect(isToolActive({}, "bash")).toBe(true);
  });

  it("同层并存：显式禁用压过白名单收录（先黑后白）", () => {
    expect(isToolActive({ enabled: ["bash", "read"], disabled: ["bash"] }, "bash")).toBe(false);
    expect(isToolActive({ enabled: ["bash", "read"], disabled: ["rm *"] }, "bash")).toBe(true);
  });

  it("isToolActiveComposed：四层纯 AND——任一层禁用即不可达", () => {
    const base: ToolActivationLayers = {
      workspace: { disabled: ["bash"] },
      profile: { enabled: ["bash", "read"] },
      global: {},
      session: {},
    };
    // workspace 层禁用压过 profile 白名单收录
    expect(isToolActiveComposed(base, "bash")).toBe(false);
    // 逐层单独禁用各一（其余层放行）
    expect(
      isToolActiveComposed({ ...base, workspace: {} , profile: { disabled: ["read"] } }, "read"),
    ).toBe(false);
    expect(isToolActiveComposed({ ...base, global: { disabled: ["read"] } }, "read")).toBe(false);
    expect(isToolActiveComposed({ ...base, session: { disabled: ["read"] } }, "read")).toBe(false);
    // 四层全放行 → 可达
    expect(isToolActiveComposed({ ...base, workspace: {} }, "bash")).toBe(true);
  });

  it("缺省全空层零禁用（EMPTY_ACTIVATION 与 undefined 等价——零行为变化）", () => {
    expect(isToolActiveComposed(EMPTY_ACTIVATION, "bash")).toBe(true);
    expect(isToolActiveComposed(EMPTY_ACTIVATION, "github__issues")).toBe(true);
  });
});
