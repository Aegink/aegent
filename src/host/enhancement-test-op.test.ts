import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enhancementTestOp } from "./settings-provider-ops.js";
import type { CredentialStore } from "../session/credentials.js";
import type { SettingsShape } from "../session/settings.js";

function baseSettings(enhancement: SettingsShape["enhancement"], providerEnabled = true): SettingsShape {
  return {
    version: 1,
    providers: [
      {
        name: "main",
        adapter: "openai",
        baseUrl: "https://unit.invalid/v1",
        model: "gpt-main",
        ...(providerEnabled ? {} : { enabled: false }),
      },
    ],
    defaultProvider: "main",
    defaultModel: "gpt-main",
    permission: {},
    sandbox: {},
    appearance: { theme: "dark", language: "zh-CN" },
    logging: {},
    projects: [],
    prompts: [],
    mcp: [],
    profiles: [],
    ...(enhancement !== undefined ? { enhancement } : {}),
  };
}

const fakeCreds = (key?: string): CredentialStore =>
  ({
    getKey: async () => key,
  }) as unknown as CredentialStore;

describe("辅助任务真实测试（T-P3-147 D）", () => {
  it("总闸关闭 = GATE_CLOSED 类型化回执", async () => {
    const r = await enhancementTestOp(fakeCreds("k"), baseSettings({ enabled: false }), "judge");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("GATE_CLOSED");
  });

  it("未配置任何显式模型 = NOT_CONFIGURED（诚实回退说明）", async () => {
    const r = await enhancementTestOp(fakeCreds("k"), baseSettings(undefined), "polish");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_CONFIGURED");
  });

  it("命中链：fastModel 兜底命中（显式缺省时）——不可达端点回执携带 resolved", async () => {
    const r = await enhancementTestOp(
      fakeCreds("k"),
      baseSettings({ fastModel: { provider: "main", model: "gpt-fast" } }),
      "title",
    );
    expect(r.resolved).toEqual({ provider: "main", modelId: "gpt-fast" });
    // unit.invalid 不可达——网络错误如实落 ok:false（不虚构成功）
    expect(r.ok).toBe(false);
  });

  it("停用条目不命中（跳过继续链）", async () => {
    const r = await enhancementTestOp(
      fakeCreds("k"),
      baseSettings({ judge: { provider: "main" } }, false),
      "judge",
    );
    // main 停用 → 链空 → NOT_CONFIGURED（不虚构）
    expect(r.code).toBe("NOT_CONFIGURED");
  });

  it("凭据缺失 = 类型化失败", async () => {
    const r = await enhancementTestOp(
      fakeCreds(undefined),
      baseSettings({ fastModel: { provider: "main", model: "gpt-fast" } }),
      "fastModel",
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("未设置 API key");
  });
});
