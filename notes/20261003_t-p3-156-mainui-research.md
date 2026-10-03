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
