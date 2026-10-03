/**
 * T-P3-156 主界面重构资产断言（自 ui-settings.test 拆出——diagnostics 域
 * 400 行纪律触顶即拆〔16d 三拆模式延续〕）：布局批（方案 A/B/C/D/E/W
 * 三栏壳/侧栏两分段/面板宿主/设置独立形态/内核信号消费）+ 功能批（K/L/U
 * 排队条·输入 Tab 栏·进度弹窗 + G/H/I 工具卡·子代理面板·分支会话）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");

function read(name: string): string {
  return readFileSync(path.join(uiDir, ...name.split("/")), "utf8");
}

describe("T-P3-156 · 主界面重构（布局批 A~W + 功能批 K~I）", () => {
  it("布局批：三栏壳 + 右上角常驻入口 + 面板宿主 + 侧栏两分段 + 内核信号消费", () => {
    const html = read("index.html");
    const app = read("app.js");
    const pane = read("pane.js");
    const sidebar = read("sidebar.js");
    const router = read("router.js");
    const css = read("style.css");
    expect(html).toContain('id="topbar"'); // 右上角常驻入口容器（需求一.4）
    expect(html).toContain('id="pane-toggle-btn"'); // 切换面板钮
    expect(html).toContain('id="terminal-btn"'); // 终端钮（面板批 P 接入显示）
    expect(html).toContain('id="progress-dock"'); // 进度弹窗挂点（需求一.5）
    expect(html).toContain('id="pane-root"'); // 面板宿主（与文件查看同位置）
    expect(html).toContain('id="terminal-drawer"'); // 终端抽屉容器（方案 P）
    expect(html).toContain('id="sidebar-resizer"'); // 侧栏拖宽条
    expect(html).toContain('id="sb-projects"'); // 侧栏项目分段（需求一.1）
    expect(html).toContain('id="sb-history"'); // 侧栏最近会话分段
    expect(html).toContain('id="sb-files"'); // 文件树滑入层（需求二.4）
    expect(html).toContain('id="notify-badge"'); // 通知徽标（迁顶栏铃铛）
    expect(pane).toContain("registerPane"); // 面板类型注册表（扩展点）
    expect(pane).toContain("openPane"); // 状态机入口
    expect(pane).toContain("renderFilePreview"); // 文件查看迁入（方案 C）
    expect(pane).toContain("localStorage"); // 宽度持久化（两段式）
    expect(sidebar).toContain("expandProject"); // 项目展开
    expect(sidebar).toContain("pinned"); // 置顶（方案 E）
    expect(sidebar).toContain("dragstart"); // 拖拽排序（方案 E）
    expect(sidebar).toContain("missing"); // 目录丢失徽章（方案 E）
    expect(sidebar).toContain("openFilePane"); // 文件树 → 面板预览联动
    expect(sidebar).toContain("agent:busy"); // 运行状态点事件源（方案 E）
    expect(app).toContain("initSidebar"); // 侧栏启动接线
    expect(app).toContain("initPane"); // 面板宿主启动接线
    expect(app).toContain('name === "idle"'); // W：空闲信号消费
    expect(app).toContain('name === "prompt_returned"'); // W：中止回填输入框
    expect(app).toContain('name === "config_refreshed"'); // W：切档回执 toast
    expect(app).toContain('name === "forked"'); // W：分支回执 → 侧栏刷新
    expect(app).toContain("agent:busy"); // 运行态广播（turn/start live）
    expect(app).toContain("sidebarWidth"); // 侧栏拖宽持久化
    expect(router).toContain("settings-mode"); // D：设置独立形态类切换
    expect(router).toContain('head === "projects"'); // A：旧路由重定向面
    expect(css).toContain("#topbar");
    expect(css).toContain("#pane-root");
    expect(css).toContain(".pane-tabbar");
    expect(css).toContain(".sidebar-resizer");
    expect(css).toContain(".sb-task-dot");
    expect(css).toContain("#app-shell.settings-mode #sidebar");
    expect(css).toContain("#terminal-drawer");
  });

  it("功能批：排队条 + 输入 Tab 栏 + 进度弹窗 + 工具卡升级 + 子代理面板 + 分支会话", () => {
    const html = read("index.html");
    const app = read("app.js");
    const composerBar = read("composer-bar.js");
    const progressDock = read("progress-dock.js");
    expect(html).toContain('id="queue-bar"'); // K：排队条容器
    expect(html).toContain('id="composer-tabs"'); // L：输入 Tab 栏
    expect(html).toContain('id="attach-file-input"'); // L：附件 +
    expect(html).toContain('id="progress-dock"'); // U：进度弹窗挂点
    expect(composerBar).toContain("steer"); // K：立即发送 = steer 注入在途轮
    expect(composerBar).toContain('"cancel"'); // K：停止 = cancel{cause:user}
    expect(composerBar).toContain('"model/switch"'); // L：模型快切
    expect(composerBar).toContain("PERMISSION_MODE_UI"); // L：权限五档菜单（basic 同源导出）
    expect(composerBar).toContain('op: "usage"'); // L：上下文 % 数据面
    expect(progressDock).toContain("DONE_STAY_MS"); // U：终态驻留
    expect(progressDock).toContain("agent:awaiting"); // U：审批挂起转橙
    expect(app).toContain("toolOpenState"); // G：展开态持久化
    expect(app).toContain("maybeCollapseReadonly"); // G：只读聚合（codex Exploring）
    expect(app).toContain('registerPane("subagent"'); // H：子代理同构面板
    expect(app).toContain("在面板打开"); // H：工具卡面板入口
    expect(read("sidebar.js")).toContain("forkTaskSession"); // I：分支会话表单
    expect(read("sidebar.js")).toContain('"session/fork"'); // I：fork wire 面
  });
});
