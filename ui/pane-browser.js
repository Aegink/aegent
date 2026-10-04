/**
 * 浏览器面板（T-P3-156 方案 Q——用户裁决"完整实现+真实浏览器内核"）：
 * 桌面壳侧经 Tauri child Webview 承载真实 WebView2（src-tauri/src/browser.rs
 * 的 command 面：create/show/hide/navigate/destroy/eval）；每个浏览器 tab =
 * 面板宿主的一个 Tab（多实例并存，pane.js Tab 条天然承载）。
 *
 * 对齐机制：承载区 div.browser-host 的 DOM 区域经 ResizeObserver 上报
 * browser_show（CSS px → 物理 px ×devicePixelRatio——Rust 侧吃物理坐标）；
 * Tab 切走/关闭走 pane.js 的 onBlur 钩子 → browser_hide（保活不销毁——
 * 滚动/登录态不丢，zcode tab residency 简化版）；关闭 = browser_destroy。
 *
 * 安全边界：壳侧 webview 独立于宿主 WebView（不共享登录态/LocalStorage）；
 * web 端（浏览器直开 host）无 child webview 能力——承载区降级为外链引导。
 */

import { IS_DESKTOP } from "./api.js";
import { registerPane } from "./pane.js";
import { icon } from "./icons.js";

let seq = 0;
let activeTabId = null; // 当前渲染实例的壳侧 label（browser-<n>）
let observer = null;
let followTimer = null; // 主窗移动跟随轮询（300ms——等值短路零流量）

function tauriInvoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

/** 面板偏移上报（T-P3-168：相对视口的物理偏移——子窗屏幕位置由 Rust 在
 *  主窗 Moved/Resized 事件里直算，拖动/拖宽零延迟跟随；UI 只在尺寸变化
 *  时上报 offset，等值短路零流量）。单实例即可，paint 重挂时换绑。 */
function bindBoundsSync(hostEl, tabId) {
  if (observer !== null) observer.disconnect();
  let last = "";
  const report = () => {
    if (!hostEl.isConnected) return;
    const rect = hostEl.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    const dpr = window.devicePixelRatio || 1;
    const payload = `${Math.round(rect.left * dpr)},${Math.round(rect.top * dpr)},${Math.round(rect.width * dpr)},${Math.round(rect.height * dpr)}`;
    if (payload === last) return; // 等值短路
    last = payload;
    void tauriInvoke("browser_set_offset", {
      x: Math.round(rect.left * dpr),
      y: Math.round(rect.top * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr),
    }).catch(() => {});
  };
  observer = new ResizeObserver(report);
  observer.observe(hostEl);
  report(); // 初次上报
}

function normalizeUrl(raw) {
  const text = String(raw).trim();
  if (text === "") return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.includes(" ") || !text.includes(".")) {
    return `https://www.bing.com/search?q=${encodeURIComponent(text)}`; // 词组→搜索
  }
  return `https://${text}`;
}

registerPane("browser", {
  title: (tab) => tab.payload.title ?? "浏览器",
  icon: "globe",
  onClose: (tab) => {
    // 关闭 tab = 真销毁 webview（区别于切走的 hide 保活）
    if (IS_DESKTOP && tab.payload?.tabId) {
      void tauriInvoke("browser_destroy", { label: tab.payload.tabId }).catch(() => {});
    }
  },
  onBlur: (tab) => {
    if (IS_DESKTOP && activeTabId !== null) {
      void tauriInvoke("browser_hide", { label: activeTabId }).catch(() => {});
    }
    if (observer !== null) {
      observer.disconnect();
      observer = null;
    }
    if (followTimer !== null) {
      clearInterval(followTimer);
      followTimer = null;
    }
  },
  render: (body, tab) => {
    body.replaceChildren();
    if (!IS_DESKTOP) {
      // web 端降级（host 页面在普通浏览器里没有壳的 child webview 能力）
      const box = document.createElement("div");
      box.className = "empty-state";
      box.innerHTML = `<div class="empty-title">浏览器面板需要桌面壳</div><div class="empty-desc">此面板需桌面版支持（内嵌网页内核）；或<a href="${String(tab.payload.url ?? "https://www.bing.com")}" target="_blank" rel="noreferrer" style="white-space:nowrap">在系统浏览器打开</a>。</div>`;
      body.appendChild(box);
      return;
    }
    const isNew = tab.payload.tabId === undefined;
    const tabId = isNew ? `browser-${String(++seq)}` : tab.payload.tabId;
    tab.payload.tabId = tabId;
    activeTabId = tabId;

    const bar = document.createElement("div");
    bar.className = "browser-bar";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "browser-nav";
    backBtn.textContent = "←";
    backBtn.title = "后退（webview 历史面——经 eval 调 history.back）";
    const fwdBtn = document.createElement("button");
    fwdBtn.type = "button";
    fwdBtn.className = "browser-nav";
    fwdBtn.textContent = "→";
    const reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.className = "browser-nav";
    reloadBtn.textContent = "↻";
    const urlInput = document.createElement("input");
    urlInput.className = "input browser-url";
    urlInput.type = "text";
    urlInput.placeholder = "输入网址或搜索词…";
    urlInput.value = tab.payload.url ?? "";
    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "btn btn-primary browser-go";
    goBtn.textContent = "前往";
    bar.append(backBtn, fwdBtn, reloadBtn, urlInput, goBtn);

    const host = document.createElement("div");
    host.className = "browser-host";
    host.innerHTML = `<div class="browser-host-hint">正在加载内核…</div>`;
    body.append(bar, host);

    const navigate = (raw) => {
      const url = normalizeUrl(raw);
      if (url === "") return;
      urlInput.value = url;
      tab.payload.url = url;
      tab.title = url.replace(/^https?:\/\//, "").slice(0, 40);
      void tauriInvoke("browser_navigate", { label: tabId, url }).catch((e) =>
        console.error("browser_navigate", e),
      );
    };
    goBtn.addEventListener("click", () => navigate(urlInput.value));
    urlInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") navigate(urlInput.value);
    });
    backBtn.addEventListener("click", () => {
      void tauriInvoke("browser_eval", { label: tabId, js: "history.back()" }).catch(() => {});
    });
    fwdBtn.addEventListener("click", () => {
      void tauriInvoke("browser_eval", { label: tabId, js: "history.forward()" }).catch(() => {});
    });
    reloadBtn.addEventListener("click", () => {
      void tauriInvoke("browser_eval", { label: tabId, js: "location.reload()" }).catch(() => {});
    });

    // 创建/复用真实内核 → 对齐 bounds。T-P3-166 需求 5：加超时兜底——
    // 壳侧 webview 创建异常挂起时用户面对永恒「正在加载内核」无法自愈；
    // 超时/失败都给出可行动提示并清理注册表残留。
    void (async () => {
      const timedOut = new Promise((resolve) =>
        setTimeout(() => resolve("timeout"), 12_000),
      );
      try {
        const created = await Promise.race([
          tauriInvoke("browser_create", {
            label: tabId,
            url: tab.payload.url ?? "https://www.bing.com",
          }).then(() => "ok"),
          timedOut,
        ]);
        if (created === "timeout") {
          host.innerHTML = `<div class="browser-host-hint">内核创建超时——请重启 aegent 重试；若持续出现请反馈 logs/webview.log</div>`;
          return;
        }
        host.innerHTML = "";
        bindBoundsSync(host, tabId);
        // 首次对齐（子窗初始藏屏外——show 一次按当前面板区域落位）
        const rect0 = host.getBoundingClientRect();
        const dpr0 = window.devicePixelRatio || 1;
        void tauriInvoke("browser_show", {
          label: tabId,
          x: Math.round(rect0.left * dpr0),
          y: Math.round(rect0.top * dpr0),
          width: Math.round(rect0.width * dpr0),
          height: Math.round(rect0.height * dpr0),
        }).catch(() => {});
      } catch (e) {
        host.innerHTML = `<div class="browser-host-hint">内核创建失败：${String(e?.message ?? e)}——请重启 aegent 重试；若持续出现请反馈 logs/webview.log</div>`;
        void tauriInvoke("browser_destroy", { label: tabId }).catch(() => {});
      }
    })();
  },
});

/** 打开/聚焦浏览器 Tab（agent 联动入口——聊天流链接点击调此面）。 */
export function openBrowserPane(url, title) {
  return import("./pane.js").then((m) =>
    m.openPane("browser", { url, title }, { title }),
  );
}

/** 关闭全部浏览器资源（壳退出/会话切换兜底——当前不挂全局，Tab 关闭即销毁）。 */
export function disposeBrowserPanes() {
  if (!IS_DESKTOP || activeTabId === null) return;
  void tauriInvoke("browser_destroy", { label: activeTabId }).catch(() => {});
  activeTabId = null;
}
