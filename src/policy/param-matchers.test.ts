/**
 * C40 · 具名参数匹配测试（T-P2-201）——从 rule-loader.test.ts 分出（文件
 * 行数纪律）。链上四用例（精确值/通配/多参数 AND/无 matcher 零变化）+
 * 声明式 paramMatchers 合并 / MCP 拒配 / 空数组归一。
 */
import { describe, expect, it } from "vitest";

import type { PolicyCall } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadRules, loadedRuleMatch } from "./rule-loader.js";

const bashCall = (command: string): PolicyCall => ({
  tool: "bash",
  args: { command },
});

describe("C40 · 具名参数匹配（T-P2-201）", () => {
  it("验收① 精确值：agent(model:opus) 只命中 model=opus 的调用（链上路径）", () => {
    const rules = loadRules(
      [{ raw: "agent(model:opus)", action: "allow" }],
      builtinRuleMatchers,
    );
    expect(rules[0]?.toolParamMatchers).toEqual([
      { key: "model", valuePattern: "opus" },
    ]);
    const match = loadedRuleMatch();
    expect(
      match(rules[0]!, { tool: "agent", args: { model: "opus" } }),
    ).toBe("allow");
    expect(
      match(rules[0]!, { tool: "agent", args: { model: "sonnet" } }),
    ).toBeUndefined();
    // 缺 key 不命中（qwen 同款：缺参 = matcher 失败，不是跳过）
    expect(
      match(rules[0]!, { tool: "agent", args: { role: "coder" } }),
    ).toBeUndefined();
  });

  it("验收② 通配：agent(model:op*) 命中 opus 前缀；number 值按字符串形状匹配", () => {
    const rules = loadRules(
      [{ raw: "agent(model:op*)", action: "ask" }],
      builtinRuleMatchers,
    );
    const match = loadedRuleMatch();
    expect(
      match(rules[0]!, { tool: "agent", args: { model: "opus" } }),
    ).toBe("ask");
    expect(
      match(rules[0]!, { tool: "agent", args: { model: "opus-4" } }),
    ).toBe("ask");
    expect(
      match(rules[0]!, { tool: "agent", args: { model: "sonnet" } }),
    ).toBeUndefined();
    // number 值转字符串后按同一方言匹配（qwen 同款 String(v)）
    expect(match(rules[0]!, { tool: "agent", args: { model: 4 } })).toBeUndefined();
    const numRule = loadRules(
      [{ raw: "agent(depth:3)", action: "deny" }],
      builtinRuleMatchers,
    );
    expect(
      loadedRuleMatch()(numRule[0]!, { tool: "agent", args: { depth: 3 } }),
    ).toBe("deny");
  });

  it("验收③ 多参数 AND：文本 DSL 与声明式 matcher 都按全命中语义", () => {
    // 文本 DSL：三参数全命中
    const text = loadRules(
      [{ raw: "agent(coder,model:opus,type:*)", action: "allow" }],
      builtinRuleMatchers,
    );
    const match = loadedRuleMatch();
    expect(
      match(text[0]!, {
        tool: "agent",
        args: { role: "coder", model: "opus", type: "fast" },
      }),
    ).toBe("allow");
    expect(
      match(text[0]!, {
        tool: "agent",
        args: { role: "coder", model: "opus" },
      }),
    ).toBeUndefined();

    // 声明式（C40 新面）：command 分型的 specifier 与参数 matcher AND
    const declared = loadRules(
      [
        {
          raw: "bash(git *)",
          action: "allow",
          paramMatchers: [{ key: "dry_run", valuePattern: "true" }],
        },
      ],
      builtinRuleMatchers,
    );
    expect(declared[0]?.toolParamMatchers).toEqual([
      { key: "dry_run", valuePattern: "true" },
    ]);
    expect(
      match(declared[0]!, {
        tool: "bash",
        args: { command: "git push", dry_run: "true" },
      }),
    ).toBe("allow");
    // 缺参数（key 不存在）→ matcher 失败
    expect(
      match(declared[0]!, { tool: "bash", args: { command: "git push" } }),
    ).toBeUndefined();
    // specifier 不命中（非 git 命令）→ 即使参数命中也不放行
    expect(
      match(declared[0]!, {
        tool: "bash",
        args: { command: "rm -rf /", dry_run: "true" },
      }),
    ).toBeUndefined();

    // 声明式 × path 分型同构
    const pathRule = loadRules(
      [
        {
          raw: "edit(*.ts)",
          action: "ask",
          paramMatchers: [{ key: "create", valuePattern: "false" }],
        },
      ],
      builtinRuleMatchers,
    );
    expect(
      match(pathRule[0]!, {
        tool: "edit",
        args: { path: "/a/b.ts", create: "false" },
      }),
    ).toBe("ask");
    expect(
      match(pathRule[0]!, {
        tool: "edit",
        args: { path: "/a/b.ts", create: "true" },
      }),
    ).toBeUndefined();
  });

  it("验收④ 无 matcher 零变化：裸规则与纯 specifier 规则行为照旧", () => {
    const rules = loadRules(
      [
        { raw: "agent", action: "deny" },
        { raw: "agent(coder)", action: "allow" },
        { raw: "bash(git status)", action: "ask" },
      ],
      builtinRuleMatchers,
    );
    const match = loadedRuleMatch();
    // 裸规则匹配任意参数形状（含带 model 等 key 的调用）
    expect(
      match(rules[0]!, { tool: "agent", args: { model: "opus", x: 1 } }),
    ).toBe("deny");
    // positional specifier 精确语义不变
    expect(
      match(rules[1]!, { tool: "agent", args: { role: "coder" } }),
    ).toBe("allow");
    // command 分型通配不变
    expect(match(rules[2]!, bashCall("git status"))).toBe("ask");
    expect(match(rules[2]!, bashCall("git push"))).toBeUndefined();
  });

  it("声明式 matcher 与解析产物合并为单一 toolParamMatchers（AND）", () => {
    const rules = loadRules(
      [
        {
          raw: "agent(coder,model:op*)",
          action: "allow",
          paramMatchers: [{ key: "depth", valuePattern: "?" }],
        },
      ],
      builtinRuleMatchers,
    );
    expect(rules[0]?.toolParamMatchers).toEqual([
      { key: "model", valuePattern: "op*" }, // 解析产物在前
      { key: "depth", valuePattern: "?" }, // 声明式在后
    ]);
    const match = loadedRuleMatch();
    expect(
      match(rules[0]!, {
        tool: "agent",
        args: { role: "coder", model: "opus", depth: 3 },
      }),
    ).toBe("allow");
    expect(
      match(rules[0]!, {
        tool: "agent",
        args: { role: "coder", model: "opus", depth: "deep" },
      }),
    ).toBeUndefined();
  });

  it("MCP 命名空间规则带声明式 matcher 同样拒配（fail-closed 不静默放行）", () => {
    const rules = loadRules(
      [
        {
          raw: "srv__tool",
          action: "allow",
          paramMatchers: [{ key: "q", valuePattern: "*" }],
        },
      ],
      builtinRuleMatchers,
    );
    expect(
      loadedRuleMatch()(rules[0]!, { tool: "srv__tool", args: { q: "x" } }),
    ).toBeUndefined();
  });

  it("空声明式数组归一为无 matcher（bare 规则不因 [] 变成 never-match）", () => {
    const rules = loadRules(
      [{ raw: "agent", action: "deny", paramMatchers: [] }],
      builtinRuleMatchers,
    );
    expect(rules[0]?.toolParamMatchers).toBeUndefined();
    expect(
      loadedRuleMatch()(rules[0]!, { tool: "agent", args: { any: 1 } }),
    ).toBe("deny");
  });
});
