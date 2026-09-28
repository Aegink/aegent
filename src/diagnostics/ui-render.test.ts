/**
 * U4/T-P3-107 渲染管线机验——ui/render.js 的 XSS 面与拒绝面/diff 解析
 * （动态 import：ui/ 是零构建原生 ESM，TS 无声明，用 URL 变量绕开静态
 * 解析；vitest node 环境可直接求值 marked/hljs 纯库）。
 *
 * 防呆断言对应 P3 §1 全局约束 4：禁 HTML 透传、href 协议白名单、
 * 用户输入不渲染（该面由 app.js textContent 保证——资产断言在
 * tauri-shell.test.ts）。
 */

import path from "node:path";
import { describe, expect, it } from "vitest";

const renderUrl = new URL(path.posix.join("../../ui/render.js"), import.meta.url).href;

// ui/ 是零构建原生 ESM（无 TS 声明）——最小形状手写（动态 import 变量绕开静态解析）
type RenderModule = {
  renderMarkdown: (text: string | undefined) => string;
  safeHref: (href: string) => string;
  highlightCode: (code: string, lang: string) => string;
  parseDenial: (
    content: string | undefined,
  ) => { reason: string; justification?: string; alternatives: string[] } | null;
  buildDiffLines: (
    name: string,
    args: Record<string, unknown>,
  ) => { kind: string; text: string }[] | null;
};
const render = (await import(renderUrl)) as RenderModule;

describe("renderMarkdown XSS 防呆（marked 配置）", () => {
  it("HTML 透传禁足：script/iframe/内联事件恒转义原样可见", () => {
    const html = render.renderMarkdown('<script>alert(1)</script> 与 <img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img"); // 标签永不落地——只以转义文本可见
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("md-html-raw");
  });

  it("href 协议白名单：javascript:/data: 恒 '#'；https 原样", () => {
    const evil = render.renderMarkdown("[x](javascript:alert(1)) 与 [y](data:text/html,bad)");
    expect(evil).not.toContain("javascript:");
    expect(evil).not.toContain("data:text/html");
    expect(evil.match(/href="#"/g)?.length).toBe(2);
    const ok = render.renderMarkdown("[z](https://example.com/a)");
    expect(ok).toContain('href="https://example.com/a"');
    expect(ok).toContain('rel="noopener noreferrer"');
  });

  it("图片 src 同走白名单；代码块高亮 + 复制按钮在位", () => {
    const img = render.renderMarkdown("![p](javascript:x) ![q](https://e.com/i.png)");
    expect(img).not.toContain('src="javascript:');
    expect(img).toContain('src="https://e.com/i.png"');
    const code = render.renderMarkdown("```js\nconst a = 1;\n```");
    expect(code).toContain("code-copy");
    expect(code).toContain("hljs-keyword"); // 指定语言高亮
    const auto = render.renderMarkdown("```\nconst b = 2;\n```");
    expect(auto).toContain("code-block");
  });

  it("safeHref 直测：空/页内/相对原样，毒协议恒 #", () => {
    expect(render.safeHref("")).toBe("#");
    expect(render.safeHref("#anchor")).toBe("#anchor");
    expect(render.safeHref("./rel")).toBe("./rel");
    expect(render.safeHref("/abs")).toBe("/abs");
    expect(render.safeHref("javascript:alert(1)")).toBe("#");
    expect(render.safeHref("vbscript:x")).toBe("#");
    expect(render.safeHref("HTTPS://a.b")).toBe("HTTPS://a.b");
  });

  it("highlightCode 兜底：未知语言自动探测；hljs 输出恒转义（标签不落地）", () => {
    const auto = render.highlightCode("<b>hi</b>", "nosuchlang");
    expect(auto).not.toContain("<b>"); // 活标签不出现（hljs-tag 内是转义实体）
    expect(auto).toContain("&lt;");
    expect(render.highlightCode("def f(): pass", "python")).toContain("hljs-keyword");
  });
});

describe("parseDenial（C55 拒绝面解析）", () => {
  it("renderDenial 同源文本 → 结构化（reason/justification/alternatives 编号还原）", () => {
    const parsed = render.parseDenial(
      "被权限策略拒绝：rm 越出工作区\n规则理由：防误删\n替代做法：\n  1. 用 del 命令带路径\n  2. 请求扩权",
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.reason).toBe("rm 越出工作区");
    expect(parsed?.justification).toBe("防误删");
    expect(parsed?.alternatives).toEqual(["用 del 命令带路径", "请求扩权"]);
  });

  it("无附加字段（零变化同形）与非拒绝文本回 null", () => {
    const bare = render.parseDenial("被权限策略拒绝：危险命令");
    expect(bare).toEqual({ reason: "危险命令", alternatives: [] });
    expect(render.parseDenial("普通工具输出")).toBeNull();
    expect(render.parseDenial(undefined)).toBeNull();
  });
});

describe("buildDiffLines（写操作 diff 对照）", () => {
  it("write：path 头 + content 全 add", () => {
    const lines = render.buildDiffLines("write", { path: "a.txt", content: "l1\nl2" });
    expect(lines).toEqual([
      { kind: "meta", text: "a.txt" },
      { kind: "add", text: "l1" },
      { kind: "add", text: "l2" },
    ]);
  });

  it("edit：oldText=del、newText=add（oldText 缺省容错）", () => {
    const lines = render.buildDiffLines("edit", { path: "a.txt", oldText: "old", newText: "new" });
    expect(lines).toEqual([
      { kind: "meta", text: "a.txt" },
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
    ]);
    const partial = render.buildDiffLines("edit", { path: "a.txt", newText: "x" });
    expect(partial).toEqual([
      { kind: "meta", text: "a.txt" },
      { kind: "del", text: "" },
      { kind: "add", text: "x" },
    ]);
  });

  it("bash/缺参数回 null（不硬造 diff）", () => {
    expect(render.buildDiffLines("bash", { command: "ls" })).toBeNull();
    expect(render.buildDiffLines("write", {})).toBeNull();
  });
});
