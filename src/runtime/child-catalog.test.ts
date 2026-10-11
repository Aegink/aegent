/**
 * W18：defaultEntryCatalogWindow——assembly.contextWindow 的目录兜底中段
 * （显式 CLI > 默认条目模型的目录值 > 200K 缺省）。
 */
import { describe, expect, it } from "vitest";
import { defaultEntryCatalogWindow } from "./child.js";
import type { SettingsShape } from "../session/settings.js";

const base = { version: 1 as const, providers: [], permission: {}, sandbox: {}, appearance: { theme: "dark", language: "zh-CN" }, logging: {}, projects: [], prompts: [], mcp: [], profiles: [] };

const settings = (providers: unknown[], extra: Record<string, unknown> = {}): SettingsShape =>
  ({ ...base, ...(providers.length > 0 ? { providers } as never : {}), ...extra }) as never;

describe("defaultEntryCatalogWindow（W18 目录窗口兜底）", () => {
  const provider = {
    name: "my-relay",
    baseUrl: "https://relay.example/v1",
    adapter: "openai",
    models: [{ id: "claude-sonnet-4-5" }], // 无任何元数据——纯 id
  };

  it("默认条目模型命中内置目录 → 目录 contextWindow 兜底", () => {
    expect(defaultEntryCatalogWindow(settings([provider], { defaultProvider: "my-relay" }))).toBe(200_000);
  });

  it("defaultModel 命中 models 内指定模型（不取首模型）", () => {
    const multi = {
      ...provider,
      models: [{ id: "gpt-4o" }, { id: "claude-sonnet-4-5" }],
    };
    expect(
      defaultEntryCatalogWindow(
        settings([multi], { defaultProvider: "my-relay", defaultModel: "claude-sonnet-4-5" }),
      ),
    ).toBe(200_000);
  });

  it("用户显式 contextWindow 优先于目录（兜底只补缺省）", () => {
    const explicit = { ...provider, models: [{ id: "claude-sonnet-4-5", contextWindow: 999_999 }] };
    expect(
      defaultEntryCatalogWindow(settings([explicit], { defaultProvider: "my-relay" })),
    ).toBe(999_999);
  });

  it("未知模型/无默认条目/条目停用 → undefined（回落 200K 缺省由调用方兜）", () => {
    const unknown = { ...provider, models: [{ id: "my-private-model" }] };
    expect(defaultEntryCatalogWindow(settings([unknown], { defaultProvider: "my-relay" }))).toBeUndefined();
    expect(defaultEntryCatalogWindow(settings([provider], {}))).toBeUndefined();
    const disabled = { ...provider, enabled: false };
    expect(defaultEntryCatalogWindow(settings([disabled], { defaultProvider: "my-relay" }))).toBeUndefined();
  });
});
