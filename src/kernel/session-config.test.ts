import { describe, expect, it } from "vitest";
import {
  SessionConfigStore,
  StaticConfigImmutableError,
  REFRESHABLE_CONFIG_KEYS,
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
    expect(REFRESHABLE_CONFIG_KEYS).toEqual(["approvalTimeoutMs", "queueMaxSize"]);
    const store = new SessionConfigStore("s1");
    expect(store.approvalTimeoutMs).toBeUndefined();
    expect(store.queueMaxSize).toBeUndefined();
  });
});
