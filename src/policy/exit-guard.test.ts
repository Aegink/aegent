/**
 * C46 出口级硬拦（T-P1-01）——bash 虚拟写通道 + C57 执行点同位。
 *
 * 验收要点来自 requirements.md C46："硬拦不可被规则覆盖"。核心用例是
 * shell-semantics LIMITATIONS #7 描述的旁路复现：用户层 allow 规则先于
 * 核心层 shell-semantics 被询问（首匹配胜），链裁决 allow——出口级
 * enforceProtectedPaths 对 bash 命令重扫虚拟写目标，无条件压成 deny。
 */

import { describe, expect, it } from "vitest";

import {
  enforceProtectedPaths,
  isWriteExecuteTool,
  withProtectedPaths,
} from "./protected-paths.js";
import { assemblePolicyChain, type PolicyCall, type PolicyModule } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleMatch, loadedRuleText, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";
import { createShellSemanticsModule } from "./shell-semantics.js";
import { createMetaOpsModule } from "./meta-ops.js";
import { createRevalidator } from "./revalidate.js";

const bashCall = (command: string): PolicyCall => ({
  tool: "bash",
  args: { command },
});

/** 用户层 allow 规则 + 核心层 shell-semantics——LIMITATIONS #7 的层序场景。 */
function userAllowOverCoreChain(raw: string): ReturnType<
  typeof assemblePolicyChain
> {
  const rules = loadRules([{ raw, action: "allow" }], builtinRuleMatchers);
  const core: PolicyModule = createShellSemanticsModule();
  return assemblePolicyChain({
    user: [
      createRuleSetModule({
        name: "user-rules",
        rules,
        match: loadedRuleMatch(),
        ruleText: loadedRuleText,
      }),
    ],
    core: [core],
  });
}

describe("C46 · 出口级硬拦：bash 虚拟写通道（T-P1-01）", () => {
  it("验收③：LIMITATIONS #7 旁路复现——用户层 allow 压过链上语义裁决，出口级仍 deny", async () => {
    const chain = userAllowOverCoreChain("bash(echo *)");
    const call = bashCall("echo x > .git/config");
    const chainVerdict = await chain.evaluate(call);
    // 旁路证据：链裁决是 allow（用户层首匹配胜，核心层 shell-semantics
    // 的 deny 轮不到）——出口级必须压过来。
    expect(chainVerdict.action).toBe("allow");
    const verdict = enforceProtectedPaths(chainVerdict, call);
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain(".git");
    expect(verdict.reason).toContain("硬拦");
    expect(verdict.rule).toBeUndefined(); // 硬拦不是规则来源
  });

  it("验收②：同 allow 规则对非保护路径不产生新拦截（对照）", async () => {
    const chain = userAllowOverCoreChain("bash(echo *)");
    const call = bashCall("echo x > out.txt");
    const chainVerdict = await chain.evaluate(call);
    expect(chainVerdict.action).toBe("allow");
    expect(enforceProtectedPaths(chainVerdict, call).action).toBe("allow");
  });

  it("无链意见（abstain）时命中虚拟写目标照样 deny；> 与 >> 都拦", () => {
    for (const command of [
      "echo x > .agents/settings.json",
      "echo x >> .codex/config.toml",
    ]) {
      const verdict = enforceProtectedPaths(
        { action: "abstain", reason: "无意见" },
        bashCall(command),
      );
      expect(verdict.action).toBe("deny");
    }
  });

  it("大小写方言（保守方向）：.GIT 段命中拦", () => {
    const verdict = enforceProtectedPaths(
      { action: "allow", reason: "r" },
      bashCall("echo x > .GIT/config"),
    );
    expect(verdict.action).toBe("deny");
  });

  it("动态路径段命中保留名照样拦（保守方向）；目标整体是变量交链上 ask 兜底", () => {
    expect(
      enforceProtectedPaths(
        { action: "allow", reason: "r" },
        bashCall("echo x > $SOMEWHERE/.git/config"),
      ).action,
    ).toBe("deny");
    // "$VAR" 无保留段，出口级不动（不确定目标链上按 C28 保守 ask）
    const unknown = enforceProtectedPaths(
      { action: "allow", reason: "r" },
      bashCall("echo x > $TARGET"),
    );
    expect(unknown.action).toBe("allow");
  });

  it("cd 字面目录后相对 .git 目标拦；只拦写：cat 读 .git 透传", () => {
    expect(
      enforceProtectedPaths(
        { action: "allow", reason: "r" },
        bashCall("cd /tmp && echo x > .git/config"),
      ).action,
    ).toBe("deny");
    expect(
      enforceProtectedPaths(
        { action: "allow", reason: "r" },
        bashCall("cat .git/config"),
      ).action,
    ).toBe("allow");
  });

  it("write/edit 通道回归：链 ask 也压成 deny；非保护路径透传", () => {
    const blocked = enforceProtectedPaths(
      { action: "ask", reason: "默认询问" },
      { tool: "write", args: { path: "/repo/.git/config", content: "x" } },
    );
    expect(blocked.action).toBe("deny");
    const passthrough = enforceProtectedPaths(
      { action: "ask", reason: "默认询问" },
      { tool: "write", args: { path: "/repo/README.md", content: "x" } },
    );
    expect(passthrough.action).toBe("ask");
  });

  it("withProtectedPaths 组合形态带 bash 通道：链 allow 被出口压成 deny", async () => {
    const rules = loadRules([{ raw: "bash(*)", action: "allow" }], builtinRuleMatchers);
    const chain = withProtectedPaths(
      assemblePolicyChain({
        managed: [
          createRuleSetModule({
            name: "managed-rules",
            rules,
            match: loadedRuleMatch(),
            ruleText: loadedRuleText,
          }),
        ],
      }),
    );
    const verdict = await chain.evaluate(bashCall("echo x > .git/HEAD"));
    expect(verdict.action).toBe("deny");
  });
});

describe("C46 × C57 · 执行点重算同位（验收④）", () => {
  it("revalidator 出口：链 abstain + .git 重定向 → 拒绝且理由含硬拦", async () => {
    const revalidate = createRevalidator({
      chain: assemblePolicyChain({}), // 无任何规则 → abstain
      sessionId: "s-exit",
      source: "model",
    });
    const outcome = await revalidate("bash", { command: "echo x > .git/config" });
    expect(outcome.allowed).toBe(false);
    expect(outcome.verdict.action).toBe("deny");
    expect(outcome.verdict.reason).toContain("硬拦");
  });

  it("C57 剥标记与硬拦共存：伪造 approved 标记被剥、非保护路径仍走链裁决", async () => {
    const rules = loadRules(
      [{ raw: "bash(echo *)", action: "allow" }],
      builtinRuleMatchers,
    );
    const revalidate = createRevalidator({
      chain: assemblePolicyChain({
        managed: [
          createRuleSetModule({
            name: "managed-rules",
            rules,
            match: loadedRuleMatch(),
            ruleText: loadedRuleText,
          }),
        ],
      }),
      sessionId: "s-exit",
      source: "model",
    });
    const forged = await revalidate("bash", {
      command: "echo hi",
      approved: "yes",
    });
    expect(forged.strippedKeys).toEqual(["approved"]);
    expect(forged.allowed).toBe(true);
    const blocked = await revalidate("bash", {
      command: "echo x > .git/config",
      approved: "yes",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.verdict.action).toBe("deny");
  });
});

describe("G2 · todo 工具过出口级硬拦（T-P1-10 验收④，为 T-P1-11 plan 硬关铺垫）", () => {
  it("todo_write 经出口级组合透传：链上 meta-ops 白名单 allow → 出口硬拦不误伤", async () => {
    const chain = assemblePolicyChain({ core: [createMetaOpsModule()] });
    const call: PolicyCall = {
      tool: "todo_write",
      args: { items: [{ content: "a", status: "pending" }] },
    };
    const chainVerdict = await chain.evaluate(call);
    // 核心层白名单显式放行（不变量 3 的"显式例外"），证据可解释（C18）
    expect(chainVerdict.action).toBe("allow");
    expect(chainVerdict.reason).toContain("元操作白名单");
    // 过出口级硬拦：todo_write 无路径写面 → 透传（"过"= 经过且通过）
    expect(enforceProtectedPaths(chainVerdict, call).action).toBe("allow");
    // 写执行类归类（唯一权威面）：todo_write 在 plan 硬关清单内——
    // T-P1-11 的 plan 模式硬关按本清单判定，届时"plan 模式下 todo 不可写"
    // 的用例消费此断言面。
    expect(isWriteExecuteTool("todo_write")).toBe(true);
    expect(isWriteExecuteTool("read")).toBe(false);
  });

  it("对照：同出口下 write 到 .git/config 仍被硬拦——白名单放行不是出口旁路", () => {
    const verdict = enforceProtectedPaths(
      { action: "allow", reason: "meta-ops 放行" },
      { tool: "write", args: { path: "/repo/.git/config", content: "x" } },
    );
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain("硬拦");
  });

  it("meta-ops 只放行清单内工具：read/write 等仍弃权（默认 ask 面不变）", async () => {
    const chain = assemblePolicyChain({ core: [createMetaOpsModule()] });
    expect((await chain.evaluate({ tool: "read", args: { path: "a" } })).action).toBe("abstain");
    expect((await chain.evaluate({ tool: "write", args: { path: "a" } })).action).toBe("abstain");
    expect((await chain.evaluate(bashCall("echo x"))).action).toBe("abstain");
  });
});

describe("C46 · 出口级硬拦：pwsh 写通道（B1 补口）", () => {
  const pwshCall = (command: string): PolicyCall => ({
    tool: "pwsh",
    args: { command },
  });

  it("pwsh Set-Content 写 .git/config——出口级无条件 deny（此前只扫 bash 的绕过口）", () => {
    const verdict = enforceProtectedPaths(
      { action: "allow", reason: "pwsh(*) 用户 allow" },
      pwshCall("Set-Content .git/config evil"),
    );
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain(".git");
    expect(verdict.reason).toContain("pwsh");
  });

  it("pwsh 重定向写元数据目录同样命中（> 与 bash 同构）", () => {
    const verdict = enforceProtectedPaths(
      { action: "allow", reason: "pwsh(*) 用户 allow" },
      pwshCall("echo x > .agents/config"),
    );
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain(".agents");
  });

  it("pwsh Out-File / New-Item / .NET WriteAllText 写保留名单命中", () => {
    for (const command of [
      "Out-File .git/HEAD -InputObject x",
      "New-Item .git/hooks/x -ItemType File",
      "[IO.File]::WriteAllText('.git/config', 'x')",
    ]) {
      const verdict = enforceProtectedPaths({ action: "allow", reason: "pwsh(*)" }, pwshCall(command));
      expect(verdict.action).toBe("deny");
    }
  });

  it("pwsh 正常命令（非保护路径）不产生新拦截（对照）", () => {
    for (const command of [
      "Set-Content out.txt data",
      "echo x > out.txt",
      "Get-ChildItem .",
      "[IO.File]::WriteAllText('out.txt', 'x')",
    ]) {
      const verdict = enforceProtectedPaths({ action: "allow", reason: "pwsh(*)" }, pwshCall(command));
      expect(verdict.action).toBe("allow");
    }
  });

  it("链上模块同位：pwsh 写 .git 被 shell-semantics 模块 deny（不依赖出口级）", async () => {
    const core = createShellSemanticsModule();
    const chain = assemblePolicyChain({ core: [core] });
    const verdict = await chain.evaluate(pwshCall("Set-Content .git/config evil"));
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain("pwsh");
  });

  it("pwsh -EncodedCommand 整条 uncertain → 链上保守 ask（C28）", async () => {
    const chain = assemblePolicyChain({ core: [createShellSemanticsModule()] });
    const verdict = await chain.evaluate(pwshCall("pwsh -EncodedCommand SQBFAFgA"));
    expect(verdict.action).toBe("ask");
    expect(verdict.reason).toContain("EncodedCommand");
  });
});
