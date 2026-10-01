/**
 * settings 信封解析回归（T-P3-148 走查实录——插件/市场族载荷键漏进未知键
 * 白名单时整信封被"未知属性"拒绝，UI 侧表现为请求挂起无回执）。
 */

import { describe, expect, it } from "vitest";

import { parseSettingsEnvelope } from "./protocol-settings.js";

describe("settings 信封：插件/市场族 op（T-P3-148 回归）", () => {
  it("plugin-check：dir 载荷通过（未知键白名单回归）", () => {
    const call = parseSettingsEnvelope({
      type: "settings",
      requestId: "s-1",
      op: "plugin-check",
      dir: "F:/plugins/demo",
    });
    expect(call.op).toBe("plugin-check");
    expect(call.dir).toBe("F:/plugins/demo");
  });

  it("plugin-pack / plugin-view-html / plugin-scaffold 载荷通过", () => {
    expect(parseSettingsEnvelope({ type: "settings", requestId: "s", op: "plugin-pack", dir: "D:/p" }).dir).toBe("D:/p");
    const view = parseSettingsEnvelope({ type: "settings", requestId: "s", op: "plugin-view-html", name: "demo", view: "main", base: "dark" });
    expect(view.view).toBe("main");
    expect(view.base).toBe("dark");
    const scaffold = parseSettingsEnvelope({ type: "settings", requestId: "s", op: "plugin-scaffold", name: "my-plug", template: "full", displayName: "My", pluginDescription: "d" });
    expect(scaffold.template).toBe("full");
    expect(scaffold.pluginDescription).toBe("d");
  });

  it("market 全动作载荷通过；未知 action 拒绝", () => {
    expect(parseSettingsEnvelope({ type: "settings", requestId: "s", op: "market", action: "add", source: "a/b" }).action).toBe("add");
    expect(parseSettingsEnvelope({ type: "settings", requestId: "s", op: "market", action: "install", marketplace: "m", name: "p" }).marketplace).toBe("m");
    expect(() => parseSettingsEnvelope({ type: "settings", requestId: "s", op: "market", action: "nope" })).toThrow(/action 非法/);
  });

  it("缺载荷 fail-closed：plugin-check 无 dir / scaffold 坏模板 拒绝", () => {
    expect(() => parseSettingsEnvelope({ type: "settings", requestId: "s", op: "plugin-check" })).toThrow(/dir/);
    expect(() => parseSettingsEnvelope({ type: "settings", requestId: "s", op: "plugin-scaffold", name: "x", template: "nope" })).toThrow(/template 非法/);
  });
});
