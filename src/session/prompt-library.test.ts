// U16/T-P3-118：提示词模板库纯函数（CRUD + 变量占位）+ settings 段隔离往返。
import { describe, expect, it } from "vitest";
import {
  PromptLibraryError,
  deletePrompt,
  extractTemplateVars,
  renderTemplate,
  upsertPrompt,
} from "./prompt-library.js";
import { defaultSettings, parseSettingsShape } from "./settings.js";

describe("prompt-library CRUD", () => {
  it("upsert：新名追加队尾、同名原位替换保序", () => {
    let lib = upsertPrompt([], { name: "review", content: "请评审 {{file}}" });
    lib = upsertPrompt(lib, { name: "test", content: "写测试", description: "单测" });
    expect(lib.map((p) => p.name)).toEqual(["review", "test"]);
    lib = upsertPrompt(lib, { name: "review", content: "评审目标：{{file}}（{{lang}}）" });
    expect(lib.map((p) => p.name)).toEqual(["review", "test"]);
    expect(lib[0]?.content).toBe("评审目标：{{file}}（{{lang}}）");
  });

  it("delete：按名删除、幂等不炸", () => {
    const lib = upsertPrompt(upsertPrompt([], { name: "a", content: "x" }), { name: "b", content: "y" });
    expect(deletePrompt(lib, "a").map((p) => p.name)).toEqual(["b"]);
    expect(deletePrompt(lib, "missing").map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("坏条目类型化拒绝：空名与空白正文", () => {
    expect(() => upsertPrompt([], { name: "  ", content: "x" })).toThrow(PromptLibraryError);
    expect(() => upsertPrompt([], { name: "ok", content: "" })).toThrow(PromptLibraryError);
  });
});

describe("模板变量（{{var}} 单一约定）", () => {
  it("extractTemplateVars：去重保序、空白占位不算变量", () => {
    expect(extractTemplateVars("评审 {{file}} 与 {{lang}}，同文件 {{ file }} 再提 {{file}}")).toEqual([
      "file",
      "lang",
    ]);
    expect(extractTemplateVars("{{}} 与 {{  }} 与 {{a b}} 都不是合法变量")).toEqual([]);
    expect(extractTemplateVars("无变量模板")).toEqual([]);
  });

  it("renderTemplate：命中替换、缺变量保留原文", () => {
    expect(renderTemplate("把 {{file}} 改成 {{lang}} 风格", { file: "a.ts", lang: "TS" })).toBe(
      "把 a.ts 改成 TS 风格",
    );
    expect(renderTemplate("把 {{file}} 改成 {{lang}} 风格", { file: "a.ts" })).toBe(
      "把 a.ts 改成 {{lang}} 风格",
    );
  });
});

describe("settings 同域存储（prompts 段）", () => {
  it("parseSettingsShape：形状校验 fail-closed（缺字段/重名/非数组）", () => {
    expect(() =>
      parseSettingsShape({ version: 1, providers: [], prompts: [{ name: "a", content: "x" }] }),
    ).not.toThrow();
    expect(() => parseSettingsShape({ version: 1, providers: [], prompts: "no" })).toThrow(/prompts 须为数组/);
    expect(() => parseSettingsShape({ version: 1, providers: [], prompts: [{ name: "a" }] })).toThrow(
      /prompts\[\].content 缺失/,
    );
    expect(() =>
      parseSettingsShape({
        version: 1,
        providers: [],
        prompts: [
          { name: "a", content: "x" },
          { name: "a", content: "y" },
        ],
      }),
    ).toThrow(/模板名重复：a/);
  });

  it("patch prompts 段形状可过 parseSettingsShape（整段替换语义——gateway 隔离断言在 host 侧）", () => {
    const base = defaultSettings();
    base.providers = [{ name: "main", adapter: "openai", baseUrl: "http://x", model: "m" }];
    base.appearance = { theme: "light", language: "en" };
    const patched = parseSettingsShape({
      ...base,
      prompts: [{ name: "review", content: "评审 {{file}}" }],
    });
    expect(patched.prompts).toEqual([{ name: "review", content: "评审 {{file}}" }]);
    // 其他段零变化（隔离——段级替换不触碰）
    expect(patched.providers).toEqual(base.providers);
    expect(patched.appearance).toEqual(base.appearance);
  });
});
