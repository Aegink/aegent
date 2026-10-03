/**
 * 项目文件面（T-P3-150 C2~C7——projects.js 的文件域拆分位）：
 * 懒加载文件树（单层 op fs-tree + 展开补水 + 代次守卫防切项目竞态——
 * pideck fileTreeLazy 同构；扁平行 + 缩进 padding——zcode 虚拟树同构）
 * + 文件预览侧边栏（Markdown 真渲染复用 renderMarkdown 管线 + 预览/源码
 * 切换——zcode 按文件类型定默认值语义）+ 树行右键菜单（打开/打开方式/在
 * 资源管理器中打开/复制相对·绝对路径/添加到聊天——zcode 七项裁剪版）。
 *
 * 边界与配额全在 host（fs-gateway：项目根 realpath 白名单 + 单层 2000 条
 * + 文本 256KB 截断 + 图片 8MB）——UI 只消费类型化结果。
 */

import { sendSettings } from "../api.js";
import { toast } from "../feedback.js";
import { renderMarkdown } from "../render.js";
import { openMenu } from "./settings/core.js";

/** 图片扩展名（与 host IMAGE_EXT_BY_MEDIA 同集——UI 预判图标用）。 */
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);

/** 相对项目根的 posix 路径（zcode getWorkspaceFileRelativePath 语义：`\`→`/`
 * 归一、根自身 → `.`）。 */
export function relativePathTo(root, target) {
  const norm = target.replaceAll("\\", "/");
  const rootNorm = root.replaceAll("\\", "/").replace(/\/$/, "");
  if (norm === rootNorm) return ".";
  return norm.startsWith(`${rootNorm}/`) ? norm.slice(rootNorm.length + 1) : norm;
}

/**
 * 文件树（左栏）。deps：{container, project, generation, onOpenFile(path)}。
 * 扁平行树：expanded Set（绝对路径）+ childrenCache；展开 = 行后插入后代
 * 行（缩进 = 深度 padding），折叠 = 摘除全部前缀后代行。
 */
export async function renderFileTree(container, deps) {
  const { project, onOpenFile } = deps;
  const generation = deps.generation;
  const expanded = new Set();
  const childrenCache = new Map(); // dirAbs → entries[]
  const depthOf = new Map(); // dirAbs → depth（行缩进）

  const primary = project.folders[0] ?? "";
  const tree = document.createElement("div");
  tree.className = "proj-tree";
  container.replaceChildren(tree);

  const isDescendant = (candidate, ancestor) =>
    candidate.startsWith(`${ancestor}/`) || candidate.startsWith(`${ancestor}\\`);

  const insertRows = (dirAbs, entries) => {
    const parentDepth = depthOf.get(dirAbs) ?? -1;
    // 根目录无行锚点（树根是抽象）——后代行直接 append；其余锚在父行后
    const rows = [...tree.children];
    const parentIdx = rows.findIndex((el) => el.dataset?.path === dirAbs);
    if (parentIdx < 0) {
      for (const entry of entries) tree.appendChild(makeRow(entry, parentDepth + 1));
      return;
    }
    const mountpoint = rows[parentIdx];
    let cursor = mountpoint;
    for (const entry of entries) {
      const row = makeRow(entry, parentDepth + 1);
      cursor.after(row);
      cursor = row;
    }
  };

  const loadDir = async (dirAbs, depth) => {
    if (generation !== deps.generation) return; // 代次守卫——切项目丢弃旧结果
    const envelope = await sendSettings({ op: "fs-tree", path: dirAbs });
    if (generation !== deps.generation) return;
    if (!envelope.ok) {
      toast(`目录加载失败：${envelope.error?.message ?? ""}`, "warn");
      expanded.delete(dirAbs);
      return;
    }
    const entries = envelope.result.entries ?? [];
    childrenCache.set(dirAbs, entries);
    for (const entry of entries) {
      if (entry.dir) depthOf.set(entry.path, depth + 1);
    }
    insertRows(dirAbs, entries);
  };

  const toggleDir = (entry) => {
    if (expanded.has(entry.path)) {
      expanded.delete(entry.path);
      // 折叠：摘除全部前缀后代行 + 递归清后代展开态
      for (const el of [...tree.children]) {
        const p = el.dataset?.path;
        if (p !== undefined && isDescendant(p, entry.path)) el.remove();
      }
      for (const dir of [...expanded]) {
        if (isDescendant(dir, entry.path)) expanded.delete(dir);
      }
      return;
    }
    expanded.add(entry.path);
    const cached = childrenCache.get(entry.path);
    if (cached !== undefined) {
      insertRows(entry.path, cached);
    } else {
      void loadDir(entry.path, depthOf.get(entry.path) ?? 0);
    }
  };

  const makeRow = (entry, depth) => {
    const row = document.createElement("div");
    row.className = "proj-tree-row";
    row.dataset.path = entry.path;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    const icon = document.createElement("span");
    icon.className = "proj-tree-icon";
    icon.textContent = entry.dir ? "📁" : fileIcon(entry.name);
    const label = document.createElement("span");
    label.className = "proj-tree-label";
    label.textContent = entry.name;
    row.append(icon, label);
    row.title = entry.path;
    row.addEventListener("click", () => {
      if (entry.dir) {
        toggleDir(entry);
      } else {
        onOpenFile(entry.path);
      }
    });
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      openMenu(row, fileMenuItems(entry));
    });
    return row;
  };

  const fileMenuItems = (entry) => [
    {
      label: "打开",
      onClick: () => (entry.dir ? toggleDir(entry) : onOpenFile(entry.path)),
    },
    ...(entry.dir
      ? []
      : [
          {
            label: "打开方式（系统默认应用）",
            onClick: () => void shellAction(entry.path, "open"),
          },
        ]),
    {
      label: "在资源管理器中打开",
      onClick: () => void shellAction(entry.path, "reveal"),
    },
    {
      label: "复制相对路径",
      onClick: () => void copyText(relativePathTo(primary, entry.path), "已复制相对路径"),
    },
    {
      label: "复制绝对路径",
      onClick: () => void copyText(entry.path, "已复制绝对路径"),
    },
    ...(entry.dir
      ? []
      : [
          {
            label: "添加到聊天",
            onClick: () => addMentionToChat(primary, entry.path),
          },
        ]),
  ];

  const shellAction = async (target, action) => {
    const envelope = await sendSettings({ op: "fs-shell", path: target, action });
    if (!envelope.ok) toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
  };

  depthOf.set(primary, -1); // 根的子行 depth 0
  await loadDir(primary, -1);
}

/** 文件预览（右栏/面板 Tab 通用）：md 预览/源码切换（zcode 语义——md 默认
 * 预览）+ 图片 + 二进制提示 + 面包屑 + 复制路径组 + 在资源管理器打开。
 * deps：{container, filePath, project, onBack?}——onBack 缺省时无返回钮
 * （面板宿主形态，T-P3-156 C）。 */
export async function renderFilePreview(container, deps) {
  const { filePath, project } = deps;
  const primary = project.folders[0] ?? "";
  const head = document.createElement("div");
  head.className = "proj-preview-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn btn-ghost";
  back.textContent = "← 返回项目";
  if (typeof deps.onBack === "function") {
    back.addEventListener("click", deps.onBack);
    head.appendChild(back);
  }
  const crumb = document.createElement("div");
  crumb.className = "proj-preview-crumb";
  crumb.textContent = relativePathTo(primary, filePath);
  crumb.title = filePath;
  const actions = document.createElement("div");
  actions.className = "proj-preview-actions";
  const copyRel = document.createElement("button");
  copyRel.type = "button";
  copyRel.className = "btn btn-ghost";
  copyRel.textContent = "复制相对路径";
  copyRel.addEventListener("click", () => void copyText(relativePathTo(primary, filePath), "已复制相对路径"));
  const copyAbs = document.createElement("button");
  copyAbs.type = "button";
  copyAbs.className = "btn btn-ghost";
  copyAbs.textContent = "复制绝对路径";
  copyAbs.addEventListener("click", () => void copyText(filePath, "已复制绝对路径"));
  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.className = "btn btn-ghost";
  reveal.title = "在资源管理器中显示（系统文件管理器定位该文件）";
  reveal.textContent = "📁";
  reveal.addEventListener("click", async () => {
    const envelope = await sendSettings({ op: "fs-shell", path: filePath, action: "reveal" });
    if (!envelope.ok) toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
  });
  actions.append(copyRel, copyAbs, reveal);
  // back 的挂载在上方 onBack 条件内（面板宿主形态无返回钮——T-P3-156 C）
  head.append(crumb, actions);

  const body = document.createElement("div");
  body.className = "proj-preview-body";
  container.replaceChildren(head, body);
  body.textContent = "加载中…";

  const envelope = await sendSettings({ op: "fs-read", path: filePath });
  if (!envelope.ok) {
    body.textContent = `读取失败：${envelope.error?.message ?? ""}`;
    body.classList.add("proj-preview-error");
    return;
  }
  const result = envelope.result;
  if (result.kind === "image") {
    const img = document.createElement("img");
    img.className = "proj-preview-image";
    img.src = `data:${result.mediaType};base64,${result.base64}`;
    img.alt = filePath;
    body.replaceChildren(img);
    return;
  }
  if (result.kind === "binary") {
    const card = document.createElement("div");
    card.className = "proj-preview-binary empty-state";
    card.innerHTML = `<div class="empty-title">二进制文件</div><div class="empty-desc">该文件不是文本/图片——可用「打开方式」交给系统默认应用。</div>`;
    body.replaceChildren(card);
    return;
  }
  const isMarkdown = MARKDOWN_EXTS.has(extOf(filePath));
  if (isMarkdown) {
    // zcode 预览/源码切换语义：md 默认预览、切源码；模式归属当前文件
    let mode = "preview";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-ghost";
    const paint = () => {
      if (mode === "preview") {
        toggle.textContent = "切换到源码";
        const rendered = document.createElement("div");
        rendered.className = "proj-preview-markdown";
        rendered.innerHTML = renderMarkdown(result.content ?? "");
        body.replaceChildren(rendered);
      } else {
        toggle.textContent = "切换到预览";
        const pre = document.createElement("pre");
        pre.className = "proj-preview-code";
        pre.textContent = result.content ?? "";
        body.replaceChildren(pre);
      }
    };
    toggle.addEventListener("click", () => {
      mode = mode === "preview" ? "code" : "preview";
      paint();
    });
    actions.prepend(toggle);
    paint();
  } else {
    const pre = document.createElement("pre");
    pre.className = "proj-preview-code";
    pre.textContent =
      result.truncated === true
        ? `${result.content ?? ""}\n\n── 文件过大，仅显示前 256KB ──`
        : (result.content ?? "");
    body.replaceChildren(pre);
  }
}

export function fileIcon(name) {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return "🖼";
  if (MARKDOWN_EXTS.has(ext)) return "📝";
  if (ext === ".json" || ext === ".toml" || ext === ".yaml" || ext === ".yml") return "⚙";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".ts" || ext === ".tsx") return "🟨";
  if (ext === ".py") return "🐍";
  if (ext === ".rs") return "🦀";
  if (ext === ".html" || ext === ".css") return "🌐";
  return "📄";
}

function extOf(name) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

export async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage, "info");
  } catch {
    toast("复制失败——浏览器剪贴板不可用", "warn");
  }
}

/** 添加到聊天：全局事件 → app.js 监听器往输入框插 mention（zcode
 * CustomEvent 协议的同构面）；同项目用相对路径。 */
export function addMentionToChat(root, filePath) {
  const rel = relativePathTo(root, filePath);
  window.dispatchEvent(
    new CustomEvent("projects:add-to-chat", { detail: { mention: `@${rel}` } }),
  );
  toast(`已在对话输入框插入 ${rel}——回对话页可见`, "info");
}
