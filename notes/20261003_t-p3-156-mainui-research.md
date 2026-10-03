# 会话笔记：主界面调研报告（T-P3-156）

- 日期时间：2026-10-03（会话内完成）
- 工具/路线：三路 Explore 并发（A 路 zcode 深读 106 调用 / B 路 pideck+pi-desktop+pi 88 调用 / C 路 codex+qwen-code+opencode+我方内核 149 调用）
- 目标：T-P3-156 主界面批次调研报告——需求六部分 32 条逐条映射+布局级信息架构图示+A~X 方案分级，落 `docs/20261003_主界面对比与改造建议.md` 待用户裁决（对应用户需求原文"多看看参考项目然后给我报告我看了在改"）

## 步骤与观察
1. 开工三件套：七参考仓在位核对（zcode 872ad96 与任务书锚点一致）；对照清单「关于」T-P3-155 已收官、「主界面」第二部分为新卡无冲突；requirements 以任务书 §1 原文为准。
2. 三路并发派发：A 路首次与 B 路撞并发限制（user concurrency limit exceeded），A/C 完成后重派 B 路成功——三路串行补派是并发撞限的正确恢复姿势。
3. B 路纠偏两个预期偏差：`io.github.muzimu217.session-import` 插件三仓均不存在（pideck 扫描导入=会话级导入 DirectorySessionImporter，非项目添加模式）；PiDeck 与 PI-Desktop 是两个独立产品（前者 Electron React、后者 pnpm workspace+Rust host-core）。
4. C 路内核盘点关键发现：我方内核排队/steer/fork/config_refreshed 四能力齐备但 `host/bridge.ts:165-167` 广播的 idle/prompt_returned/config_refreshed/forked 被 `ui/app.js:1908-1956` handleEnvelope 丢弃——UI 接入内核零改动。
5. 报告结构：§1 需求 32 条映射（14 已有/6 部分/12 缺）→ §2 六张 ASCII 布局图（总布局/侧栏/右上角+进度弹窗/面板宿主/输入 Tab 条/设置独立页）→ §4 A~X 24 方案（XL×2+L×5+M×7+S×8）→ §5 待澄清 12 条（终端 node-pty/浏览器 Tauri multiwebview 均标【未验证】）→ §6 验收清单 10 条。

## 结论（一行）
主界面差距是信息架构级（侧栏非项目列表/无右上角/无面板宿主），方案 A 布局重构先行是其余项容器；内核三大能力（排队/fork/子代理流）UI 零露出但接入成本低。

## 未解决 / 下一步
- ~~用户裁决 A~X 方案+12 条待澄清~~ **已裁决（2026-10-03，同会话追加）**：①终端=node-pty 完整路线（portable spike 前置）；②浏览器=完整真实浏览器内核（不做 iframe MVP，multiwebview/CDP spike 前置）；③子代理=仅 AI 委派+面板查看；④其余全按报告建议（多根项目做/轻隔离/轮末发送为主+steer 并存/阈值 8KB 或 400 行/辅助对话落盘/文件树留侧栏滑入/四批切分）。裁决已写回报告 §0 裁决记录+§5 裁决结果表。
- 实施按四批推进：布局批（A/B/C/D/E/W）→功能批（G/H/I/K/L/U）→面板批（P/Q/R/S/T，P/Q spike 开工前先跑）→打磨批（F/M/N/O/X/V/J）
- 实施完成后对照清单第二部分新增「主界面」行

## 实施进度（2026-10-03 下午，全做裁决后四批推进）

- **布局批 A/B/C/D/E/W——已提交 aeeb3b0**：三栏壳（index.html 重写）/ui/pane.js 面板宿主状态机（registerPane 扩展点）/ui/sidebar.js 侧栏两分段（projects.js+history.js 迁入壳化）/router 重定向+settings-mode/app.js W 四信号（idle/prompt_returned/config_refreshed/forked）/拖宽两段式/keymap pane+new-task 动作。走查全绿（IAB：添加项目→展开→文件树→双 Tab 面板→关闭回落→设置独立形态→重定向→定位闪烁）。修复记录：initSidebar 提前于 connect 的 WS null（首拉移 hello 后）；renderFilePreview 的 back 块级作用域 ReferenceError；paint 漏 syncToggleBtn；切换面板钮改常显（需求一.4"固定"）。
- **功能批 K/L/U/G/H/I——已提交 54e2665**：ui/composer-bar.js（排队条+附件+/权限五档 pill（basic.js 导出 PERMISSION_MODE_UI/applyPermissionMode）+上下文 % pill（op:usage）+模型 pill（model/switch））/ui/progress-dock.js（进度 pill+hover 面板+终态 8s 驻留+审批转橙；启动 idle 误报已修=wasRunning 守卫）/G 工具卡（toolOpenState 持久化+失败摘要挂 summary.title+maybeCollapseReadonly 只读聚合≥3 张）/H registerPane("subagent") 同构面板（快照+刷新+5s 自动轮询+attachSubagentView 加"在面板打开"）/I forkTaskSession 表单（session/fork targetId+after|before+atSeq；任务行+会话行双入口）。走查：权限切档真实生效（config/refresh 回执 toast）、busy 模拟 pill+排队条形态、真轮 echo 走通 turn/start→end 全事件。**walkthrough 环境坑**：--host-db 是隔离清单库（sessions 清单空=预期，事件在主库）；启动期错误在 WS 前上不了日志（initComposerBar 已 try/catch 可见化）；IAB evaluate 动态 import 不可用（importModule 沙箱限制——用注入 module script 诊断）。**composer-bar.js 的 getSessionId 从 state.js 导（曾误从 api.js→整页模块加载失败）**。
- **Spike P 全绿**：node-pty 1.1.0（prebuilds/win32-x64/conpty.node）dev+portable 双环境 spawn cmd.exe exit 0。tools/build-host-bundle.mjs 改动：--external:node-pty+cpSync dereference（pnpm symlink EPERM）+**不过滤整包拷（"prebuilds" 含 "build" 子串会被路径级 filter 误杀）**（61.4MB 含全平台 prebuilds——瘦身边际在打磨批）。
- **Spike Q 编译通过**：src-tauri Cargo.toml 加 tauri features=["unstable"]；src-tauri/src/browser.rs（browser_create/show/hide/navigate/destroy→close/eval——child Webview 挂 Window.add_child（非 WebviewWindow）；WebviewUrl 在 tauri:: 顶层；set_bounds 吃 Position/Size enum（into()）；state guard 须先绑定再 lock）。cargo check 0 error。**真机验证待 tauri dev**。
- 面板批实施中：ui/pane-browser.js 已写（pane.js 加 onBlur/onActivate 钩子）；待做：host terminal-ops（node-pty+terminal-data notification 下行）/git-ops（status/diff/stage/commit/log——child_process git）/assistant-log op；UI terminal.js（xterm vendor 化）/git/review/assistant 四面板；测试断言+走查+提交。
- 测试拆分：ui-settings.test.ts 触 400 行纪律→T-P3-156 断言拆 src/diagnostics/ui-mainui.test.ts（两 describe）。

## 打磨批进度（2026-10-03 晚）

- **M 大文本粘贴→附件——已实施**：paste 链加大文本分支（>8KB 或 >400 行任一→File text/plain 入附件链）+addAttachment 白名单加 text/plain 通道+chip 命名 pasted-<HHMMSS>.txt。**待补**：chip 点击弹窗查看原文（attachments-preview chip 无点击面——下轮加 data-pasted 标记+模态）。
- **O 命令弹窗美化——已实施**：CSS 层（分组头/激活态 inset 光条/描述第二行/键位 kbd 标）。
- **F 多根项目——验证即达成**：数据模型本就是 roots 数组（projects.js T-P3-150 A1）+编辑对话框多行目录+卡片"N 个目录"meta——无需新代码，实测记档即可。
- **J 会话树 / V 轻隔离 / N 图片能力 / X 收尾——待下轮**：J=面板"会话树"Tab（fork-tree 数据源流内 session/fork 事件过滤渲染）；V=内核写路径约束（subagent.ts PathGuard 专属子目录——L 级内核改造单独立批）；N=host 模型 capabilities 元数据面缺失【诚实降级：附件图片 tooltip 提示+轮次错误可见，P2 补 host 能力面】；X=焦点管理/Esc 归还/i18n 词条收尾。
- 下轮：M chip 查看+J 树+N 记档落对照清单+X 收尾+对照清单新增主界面行+交接 handoff。

## 终局（2026-10-03 晚——四批全量完成）

- 全部 A~X 方案落地：布局批 aeeb3b0 / 功能批 54e2665 / 面板批 8e0e3d5 / 打磨批 eb023db+cfc7d4e / 交接 c8bfb92——已推 origin/main（e802c7f..c8bfb92）。
- 收尾验证：全量 2068 测试绿 / 架构 0 error / tsc 0 / 对照清单第二部分新增「主界面重构」行（待用户打勾）/handoff_2026-10-03_19-00.md 就位。
- V 轻隔离实测注意：任务派发子会话 id 含 "::"（Windows 文件名非法）——隔离目录名已净化（replaceAll ":","_"）。
- 遗留（P2 记档）：N 的 host 模型 capabilities 元数据面；V 的 per-child git worktree；node-pty portable 61MB 瘦身；桌面壳真机走查（终端 PTY 交互/浏览器 WebView2 bounds 跟随/焦点链）。
