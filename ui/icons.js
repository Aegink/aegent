/**
 * aegent ui 图标集（T-P3-134 · UI 批次 A②；T-P3-157 批 2 扩充 30 枚）——
 * 内联 SVG 线性图标，单色 currentColor（随文字色走）。
 * 形态自绘：24×24 viewBox、stroke 1.8、round 端点/拐角的极简线性形
 * （lucide 风格的自绘等价形——不摘任何参考仓源码）。
 * 尺寸档：控件内由上下文 CSS 约束（.nav-item svg 等）；通用档
 * .icon-sm(14)/.icon-md(16)/.icon-lg(18)；默认 1em 随文字（presentation
 * 属性最低优先级，不覆盖任何上下文规则）。
 * 语义色类：.icon-ok/.icon-err/.icon-warn；旋转态：.icon-spin（loader 用）。
 * 用法：icon(name, {cls, size}) → SVGElement；injectIcons(root) 扫
 * [data-icon] 占位注入（data-icon-size/data-icon-class 透传）。
 */

const PATHS = {
  chat: '<path d="M21 14a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16.6 16.6 4.4 4.4"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  usage: '<path d="M5 20v-6M12 20V6M19 20v-10"/><path d="M3 20h18"/>',
  bell: '<path d="M18 16H6l1.5-2.5V9a4.5 4.5 0 0 1 9 0v4.5L18 16z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3.5"/>',
  close: '<path d="M5 5l14 14M19 5 5 19"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20z"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5"/><path d="M12 18.2v.3"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  retry: '<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M12 15h5"/>',
  plug: '<path d="M9 2v6M15 2v6"/><path d="M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v6"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4"/><path d="M8.5 14h.01M15.5 14h.01"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M19 17H6a2 2 0 0 0-2 2"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M4 3h16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',

  // —— T-P3-157 批 2 扩充（lucide 风格自绘等价形）——
  // 文件/写入族
  filePen: '<path d="M12 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l4 4v5"/><path d="M14 2v4h4"/><path d="M21.3 12.7a2.4 2.4 0 0 0-3.4 0L14 16.6V20h3.4l3.9-3.9a2.4 2.4 0 0 0 0-3.4z"/>',
  fileCode: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/><path d="m10 12-2 2 2 2"/><path d="m14 12 2 2-2 2"/>',
  fileCog: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/><circle cx="12" cy="15" r="2"/><path d="M12 11.5v1M12 17.5v1M15.5 15h-1M9.5 15h-1M14.6 12.4l-.7.7M10.1 17l-.7.7M14.6 17.6l-.7-.7M10.1 13l-.7-.7"/>',
  folderOpen: '<path d="M4 20a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v2"/><path d="M4 20h14.6a1 1 0 0 0 .95-.68L22 12H8.2a2 2 0 0 0-1.9 1.37z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 15-5-5L5 21"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  paperclip: '<path d="m20.5 11.5-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"/>',
  // 状态族（成功/失败/运行/停止/取消/警告）
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>',
  loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  circleStop: '<circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  // 功能动作族
  zap: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  puzzle: '<path d="M10 3H4v6h1.5a1.5 1.5 0 0 1 0 3H4v8h6v-1.5a1.5 1.5 0 0 1 3 0V20h7v-6h-1.5a1.5 1.5 0 0 1 0-3H20l-1-1V5a2 2 0 0 0-2-2h-5v1.5a1.5 1.5 0 0 1-3 0z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.3 4 5.6 4 9s-1.5 6.7-4 9c-2.5-2.3-4-5.6-4-9s1.5-6.7 4-9z"/>',
  circleHelp: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.8 2.8 0 0 1 5.4.9c0 1.8-2.6 2.4-2.6 3.6"/><path d="M12 17h.01"/>',
  wrench: '<path d="M15.2 4.6a5.2 5.2 0 0 0-6.9 6.9L3 16.8a2 2 0 0 0 0 2.8l1.4 1.4a2 2 0 0 0 2.8 0l5.3-5.3a5.2 5.2 0 0 0 6.9-6.9l-3 3-2.8-.7-.7-2.8z"/>',
  map: '<path d="m9 3-5.4 1.9v16L9 19l6 2 5.4-1.9v-16L15 5z"/><path d="M9 3v16"/><path d="M15 5v16"/>',
  searchCode: '<circle cx="11" cy="11" r="7"/><path d="m16.6 16.6 4.4 4.4"/><path d="m9.2 9.2-1.8 1.8 1.8 1.8"/><path d="m12.8 9.2 1.8 1.8-1.8 1.8"/>',
  bandage: '<rect x="4.6" y="9.3" width="14.8" height="5.4" rx="2.7" transform="rotate(-45 12 12)"/><path d="M10.5 10.5h.01"/><path d="M13.5 10.5h.01"/><path d="M10.5 13.5h.01"/><path d="M13.5 13.5h.01"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.3 0"/>',
  // 面板/通知族
  gitFork: '<circle cx="6" cy="5" r="2.2"/><circle cx="18" cy="5" r="2.2"/><circle cx="12" cy="19" r="2.2"/><path d="M6 7.2v1.3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.2"/><path d="M12 11.5v5.3"/>',
  messageCircle: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  link2: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6"/><path d="M12 16v4"/>',
  // 杂项
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pin: '<path d="M12 17v5"/><path d="M7 14l2-3.5V4h6v6.5l2 3.5a1 1 0 0 1-.9 1.5H7.9A1 1 0 0 1 7 14z"/>',
  volume2: '<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/>',
  hexagon: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/>',
};

/** 图标名清单（机验面：批 2 扩充后 ≥60 枚——验收口径随之抬升）。 */
export const ICON_NAMES = Object.keys(PATHS);

/**
 * icon(name, opts?) → SVGElement（单色 currentColor；未知名回退 alert）。
 * opts.cls：附加类（icon-sm/icon-ok/icon-spin 等）；opts.size：px 数字——
 * 写 width/height 表现属性（上下文 CSS 规则优先级恒高于表现属性，不破坏
 * 既有 .nav-item svg 等约束）。
 */
export function icon(name, opts = {}) {
  const body = PATHS[name] ?? PATHS.alert;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  // 默认 1em 随文字（未约束上下文的兜底——防 svg 膨胀为默认 300×150）
  svg.setAttribute("width", "1em");
  svg.setAttribute("height", "1em");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = body; // 形状库为模块内常量（非用户输入——注入面封闭）
  if (opts.cls) svg.setAttribute("class", opts.cls);
  if (typeof opts.size === "number" && opts.size > 0) {
    svg.setAttribute("width", String(opts.size));
    svg.setAttribute("height", String(opts.size));
  }
  return svg;
}

/** 扫描 root 下 [data-icon] 占位并注入对应图标（保留占位的其他子节点——
 *  徽标等附加元素跟在图标之后）。data-icon-size=px / data-icon-class=类名
 *  透传（T-P3-157 批 2 机制扩展——骨架静态占位即可声明尺寸与语义色）。 */
export function injectIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (el.dataset.iconDone === "1") continue;
    el.dataset.iconDone = "1";
    el.prepend(icon(el.dataset.icon, {
      cls: el.dataset.iconClass || undefined,
      size: el.dataset.iconSize ? Number(el.dataset.iconSize) : undefined,
    }));
  }
}
