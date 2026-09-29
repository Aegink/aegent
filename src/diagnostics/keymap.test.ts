/**
 * 快捷键注册表测试（U25/T-P3-128）——combo 规范化 / 覆盖合并往返 /
 * 冲突检测（注册表内 + 浏览器保留键）/ 事件分发（输入态语义）。
 * ui/keymap.js 是纯逻辑模块（无 DOM）——直接 import 直测。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_KEYMAP,
  RESERVED_COMBOS,
  createKeymap,
  detectConflict,
  eventToCombo,
  formatCombo,
  resolveAction,
} from "../../ui/keymap.js";
import { parseSettingsShape, defaultSettings } from "../session/settings.js";

/** KeyboardEvent 假件（注册表纯逻辑只读 ctrl/alt/shift/meta/key）。 */
function fakeKey(key: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) {
  return { key, ctrlKey: mods.ctrl === true, altKey: mods.alt === true, shiftKey: mods.shift === true, metaKey: mods.meta === true };
}

describe("combo 规范化", () => {
  it("修饰键顺序固定 Ctrl<Alt<Shift<Meta；字母大写", () => {
    expect(eventToCombo(fakeKey("f", { ctrl: true }))).toBe("Ctrl+F");
    expect(eventToCombo(fakeKey("f", { shift: true, ctrl: true }))).toBe("Ctrl+Shift+F");
    expect(eventToCombo(fakeKey("F", { ctrl: true }))).toBe("Ctrl+F"); // 大小写归一
    expect(eventToCombo(fakeKey(",", { ctrl: true }))).toBe("Ctrl+,");
    expect(eventToCombo(fakeKey("Escape"))).toBe("Escape");
    expect(eventToCombo(fakeKey("F1"))).toBe("F1");
  });

  it("纯修饰键返回 null（不构成绑定）；formatCombo 乱序归一", () => {
    expect(eventToCombo(fakeKey("Control", { ctrl: true }))).toBeNull();
    expect(formatCombo(["shift", "ctrl", "F"])).toBe("Ctrl+Shift+F");
    expect(formatCombo(["F"])).toBe("F");
  });
});

describe("createKeymap（覆盖合并往返）", () => {
  it("无覆盖 = 默认键位；部分覆盖语义（未列 action 用默认）", () => {
    expect(createKeymap(null)).toEqual(DEFAULT_KEYMAP);
    const merged = createKeymap({ find: "Ctrl+K", settings: "Ctrl+0" });
    expect(merged.find).toBe("Ctrl+K");
    expect(merged.settings).toBe("Ctrl+0");
    expect(merged.search).toBe(DEFAULT_KEYMAP.search); // 未覆盖保留
  });

  it("非法覆盖值忽略（非字符串/空串/未知 action）——坏档不炸键位面", () => {
    const merged = createKeymap({ find: "", usage: 7 as unknown as string, ghost: "Ctrl+1" });
    expect(merged.find).toBe(DEFAULT_KEYMAP.find);
    expect(merged.usage).toBe(DEFAULT_KEYMAP.usage);
    expect("ghost" in merged).toBe(false);
  });
});

describe("detectConflict（冲突提示）", () => {
  it("注册表内冲突：同 combo 命中其他 action（自身排除）", () => {
    const bindings = { ...DEFAULT_KEYMAP, find: "Ctrl+K", usage: "Ctrl+K" };
    expect(detectConflict("Ctrl+K", bindings, "find").conflict).toBe("usage");
    expect(detectConflict("Ctrl+K", bindings, "usage").conflict).toBe("find");
    // 非冲突方视角同样看到冲突（find/usage 都绑着 Ctrl+K）
    expect(detectConflict("Ctrl+K", bindings, "work").conflict).toBeDefined();
  });

  it("浏览器保留键：提示（reserved:true）不拦截", () => {
    expect(detectConflict("Ctrl+T", { ...DEFAULT_KEYMAP }, "find").reserved).toBe(true);
    expect(RESERVED_COMBOS.has("Ctrl+W")).toBe(true);
    expect(detectConflict("Ctrl+K", { ...DEFAULT_KEYMAP }, "find")).toEqual({});
  });
});

describe("settings shortcuts 段（parseSettingsShape——U25 持久化面）", () => {
  it("action→组合键往返 + 非法值宽容忽略 + 全空归一缺省", () => {
    const s = parseSettingsShape({ shortcuts: { find: "Ctrl+K", usage: "Ctrl+Alt+U" } });
    expect(s.shortcuts).toEqual({ find: "Ctrl+K", usage: "Ctrl+Alt+U" });
    expect(parseSettingsShape(JSON.parse(JSON.stringify(s))).shortcuts).toEqual(s.shortcuts);
    const lax = parseSettingsShape({ shortcuts: { find: "", usage: 7, work: "Ctrl+J" } });
    expect(lax.shortcuts).toEqual({ work: "Ctrl+J" });
    expect(parseSettingsShape({ shortcuts: { find: "" } }).shortcuts).toBeUndefined();
    expect(() => parseSettingsShape({ shortcuts: "x" })).toThrow(/shortcuts 须为对象/);
    expect(defaultSettings().shortcuts).toBeUndefined();
  });
});

describe("resolveAction（分发语义）", () => {
  it("命中返回 action；未命中 null；输入区带修饰键仍分发（既有 Ctrl+F 行为）", () => {
    const bindings = createKeymap(null);
    expect(resolveAction(bindings, fakeKey("f", { ctrl: true }))).toBe("find");
    expect(resolveAction(bindings, fakeKey("f", { ctrl: true, shift: true }))).toBe("search");
    expect(resolveAction(bindings, fakeKey("f"))).toBeNull();
    // 输入区：带修饰键的组合照常分发（打字中可搜索——既有行为保持）
    expect(resolveAction(bindings, fakeKey("f", { ctrl: true }), { inInput: true })).toBe("find");
    // 输入区：裸键不分发（还给编辑）；Escape 例外（关搜索条）
    expect(resolveAction(bindings, fakeKey("Escape"), { inInput: true })).toBe("close-find");
    expect(resolveAction(bindings, fakeKey("a"), { inInput: true })).toBeNull();
  });
});
