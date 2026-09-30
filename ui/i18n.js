/**
 * 界面 i18n（T-P3-141 批次 B——zcode 自研轻量模式同构：平铺词典 + t()，
 * **中文原文即键**——未翻译字符串回退中文原文，翻译覆盖批次渐进零破坏）。
 * settings.appearance.language = "system" | "zh-CN" | "en"（system =
 * navigator.language 前缀判定——zcode localePreference 简化版；切换经设置
 * 保存后整页刷新生效，零构建链的全量等价面）。
 */

import { MESSAGES as EN } from "./locales/en-US.js";

let locale = "zh-CN";

export function currentLocale() {
  return locale;
}

/** 偏好解析（system → navigator 前缀；zh* 归一 zh-CN）。 */
export function resolveLocalePreference(pref) {
  if (pref === "zh-CN" || pref === "en") return pref;
  const nav = (typeof navigator !== "undefined" && navigator.language) || "zh-CN";
  return nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/**
 * 翻译（zh 文本即键）：词典缺失回退原文；{key} 占位替换。批次一覆盖 =
 * 骨架导航 + 设置域框架 + 外观页；其余文案随批次二补词典（不改调用点）。
 */
export function t(zh, params) {
  let s = locale === "zh-CN" ? zh : (EN[zh] ?? zh);
  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** 应用语言偏好（设置加载/切换时调用——document.lang + 静态 DOM 扫描）。 */
export function applyLocalePreference(pref) {
  locale = resolveLocalePreference(pref);
  document.documentElement.lang = locale;
  applyI18nDom();
  return locale;
}

/** 静态 DOM 扫描（data-i18n / data-i18n-placeholder / data-i18n-title——
 *  index.html 骨架的零构建翻译面；JS 渲染面直接调 t()）。 */
export function applyI18nDom(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n") ?? "");
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder") ?? ""));
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title") ?? ""));
  }
}
