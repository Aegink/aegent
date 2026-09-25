import { describe, expect, it } from "vitest";

import type { ToolCallPayload } from "../kernel/loop.js";
import { makeLoop, ScriptedProvider } from "../kernel/loop.test-utils.js";
import { assemblePolicyChain, type PolicyCall } from "./chain.js";
import {
  BUILTIN_DANGEROUS_PATTERNS,
  createDangerousCommandModule,
  findDangerousCommand,
} from "./dangerous-commands.js";
import { DenyPermissionBroker } from "./broker.js";
import { createToolGateLayer } from "./gate.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleMatch, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";

/** gate 集成用规则模块（首匹配 + 委托）。 */
function rulesForGate(entries: ReadonlyArray<readonly ["allow" | "ask" | "deny", string]>) {
  const rules = loadRules(
    entries.map(([action, raw]) => ({ raw, action })),
    builtinRuleMatchers,
  );
  return createRuleSetModule({
    name: "user-rules",
    rules,
    match: loadedRuleMatch(builtinRuleMatchers),
    ruleText: (rule) => rule.raw,
  });
}

const bashCall = (command: string): PolicyCall => ({
  tool: "bash",
  args: { command },
  sessionId: "s1",
  source: "model",
});
const module = () => createDangerousCommandModule();

describe("C10 · 三组起步模式", () => {
  it("rm -rf /x、sudo x、chmod 777 x 各升 ask，理由带模式名", async () => {
    const cases = [
      { command: "rm -rf /x", name: "recursive-delete" },
      { command: "sudo x", name: "sudo" },
      { command: "chmod 777 x", name: "privilege-777" },
    ];
    for (const { command, name } of cases) {
      const outcome = await module().evaluate(bashCall(command));
      expect(outcome).toBeDefined();
      expect(outcome!.action).toBe("ask");
      expect(outcome!.reason).toContain(name);
    }
  });

  it("大小写不敏感（pi /i 同款）", async () => {
    expect((await module().evaluate(bashCall("RM -RF /x")))!.action).toBe("ask");
    expect((await module().evaluate(bashCall("Sudo apt install x")))!.action).toBe("ask");
  });

  it("ls 不命中；rm -r 的合法变体按模式界定", async () => {
    expect(await module().evaluate(bashCall("ls"))).toBeUndefined();
    expect(await module().evaluate(bashCall("git status"))).toBeUndefined();
    // 模式只认 -rf/-r/--recursive 的递归删除形状（pi 原样），普通 rm 不命中
    expect(await module().evaluate(bashCall("rm notes.txt"))).toBeUndefined();
  });

  it("非 bash 工具不扫（写路径等价物随 T-5-14 虚拟操作接入）", async () => {
    expect(
      await module().evaluate({ tool: "write", args: { path: "/x" } }),
    ).toBeUndefined();
  });
});

describe("C10 · 清单可追加（新增模式只注册不改内核）", () => {
  it("内置清单三组起步且冻结（C36 只追加不替换）", () => {
    expect(BUILTIN_DANGEROUS_PATTERNS.map((p) => p.name)).toEqual([
      "recursive-delete",
      "sudo",
      "privilege-777",
    ]);
    expect(Object.isFrozen(BUILTIN_DANGEROUS_PATTERNS)).toBe(true);
  });

  it("装配处追加自定义模式即生效；findDangerousCommand 直查", async () => {
    const extended = createDangerousCommandModule({
      patterns: [
        ...BUILTIN_DANGEROUS_PATTERNS,
        { name: "fork-bomb", pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
      ],
    });
    await expect(extended.evaluate(bashCall("ls"))).resolves.toBeUndefined();
    const hit = findDangerousCommand(":(){ :|:& };:", [
      ...BUILTIN_DANGEROUS_PATTERNS,
      { name: "fork-bomb", pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
    ]);
    expect(hit?.name).toBe("fork-bomb");
  });
});

describe("C10 · 接入 gate（T-5-12 链层）", () => {
  function makeGateLoop() {
    const provider = new ScriptedProvider();
    const gate = createToolGateLayer({
      chain: assemblePolicyChain({
        user: [rulesForGate([["allow", "bash(ls)"]])],
        core: [createDangerousCommandModule()],
      }),
      broker: new DenyPermissionBroker(),
      sessionId: "s1",
    });
    let executed = 0;
    const { loop, store } = makeLoop(provider, {
      layers: { toolCall: [gate] },
      executeTool: async () => {
        executed += 1;
        return { content: "ran" };
      },
    });
    const mountBash = (id: string, command: string) => {
      provider.mount([
        {
          type: "tool-call-delta",
          id,
          name: "bash",
          argsDelta: JSON.stringify({ command }),
        },
        { type: "done" },
      ]);
      provider.mount([{ type: "text-delta", text: "ok" }, { type: "done" }]);
    };
    return { loop, store, executed: () => executed, mountBash };
  }

  it("rm -rf 走 ask → 缺省 Deny broker 拒绝：工具零执行、tool/result isError", async () => {
    const h = makeGateLoop();
    h.mountBash("c1", "rm -rf /x");
    await h.loop.runTurn("清理");
    expect(h.executed()).toBe(0);
    const events = h.store.load("s1");
    const result = events.find((e) => e.type === "tool/result") as unknown as {
      message: { isError?: boolean; content: string };
    };
    expect(result.message.isError).toBe(true);
    expect(result.message.content).toContain("recursive-delete");
  });

  it("ls 正常执行（危险库不误伤）", async () => {
    const h = makeGateLoop();
    h.mountBash("c1", "ls");
    await h.loop.runTurn("看目录");
    expect(h.executed()).toBe(1);
    const events = h.store.load("s1");
    const result = events.find((e) => e.type === "tool/result") as unknown as {
      message: { content: string };
    };
    expect(result.message.content).toBe("ran");
  });
});
