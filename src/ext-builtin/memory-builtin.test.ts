/** T7-2 内建记忆 provider 测试：行为零变化（等价测试）+ 单外部约束。 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  appendMemoryFact,
  createBuiltinMemoryProvider,
  primeBuiltinMemoryBlock,
  cachedBlock,
} from "./memory-builtin.js";
import { MemoryProviderRegistry } from "../core/index.js";

describe("W4/T7-2 内建记忆 provider（MEMORY.md 追加实现搬迁——行为零变化）", () => {
  it("appendMemoryFact：日期行追加语义与 save-memory 一致（文件不存在则建含标题）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-mem-"));
    const memoryPath = path.join(dir, "memory", "MEMORY.md");
    await appendMemoryFact(memoryPath, "  多   空格  折叠  ", () => new Date("2026-10-10T00:00:00Z"));
    const text = readFileSync(memoryPath, "utf8");
    expect(text).toContain("# 持久记忆");
    expect(text).toContain("- [2026-10-10] 多 空格 折叠");
  });

  it("provider 面：tools 贡献 save_memory + systemPromptBlock 独立段（G6）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-mem-"));
    const memoryPath = path.join(dir, "MEMORY.md");
    writeFileSync(memoryPath, "# 持久记忆\n\n- [2026-10-09] 既有记忆\n");
    const provider = createBuiltinMemoryProvider({ memoryPath });
    await provider.initialize?.();
    await primeBuiltinMemoryBlock(memoryPath);
    expect(provider.tools?.().map((t) => t.name)).toEqual(["save_memory"]);
    expect(cachedBlock.value).toContain("## 持久记忆");
    expect(cachedBlock.value).toContain("- [2026-10-09] 既有记忆");
    await provider.shutdown();
  });

  it("单外部约束：external 二次注册 fail-closed；builtin 同理", () => {
    const registry = new MemoryProviderRegistry();
    const p = createBuiltinMemoryProvider({});
    registry.register("builtin", p);
    expect(() => registry.register("builtin", p)).toThrow(/builtin 已在位/);
    registry.register("external", p);
    expect(() => registry.register("external", p)).toThrow(/单外部约束/);
  });

  it("systemPromptBlock：external 覆盖 builtin（外部 provider 优先）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-mem-"));
    const registry = new MemoryProviderRegistry();
    registry.register("builtin", createBuiltinMemoryProvider({ memoryPath: path.join(dir, "MEMORY.md") }));
    await primeBuiltinMemoryBlock(path.join(dir, "MEMORY.md"));
    registry.register("external", {
      initialize: async () => {},
      systemPromptBlock: () => "## 外部记忆段",
      shutdown: async () => {},
    });
    expect(registry.systemPromptBlock()).toBe("## 外部记忆段");
  });
});
