import { describe, expect, it } from "vitest";
import {
  SessionConfigStore,
  StaticConfigImmutableError,
  REFRESHABLE_CONFIG_KEYS,
  PERMISSION_PRESETS,
  UnknownPresetError,
} from "./session-config.js";

describe("SessionConfigStore —— B21 配置两类", () => {
  it("白名单键热刷新生效：refresh 后 getter 读到新值（下一观测可见）", () => {
    const store = new SessionConfigStore("s1", { approvalTimeoutMs: 120_000, queueMaxSize: 64 });
    const { applied } = store.refresh({ approvalTimeoutMs: 5_000, queueMaxSize: 8 });
    expect(applied).toEqual(["approvalTimeoutMs", "queueMaxSize"]);
    expect(store.approvalTimeoutMs).toBe(5_000);
    expect(store.queueMaxSize).toBe(8);
  });

  it("静态设置出现在刷新载荷 → 类型化拒绝（STATIC_CONFIG_IMMUTABLE）且整包零应用", () => {
    const store = new SessionConfigStore("s1", { approvalTimeoutMs: 120_000 });
    // model 是会话内静态设置（codex 刷新用例同款断言对象）
    expect(() =>
      store.refresh({ model: "gpt-5.4", approvalTimeoutMs: 1_000 }),
    ).toThrow(StaticConfigImmutableError);
    // 整包拒绝：合法键也没被应用
    expect(store.approvalTimeoutMs).toBe(120_000);
    // 纯静态载荷同样拒绝
    expect(() => store.refresh({ permissions: [] })).toThrow(StaticConfigImmutableError);
    try {
      store.refresh({ identity: { provider: "x", modelId: "y" } });
    } catch (e) {
      expect((e as StaticConfigImmutableError).code).toBe("STATIC_CONFIG_IMMUTABLE");
      expect((e as StaticConfigImmutableError).key).toBe("identity");
    }
  });

  it("白名单键的值类型非法 → 拒绝（fail-closed 不静默钳）", () => {
    const store = new SessionConfigStore("s1");
    expect(() => store.refresh({ approvalTimeoutMs: 0 })).toThrow(StaticConfigImmutableError);
    expect(() => store.refresh({ approvalTimeoutMs: -1 })).toThrow(StaticConfigImmutableError);
    expect(() => store.refresh({ queueMaxSize: 1.5 })).toThrow(StaticConfigImmutableError);
    expect(() => store.refresh({ queueMaxSize: "64" })).toThrow(StaticConfigImmutableError);
  });

  it("白名单闭集冻结只追加；未刷新路径 getter 返回装配初始值（零行为变化）", () => {
    // T-P1-73：sandboxMode 追加入白名单（C8 观测面 knob——只追加的预期演进）
    // T-P1-77：unattended 追加入白名单（C33 无人值守开关）
    expect(REFRESHABLE_CONFIG_KEYS).toEqual([
      "approvalTimeoutMs",
      "queueMaxSize",
      "sandboxMode",
      "unattended",
    ]);
    const store = new SessionConfigStore("s1");
    expect(store.approvalTimeoutMs).toBeUndefined();
    expect(store.queueMaxSize).toBeUndefined();
    expect(store.unattended).toBeUndefined();
  });

  it("C33 · unattended knob（T-P1-77）：布尔值生效；非布尔类型化拒绝（零写入）", () => {
    const store = new SessionConfigStore("s1");
    const { applied } = store.refresh({ unattended: true });
    expect(applied).toEqual(["unattended"]);
    expect(store.unattended).toBe(true);
    expect(store.refresh({ unattended: false }).applied).toEqual(["unattended"]);
    expect(store.unattended).toBe(false);
    expect(() => store.refresh({ unattended: "on" })).toThrow(StaticConfigImmutableError);
    expect(() => store.refresh({ unattended: 1 })).toThrow(StaticConfigImmutableError);
    expect(store.unattended).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C8 权限预设成套切换（T-P1-73）：预设 = 命名记录，切换 = 经既有 refresh
// 通道逐 knob 写入（不新增第二来源）。
// ---------------------------------------------------------------------------

describe("C8 · 权限预设成套切换（T-P1-73）", () => {
  it("验收①：三预设各自成套生效（getter 断言）", () => {
    for (const [name, preset] of Object.entries(PERMISSION_PRESETS)) {
      const store = new SessionConfigStore("s1");
      const { applied } = store.applyPreset(name);
      expect(applied).toEqual(["sandboxMode"]);
      expect(store.sandboxMode).toBe(preset.values.sandboxMode);
    }
    // 连续切换：后一预设成套覆盖前一预设
    const store = new SessionConfigStore("s1");
    store.applyPreset("yolo");
    expect(store.sandboxMode).toBe("danger-full-access");
    store.applyPreset("readonly");
    expect(store.sandboxMode).toBe("read-only");
  });

  it("验收②：未知预设名类型化拒绝（UNKNOWN_PRESET，零写入）", () => {
    const store = new SessionConfigStore("s1", { approvalTimeoutMs: 120_000 });
    expect(() => store.applyPreset("ghost")).toThrow(UnknownPresetError);
    try {
      store.applyPreset("ghost");
    } catch (e) {
      expect((e as UnknownPresetError).code).toBe("UNKNOWN_PRESET");
      expect((e as UnknownPresetError).preset).toBe("ghost");
    }
    // 零写入：既有值不动
    expect(store.approvalTimeoutMs).toBe(120_000);
    expect(store.sandboxMode).toBeUndefined();
  });

  it("验收③：切换是 refresh 语义——静态键不入预设载荷；refresh 直发 sandboxMode 同语义", () => {
    const store = new SessionConfigStore("s1");
    // 预设载荷全部是白名单键（经 refresh 通道零拒绝）
    for (const preset of Object.values(PERMISSION_PRESETS)) {
      for (const key of Object.keys(preset.values)) {
        expect((REFRESHABLE_CONFIG_KEYS as readonly string[]).includes(key)).toBe(true);
      }
    }
    // refresh 通道直发 sandboxMode 同样生效（CLI /preset 走的就是这条路）
    const { applied } = store.refresh({ sandboxMode: "workspace-write" });
    expect(applied).toEqual(["sandboxMode"]);
    expect(store.sandboxMode).toBe("workspace-write");
    // 非法值拒绝（闭集外）
    expect(() => store.refresh({ sandboxMode: "off" })).toThrow(StaticConfigImmutableError);
  });

  it("切换经 onInfo 留痕（预设事件保留用户意图）", () => {
    const infos: string[] = [];
    const store = new SessionConfigStore("s1", undefined, { onInfo: (m) => infos.push(m) });
    store.applyPreset("workspace");
    expect(infos).toHaveLength(1);
    expect(infos[0]).toContain("workspace");
    expect(infos[0]).toContain("s1");
  });
});
