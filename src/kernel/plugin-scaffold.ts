/**
 * 插件脚手架（T-P3-148 H/I/J）——四模板纯函数 + 本地 dev 市场登记。
 *
 * 形态母版：pi-desktop plugin-devkit templates.ts（四模板/scaffold 纯函数/
 * 拒绝非空目录/最小权限示范）+ zcode plugin-creator（先全部检查后写盘/
 * validate 先行）+ qwen /extensions new --template（生成后不自动装载）。
 *
 * 四模板（用户截图的"面板/智能体工具/技能包/全部能力"对应）：
 *   - view-basic  视图：contributes.views + views/index.html——纯资源插件
 *     零入口（I9 入口按需：无 capabilities/hooks 不要求 index.js）；
 *   - agent-tool  智能体工具：capabilities ["registerTool"] + index.js
 *     （SDK onActivate → caps.registerTool，读 caps.pluginSettings 示范 F）；
 *   - skill-pack  技能包：contributes.skills + skills/<slug>/SKILL.md——零入口；
 *   - full        全部能力：命令（内联模板）+ 技能 + 视图 + 工具 + 设置并集，
 *     manifest 注释行说明各面（最小权限示范：工具只登记不越界）。
 *
 * 纪律：所有检查先于任何写盘（zcode createPlugin 顺序——目录冲突/名称形状
 * 先行，避免半份脚手架）；生成后不自动装载（pi pluginCreateFromTemplate
 * 语义——装载走插件页审批链）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { PLUGIN_NAME_SHAPE } from "./plugin-manifest-contributes.js";

export const PLUGIN_TEMPLATE_IDS = ["view-basic", "agent-tool", "skill-pack", "full"] as const;
export type PluginTemplateId = (typeof PLUGIN_TEMPLATE_IDS)[number];

export const PLUGIN_TEMPLATE_LABELS: Record<PluginTemplateId, string> = {
  "view-basic": "视图（插件页内受控渲染的面板）",
  "agent-tool": "智能体工具（给模型登记一个工具）",
  "skill-pack": "技能包（向系统提示注入技能文档）",
  full: "全部能力（命令+技能+视图+工具+设置）",
};

export interface ScaffoldInput {
  /** 插件名（slug——v2 清单 name 形状，目录名同名）。 */
  readonly slug: string;
  readonly template: PluginTemplateId;
  /** 目标目录（须不存在或为空目录）。 */
  readonly targetDir: string;
  readonly displayName?: string;
  readonly description?: string;
}

export interface ScaffoldResult {
  readonly dir: string;
  readonly manifest: Record<string, unknown>;
  /** 相对 targetDir 的文件清单（创建顺序）。 */
  readonly files: readonly string[];
}

/** 目标目录检查（不存在或空目录才可脚手架——pi isEmptyDir 同语义）。 */
function ensureEmptyDir(dir: string): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir).filter((name) => name !== ".DS_Store" && name !== "Thumbs.db");
  if (entries.length > 0) {
    throw new Error(`目标目录非空，拒绝脚手架：${dir}`);
  }
}

function writeAll(dir: string, files: Readonly<Record<string, string>>): string[] {
  const written: string[] = [];
  for (const [relative, content] of Object.entries(files)) {
    const abs = path.join(dir, relative);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    written.push(relative.replace(/\\/g, "/"));
  }
  return written;
}

/** 视图 HTML（自足样式 + postMessage 桥预留注释——受控 iframe 渲染）。 */
function viewHtml(displayName: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${displayName}</title>
<style>
  /* 跟随宿主主题：宿主经 postMessage 投递 {type:"aegent:theme", base} */
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 20px;
         background: canvas; color: canvastext; }
  .card { border: 1px solid color-mix(in srgb, canvastext 14%, transparent);
          border-radius: 12px; padding: 16px; max-width: 560px; }
  button { font: inherit; padding: 6px 14px; border-radius: 8px; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <h2>${displayName}</h2>
    <p>这是插件贡献的视图（contributes.views）——宿主以受控 iframe 渲染本文件，
       与宿主的桥只走 postMessage 窄消息面（主题 token / 关闭），无宿主句柄。</p>
    <button id="hello">打个招呼</button>
    <p id="out" aria-live="polite"></p>
  </div>
  <script>
    // 外观约定（T-P3-148 C）：宿主注入 window.__AEGENT_VIEW__（初始态）+
    // postMessage {type:"aegent:appearance", base, locale}（后续变化）——
    // 页面 CSS 按 documentElement.dataset.base 分支（pi data-base 同款）
    function applyAppearance(a) {
      if (!a || a.base === undefined) return;
      document.documentElement.dataset.base = a.base;
      document.documentElement.style.colorScheme = a.base === "light" ? "light" : "dark";
    }
    applyAppearance(window.__AEGENT_VIEW__);
    window.addEventListener("message", (ev) => {
      if (ev.data && ev.data.type === "aegent:appearance") applyAppearance(ev.data);
    });
    document.getElementById("hello").addEventListener("click", () => {
      document.getElementById("out").textContent = "你好，来自插件视图（" + new Date().toLocaleTimeString() + "）";
    });
  </script>
</body>
</html>
`;
}

function toolIndexJs(displayName: string): string {
  return `/**
 * ${displayName}——插件入口（AegentPlugin 三段式：onActivate/onEvent/onDispose）。
 * 装载时宿主发一枚受限能力 token（caps）——插件拿不到内核句柄（D4 红线）。
 */
export default {
  // 清单以 plugin.json 为权威（宿主装载时注入——入口不重复声明）
  async onActivate(caps) {
    // F：caps.pluginSettings = plugin.json contributes.settings 的合并值
    // （default + 用户在插件中心配置的值）。改这里后新会话生效。
    const prefix = typeof caps.pluginSettings.prefix === "string" ? caps.pluginSettings.prefix : "";
    caps.registerTool({
      name: "echo_text",
      description: "回声：原样返回 args.text（插件工具描述随登记内联生效）。",
      async execute(args) {
        const text = typeof args?.text === "string" ? args.text : "";
        return { content: prefix + text };
      },
    });
  },
  async onDispose() {
    // 收尾：dispose 后工具已注销、订阅失效——无需手动撤销
  },
};
`;
}

function skillDoc(displayName: string, slug: string): string {
  return `---
name: ${slug}
description: ${displayName} 的示例技能——把这份文档换成"什么时候按它的指引行事"。
---

# ${displayName}

技能正文会按名注入系统提示清单，正文经 skill_load 按需加载。全文与用户的
AGENTS.md 竞争上下文——保持短而具体。

## 什么时候用

- 用户请求命中本插件的使用场景时。

## 怎么用

1. 把这里换成 1~3 条可执行指引。
2. 需要配套行为时在插件里加工具（agent-tool 模板的 echo_text 可作起点）。
`;
}

function readme(displayName: string, slug: string, template: PluginTemplateId, lines: readonly string[]): string {
  return `# ${displayName}

由 aegent「${PLUGIN_TEMPLATE_LABELS[template]}」模板生成的插件（T-P3-148 H）。

## 贡献

${lines.map((l) => `- ${l}`).join("\n")}

## 安装

插件中心 → 安装插件 → 装载方式"进程内" → 插件名 \`${slug}\`、装载源填本目录
绝对路径 → 审批确认。或把本目录用「本地 dev 市场」登记后从市场装。

## 开发

- 改 plugin.json（manifest v2：contributes 贡献声明闭集）与入口/资源文件；
- 装载失败在插件中心行内红字显示诊断（never-fail，不炸会话）；
- 卸载只是移出装载清单，目录文件保留。
`;
}

function manifestJson(slug: string, template: PluginTemplateId, displayName: string, description: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: slug,
    version: "0.1.0",
    description,
    trust: "untrusted",
    capabilities: [] as string[],
  };
  if (template === "view-basic") {
    return {
      ...base,
      contributes: { views: [{ id: "main", title: displayName, entry: "views/index.html" }] },
    };
  }
  if (template === "agent-tool") {
    return { ...base, capabilities: ["registerTool"] };
  }
  if (template === "skill-pack") {
    return { ...base, contributes: { skills: ["skills"] } };
  }
  return {
    ...base,
    capabilities: ["registerTool", "subscribe"],
    contributes: {
      commands: [
        {
          name: "hello",
          description: "示例命令——按 /hello 调用（提示词模板域参数化展开）",
          argumentHint: "<名字>",
          template: "你好，$1！这条命令来自插件 " + slug + "（提示词模板域合并消费）。",
        },
      ],
      skills: ["skills"],
      views: [{ id: "main", title: displayName, entry: "views/index.html" }],
      settings: [
        { name: "prefix", type: "string", default: "[demo] ", description: "echo_text 工具输出的前缀" },
      ],
      subscriptions: ["user/message"],
    },
  };
}

/** 四模板脚手架（纯函数语义：检查先行、逐文件写盘、拒绝非空目录）。 */
export function scaffoldPlugin(input: ScaffoldInput): ScaffoldResult {
  if (!(PLUGIN_TEMPLATE_IDS as readonly string[]).includes(input.template)) {
    throw new Error(`未知模板：${String(input.template)}（合法：${PLUGIN_TEMPLATE_IDS.join(" | ")}）`);
  }
  if (typeof input.slug !== "string" || !PLUGIN_NAME_SHAPE.test(input.slug)) {
    throw new Error(`插件名须为 slug 形状（小写字母数字开头，. - _ 可内用，≤64 字节）：${String(input.slug)}`);
  }
  const dir = path.resolve(input.targetDir);
  ensureEmptyDir(dir);
  const displayName = input.displayName?.trim() || input.slug;
  const description = input.description?.trim() || `${displayName}——由 ${PLUGIN_TEMPLATE_LABELS[input.template]} 模板生成。`;
  const manifest = manifestJson(input.slug, input.template, displayName, description);
  const files: Record<string, string> = {
    "plugin.json": JSON.stringify(manifest, null, 2) + "\n",
    "README.md": readme(
      displayName,
      input.slug,
      input.template,
      input.template === "view-basic"
        ? ["视图 `main`（views/index.html）"]
        : input.template === "agent-tool"
          ? ["工具 `echo_text`（onActivate 登记执行体）"]
          : input.template === "skill-pack"
            ? [`技能 \`${input.slug}\`（skills/${input.slug}/SKILL.md）`]
            : ["命令 `hello`（/hello 参数化展开）", `技能 \`${input.slug}\``, "视图 `main`", "工具 `echo_text`（读插件设置 prefix）", "设置 `prefix`（详情表单可改）"],
    ),
  };
  if (input.template === "view-basic" || input.template === "full") {
    files["views/index.html"] = viewHtml(displayName);
  }
  if (input.template === "agent-tool" || input.template === "full") {
    files["index.js"] = toolIndexJs(displayName);
  }
  if (input.template === "skill-pack" || input.template === "full") {
    files[`skills/${input.slug}/SKILL.md`] = skillDoc(displayName, input.slug);
  }
  const written = writeAll(dir, files);
  return { dir, manifest, files: written };
}

// ---------------------------------------------------------------------------
// 本地 dev 市场（J——zcode upsert-dev-marketplace 同构）
// ---------------------------------------------------------------------------

export interface DevMarketUpsert {
  readonly workspaceRoot: string;
  readonly name: string;
  /** 插件目录（必须已位于 <workspace>/plugins/ 之下——source 相对化前提）。 */
  readonly dir: string;
  readonly version: string;
  readonly description?: string;
}

export interface DevMarketResult {
  readonly marketplacePath: string;
  readonly marketplaceName: string;
  /** 相对市场的插件 source（如 `./my-plugin`）。 */
  readonly source: string;
  readonly changed: boolean;
}

/**
 * 稳定 dev 市场名（zcode devMarketplaceName 同构：dev-<label>-<sha256 前 8>——
 * 跨会话稳定，同名插件重复登记是更新不是新增）。
 */
export function devMarketplaceName(workspaceRoot: string): string {
  const label =
    path.basename(workspaceRoot)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace";
  const identity = process.platform === "win32" ? workspaceRoot.toLowerCase() : workspaceRoot;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 8);
  return `dev-${label}-${hash}`;
}

/** 原子写 JSON（tmp + rename——settings/skill-save 同纪律）。 */
function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

/**
 * 插件登记进本地 dev 市场（<workspace>/plugins/marketplace.json）：条目
 * upsert 保序、source 必须落市场根内、同名单显式覆盖（dev 语义——自己写的
 * 插件重复登记 = 更新版本描述）。
 */
export function upsertDevMarketplace(input: DevMarketUpsert): DevMarketResult {
  const marketRoot = path.resolve(input.workspaceRoot, "plugins");
  const marketPath = path.join(marketRoot, "marketplace.json");
  const pluginDir = path.resolve(input.dir);
  const rel = path.relative(marketRoot, pluginDir);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`插件目录必须位于 ${marketRoot} 之内（dev 市场 source 相对化前提）：${input.dir}`);
  }
  const source = `./${rel.replace(/\\/g, "/")}`;
  const name = devMarketplaceName(input.workspaceRoot);
  let market: { name?: string; plugins?: { name: string; source: string; version?: string; description?: string }[] } = {};
  if (existsSync(marketPath)) {
    try {
      market = JSON.parse(readFileSync(marketPath, "utf8")) as typeof market;
    } catch {
      throw new Error(`既有 marketplace.json 不是合法 JSON：${marketPath}`);
    }
    if (market.name !== undefined && market.name !== name) {
      throw new Error(
        `既有市场名不一致（${market.name} ≠ ${name}）——该文件是另一市场的清单，拒绝混写`,
      );
    }
  }
  market.name = name;
  const plugins = Array.isArray(market.plugins) ? market.plugins : [];
  const entry = {
    name: input.name,
    source,
    version: input.version,
    ...(input.description !== undefined && input.description !== "" ? { description: input.description } : {}),
  };
  const index = plugins.findIndex((p) => p.name === input.name);
  let changed: boolean;
  if (index >= 0) {
    changed = JSON.stringify(plugins[index]) !== JSON.stringify(entry);
    plugins[index] = entry;
  } else {
    plugins.push(entry);
    changed = true;
  }
  market.plugins = plugins;
  if (changed || !existsSync(marketPath)) {
    atomicWriteJson(marketPath, market);
  }
  return { marketplacePath: marketPath, marketplaceName: name, source, changed };
}
