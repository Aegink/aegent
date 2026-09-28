# P3 实施计划（产品化层）

> **性质**：P3 优先级层全阶段计划（U 域 21 条 / 批次 16a+16b+16c / 24 张卡），2026-09-28 展卡（同日两次扩充——①UI 功能组：用户裁决"UI 精美化太少了，参考仓库成熟软件的多个功能多个 UI"；②产品扩展组：用户裁决"再多看看各个仓库，还可以补充更多"——深读 pi-desktop·workpanel/services、cc-switch·mcp/prompts/profiles/providers 子域、pi·tui 编辑器组件后新增 U15~U21）——**"让 aegent 从内核变成产品"**。
> **执行协议**：沿用 [`plan-p0.md`](plan-p0.md) §0；推进模式一会话一批次（16a → 16b）。
> **锚点纪律**：U 域 21 条锚点于 2026-09-28 展卡逐一核对——两轮深读：①产品 UI 清单（cc-switch·src/components 38 件 + pi-desktop·src/components 46 件——ComposerAutocomplete 五类补全图标集 / StartupRecovery 的 startup-watchdog 诊断面 / cc-switch settings 的 AuthCenter·BackupList·Proxy·Language 分节）；②产品扩展面（pi-desktop·workpanel 五 Tab——ReviewTab 的 `reviewChangesFromMessages`+`summarizeReviewChanges` 与 SubagentPanel 的 delegation 状态/耗时/失败收集、cc-switch·mcp 向导四件/prompts 五件/profiles 两件/providers·FailoverPriorityBadge、settings·EnhancementModelCard（ADR 0121 辅助模型）、deeplink 三确认、pi·tui editor/kill-ring/alt-screen-search/fuzzy 编辑器组件——行为证据取自组件名与源码头注释）。
> **执行前置**：批次 16a/16b/16c 在批次 15a~15e（P2，[`plan-p2.md`](plan-p2.md)）收官之后——U3 依赖 15a 的 Q2、U12 依赖 15e 的 J21、U13 依赖 15d 的 N5 与 M3、U15 依赖 15a 的 Q2 与 P1 的 E5/H2、U18 依赖 15b 的 C42、U19 依赖 P1 的 J15、U8 依赖 15d/15b/15c 面。

## §1 全局约束（P3 段）

1. **一份资产两端共用不变**：全部 UI 条目只动 `ui/`——桌面壳（K2）与网页（K5）同时受益，不出现第二份 UI。
2. **凭据红线全程**：U2 的 key 管理走 DPAPI/私有档，配置文件与日志零明文；U8 各平台凭据由用户提供、掩码入 `private/`。
3. **构建链最小化**：不引入前端框架（React/Vite 不取——ui/ 原生 ES module 已工作，重写无验收收益）；渲染增强用 marked（MIT）+ highlight.js（BSD-3）两个纯库 vendor 本地化（`ui/vendor/`，THIRD_PARTY 登记）。
4. **渲染安全防呆**：markdown 渲染只作用于**模型产出**（assistant），用户输入不渲染（注入面禁足）；marked 配置禁 HTML 透传。
5. **体积目标分列陈述**：§6.1 的 60MB 是"壳"目标；U6 引入运行时随包后安装器体积分列（壳 + runtime），不混用旧口径。
6. **工程纪律不变**：新域 managed:true 入册；工具链四件收官必跑；count-features = **331**（P3 列 21 条）。

## §3 批次 16a 卡序（6 张：U1/U2/U14/U5/U3 + 收口——产品地基：配置与设置中心；2026-09-28 展卡）

**展卡核对结论（16a）**：
1. **U1/U2/U14/U5 的行为蓝本就是 cc-switch 的产品主题**（多供应商配置切换）——settings/ 组件族分节形态（AuthCenter 凭据/DirectorySettings/LanguageSettings/GlobalProxySettings/AboutSection）直接映射我方设置中心分节；我方增量 = `~/.aegent/settings.json` + 优先级链 + 三入口接线（实测发现 CLI/host/桌面全靠环境变量——真实空白）。
2. **U14 设置中心是 U1/U2/U5 的渲染端**——一卡承载避免"配置面落两次"（CLI 命令与 UI 页共用同一 settings 模块）；主题面按 cc-switch theme-provider 行为（全端一致暗/亮）。
3. **U3 消费两个既有面**（Q2 检索 + M3 resume）——本卡是入口面（UI 侧栏 + CLI 子命令），不是新机制。

**词汇表预判**：16a 全部零事件（入口/渲染/分发面——既有词汇在位）。

#### T-P3-101 · U1 · 配置文件面（settings 持久化 + 优先级链） `[ ]`
- **依据需求**：U1（"settings 持久化（provider 列表、默认端点/模型、权限档、沙箱档、外观）；环境变量 > 配置文件 > 默认值；损坏配置 fail-closed 且给出修复指引"）
- **上游首选参考**：[cc-switch·src/config.rs](../oss/cc-switch/src-tauri/src/config.rs) + [app_store.rs](../oss/cc-switch/src-tauri/src/app_store.rs)（配置读写/迁移/默认值的产品形态）
- **取什么 / 别抄什么**：取"配置分层（默认值 → 文件 → 环境变量覆盖）+ 损坏 fail-closed + 迁移版本号"行为；不抄其 Rust 结构与其多应用切换语义（我方单应用）
- **要产出**：`src/session/settings.ts`——`SettingsShape`（provider 列表/默认 provider+model/权限档/沙箱档/外观/语言）+ `loadSettings(dir?)`（`~/.aegent/settings.json`：损坏 → SettingsError 带行列号与修复指引）+ 优先级合并（env > file > default——AEGENT_* 对接）+ `--settings <path>` 参数面；CLI/host/桌面三入口接线（不带环境变量可启动）
- **验收**：`npx vitest run src/session/settings.test.ts src/cli/index.test.ts`（扩）——三档优先级合并 + 损坏 fail-closed（错误带指引）+ 默认值启动 + 三入口接线断言
- **依赖**：无（16a 首卡）
- **风险 / 未知**：配置 schema 版本迁移（v1 起步——迁移链 sqlite 同款纪律）

#### T-P3-102 · U2 · 凭据管理入口（录入/更换/删除 + DPAPI 落盘） `[ ]`
- **依据需求**：U2（"key 的录入/更换/删除走 CLI/UI；落盘经 DPAPI 加密；配置文件与日志零明文"）
- **上游首选参考**：[cc-switch·app_store.rs](../oss/cc-switch/src-tauri/src/app_store.rs)（凭据隔离存储）+ [codex·dpapi.rs](../oss/codex/codex-rs/windows-sandbox-rs/src/dpapi.rs)（P0 D8 已落加密面）
- **取什么 / 别抄什么**：取"凭据与配置分离存储 + 专用管理命令"行为；DPAPI 面复用 D8
- **要产出**：`src/session/credentials.ts`——`setKey/getKey/deleteKey`（provider 维度；DPAPI 加密落 `~/.aegent/credentials.bin`——非 Windows 回退 0600 权限文件记档）+ CLI `aegent key set/get/delete <provider>` + settings 面集成（settings.json 零 key 断言）+ 零明文扫描
- **验收**：`npx vitest run src/session/credentials.test.ts`——往返 + 加密断言 + 删除面 + 零明文 + 非 Windows 回退
- **依赖**：T-P3-101
- **风险 / 未知**：DPAPI 非交互会话可用性（P0 已验证面）

#### T-P3-103 · U14 · 设置中心与主题（U1/U2/U5 的完整渲染端） `[ ]`
- **依据需求**：U14（"provider 管理/凭据/权限档/沙箱档/代理/语言/日志/关于的多分节设置页 + 暗/亮主题切换"）
- **上游首选参考**：[cc-switch·settings/ 组件族](../oss/cc-switch/src/components/settings)（About/AuthCenter/DirectorySettings/LanguageSettings/GlobalProxySettings/BackupListSection 分节形态）+ [theme-provider](../oss/cc-switch/src/components/theme-provider.tsx)
- **取什么 / 别抄什么**：取"多分节设置页 + 分节即改即存 + 主题全端一致"行为；AuthCenter 分节映射我方凭据页（U2）；代理/备份分节不取（无对应面——YAGNI 记档）
- **要产出**：`ui/` 设置页（多分节：供应商管理/凭据/权限与沙箱档/外观主题/语言/关于——即改即存 settings 面）+ 主题切换（CSS 变量方案——`ui/style.css` 主题变量化）+ 导航入口（状态栏齿轮）；分节与 settings 模块一一对应断言
- **验收**：ui 资产断言（分节齐全/主题变量在位）+ settings 往返（UI 改 → 文件变 → 重启生效）+ 人工走查列确认清单
- **依赖**：T-P3-101/102（settings + 凭据模块）
- **风险 / 未知**：即改即存的保存时序（防抖——卡内定形）

#### T-P3-104 · U5 · 模型/端点管理 UI（多供应商切换 + 健康徽标） `[ ]`
- **依据需求**：U5（"多供应商列表、会话期切换、健康徽标"）
- **上游首选参考**：[cc-switch 核心形态](../oss/cc-switch)（多供应商配置一键切换——本仓的产品主题即此）
- **取什么 / 别抄什么**：取"供应商卡片列表 + 一键切换 + 状态显示"的界面行为；不抄其 Claude/Codex/Gemini 特定配置语义
- **要产出**：设置页供应商分节（列表/新增/编辑/默认标记——U1 渲染端）+ 会话期切换（UI 下拉 → `model/switch` 请求——J6 wire 面已有，即时生效下一轮）+ 健康徽标（J16 probeProvider 的 UI 消费——列表项状态点，探测节流）
- **验收**：`npx vitest run src/host/server.test.ts`（扩）+ ui 资产断言——切换请求往返 + 下一轮 request/header modelId 变化 + 健康探测触发
- **依赖**：T-P3-101/102/103
- **风险 / 未知**：切换时在途轮语义（J6 既有——新 turn 生效）

#### T-P3-105 · U3 · 会话历史管理（列表/续聊/删除入口） `[ ]`
- **依据需求**：U3（"历史会话列表/续聊/删除；崩溃恢复一键续跑"）
- **上游首选参考**：[pi-desktop 会话列表行为](../oss/pi-desktop)（🔴 只学行为：列表信息架构）+ P2 15a 的 Q2 检索面
- **取什么 / 别抄什么**：取"列表（时间/标题/状态）+ 点开续聊 + 删除确认"的信息架构；机制全部复用（Q2/resume/Q4）——入口面
- **要产出**：①CLI：`aegent sessions list/resume/delete` 子命令；②UI 侧栏：历史列表 + 续聊按钮（query 信封扩展 `op:"sessions"`——wire 形状扩展先例）+ 删除确认对话框
- **验收**：`npx vitest run src/session/sessions-cli.test.ts src/host/server.test.ts`（扩）——三面 + resume 一键 + UI 资产断言
- **依赖**：P2 15a（Q2/Q4）；T-P3-101
- **风险 / 未知**：wire query 扩展形状（op 枚举追加——批次 12/14 先例）

#### T-P3-106 · 收口 · 16a 盘点 `[ ]`
- **依据需求**：批次 16a 收口
- **要产出**：盘点面：①U1 优先级链 × 三入口一致性；②U2 凭据零明文全链扫描；③U14 设置分节 × settings 模块一一对应；④U5 切换 × J6 语义（新 turn 生效）；⑤快照即规格：设置改 → 文件变 → 重启生效一条
- **验收**：`npx vitest run`（全量）+ 工具链四件 + license-audit
- **依赖**：T-P3-101 ~ 105
- **风险 / 未知**：无

## §4 批次 16b 卡序（10 张：U4/U9/U10/U11/U12/U13/U6/U7/U8 + 收口——体验与分发；2026-09-28 展卡）

**展卡核对结论（16b）**：
1. **对话体验组（U4/U9/U10）的行为证据来自本轮深读**：pi-desktop ComposerAutocomplete 的补全面五类（文件/文件夹/斜杠命令/插件/技能——图标集为证）；ConversationMinimap 是长会话结构导航（React memo 化——行为是"轮次结构条 + 点击跳转"）；SearchDialog/SearchSessionResults 是会话内与跨会话两级搜索。
2. **U11 项目管理是 pi-desktop 最重的产品语义**（Project* 六件：切换/建/改/删/指令/记忆）——我方映射：workspace 目录切换（host 单会话模型的扩展——项目 = workspace+settings 组合档）+ 项目级指令页（goal/set 面入口化）；多项目并存的 host 语义（session 隔离）执行时定形。
3. **U12 两个消费端**：ContextUsageInspector（上下文余量/压缩状态——F 族与 E17 的可视化）+ cc-switch usage 族（成本页——J21 消费端）。
4. **U13 五件套全是"不打断"纪律**：NotificationCenter/Toast（N5 分型 UI 消费）、OnboardingChecklist（首次引导不挡路）、StartupRecovery（M3 可视化——诊断信息 + 一键续跑，pi-desktop 的 startup-watchdog 诊断面）、UpdateBanner/ReleaseNotesDialog（U7 消费端）。
5. **U6 定形点**（展卡预判）：node 运行时随包三案——①node 22 SEA（需 esbuild bundle 成单文件 CJS）②便携 node.exe 随包（+~80MB，最稳）③用户自装 node（不满足双击即用）。**倾向 ①**（真单文件 ~50MB）；better-sqlite3 原生模块是 ①案最大风险点，SEA 实测失败回退 ②。
6. **U7 依赖 U6 分发形态**（升级包 = sidecar 产物的版本化）；签名走 minisign（cc-switch pubkey 形态）。
7. **U8 是人工确认清单的闭环卡**——每项都需要用户提供真实凭据/环境；跑不掉的明确"放弃"记档（不悬挂）。

**词汇表预判**：16b 全部零事件预判（渲染/导航/分发面）；U10 粘贴图走 P1 附件链（attachments 载荷已有）；无立案候选。

#### T-P3-107 · U4 · UI 渲染分层基础（markdown/高亮/流式/工具卡/diff） `[ ]`
- **依据需求**：U4（"markdown 与代码高亮渲染（含代码块复制按钮）、流式打字节流、工具调用卡展开、审批卡优化、错误与重试交互；一份资产两端共用"）
- **上游首选参考**：[pi·client](../oss/pi/packages/client)（🔴 只学行为：渲染分层与增量更新纪律）
- **取什么 / 别抄什么**：取"渲染分层（纯文本/markdown/代码）+ 增量追加不重排"行为；不抄其 React 框架（全局约束 3——原生 + marked/highlight.js 两 vendor 库）
- **要产出**：①`ui/vendor/`（marked + highlight.js 本地化 + THIRD_PARTY 登记）；②渲染分层：assistant 走 markdown+高亮（**用户输入不渲染**——注入面防呆，marked 禁 HTML 透传）；③流式打字：text-delta 节流追加（requestAnimationFrame）；④工具卡展开：tool/call→result 成对折叠卡（args JSON 格式化 + 写操作 diff 对照）；⑤审批卡优化（C55 alternatives 展示）+ 错误重试交互
- **验收**：`npx vitest run src/diagnostics/tauri-shell.test.ts`（扩）+ ui 资产冒烟 + **人工走查列确认清单**（XSS 评审落完成记录）
- **依赖**：T-P3-106（16a 收口）
- **风险 / 未知**：XSS 面（marked 配置白名单策略）

#### T-P3-108 · U9 · 对话导航与检索 UI（搜索两级 + 长会话小地图） `[ ]`
- **依据需求**：U9（"会话内搜索、跨会话搜索、长会话小地图"）
- **上游首选参考**：[pi-desktop·SearchDialog/SearchSessionResults/ConversationMinimap](../oss/pi-desktop/apps/desktop/src/components)（🔴 只学行为）
- **取什么 / 别抄什么**：取"会话内搜索高亮跳转 + 跨会话搜索列表跳转 + 轮次结构导航条"三行为；不抄其 React 实现
- **要产出**：①会话内搜索（Ctrl+F 面板：命中高亮 + 上下跳转——渲染层文本检索）；②跨会话搜索（Q2 检索的 UI 消费——结果列表 → 点开续聊）；③小地图（消息类型着色条 + 点击跳轮——纯 DOM 实现）
- **验收**：ui 资产断言 + `npx vitest run src/host/server.test.ts`（扩——跨会话搜索走 query 面）+ 人工走查
- **依赖**：T-P3-107；P2 15a Q2
- **风险 / 未知**：小地图在超长会话的渲染性能（虚拟化——按需记档）

#### T-P3-109 · U10 · 输入区升级（Composer：多行 + 五类补全 + 粘贴图） `[ ]`
- **依据需求**：U10（"多行编辑、@文件/@目录补全、斜杠命令与技能补全、粘贴图片入附件面"）
- **上游首选参考**：[pi-desktop·ComposerAutocomplete](../oss/pi-desktop/apps/desktop/src/components)（补全面五类：文件/文件夹/斜杠/插件/技能）+ [pi·tui·autocomplete](../oss/pi/packages/tui)（🔴 只学行为）
- **取什么 / 别抄什么**：取"@ 触发文件补全 + / 触发命令补全 + 键盘导航"行为；插件类补全不取（无插件清单面——I5 落地后随需要）
- **要产出**：textarea 多行编辑（Shift+Enter 换行/Enter 发送）+ @补全（workspace 文件清单——host 只读列举面）+ /补全（斜杠命令 + 已注册工具/技能清单）+ 粘贴图片（clipboard → P1 附件链 attachments）
- **验收**：ui 资产断言 + `npx vitest run src/kernel/agent-process.test.ts`（扩——带附件 prompt 链已有）+ 补全清单来源断言
- **依赖**：T-P3-107
- **风险 / 未知**：workspace 文件列举的面（host 只读 list——wire 扩展先例）

#### T-P3-110 · U11 · 项目/工作区管理（多项目列表 + 指令记忆页） `[ ]`
- **依据需求**：U11（"多项目列表与切换、项目级指令与记忆页、新建/编辑/删除项目对话框"）
- **上游首选参考**：[pi-desktop·HomeProjectSwitcher/ProjectCreateDialog/ProjectEditDialog/ProjectInstructionsDialog/ProjectMemoryDialog](../oss/pi-desktop/apps/desktop/src/components)（🔴 只学行为）
- **取什么 / 别抄什么**：取"项目 = workspace + 配置组合档 + 项目级指令随会话生效"的行为；多项目 host 语义（session 隔离）执行时定形——倾向每项目一 session（AgentHost registry 已多会话）
- **要产出**：settings 项目档（列表：name/workspace/path/指令）+ UI 项目页（切换/新建/编辑/删除 + 项目指令与记忆编辑页——goal/set 面）+ 切换联动（host server 的 sessionId 路由——registry 已多会话）
- **验收**：`npx vitest run src/session/settings.test.ts`（扩——项目档）+ `src/host/server.test.ts`（扩——跨项目切换路由）+ ui 资产断言
- **依赖**：T-P3-103（会话侧栏——切换的载体）
- **风险 / 未知**：多项目并发会话的租约面（每会话独立租约——既有语义复用）

#### T-P3-111 · U12 · 用量与上下文可视化（检查器 + 成本页） `[ ]`
- **依据需求**：U12（"上下文余量检查器（token 用量/窗口占比/压缩状态）、成本统计页（按会话/按轮）"）
- **上游首选参考**：[pi-desktop·ContextUsageInspector](../oss/pi-desktop/apps/desktop/src/components) + [cc-switch·usage 组件族](../oss/cc-switch/src/components)（UsageFooter/UsageScriptModal）
- **取什么 / 别抄什么**：取"余量可见可解释（含压缩状态）+ 成本两级聚合"行为；不抄其图表库（纯 DOM/SVG 最小面）
- **要产出**：①上下文检查器：当前窗口 token 用量/占比/压缩次数与最近压缩状态（E17/F 族事实的 UI 消费——query 面 + usage 载荷）；②成本统计页：按会话/按轮成本（J21 面消费端）
- **验收**：ui 资产断言 + `npx vitest run src/obs/`（扩——聚合面既有）+ 数据源断言（usage 载荷单源）
- **依赖**：P2 15e（J21）；T-P3-107
- **风险 / 未知**：压缩状态的实时性（事件流推送——已有）

#### T-P3-112 · U13 · 通知与引导体验（五件套：通知/引导/恢复/更新横幅/发布说明） `[ ]`
- **依据需求**：U13（"通知中心与 Toast、首次运行引导清单、启动恢复页（诊断+一键续跑）、更新横幅与发布说明弹窗"）
- **上游首选参考**：[pi-desktop·NotificationCenter/OnboardingChecklist/StartupRecovery/UpdateBanner/ReleaseNotesDialog](../oss/pi-desktop/apps/desktop/src/components)（🔴 只学行为——StartupRecovery 的 startup-watchdog 诊断面）
- **取什么 / 别抄什么**：取"通知分型聚合 + 引导不挡路 + 恢复诊断一键续跑 + 更新不打断"四行为；发布说明弹窗内容本地化（CHANGELOG 摘要）
- **要产出**：①通知中心（N5 四类分型的 UI 消费——聚合面板 + Toast 轻提示）；②首次引导（功能清单式 onboarding——settings 首跑标记）；③启动恢复页（host 重连时的 M3 resume 诊断 + 一键续跑按钮）；④更新横幅（U7 的更新可用提示）+ 发布说明弹窗
- **验收**：ui 资产断言 + `npx vitest run src/host/notify.test.ts`（扩——分型消费）+ 人工走查
- **依赖**：P2 15d N5；T-P3-107；T-P3-114（更新器——横幅消费端，卡序内后置接线）
- **风险 / 未知**：引导清单的内容定形（首跑检测——settings 标记）

#### T-P3-113 · U6 · 桌面壳 sidecar 分发（双击即用） `[ ]`
- **依据需求**：U6（"壳管理 host 进程生命周期（启动/健康/退出收束）；node 运行时随包；双击即用"）
- **上游首选参考**：[cc-switch·tauri 侧](../oss/cc-switch/src-tauri)（externalBin sidecar 形态）
- **取什么 / 别抄什么**：取"壳 = 进程管理器"行为；运行时方案执行时定形（展卡预判：**倾向 esbuild bundle 成单文件 CJS + node 22 SEA** 真单文件 ~50MB；SEA 实测失败回退便携 node.exe 随包 +~80MB——全局约束 5 体积分列陈述）
- **要产出**：①host 单文件 bundle 面（esbuild devDep + `build:single` 脚本）；②SEA 产物流程脚本或便携 node 回退；③Tauri 壳 Rust 侧进程管理（起 sidecar/健康探测/退出收束）；④壳启动参数来自 U1 配置
- **验收**：**真实机器双击 exe → 自起 host → UI 可对话（人工验收）** + `npx vitest run src/diagnostics/tauri-shell.test.ts`（扩——sidecar 配置形状）+ 体积分列数字落完成记录
- **依赖**：T-P3-101（配置）；批次 13 K2 壳面
- **风险 / 未知**：SEA 对 better-sqlite3 原生模块的兼容（①案最大风险——失败即回退 ②）；Windows Defender 误报（签名面随 U7）

#### T-P3-114 · U7 · 自动更新（updater + 版本清单 + 签名，本地演示面） `[ ]`
- **依据需求**：U7（"updater 插件 + 版本清单 + 签名校验；本地演示面——分发渠道不建"）
- **上游首选参考**：[cc-switch·tauri-plugin-updater](../oss/cc-switch/src-tauri/Cargo.toml)（pubkey + endpoints 形态）
- **取什么 / 别抄什么**：取"签名 + 清单 + 插件校验安装"链路；不建真实分发渠道（endpoints 指向本地/localhost——演示面）
- **要产出**：tauri-plugin-updater 接入（插件解禁例外——updater 单插件入册）+ minisign 密钥对流程（私钥 `private/`）+ `latest.json` 生成脚本（tools/）+ 本地演示两路（校验通过/拒绝）+ 更新横幅接线（T-P3-112 消费端）
- **验收**：本地 updater 演示两路落完成记录 + `npx vitest run src/diagnostics/tauri-shell.test.ts`（扩）
- **依赖**：T-P3-113（sidecar 产物）
- **风险 / 未知**：updater 的 https 要求（本地演示例外配置——执行时定形）

#### T-P3-115 · U8 · 真实平台联调收尾（人工确认清单闭环） `[ ]`
- **依据需求**：U8（"Anthropic 真实端点、飞书/Slack 真实机器人、STT 真实端点、OAuth 真实流程、ACP 真实客户端——人工确认清单逐项闭环"）
- **上游首选参考**：各平台真实环境（P1/P2 联调项汇总闭环——无单一新锚）
- **取什么 / 别抄什么**：——（验证卡）
- **要产出**：逐项联调记录（每项：凭据掩码入 `private/` + 实测结果 + 缺口修复或放弃理由）：①Anthropic 真实端点一轮（cache_control 策略）；②飞书/Slack 真实机器人一轮；③STT 真实端点；④OAuth 真实流程；⑤ACP 真实客户端；⑥Windows 真机桌面壳+S4 屏幕操作
- **验收**：人工确认清单逐项状态更新（转正/放弃两态——不悬挂）+ 联调缺口若涉产品代码 → 当场修复回归
- **依赖**：P2 15d/15e 全部 + T-P3-113（桌面壳真机）
- **风险 / 未知**：**各项都需要用户提供真实凭据/环境**——不可用项明确记档放弃（不阻塞 P3 收官）

#### T-P3-116 · 收口 · P3 盘点 + 产品化终验收 `[ ]`
- **依据需求**：批次 16a/16b 收口
- **要产出**：盘点面：①U1 优先级链 × 三入口一致性；②U2 凭据零明文全链扫描；③U14 设置分节 × settings 模块一一对应；④U4 渲染 XSS 面评审结论；⑤U6 分发形态定形记录（SEA 或回退）+ 体积分列陈述；⑥U8 闭环状态表；⑦快照即规格：双击 exe 全链一条（人工）+ 设置改→文件变→重启生效一条
- **验收**：`npx vitest run`（全量）+ 工具链四件（count-features = 324）+ license-audit + **P3 对账**：14 条逐条状态表入 progress
- **依赖**：T-P3-101 ~ 115 全部
- **风险 / 未知**：无

## §5 批次 16c 卡序（8 张：U15/U16/U17/U18/U19/U20/U21 + 收口——产品扩展组；2026-09-28 展卡）

**展卡核对结论（16c）**：
1. **U15 工作面板是本轮最大发现**：pi-desktop 把"agent 干活的过程可视化"做成三 Tab——ReviewTab 从消息流提取变更（`reviewChangesFromMessages` 纯函数 + `summarizeReviewChanges` 汇总）+ SubagentPanel 收集委派状态/耗时/失败（`collectDelegation*` 三收集器）——我方数据面全在（tool/call·result 流内事实 + E5/H2 子代理事件），缺的是可视化面板。
2. **U16 提示词库 ≠ I8 人格预设**：I8 是系统级 agent 预设（persona），U16 是用户自建模板库（cc-switch PromptLibrary 五件——库/表单/条目）；调用面共用 Composer 斜杠补全（U10）。
3. **U17 MCP 向导**：cc-switch 的 McpWizardModal 分步向导 + useMcpValidation 校验——我方 mcp 域（P0 已落）的管理 UI 空白面。
4. **U18 辅助模型卡 = C42 的配置 UI 面**：pi-desktop ADR 0121 原文"哪个模型改写 Composer 草稿、带多少 reasoning"——判官/摘要/标题等辅助任务的模型与主对话模型分离配置；我方 C42（P2 15b）判官的 provider 独立配置正对应此卡。
5. **U19 Profiles = 配置组合档**（provider+模型+权限一键切场景）+ FailoverPriorityBadge（J15 故障转移顺序的 UI 消费——P1 已落故障转移队列库面）。
6. **U20 导入导出/深链**：cc-switch 的 BackupListSection/ImportExportSection + deeplink 三确认（MCP/提示词/技能导入必确认——安全面：深链导入是不可信输入，确认面是 C 族防线）。
7. **U21 CLI 也是产品入口**（K1）：pi·tui 的编辑器组件（kill-ring 剪贴环/alt-screen-search/fuzzy 模糊搜索）是现代 TUI 手感的三件——REPL（readline 行式）升级为自绘编辑面的渐进路线执行时定形（倾向 kill-ring+模糊历史搜索先行，全 TUI 重绘 YAGNI 记档）。

**词汇表预判**：16c 全部零事件预判（面板/库/向导/配置面——既有事件与 wire 词汇在位）。

#### T-P3-117 · U15 · 工作面板三 Tab（文件树/变更评审/子代理监控） `[ ]`
- **依据需求**：U15（"文件树浏览、变更评审 Tab、子代理监控 Tab"）
- **上游首选参考**：[pi-desktop·workpanel 五件](../oss/pi-desktop/apps/desktop/src/components/workpanel)（WorkPanel/FilesTab/ReviewTab/SubagentPanel——🔴 只学行为）
- **取什么 / 别抄什么**：取"三 Tab 工作面板 + 变更从消息流提取纯函数 + 委派状态收集器"三行为；不抄其 React 状态管理
- **要产出**：①ui/ 工作面板（侧栏第二 Tab 区）：文件树 Tab（workspace 只读树——U10 的列举面复用 + 点击预览）；②变更评审 Tab（从事件流提取 write/edit/bash 写操作的文件清单——新增/修改/删除分组 + 会话汇总统计——**纯函数从流提取**，不另建状态）；③子代理监控 Tab（子代理会话列表 + 委派状态/耗时/失败——H2 面的 query 消费）
- **验收**：ui 资产断言 + `npx vitest run src/session/review-changes.test.ts`（新——提取纯函数：从流算变更清单/汇总）+ 子代理监控数据源断言 + 人工走查
- **依赖**：T-P3-107（16b 渲染基础）；P2 15a Q2；P1 E5/H2
- **风险 / 未知**：文件树在大 workspace 的性能（懒加载子目录——按需记档）

#### T-P3-118 · U16 · 提示词库（用户模板 CRUD + 斜杠调用） `[ ]`
- **依据需求**：U16（"用户自建/编辑/删除 prompt 模板；Composer 斜杠调用时列出"）
- **上游首选参考**：[cc-switch·prompts 五件](../oss/cc-switch/src/components/prompts)（PromptLibrary/PromptFormPanel/PromptListItem——🔴 只学行为）
- **取什么 / 别抄什么**：取"库列表 + 表单编辑 + 条目管理"形态；与 I8 persona 的分界记档（系统预设 vs 用户模板）
- **要产出**：`src/session/prompt-library.ts`（模板 CRUD——settings 同域存储或独立档）+ ui/ 库页（列表/表单/删除确认）+ Composer `/` 补全并入库内模板（U10 补全面扩展）+ 选中即填入输入框（模板变量占位符 `{{var}}` 最小面）
- **验收**：`npx vitest run src/session/prompt-library.test.ts`——CRUD + 变量占位 + settings 隔离断言 + ui 资产断言
- **依赖**：T-P3-103（U14/U10 面）
- **风险 / 未知**：模板变量语法（`{{var}}` 单一约定——YAGNI 记档）

#### T-P3-119 · U17 · MCP 管理向导（分步添加 + 校验 + 统一面板） `[ ]`
- **依据需求**：U17（"MCP server 的向导式添加、统一管理面板（启停/编辑/删除）、连接校验"）
- **上游首选参考**：[cc-switch·mcp 四件](../oss/cc-switch/src/components/mcp)（McpWizardModal/McpFormModal/UnifiedMcpPanel/useMcpValidation——🔴 只学行为）
- **取什么 / 别抄什么**：取"向导分步（类型选择→参数→校验→保存）+ 统一面板 + 连接校验"三行为；不抄其特定生态预设
- **要产出**：ui/ MCP 管理页（settings 分节扩展）：向导式添加（stdio/http 两型分步表单）+ 统一面板（清单/启停/编辑/删除）+ 连接校验（launch 测试——mcp 域既有连接面）+ 配置落 settings（MCP server 清单——mcp 域装配消费）
- **验收**：`npx vitest run src/mcp/`（扩——settings 装配面）+ ui 资产断言 + 向导往返
- **依赖**：P0 mcp 域；T-P3-103（设置页）
- **风险 / 未知**：MCP server 真实进程的校验演示（echo 型 mock server——真实生态联调随 U8）

#### T-P3-120 · U18 · 辅助模型配置卡（判官/摘要等增强任务分档） `[ ]`
- **依据需求**：U18（"判官/摘要/标题等增强任务的模型独立配置（选哪个模型 + reasoning 档位），与主对话模型分离"）
- **上游首选参考**：[pi-desktop·EnhancementModelCard](../oss/pi-desktop/apps/desktop/src/components/settings)（ADR 0121："Which model rewrites the Composer draft, and with how much reasoning"）
- **取什么 / 别抄什么**：取"辅助任务模型独立配置 + reasoning 档位 + 缺省回退主模型"三行为；我方增强任务面 = C42 判官（P2 15b）+ F5 摘要（P1 已落 summarizer）
- **要产出**：settings 增强模型分节（judge/summarizer 两任务各配 provider+model+reasoning 档——缺省 = 主模型回退）+ 消费端接线（C42 判官配置 / F5 summarizer 配置读此档——P2 15b 卡的 judge 配置面与本卡对齐）+ ui/ 设置页分节（U14 扩展）
- **验收**：`npx vitest run src/session/settings.test.ts`（扩）+ `src/policy/judge.test.ts`（扩——配置读取）+ ui 资产断言
- **依赖**：P2 15b（C42 判官）；T-P3-101
- **风险 / 未知**：增强任务清单（判官/摘要两个起步——标题生成无独立面记档）

#### T-P3-121 · U19 · Profiles 配置档与故障转移徽标 `[ ]`
- **依据需求**：U19（"配置组合档一键切场景；多供应商故障转移优先级徽标"）
- **上游首选参考**：[cc-switch·ProfileSwitcher/ProfileManageDialog](../oss/cc-switch/src/components/profiles) + [FailoverPriorityBadge](../oss/cc-switch/src/components/providers)（🔴 只学行为）
- **取什么 / 别抄什么**：取"组合档 = 子配置集一键切换 + 优先级可见可调"行为；不抄其多应用切换语义
- **要产出**：①settings Profiles 档（组合：默认 provider+模型+权限档+沙箱档的命名组合）+ ui/ 管理页（建/删/切换——切换 = 批量改 settings 生效值）+ 状态栏快速切换器；②供应商列表的故障转移优先级拖拽排序（settings 的 provider 顺序 = failover 顺序——J15 消费断言）
- **验收**：`npx vitest run src/session/settings.test.ts`（扩——Profiles 往返 + 顺序语义）+ ui 资产断言 + J15 消费链断言
- **依赖**：T-P3-104（供应商列表）；P1 J15
- **风险 / 未知**：切换时在途会话的语义（新 turn 生效——J6 同款）

#### T-P3-122 · U20 · 配置导入导出与深链分享（备份/迁移/导入确认） `[ ]`
- **依据需求**：U20（"配置包导出/导入（含备份列表）、深链导入的确认面"）
- **上游首选参考**：[cc-switch·ImportExportSection/BackupListSection](../oss/cc-switch/src/components/settings) + [deeplink 三确认](../oss/cc-switch/src/components/deeplink)（🔴 只学行为）
- **取什么 / 别抄什么**：取"导出包 + 导入确认 + 备份列表"行为；深链协议（自定义 scheme）最小面——aegent://import?data= 形态（Tauri deep-link 插件或浏览器协议——执行时定形）；**导入必确认**（不可信输入面）
- **要产出**：`src/session/settings-transfer.ts`——导出（settings+providers 打包 JSON——**凭据不打包**零明文纪律）+ 导入（校验 → 确认对话框逐项列出变更 → 应用）+ 自动备份（导入前快照旧配置——保留最近 N 份）+ ui/ 导入导出分节（U14 扩展）+ 深链确认页
- **验收**：`npx vitest run src/session/settings-transfer.test.ts`——往返 + 凭据排除断言 + 备份滚动 + 坏包拒绝 + ui 资产断言
- **依赖**：T-P3-101/102
- **风险 / 未知**：深链 scheme 注册（Tauri 插件面——U7 同款插件解禁逻辑）

#### T-P3-123 · U21 · CLI 终端体验升级（kill-ring/模糊搜索/多行编辑） `[ ]`
- **依据需求**：U21（"REPL 编辑器升级——kill-ring、模糊历史搜索、多行编辑；CLI 是 K1 主入口，产品化不能只顾图形端"）
- **上游首选参考**：[pi·tui·editor/kill-ring/alt-screen-search/fuzzy](../oss/pi/packages/tui/src)（🔴 只学行为——完整 TUI 编辑器组件）
- **取什么 / 别抄什么**：取"kill-ring（Ctrl+K/U/W 剪贴环）+ 模糊历史搜索 + 多行编辑"三行为；全 TUI 重绘（alt-screen/鼠标/组件框架）不取——渐进路线（readline 之上增强，倾向 kill-ring + 模糊历史搜索先行，全重绘 YAGNI 记档）
- **要产出**：`src/cli/editor.ts`——输入行编辑增强（kill-ring 面向 REPL 历史/当前行的剪贴操作 + Ctrl+R 模糊历史搜索 + 反斜杠续行的多行输入）+ 接线 repl.ts（既有命令零变化）
- **验收**：`npx vitest run src/cli/editor.test.ts`（新）+ `src/cli/cli.test.ts`（扩）——三行为用例 + 既有 REPL 命令零回归
- **依赖**：无（独立面——16c 可并行）
- **风险 / 未知**：Windows 终端按键差异（Ctrl+W 等——跨终端兼容负例记档）

#### T-P3-124 · 收口 · 16c 盘点 + P3 全段对账 `[ ]`
- **依据需求**：批次 16c 收口 + P3 全段终验收
- **要产出**：盘点面：①U15 变更提取纯函数 × 流轻量纪律（从流算不建状态）；②U16 用户模板 × I8 系统预设分界；③U18 辅助模型 × 主模型回退链；④U20 导入确认 × 不可信输入面（C 族防线）；⑤U21 CLI 增强 × 既有命令零回归；⑥P3 全段对账（21 条状态表）+ 人工确认清单闭环复核
- **验收**：`npx vitest run`（全量）+ 工具链四件（count-features = 331）+ license-audit
- **依赖**：T-P3-101 ~ 123 全部
- **风险 / 未知**：无

## §6 批次完成定义

- **16a**：6 张卡全勾 ✅；CLI 不带环境变量可启动（读配置）✅；凭据零明文 ✅；设置中心人工走查 ✅；报告入 `plan-p3-progress.md` ✅。
- **16b**：10 张卡全勾 ✅；渲染安全评审 ✅；**双击 exe 可对话（人工验收）** ✅；人工确认清单全部闭环（转正/放弃两态）✅；`count-features.sh` = **324** ✅；`check-doc-links.sh` 显式传参 0 失效 ✅；`license-audit.sh` exit 0（vendor 登记）✅。
- **16c**：8 张卡全勾 ✅；工作面板三 Tab 可用（文件树/变更评审/子代理监控）✅；提示词库/MCP 向导/辅助模型卡/Profiles/导入导出/CLI TUI 各面验收 ✅；报告入 `plan-p3-progress.md` ✅。
- P3 对账：21 条逐条状态表（落地/放弃理由）入 progress ✅。
