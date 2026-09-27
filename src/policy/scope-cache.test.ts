/**
 * C47/C34 批准缓存测试（T-P1-69 新建）——ApprovalScopeCache 基本面回归
 * + trustGated 标记门控（未信任不生效、信任后恢复、非 trustGated 照常）
 * + createSessionApprovalModule 的 trustState 活查询联动。
 */
import { describe, expect, it } from "vitest";

import { builtinRuleMatchers } from "./matchers.js";
import type { PolicyModule } from "./chain.js";
import {
  ApprovalScopeCache,
  createSessionApprovalModule,
} from "./review-decision.js";
import type { PolicyCall } from "./chain.js";

describe("C47 · ApprovalScopeCache 基本面（回归）", () => {
  it("session 批准记入后同会话同规则命中；once 不留痕", () => {
    const cache = new ApprovalScopeCache();
    cache.record("s1", "bash(git *)", "session");
    expect(cache.isApproved("s1", "bash(git *)")).toBe(true);
    expect(cache.isApproved("s1", "bash(other)")).toBe(false);
    expect(cache.isApproved("s2", "bash(git *)")).toBe(false);
    cache.record("s1", "bash(git *)", "once");
    expect(cache.isApproved("s1", "bash(git *)")).toBe(true); // once 不新增
  });
});

describe("C34 · trustGated 批准门控（T-P1-69）", () => {
  it("验收③：trustGated 批准未信任不生效（过滤不记账），信任后恢复", () => {
    const cache = new ApprovalScopeCache();
    cache.record("s1", "bash(npm test)", "session", { trustGated: true });
    // 记录保留在缓存（不移除——恢复信任即还原）
    expect(cache.isApproved("s1", "bash(npm test)", { trusted: true })).toBe(true);
    expect(cache.isApproved("s1", "bash(npm test)", { trusted: false })).toBe(false);
    expect(cache.isApproved("s1", "bash(npm test)", { trusted: true })).toBe(true);
  });

  it("验收④：非 trustGated 用户批准不受信任状态影响", () => {
    const cache = new ApprovalScopeCache();
    cache.record("s1", "bash(git *)", "session");
    expect(cache.isApproved("s1", "bash(git *)", { trusted: false })).toBe(true);
  });

  it("缺省未启用（trusted 缺省）时 trustGated 批准照常命中", () => {
    const cache = new ApprovalScopeCache();
    cache.record("s1", "bash(npm test)", "session", { trustGated: true });
    expect(cache.isApproved("s1", "bash(npm test)")).toBe(true);
  });
});

describe("C34 · session-approval 模块 trustState 活查询联动", () => {
  function moduleWith(trustState?: () => boolean | undefined): PolicyModule {
    const cache = new ApprovalScopeCache();
    cache.record("s1", "bash(npm test)", "session", { trustGated: true });
    return createSessionApprovalModule({
      cache,
      sessionId: "s1",
      matchers: builtinRuleMatchers,
      ...(trustState !== undefined ? { trustState } : {}),
    });
  }

  const call: PolicyCall = { tool: "bash", args: { command: "npm test" } };

  it("未信任时 trustGated 批准不放行（模块弃权）；信任后恢复放行", async () => {
    const trust = { value: false as boolean | undefined };
    const mod = moduleWith(() => trust.value);
    expect(await mod.evaluate(call)).toBeUndefined(); // 未信任 → 弃权
    trust.value = true;
    const verdict = await mod.evaluate(call);
    expect(verdict?.action).toBe("allow"); // 恢复信任即还原（qwen 同款）
  });

  it("缺省未启用零行为变化；非 trustGated 批准在未信任下照常放行", async () => {
    expect(await moduleWith(undefined).evaluate(call)).toMatchObject({ action: "allow" });

    const userCache = new ApprovalScopeCache();
    userCache.record("s1", "bash(npm test)", "session"); // 无 trustGated
    const userMod = createSessionApprovalModule({
      cache: userCache,
      sessionId: "s1",
      matchers: builtinRuleMatchers,
      trustState: () => false,
    });
    expect(await userMod.evaluate(call)).toMatchObject({ action: "allow" });
  });
});
