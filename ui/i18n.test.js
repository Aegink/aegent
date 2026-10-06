// @vitest-environment happy-dom
/**
 * i18n 行为级测试（D 级债务 7 清偿——ui 组件测试群首件）：词典回退、
 * 占位替换、locale 偏好解析、静态 DOM 扫描三属性面。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { applyI18nDom, applyLocalePreference, currentLocale, resolveLocalePreference, t } from "./i18n.js";

beforeEach(() => {
  applyLocalePreference("zh-CN");
});

describe("t() 翻译面", () => {
  it("zh-CN：中文原文即值（恒等）", () => {
    expect(currentLocale()).toBe("zh-CN");
    expect(t("对话")).toBe("对话");
  });

  it("en：词典命中译出，未收录键回退中文原文（渐进覆盖零破坏）", () => {
    applyLocalePreference("en");
    expect(t("对话")).toBe("Chat");
    expect(t("协作发起面尚无词典键（回退原文）")).toBe("协作发起面尚无词典键（回退原文）");
  });

  it("{key} 占位替换（en 词典条目内 + 回退原文内都生效）", () => {
    applyLocalePreference("zh-CN");
    expect(t("已派发 {n} 条", { n: 3 })).toBe("已派发 3 条");
  });
});

describe("locale 偏好解析", () => {
  it("显式值直通 / zh 前缀归一 / navigator 回退", () => {
    expect(resolveLocalePreference("zh-CN")).toBe("zh-CN");
    expect(resolveLocalePreference("en")).toBe("en");
    expect(resolveLocalePreference(undefined)).toBe("en"); // happy-dom navigator 默认 en-US → en
  });

  it("applyLocalePreference 写 document.lang 并返回归一值", () => {
    applyLocalePreference("en");
    expect(currentLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    applyLocalePreference("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});

describe("applyI18nDom：静态 DOM 三属性扫描", () => {
  it("data-i18n 文本 / placeholder / title 各自替换", () => {
    document.body.innerHTML = `
      <button id="a" data-i18n="对话"></button>
      <input id="b" data-i18n-placeholder="搜索" />
      <span id="c" data-i18n-title="折叠/展开侧栏"></span>
    `;
    applyLocalePreference("en");
    applyI18nDom();
    expect(document.getElementById("a").textContent).toBe("Chat");
    expect(document.getElementById("b").getAttribute("placeholder")).toBe("Search");
    expect(document.getElementById("c").getAttribute("title")).toBe("Collapse/expand sidebar");
    document.body.innerHTML = "";
  });
});
