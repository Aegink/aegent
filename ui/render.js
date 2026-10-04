/**
 * U4/T-P3-107 渲染分层基础——模型产出（assistant）的 markdown/代码高亮
 * 渲染管线（纯函数模块：app.js 消费；src/diagnostics/ui-render.test.ts
 * 经动态 import 直测 XSS 面）。
 *
 * 渲染安全防呆（P3 §1 全局约束 4）：
 * - 本模块只准用于**模型产出**——用户输入由 app.js 保持 textContent 不渲染
 *   （注入面禁足：用户原文永远不走 markdown 管线）。
 * - marked 禁 HTML 透传：renderer.html 恒转义原样可见（看得见、不执行）。
 * - 链接/图片 href 协议白名单（http/https/mailto/页内/相对）——javascript:
 *   等毒协议恒返 "#"。
 * - 代码高亮由 highlight.js 输出（其 value 已 HTML 转义）；vendor 本地化
 *   （ui/vendor/，许可登记见 THIRD_PARTY.md 与 ui/vendor/README.md）。
 */

import { marked } from "./vendor/marked.esm.js";
import hljs from "./vendor/highlight.esm.js";

export function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** href 协议白名单：安全值原样返回；其余（javascript:/data: 等）恒 "#"。 */
export function safeHref(href) {
  const raw = String(href ?? "").trim();
  if (raw === "") return "#";
  if (raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("./")) return raw;
  return /^(https?:|mailto:)/i.test(raw) ? raw : "#";
}

/** 无语言标注时自动探测的候选子集（T-P3-160 需求 6——全库 highlightAuto
 *  对短片段命中率低，限定常见语言后明显更准；vendor 36 语言内的闭集）。 */
const AUTO_LANG_SUBSET = [
  "javascript", "typescript", "python", "json", "bash", "xml", "css", "go",
  "rust", "java", "sql", "yaml", "markdown", "ini", "shell", "kotlin", "swift",
];

/** 路径扩展名 → hljs 语言（read 工具结果/文件预览源码高亮——VS Code 观感）。 */
const EXT_LANG = new Map([
  ["js", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"], ["jsx", "javascript"],
  ["ts", "typescript"], ["mts", "typescript"], ["cts", "typescript"], ["tsx", "typescript"],
  ["py", "python"], ["json", "json"], ["jsonc", "json"], ["sh", "bash"], ["bash", "bash"],
  ["ps1", "powershell"] , ["html", "xml"], ["htm", "xml"], ["xml", "xml"], ["svg", "xml"],
  ["css", "css"], ["less", "less"], ["scss", "scss"], ["go", "go"], ["rs", "rust"],
  ["java", "java"], ["kt", "kotlin"], ["swift", "swift"], ["sql", "sql"], ["yml", "yaml"],
  ["yaml", "yaml"], ["toml", "ini"], ["ini", "ini"], ["md", "markdown"], ["c", "c"],
  ["h", "c"], ["cpp", "cpp"], ["hpp", "cpp"], ["cs", "csharp"], ["rb", "ruby"],
  ["php", "php"], ["lua", "lua"], ["mk", "makefile"], ["makefile", "makefile"],
  ["diff", "diff"], ["patch", "diff"],
]);

/** 从文件路径推断高亮语言（无匹配回 ""——调用方转义兜底）。 */
export function langFromPath(path) {
  const name = String(path ?? "").split(/[\\/]/).at(-1) ?? "";
  if (name.toLowerCase() === "makefile") return "makefile";
  const ext = name.includes(".") ? name.split(".").at(-1).toLowerCase() : "";
  return EXT_LANG.get(ext) ?? "";
}

/** 代码高亮（指定语言 → 自动探测回退 → 失败转义兜底）。 */
export function highlightCode(code, lang) {
  try {
    if (lang !== "" && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code, AUTO_LANG_SUBSET).value;
  } catch {
    return escapeHtml(code);
  }
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    // 禁 HTML 透传：原样转义可见——模型产出的内嵌 HTML 只读不执行
    html(token) {
      return `<code class="md-html-raw">${escapeHtml(token.text ?? "")}</code>`;
    },
    code(token) {
      const lang = String(token.lang ?? "").trim().split(/\s+/)[0] ?? "";
      const body = highlightCode(String(token.text ?? ""), lang);
      // 代码块复制按钮（U4 验收项——复制行为在 app.js 事件委托）
      return `<div class="code-block"><button type="button" class="code-copy">复制</button><pre><code class="hljs">${body}</code></pre></div>`;
    },
    link(token) {
      const href = safeHref(token.href);
      const label = this.parser.parseInline(token.tokens ?? []);
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image(token) {
      return `<img src="${escapeHtml(safeHref(token.href))}" alt="${escapeHtml(token.text ?? "")}" />`;
    },
  },
});

/** 渲染模型产出的 markdown → HTML（同步；仅 assistant 面调用——见头注）。 */
export function renderMarkdown(text) {
  return marked.parse(String(text ?? ""), { async: false });
}

/** 高亮代码块 DOM（T-P3-160 需求 6/7——read 工具结果与文件预览源码共用，
 *  VS Code 观感：hljs token 多色 + 复制钮，与 assistant md 代码块同形）。 */
export function highlightedCodeBlock(code, lang) {
  const wrap = document.createElement("div");
  wrap.className = "code-block";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "code-copy";
  copy.textContent = "复制";
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.className = "hljs";
  codeEl.innerHTML = highlightCode(code, lang);
  pre.appendChild(codeEl);
  wrap.append(copy, pre);
  return wrap;
}

const DENIAL_PREFIX = "被权限策略拒绝：";

/**
 * C55 拒绝面解析：renderDenial（policy/denial.ts）的同源文本 → 结构化形状
 * （reason/justification/alternatives）——工具结果错误卡把"替代做法"渲染成
 * 编号清单；非拒绝文本回 null（零误伤）。
 */
export function parseDenial(content) {
  const text = String(content ?? "");
  if (!text.startsWith(DENIAL_PREFIX)) return null;
  const lines = text.split(/\r?\n/);
  const out = { reason: lines[0]?.slice(DENIAL_PREFIX.length) ?? "", alternatives: [] };
  let inAlternatives = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith("规则理由：")) {
      out.justification = line.slice("规则理由：".length);
      inAlternatives = false;
    } else if (line.trim() === "替代做法：") {
      inAlternatives = true;
    } else if (inAlternatives) {
      const m = line.match(/^\s*\d+\.\s*(.+)$/);
      if (m !== null) out.alternatives.push(m[1]);
    }
  }
  return out;
}

/**
 * 写操作 diff 行（U4 工具卡的"写操作 diff 对照"）：write/edit 的 args →
 * [{kind, text}]（meta=文件头 / del=旧值 / add=新值）；非写操作回 null
 * （bash 等无文件语义工具不硬造 diff）。参数名 = builtin 工具 schema
 * （write: path/content；edit: path/oldText/newText）。
 */
export function buildDiffLines(name, args) {
  if (name === "write" && typeof args?.content === "string") {
    return [
      { kind: "meta", text: String(args?.path ?? "") },
      ...String(args.content).split(/\r?\n/).map((l) => ({ kind: "add", text: l })),
    ];
  }
  if (name === "edit" && (typeof args?.oldText === "string" || typeof args?.newText === "string")) {
    return [
      { kind: "meta", text: String(args?.path ?? "") },
      ...String(args?.oldText ?? "").split(/\r?\n/).map((l) => ({ kind: "del", text: l })),
      ...String(args?.newText ?? "").split(/\r?\n/).map((l) => ({ kind: "add", text: l })),
    ];
  }
  return null;
}
