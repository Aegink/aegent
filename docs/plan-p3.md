# P3 实施计划（产品化层）

> **性质**：P3 优先级层全阶段计划（U 域 27 条 / 批次 16a~16d / 31 张卡），2026-09-28 展卡（同日三次扩充——①UI 功能组；②产品扩展组（深读 pi-desktop·workpanel/services、cc-switch·mcp/prompts/profiles、pi·tui 后新增 U15~U21）；③管理面组（用户提供 pi-desktop 子智能体管理页截图并裁决"还有技能、子智能体等功能"——深读 AgentSubagentsPage/SkillEditorSheet/SkillMarketPanel/KeyboardShortcutsSection 后新增 U22~U26）——**"让 aegent 从内核变成产品"**。
> **执行协议**：沿用 [`plan-p0.md`](plan-p0.md) §0；推进模式一会话一批次（16a → 16b）。
> **锚点纪律**：U 域 21 条锚点于 2026-09-28 展卡逐一核对——两轮深读：①产品 UI 清单（cc-switch·src/components 38 件 + pi-desktop·src/components 46 件——ComposerAutocomplete 五类补全图标集 / StartupRecovery 的 startup-watchdog 诊断面 / cc-switch settings 的 AuthCenter·BackupList·Proxy·Language 分节）；②产品扩展面（pi-desktop·workpanel 五 Tab——ReviewTab 的 `reviewChangesFromMessages`+`summarizeReviewChanges` 与 SubagentPanel 的 delegation 状态/耗时/失败收集、cc-switch·mcp 向导四件/prompts 五件/profiles 两件/providers·FailoverPriorityBadge、settings·EnhancementModelCard（ADR 0121 辅助模型）、deeplink 三确认、pi·tui editor/kill-ring/alt-screen-search/fuzzy 编辑器组件——行为证据取自组件名与源码头注释）。
> **执行前置**：批次 16a/16b/16c 在批次 15a~15e（P2，[`plan-p2.md`](plan-p2.md)）收官之后——U3 依赖 15a 的 Q2、U12 依赖 15e 的 J21、U13 依赖 15d 的 N5 与 M3、U15 依赖 15a 的 Q2 与 P1 的 E5/H2、U18 依赖 15b 的 C42、U19 依赖 P1 的 J15、U8 依赖 15d/15b/15c 面。

## §1 全局约束（P3 段）

1. **一份资产两端共用不变**：全部 UI 条目只动 `ui/`——桌面壳（K2）与网页（K5）同时受益，不出现第二份 UI。
2. **凭据红线全程**：U2 的 key 管理走 DPAPI/私有档，配置文件与日志零明文；U8 各平台凭据由用户提供、掩码入 `private/`。
3. **构建链最小化**：不引入前端框架（React/Vite 不取——ui/ 原生 ES module 已工作，重写无验收收益）；渲染增强用 marked（MIT）+ highlight.js（BSD-3）两个纯库 vendor 本地化（`ui/vendor/`，THIRD_PARTY 登记）。
4. **渲染安全防呆**：markdown 渲染只作用于**模型产出**（assistant），用户输入不渲染（注入面禁足）；marked 配置禁 HTML 透传。
5. **体积目标分列陈述**：§6.1 的 60MB 是"壳"目标；U6 引入运行时随包后安装器体积分列（壳 + runtime），不混用旧口径。
6. **工程纪律不变**：新域 managed:true 入册；工具链四件收官必跑；count-features = **337**（P3 列 27 条）。

## §2 批次划分总表（27 条 / 四批 / 31 卡）

| 批次 | 主题 | 条目 | 数 | 卡 | 依赖锚点 |
| --- | --- | --- | --- | --- | --- |
| 16a | 产品地基（配置与设置中心） | U1 U2 U14 U5 U3 | 5 | 6 | 无（P3 首启） |
| 16b | 体验与分发 | U4 U9 U10 U11 U12 U13 U6 U7 U8 | 9 | 10 | P2 15a Q2 / 15d N5 / 15e J21 / 13 K2 |
| 16c | 产品扩展 | U15 U16 U17 U18 U19 U20 U21 U27 | 8 | 9 | P2 15a/15b/15c；P1 E5/H2/J15 |
| 16d | 管理面 | U22 U23 U24 U25 U26 | 5 | 6 | P1 I2/H1-H5；P2 15c H6/15d P4 |

**排序理由**：16a 先行（settings/凭据是全部后续面的底座——U14 设置中心是 U1/U2/U5 的渲染端，一卡承载防配置面落两次）；16b 体验与分发（消费 P2 全段产出——Q2 检索/N5 分型/J21 成本/M3 恢复）；16c 产品扩展（工作面板/协作/库/向导——依赖 16b 的渲染基座与 P2 的 E6/H6/J15）；16d 管理面收尾（技能/子智能体/指令/快捷键/语音——全部依赖已落数据面，增量集中在配置与 UI）。

## §3 批次 16a 卡序（6 张：U1/U2/U14/U5/U3 + 收口——产品地基：配置与设置中心；2026-09-28 展卡）

**展卡核对结论（16a）**：
1. **U1/U2/U14/U5 的行为蓝本就是 cc-switch 的产品主题**（多供应商配置切换）——settings/ 组件族分节形态（AuthCenter 凭据/DirectorySettings/LanguageSettings/GlobalProxySettings/AboutSection）直接映射我方设置中心分节；我方增量 = `~/.aegent/settings.json` + 优先级链 + 三入口接线（实测发现 CLI/host/桌面全靠环境变量——真实空白）。
2. **U14 设置中心是 U1/U2/U5 的渲染端**——一卡承载避免"配置面落两次"（CLI 命令与 UI 页共用同一 settings 模块）；主题面按 cc-switch theme-provider 行为（全端一致暗/亮）。
3. **U3 消费两个既有面**（Q2 检索 + M3 resume）——本卡是入口面（UI 侧栏 + CLI 子命令），不是新机制。

**词汇表预判**：16a 全部零事件（入口/渲染/分发面——既有词汇在位）。

#### T-P3-101 · U1 · 配置文件面（settings 持久化 + 优先级链） `[x]`
- **依据需求**：U1（"settings 持久化（provider 列表、默认端点/模型、权限档、沙箱档、外观）；环境变量 > 配置文件 > 默认值；损坏配置 fail-closed 且给出修复指引"）
- **上游首选参考**：[cc-switch·src/config.rs](../oss/cc-switch/src-tauri/src/config.rs) + [app_store.rs](../oss/cc-switch/src-tauri/src/app_store.rs)（配置读写/迁移/默认值的产品形态）
- **取什么 / 别抄什么**：取"配置分层（默认值 → 文件 → 环境变量覆盖）+ 损坏 fail-closed + 迁移版本号"行为；不抄其 Rust 结构与其多应用切换语义（我方单应用）
- **要产出**：`src/session/settings.ts`——`SettingsShape`（provider 列表/默认 provider+model/权限档/沙箱档/外观/语言）+ `loadSettings(dir?)`（`~/.aegent/settings.json`：损坏 → SettingsError 带行列号与修复指引）+ 优先级合并（env > file > default——AEGENT_* 对接）+ `--settings <path>` 参数面；CLI/host/桌面三入口接线（不带环境变量可启动）
- **验收**：`npx vitest run src/session/settings.test.ts src/cli/index.test.ts`（扩）——三档优先级合并 + 损坏 fail-closed（错误带指引）+ 默认值启动 + 三入口接线断言
- **依赖**：无（16a 首卡）
- **风险 / 未知**：配置 schema 版本迁移（v1 起步——迁移链 sqlite 同款纪律）
- **完成记录（2026-09-29）**：验收 `npx vitest run src/session/settings.test.ts src/cli/index.test.ts` → **16 passed**（+回归 agent-process/agent-protocol/model-switch/cli/server 82 passed）。落地：`settings.ts`（SettingsShape v1 + SettingsError 行列号+修复指引 + parse/load/save〔tmp 原子替换〕+ `resolveChildLaunchArgv` 三档优先级纯函数）；`--settings <path>` 入 CLI/host 两入口 argv；agent-child parseArgs 补 `--base-url/--api-key/--model` argv 面；桌面壳经 host（壳只加载 ui 静态资产）。**卡内定形两点**：①provider 槽是适配器名空间、条目名是供应商别名——文件档**整体生效或不生效**（defaultProvider 选中条目整体注入 adapter/baseUrl/model，cc-switch 配置切换同款语义；env 占用时条目不参与）；②settings.json 永不承载 apiKey（零明文，U2 凭据面接管）。`locateJsonError` 从 models/config.ts 导出复用（单一扫描器）。测试窗口：index.test.ts 用假子进程入口写 argv 观察窗（写完即退防 messages 悬挂）。

#### T-P3-102 · U2 · 凭据管理入口（录入/更换/删除 + DPAPI 落盘） `[x]`
- **依据需求**：U2（"key 的录入/更换/删除走 CLI/UI；落盘经 DPAPI 加密；配置文件与日志零明文"）
- **上游首选参考**：[cc-switch·app_store.rs](../oss/cc-switch/src-tauri/src/app_store.rs)（凭据隔离存储）+ [codex·dpapi.rs](../oss/codex/codex-rs/windows-sandbox-rs/src/dpapi.rs)（P0 D8 已落加密面）
- **取什么 / 别抄什么**：取"凭据与配置分离存储 + 专用管理命令"行为；DPAPI 面复用 D8
- **要产出**：`src/session/credentials.ts`——`setKey/getKey/deleteKey`（provider 维度；DPAPI 加密落 `~/.aegent/credentials.bin`——非 Windows 回退 0600 权限文件记档）+ CLI `aegent key set/get/delete <provider>` + settings 面集成（settings.json 零 key 断言）+ 零明文扫描
- **验收**：`npx vitest run src/session/credentials.test.ts`——往返 + 加密断言 + 删除面 + 零明文 + 非 Windows 回退
- **依赖**：T-P3-101
- **风险 / 未知**：DPAPI 非交互会话可用性（P0 已验证面）
- **完成记录（2026-09-29）**：验收 `npx vitest run src/session/credentials.test.ts` → **13 passed**（含 Windows 真 PowerShell DPAPI 往返；+dpapi.test 7 passed 回归）。落地：`credentials.ts`（CredentialStore 接口 + DpapiCredentialStore〔包 SecureKeyStore——本卡为其补 deleteKey/listKeys 对称扩展〕+ PlainFileCredentialStore〔0600 + tmp 原子替换 + 损坏 fail-closed 带指引〕+ createCredentialStore 平台工厂〔platform 注入〕）；CLI `aegent key set|get|delete|list`（`src/cli/key.ts`——key 从 stdin 读不进命令行、get 只出掩码 maskToken、幂等删除、空 key 拒绝）；**装配消费**：CLI/host main 在文件档条目将被选中时提前 decrypt defaultProvider 凭据 → `resolveChildLaunchArgv` 的 credentialKey 槽（apiKey 槽序：显式 > env > 凭据）。零明文断言：凭据文件 sk- 证伪 + settings.json 无 apiKey 字段。architecture-policy：session requires 增补 sandbox（DPAPI 依赖——声明在案）。UI 录入面随 T-P3-103 设置中心（AuthCenter 分节映射）。

#### T-P3-103 · U14 · 设置中心与主题（U1/U2/U5 的完整渲染端） `[x]`
- **依据需求**：U14（"provider 管理/凭据/权限档/沙箱档/代理/语言/日志/关于的多分节设置页 + 暗/亮主题切换"）
- **上游首选参考**：[cc-switch·settings/ 组件族](../oss/cc-switch/src/components/settings)（About/AuthCenter/DirectorySettings/LanguageSettings/GlobalProxySettings/BackupListSection 分节形态）+ [theme-provider](../oss/cc-switch/src/components/theme-provider.tsx)
- **取什么 / 别抄什么**：取"多分节设置页 + 分节即改即存 + 主题全端一致"行为；AuthCenter 分节映射我方凭据页（U2）；代理/备份分节不取（无对应面——YAGNI 记档）
- **要产出**：`ui/` 设置页（多分节：供应商管理/凭据/权限与沙箱档/外观主题/语言/关于——即改即存 settings 面）+ 主题切换（CSS 变量方案——`ui/style.css` 主题变量化）+ 导航入口（状态栏齿轮）；分节与 settings 模块一一对应断言
- **验收**：ui 资产断言（分节齐全/主题变量在位）+ settings 往返（UI 改 → 文件变 → 重启生效）+ 人工走查列确认清单
- **依赖**：T-P3-101/102（settings + 凭据模块）
- **风险 / 未知**：即改即存的保存时序（防抖——卡内定形）
- **完成记录（2026-09-29）**：验收 `npx vitest run src/diagnostics/tauri-shell.test.ts src/host/server.test.ts` → **14 passed**（含新增 settings 信封 e2e 两例）。落地三件：①**wire**：ClientEnvelope 增 `settings` 信封（op 闭集 get/update/credentials-set|delete|list；op 闭集与 patch 形状 parse 层校验、段白名单 gateway 层——双层分工，未知段回类型化 SETTINGS_PATCH_SECTION_UNKNOWN 且不落盘）；②**host**：`settings-gateway.ts`（FileSettingsGateway——get/update 段级合并 + applySettingsPatch 白名单校验 + 凭据三操作，list 只回掩码）+ bridge 透传 onSettings + HostServer 装配（生产 main = 真文件）；③**ui**：设置面板右侧抽屉六分节（providers/credentials/permission/sandbox/appearance/about）+ 状态栏齿轮导航 + 即改即存（段级 patch 500ms 防抖合并）+ 主题 CSS 变量化（`body[data-theme="light"]` 全端一致）+ 凭据 key 输入 type=password 不回显。**快照即规格（机验）**：update → 文件变 → 重新 loadSettings 一致（server.test e2e）。人工走查列入人工确认清单（视觉可读性）。无 gateway 的 host 回 SETTINGS_UNSUPPORTED（功能面缺省关闭）。
- **偏离记档（2026-09-29 收口补核）**：原文"代理/日志"分节——"代理"展卡已裁决不取（YAGNI）；"日志"分节未落且卡内未明示豁免（上游 LogConfigPanel.tsx 行为锚在位）→ **#28 立案待裁决**（见 plan-p3-progress.md）。

#### T-P3-104 · U5 · 模型/端点管理 UI（多供应商切换 + 健康徽标） `[x]`
- **依据需求**：U5（"多供应商列表、会话期切换、健康徽标"）
- **上游首选参考**：[cc-switch 核心形态](../oss/cc-switch)（多供应商配置一键切换——本仓的产品主题即此）
- **取什么 / 别抄什么**：取"供应商卡片列表 + 一键切换 + 状态显示"的界面行为；不抄其 Claude/Codex/Gemini 特定配置语义
- **要产出**：设置页供应商分节（列表/新增/编辑/默认标记——U1 渲染端）+ 会话期切换（UI 下拉 → `model/switch` 请求——J6 wire 面已有，即时生效下一轮）+ 健康徽标（J16 probeProvider 的 UI 消费——列表项状态点，探测节流）
- **验收**：`npx vitest run src/host/server.test.ts`（扩）+ ui 资产断言——切换请求往返 + 下一轮 request/header modelId 变化 + 健康探测触发
- **依赖**：T-P3-101/102/103
- **风险 / 未知**：切换时在途轮语义（J6 既有——新 turn 生效）
- **完成记录（2026-09-29）**：验收 `npx vitest run src/host/server.test.ts` → **9 passed**（新增切模 e2e + probe 两例；+ui 资产断言/内核回归 50 passed）。落地：①**多注册表装配**（agent-child.ts `buildModelsRegistry`——未显式 --provider 且 settings.json providers 在位时全条目实例化（adapter→openai/anthropic 适配层 + withRetry；凭据按条目名从 credentials.bin 解密——子进程同用户 DPAPI 可解）进 models 注册表，initialIdentity = defaultProvider 条目；同 identity 去重、无 model 条目跳过；显式单模型分支零变化）；②**UI**：供应商列表项加"本会话切换"（model/switch 请求——非写命令免租约，新 turn 生效提示）+ "测健康"（settings op:probe 新 op → gateway.probeProvider → J16 probeProvider，UI 状态点 operational/degraded/unreachable + 10s 节流缓存）+ 编辑（点条目名回填表单保存=段替换）；③**wire**：settings op 闭集追加 probe（provider 校验 parse 层）；gateway 加 healthProbe 注入点（生产 = 真 J16 探测、测试注入 fake——**探测不触碰熔断器**的分域不变量随 J16）。验收断言：switch 往返 ok → 下一轮 request/header config.modelId = 新值 + model/switch 落流事件（J9）。

#### T-P3-105 · U3 · 会话历史管理（列表/续聊/删除入口） `[x]`
- **依据需求**：U3（"历史会话列表/续聊/删除；崩溃恢复一键续跑"）
- **上游首选参考**：[pi-desktop 会话列表行为](../oss/pi-desktop)（🔴 只学行为：列表信息架构）+ P2 15a 的 Q2 检索面
- **取什么 / 别抄什么**：取"列表（时间/标题/状态）+ 点开续聊 + 删除确认"的信息架构；机制全部复用（Q2/resume/Q4）——入口面
- **要产出**：①CLI：`aegent sessions list/resume/delete` 子命令；②UI 侧栏：历史列表 + 续聊按钮（query 信封扩展 `op:"sessions"`——wire 形状扩展先例）+ 删除确认对话框
- **验收**：`npx vitest run src/session/sessions-cli.test.ts src/host/server.test.ts`（扩）——三面 + resume 一键 + UI 资产断言
- **依赖**：P2 15a（Q2/Q4）；T-P3-101
- **风险 / 未知**：wire query 扩展形状（op 枚举追加——批次 12/14 先例）
- **完成记录（2026-09-29）**：验收 `npx vitest run src/session/sessions-cli.test.ts src/host/server.test.ts` → **16 passed**（+db/cli/内核回归 65 passed）。落地：①**SQL 面**（db.ts）：`listSessionSummaries`（session_index 清单 + SQLite bare-column 取每会话首条 user/message 前 60 字做标题）+ `deleteSession`（sessions/events/session_index/archived_sessions 四表事务硬删除；非法 id 拒绝、幂等 false）；②**CLI**（`src/cli/sessions.ts`）：`aegent sessions list [--db]`（缺省 ~/.aegent/sessions.db）/`delete <id> --yes`（无 --yes 闸住——硬删除确认）/`resume <id>`（index.ts 分流 = 以 --session <id> 正常启动 REPL——续聊即同一会话 id 再开进程，机制复用零新增）；③**wire**：query op 枚举追加 `sessions`（清单）+ events 放宽为任意会话只读（跨会话直接回源 SQLite 库——历史会话不在内存镜像；本会话仍内存序；写命令仍限本会话）；settings op 追加 `session-delete`（gateway.sessionDelete——sessionDb 可选依赖，未配置回 SESSION_DB_UNAVAILABLE）；④**UI**：历史侧栏（☰ 按钮 → 清单：标题/id/事件数/时间 + 查看〔只读恢复视图 + resume 提示〕+ 删除〔window.confirm 确认〕）。崩溃恢复一键续跑 = resume 面同链（M3 boot-maintenance 在启动时自动跑，既有）。

#### T-P3-106 · 收口 · 16a 盘点 `[x]`
- **依据需求**：批次 16a 收口
- **要产出**：盘点面：①U1 优先级链 × 三入口一致性；②U2 凭据零明文全链扫描；③U14 设置分节 × settings 模块一一对应；④U5 切换 × J6 语义（新 turn 生效）；⑤快照即规格：设置改 → 文件变 → 重启生效一条
- **验收**：`npx vitest run`（全量）+ 工具链四件 + license-audit
- **依赖**：T-P3-101 ~ 105
- **风险 / 未知**：无
- **完成记录（2026-09-29）**：全量 `npx vitest run` → **1710 passed / 7 skipped**（196 文件；7 skipped 中 6 例 = live-p2 真实端点联调条件跳过——本会话无凭据环境，P2 15e 已 6/6 跑过）；`tsc --noEmit` 干净；工具链五件全绿：architecture:check **0 error / 21 warning**（基线保持；治理：session+sandbox / host+models / cli+models requires 增补 + 2 条长 e2e 测试文件 exceptions 豁免）、vocabulary:check 0 问题（零事件兑现）、count-features **337** 不变、check-doc-links 显式传参 **1206 链接 0 失效**、license-audit exit 0。五项盘点与快照即规格机验全部落 `plan-p3-progress.md` 收官报告；人工确认清单新增 U14/U5/U3 三条走查项（U6/U8/U4 随 16b）。批次 16b 提示词已更新。

#### T-P3-132 · U14 补全 · 日志分节（#28 裁决落实） `[x]`（16a 补全批——2026-09-29 用户裁决补落，编号追加不重排；执行序 = 16b 会话首卡 T-P3-107 之前）
- **依据需求**：U14 原文（requirements.md:653）"…沙箱档/代理/语言/**日志**/关于的多分节设置页"——"日志"分节 16a 未落且无卡内豁免（#28 立案）；用户 2026-09-29 裁决**认可补落**（"代理"分节维持展卡 YAGNI 裁决不取）
- **上游首选参考**：[cc-switch·LogConfigPanel.tsx](../oss/cc-switch/src/components/settings/LogConfigPanel.tsx)（🔴 只学行为：日志配置可查可改即生效）+ 我方 E14/T-P1-90 的 `--raw-log-dir` 既有装配面
- **取什么 / 别抄什么**：取"日志配置进设置页、即改即存"行为；不抄其 React 结构与 Tauri 特定实现
- **要产出**：①settings v1 增 `logging` 段（`rawLogDir?: string`——E14 原始分片日志目录的持久化位；空 = 缺省不写，B8a 同款 fail-closed 语义不动）+ `applySettingsPatch` 白名单加 logging + parseSettingsShape 校验；②ui/"日志"分节（第七分节：目录输入即改即存——LogConfigPanel 行为映射）；③装配消费：resolveChildLaunchArgv 增 rawLogDir 槽（file 档 → `--raw-log-dir` 注入，agent-child 既有 argv 面零改动）；④ui 资产断言更新（六→七分节）
- **验收**：`npx vitest run src/session/settings.test.ts src/diagnostics/tauri-shell.test.ts src/host/server.test.ts`（扩）——logging 往返 + 白名单 + 分节断言 + 装配注入
- **依赖**：T-P3-101/103（已收官——本卡是补全面）
- **风险 / 未知**：无（E14 面既有；纯增量）
- **完成记录（2026-09-29）**：验收 `npx vitest run src/session/settings.test.ts src/diagnostics/tauri-shell.test.ts src/host/server.test.ts` → **31 passed**（settings 14 + tauri-shell 7 + server 10；tsc --noEmit 干净）。落地：①`settings.ts` SettingsShape v1 增 `logging` 段（`rawLogDir?: string`——缺省 `logging: {}`；parseSettingsShape 校验非空字符串 fail-closed）；②`resolveChildLaunchArgv` 增 `--raw-log-dir` 槽（parseChildArgs 补解析；优先级 = 显式 > env `AEGENT_RAW_LOG_DIR` > file 档——agent-child 既有 argv/env 面零改动）；③`applySettingsPatch` 白名单（SETTINGS_PATCH_SECTIONS）加 `logging`；④ui 第七分节 `data-section="logging"`（原始分片目录输入即改即存——markDirty("logging") 防抖合并，LogConfigPanel 行为映射）；⑤tauri-shell.test 分节断言六→七 + settings.test logging 往返/校验/装配三路径（file 补位/env 同值/显式占用不重复注入）+ server.test logging patch 白名单往返（update → 文件变 → 重新 loadSettings 一致）。#28 落实，16a 全闭。

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

#### T-P3-107 · U4 · UI 渲染分层基础（markdown/高亮/流式/工具卡/diff） `[x]`
- **依据需求**：U4（"markdown 与代码高亮渲染（含代码块复制按钮）、流式打字节流、工具调用卡展开、审批卡优化、错误与重试交互；一份资产两端共用"）
- **上游首选参考**：[pi·client](../oss/pi/packages/client)（🔴 只学行为：渲染分层与增量更新纪律）
- **取什么 / 别抄什么**：取"渲染分层（纯文本/markdown/代码）+ 增量追加不重排"行为；不抄其 React 框架（全局约束 3——原生 + marked/highlight.js 两 vendor 库）
- **要产出**：①`ui/vendor/`（marked + highlight.js 本地化 + THIRD_PARTY 登记）；②渲染分层：assistant 走 markdown+高亮（**用户输入不渲染**——注入面防呆，marked 禁 HTML 透传）；③流式打字：text-delta 节流追加（requestAnimationFrame）；④工具卡展开：tool/call→result 成对折叠卡（args JSON 格式化 + 写操作 diff 对照）；⑤审批卡优化（C55 alternatives 展示）+ 错误重试交互
- **验收**：`npx vitest run src/diagnostics/tauri-shell.test.ts`（扩）+ ui 资产冒烟 + **人工走查列确认清单**（XSS 评审落完成记录）
- **依赖**：T-P3-106（16a 收口）
- **风险 / 未知**：XSS 面（marked 配置白名单策略）
- **完成记录（2026-09-29）**：验收 `npx vitest run src/diagnostics/tauri-shell.test.ts src/diagnostics/ui-render.test.ts` → **18 passed**（tauri-shell 8 扩 + ui-render 10 新；`node --check` 两 JS 语法过；tsc 干净）。落地：①**vendor 本地化**：`ui/vendor/`（marked 16.4.2 原样 `lib/marked.esm.js` + highlight.js 11.12.0 `lib/common.js` 经 esbuild bundle 成浏览器 ESM〔36 common 语言，npm 包内 `es/` 是 Node 双包互操作面浏览器不可 import——bundle 产物入库、UI 消费端仍零构建链〕+ 两 LICENSE + 出处 README + esbuild devDep〔同时服务 T-P3-113〕+ THIRD_PARTY.md 两条登记）；②**渲染管线** `ui/render.js`（纯函数模块）：marked 禁 HTML 透传（renderer.html 恒转义 `md-html-raw` 可见不执行）+ href 协议白名单（javascript:/data: 恒 "#"，链接 `rel="noopener noreferrer"`）+ 代码块 hljs 高亮 + 复制按钮；③**app.js 分层**：assistant 走 markdown 气泡（流式打字 `typeStream`——rAF 消费事件自带 `TimedStreamChunk` 时间轴〔零新增 wire 面〕，超长流压缩 ≤2s，终态换完整渲染；恢复视图直接终态），**用户输入 textContent 原样不渲染**（注入面禁足）；工具卡 `tool/call`→`tool/result` 以 `callId` 成对折叠（args JSON 格式化 + write/edit 写操作 diff 对照〔del/add 着色〕+ result 原样不渲染）；④审批卡优化：C54 分类 chip + 超时倒计时 + C55 拒绝面结构化展示（`parseDenial` 解析 renderDenial 同源文本 → 编号替代做法清单）；⑤错误重试交互：`turn/end` reason.kind=error 卡挂"重试上一条"按钮（重发最近 user prompt）。**XSS 评审（落完成记录）**：机验面 = `ui-render.test.ts` 十例（script/img 标签恒转义不落地、javascript:/data: href 恒 "#"、hljs 输出转义、safeHref 白名单直测）；设计面 = 渲染只作用于 assistant 事件（app.js 的 `renderMarkdown` 调用点全部在 assistant 分支——typeStream 终态与 assistant 气泡；user 气泡恒 textContent）、工具结果/args 恒 textContent、marked 无其他 innerHTML 注入点、vendor 纯库无网络面；**残余面**：marked/hljs 零-day 为上游风险（vendor 固定版本可控），人工走查列入确认清单。

#### T-P3-108 · U9 · 对话导航与检索 UI（搜索两级 + 长会话小地图） `[x]`
- **依据需求**：U9（"会话内搜索、跨会话搜索、长会话小地图"）
- **上游首选参考**：[pi-desktop·SearchDialog/SearchSessionResults/ConversationMinimap](../oss/pi-desktop/apps/desktop/src/components)（🔴 只学行为）
- **取什么 / 别抄什么**：取"会话内搜索高亮跳转 + 跨会话搜索列表跳转 + 轮次结构导航条"三行为；不抄其 React 实现
- **要产出**：①会话内搜索（Ctrl+F 面板：命中高亮 + 上下跳转——渲染层文本检索）；②跨会话搜索（Q2 检索的 UI 消费——结果列表 → 点开续聊）；③小地图（消息类型着色条 + 点击跳轮——纯 DOM 实现）
- **验收**：ui 资产断言 + `npx vitest run src/host/server.test.ts`（扩——跨会话搜索走 query 面）+ 人工走查
- **依赖**：T-P3-107；P2 15a Q2
- **风险 / 未知**：小地图在超长会话的渲染性能（虚拟化——按需记档）
- **完成记录（2026-09-29）**：验收 `npx vitest run src/session/query.test.ts src/host/server.test.ts src/diagnostics/tauri-shell.test.ts` → **24 passed**（query 6 + server 10 + tauri-shell 8；node --check 过、tsc 干净）。落地：①**会话内搜索**（Ctrl+F 条，index.html find-bar）：渲染层文本检索——TreeWalker 文本节点摘帽/戴帽（`mark.search-hit`，active 着色 + scrollIntoView 居中），Enter/Shift+Enter 上下循环跳转、计数 n/N、Esc 关闭还原（normalize 还原原文本节点——不改事件内容）；②**跨会话搜索**（🔍 按钮 + Ctrl+Shift+F）：**wire 扩展 query op:"search"**（criteria.contentLike 必填非空 ≤256〔MAX_CONTENT_LIKE_CHARS 同源〕+ limit 1..500/offset≥0，parse 层形状坏整信封拒 → "(unparsed)" PROTOCOL_MALFORMED）→ bridge op:"search" 分支 → **querySessionsDb**（query.ts 新导出：已打开库上的检索，语义与 querySessions 全同——query.test 等价断言；复用 sessionsLibrary 连接不逐查开关库）→ 只回摘要行（sessionId/seq/type/ts/excerpt——**事件整值不出检索面**，e2e 断言）→ UI 命中列表（会话/类型/时间/摘录）+ "查看" = 只读恢复视图（与历史侧栏同链）+ 续聊入口提示；③**小地图**（#minimap 固定右缘）：user=accent/agent=ok/tool=warn 三色 3px 行 + title 标轮次，点击 scrollIntoView + 1.2s flash；登记面 renderEventEnvelope/renderHistory 共用（只读查看入口 resetStreamView 统一摘帽 + 重建）；④tauri-shell 资产断言扩（find-bar/minimap/search-panel/search-results + op:"search"/findInStream/minimapRegister + css 标记）。人工走查列入确认清单（视觉/键位手感）。

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

## §5 批次 16c 卡序（9 张：U15/U16/U17/U18/U19/U20/U21 + U27〔T-P3-131，判断修正补录〕 + 收口——产品扩展组；2026-09-28 展卡）

**展卡核对结论（16c）**：
1. **U15 工作面板是本轮最大发现**：pi-desktop 把"agent 干活的过程可视化"做成三 Tab——ReviewTab 从消息流提取变更（`reviewChangesFromMessages` 纯函数 + `summarizeReviewChanges` 汇总）+ SubagentPanel 收集委派状态/耗时/失败（`collectDelegation*` 三收集器）——我方数据面全在（tool/call·result 流内事实 + E5/H2 子代理事件），缺的是可视化面板。
2. **U16 提示词库 ≠ I8 人格预设**：I8 是系统级 agent 预设（persona），U16 是用户自建模板库（cc-switch PromptLibrary 五件——库/表单/条目）；调用面共用 Composer 斜杠补全（U10）。
3. **U17 MCP 向导**：cc-switch 的 McpWizardModal 分步向导 + useMcpValidation 校验——我方 mcp 域（P0 已落）的管理 UI 空白面。
4. **U18 辅助模型卡 = C42 的配置 UI 面**：pi-desktop ADR 0121 原文"哪个模型改写 Composer 草稿、带多少 reasoning"——判官/摘要/标题等辅助任务的模型与主对话模型分离配置；我方 C42（P2 15b）判官的 provider 独立配置正对应此卡。
5. **U19 Profiles = 配置组合档**（provider+模型+权限一键切场景）+ FailoverPriorityBadge（J15 故障转移顺序的 UI 消费——P1 已落故障转移队列库面）。
6. **U20 导入导出/深链**：cc-switch 的 BackupListSection/ImportExportSection + deeplink 三确认（MCP/提示词/技能导入必确认——安全面：深链导入是不可信输入，确认面是 C 族防线）。
7. **U27 会话间协作（判断修正补录）**：初判"多端 roster 已覆盖"错误——roster 是"用户多端连同一会话"（surface attach/detach），U27 是"会话间派任务"（agent-to-agent，pi-desktop session-collaboration 的 SessionCollaborationMessage：task/message/completion 三类 + 权限上限快照防提权 + 完成通知）——两者正交。我方落点：协作消息走**流内新事件候选**（#28 立案预判——协作消息是持久事实）或复用 E9 引用面扩展；依赖 E6 树（P2 15a）+ H6 后端（P2 15c）+ E9（P2 15a）；权限上限快照 = H3/H5 降级面的协作侧对偶（提交时快照，排队中不可提权）。
8. **U21 CLI 也是产品入口**（K1）：pi·tui 的编辑器组件（kill-ring 剪贴环/alt-screen-search/fuzzy 模糊搜索）是现代 TUI 手感的三件——REPL（readline 行式）升级为自绘编辑面的渐进路线执行时定形（倾向 kill-ring+模糊历史搜索先行，全 TUI 重绘 YAGNI 记档）。

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

#### T-P3-131 · U27 · 会话间协作（派任务/消息往来/权限上限快照） `[ ]`（16c 第九张——判断修正补录，编号追加不重排）
- **依据需求**：U27（"会话之间的任务派发与消息往来；权限上限快照；会话引用谱系；往来可视化"）
- **上游首选参考**：[pi-desktop·session-collaboration](../oss/pi-desktop/apps/desktop/electron/main/services/session-collaboration.ts) + [共享类型](../oss/pi-desktop/packages/shared/src/session-collaboration.ts)（🔴 只学行为）
- **取什么 / 别抄什么**：取"协作消息三型（task/message/completion）+ 状态生命周期 + **权限上限快照（排队任务不可被后续设置提权）** + 完成通知 + 往来列表"五行为；不抄其 Electron 服务结构与其插件面
- **要产出**：①**#28 立案预判**：协作消息的持久面——倾向流内新事件 `session/task-dispatch` 系（派发/结算）或复用 E9 引用面扩展（执行时定形按"协作消息是持久事实"）；②`src/session/collaboration.ts`——dispatch（源会话 → 目标会话派任务：kind/内容/权限上限快照）+ 排队与执行状态机（queued/running/completed/failed/cancelled）+ completion 回投（结果落源会话流）+ 通知（N5 分型候选）；③权限上限快照——在 H3/H5 降级算法上叠加"协作任务权限 = 提交时快照 ∩ 当前"，队列中设置变更不可提权（**逆方向也不降权**——快照语义定形）；④ui/ 往来面板（子代理监控 Tab 邻居——U15 扩展位）
- **验收**：`npx vitest run src/session/collaboration.test.ts`——派发/排队/执行/回投全链 + **权限上限不可提升断言**（排队中改设置 → 任务权限不变）+ 会话不存在类型化拒绝 + 词汇表管线（若立案）
- **依赖**：P2 15a（E6 树/E9 引用）；P2 15c（H6 后端）；T-P3-117（工作面板承载）
- **风险 / 未知**：协作消息的事件形状是本卡最大定形点（#28 立案）；环检测（A 派 B、B 派 A 的任务环——复用 E9 环检测）

#### T-P3-124 · 收口 · 16c 盘点 `[ ]`
- **依据需求**：批次 16c 收口 + P3 全段终验收
- **要产出**：盘点面：①U15 变更提取纯函数 × 流轻量纪律（从流算不建状态）；②U16 用户模板 × I8 系统预设分界；③U18 辅助模型 × 主模型回退链；④U20 导入确认 × 不可信输入面（C 族防线）；⑤U21 CLI 增强 × 既有命令零回归；⑥P3 全段对账（21 条状态表）+ 人工确认清单闭环复核
- **验收**：`npx vitest run`（全量）+ 工具链四件（count-features = 331）+ license-audit
- **依赖**：T-P3-101 ~ 123、131 全部
- **风险 / 未知**：无

## §6 批次 16d 卡序（6 张：U22/U23/U24/U25/U26 + 收口——管理面组；2026-09-28 展卡）

**展卡核对结论（16d）**：
1. **U23 是本轮实证最重的卡**（用户提供 pi-desktop 子智能体管理页截图）：内置五预设（探索者 Task(explorer)·Read/Glob/Grep/Bash、代码审查员 Task(code-reviewer)·Read/Glob/Grep、测试执行者 Task(test-runner)、修复者 Task(fixer)·+Edit/Write、UI 设计师 Task(ui-designer)·+BrowserPreview）+ 用户自定义分区（~/.agents/subagents——我方 ~/.aegent/subagents）+ 启用开关 + 工具权限 chips；pi-desktop 更有 **SubagentModelPicker + SubagentFallbackModels（每个子代理独立模型与回退链）**——我方数据面全在（H1-H5 批次 5 已落：task 工具/结算栅栏/权限降级/隔离上下文；H6 后端可插 P2 15c；工具集权限面 H3/H5）——缺管理 UI 与预设内容。
2. **U22 技能面分两半**：技能目录本体 I2 已落（P1，skills.test.ts + tool-load.ts）——本卡是管理 UI（清单/开关）+ 编辑器（SkillEditorSheet 形态）+ 来源目录管理（RepoManager 形态）；"技能市场"真实渠道不建（市场面 = 本地/目录安装最小化——与 U20 导入面呼应）。
3. **U24 指令中心**：pi-desktop"指令"页 + 我方 C22 规则作用域（project/user 档——P1 已落规则面）的 UI 化；与 U11 项目指令页的分界：U11 管"项目档"（workspace 组合），U24 管"指令与规则文件本体"（全局 AGENTS.md + 用户级规则编辑）。
4. **U25 快捷键系统**：KeyboardShortcutsSection 形态——清单/自定义/冲突提示三件。
5. **U26 语音**：截图"语音【实验性】"位 + pi-desktop speech-service——我方 P2 P4（STT 面）的 UI 消费端（设置页 + Composer 麦克风按钮）。

**词汇表预判**：16d 全部零事件预判（管理面/配置面——既有词汇在位）。

#### T-P3-125 · U22 · 技能管理（清单/编辑器/来源目录） `[ ]`
- **依据需求**：U22（"技能清单页、技能编辑器、来源目录管理；I2 已落——本卡是管理 UI 与编辑器面"）
- **上游首选参考**：[cc-switch·skills 四件](../oss/cc-switch/src/components/skills)（SkillsPage/SkillCard/RepoManagerPanel/UnifiedSkillsPanel）+ [pi-desktop·SkillEditorSheet/SkillMarketPanel](../oss/pi-desktop/apps/desktop/src/components/settings)（🔴 只学行为）
- **取什么 / 别抄什么**：取"清单+卡片+开关+编辑器+来源目录管理"形态；技能市场真实渠道不建（目录安装最小化）
- **要产出**：ui/ 技能页（settings 分节）：清单（卡片：名称/描述/内置与用户标记/启用开关——I2 技能目录的消费）+ 编辑器（新建/编辑：名称/描述/提示词/工具集多选——写回技能目录）+ 来源目录管理（清单/增删——RepoManager 形态）+ 停用生效面（技能清单装配消费 disabled 集）
- **验收**：`npx vitest run src/kernel/skills.test.ts`（扩——disabled 集消费）+ ui 资产断言 + 编辑器往返
- **依赖**：I2（P1 已落）；T-P3-103（设置页）
- **风险 / 未知**：技能格式扩展（编辑器写回须保持 I2 目录纪律——坏文件 fail-closed）

#### T-P3-126 · U23 · 子智能体管理（内置五预设 + 自定义 + 模型 fallback 链） `[ ]`
- **依据需求**：U23（"内置预设五例、用户自定义、启用开关、per-subagent 模型与 fallback 链、工具权限 chips"）
- **上游首选参考**：[pi-desktop·AgentSubagentsPage/SubagentEditorSheet/SubagentModelPicker/SubagentFallbackModels](../oss/pi-desktop/apps/desktop/src/components/settings)（🔴 只学行为——用户截图实证形态：探索者/代码审查员/测试执行者/修复者/UI 设计师五内置）
- **取什么 / 别抄什么**：取"预设卡片（名称/Task(slug)/描述/工具 chips/开关）+ 编辑器 + 独立模型与 fallback 链"形态；预设内容按我方工具集映射（UI 设计师的 BrowserPreview 对应 S3 浏览器面——S3 为 P2 项，预设记为依赖面）
- **要产出**：`src/session/subagents-config.ts`（预设定义：五内置（探索者/代码审查员/测试执行者/修复者/UI 设计师——提示词+工具集+模型档）+ 用户自定义 CRUD——~/.aegent/subagents）+ 消费面（task 工具的预设名解析——H1 面扩展：`task --agent code-reviewer` 形态）+ ui/ 子智能体页（卡片+编辑器+模型 picker+fallback 链编辑+权限 chips）
- **验收**：`npx vitest run src/session/subagents-config.test.ts` + `src/kernel/tools/builtin.test.ts`（扩——task 预设解析）+ 五预设内置断言 + ui 资产断言
- **依赖**：P1 H1-H5；P2 15c H6；T-P3-120（模型档面）
- **风险 / 未知**：预设随版本升级的合并策略（内置更新 vs 用户改动——只追加纪律）

#### T-P3-127 · U24 · 指令中心（全局/项目指令与规则编辑） `[ ]`
- **依据需求**：U24（"全局与项目级指令文件集中管理、用户级规则文件编辑——C22 四档作用域的 UI 面"）
- **上游首选参考**：[pi-desktop 指令页行为](../oss/pi-desktop/apps/desktop/src/components/settings)（🔴 只学行为）+ 我方 C22 规则作用域面
- **取什么 / 别抄什么**：取"层级清晰的指令/规则编辑 + 模板辅助"形态
- **要产出**：ui/ 指令中心页：全局 AGENTS.md 查看/编辑（保存前确认）+ 用户级规则文件编辑（规则语法校验——linter 面复用）+ 项目级指令入口（U11 联动）+ 模板插入辅助
- **验收**：ui 资产断言 + `npx vitest run src/policy/`（扩——规则文件校验往返）+ 保存确认面
- **依赖**：T-P3-103；C22（P1）
- **风险 / 未知**：编辑写回的安全面（文件路径受限——protected 面前移）

#### T-P3-128 · U25 · 快捷键系统（清单/自定义/冲突提示） `[ ]`
- **依据需求**：U25（"全局快捷键清单可查、可自定义绑定、冲突提示"）
- **上游首选参考**：[pi-desktop·KeyboardShortcutsSection](../oss/pi-desktop/apps/desktop/src/components/settings)（🔴 只学行为）
- **取什么 / 别抄什么**：取"清单 + 绑定编辑 + 冲突提示"三件
- **要产出**：`ui/keymap.js`（快捷键注册表 + 绑定逻辑——面板/发送/搜索/会话切换/新会话）+ settings 快捷键分节（清单/编辑/冲突提示——浏览器快捷键冲突的提示面）+ 绑定持久化（settings）
- **验收**：ui 资产断言 + 键位注册表往返 + 冲突检测用例（`npx vitest run src/diagnostics/keymap.test.ts` 新——注册表纯逻辑直测）
- **依赖**：T-P3-103
- **风险 / 未知**：浏览器保留键冲突（提示不拦截——卡内定形）

#### T-P3-129 · U26 · 语音设置与输入（实验性） `[ ]`
- **依据需求**：U26（"STT/TTS 配置页 + Composer 语音输入按钮；P4 的 UI 消费端"）
- **上游首选参考**：pi-desktop 语音设置形态（🔴 只学行为——用户截图的"语音【实验性】"位）+ [speech-service](../oss/pi-desktop/apps/desktop/electron/main/services)
- **取什么 / 别抄什么**：取"设置页（引擎选择）+ 输入按钮（按住说话）"形态；TTS 播报最小面（可先只落 STT 侧——卡内定形）
- **要产出**：settings 语音分节（实验性标记；STT 引擎配置——OpenAI 协议端点复用）+ Composer 麦克风按钮（MediaRecorder → P4 的 STT 链 → 文本填入输入框）+ 权限拒绝降级（麦克风权限）
- **验收**：ui 资产断言 + `npx vitest run src/attachments/`（扩——STT 链复用）+ 人工走查（真实麦克风）
- **依赖**：P2 15d P4（STT 面）
- **风险 / 未知**：浏览器 MediaRecorder 编码格式与 STT 端点兼容（webm/opus——卡内定形）

#### T-P3-130 · 收口 · 16d 盘点 + P3 全段终验收 `[ ]`
- **依据需求**：批次 16d 收口 + P3 全段终验收
- **要产出**：盘点面：①U22 技能开关 × I2 装配链；②U23 五预设 × H 族权限降级（预设工具集即 H3/H5 的声明面）；③U23 模型 fallback 链 × U18 辅助模型档一致性；④U24 指令编辑 × protected 路径防线；⑤U25 键位 × 浏览器保留键；⑥U26 STT 链 × P4 面；⑦P3 全段对账（26 条状态表）+ 人工确认清单闭环复核
- **验收**：`npx vitest run`（全量）+ 工具链四件（count-features = 336）+ license-audit
- **依赖**：T-P3-101 ~ 129 全部
- **风险 / 未知**：无

## §7 批次完成定义

- **16a**：6 张卡全勾 ✅；CLI 不带环境变量可启动（读配置）✅；凭据零明文 ✅；设置中心人工走查 ✅；报告入 `plan-p3-progress.md` ✅。**补全卡 T-P3-132**（#28 裁决落实——U14 日志分节）随 16b 会话首卡之前执行，勾后 16a 全闭。
- **16b**：10 张卡全勾 ✅；渲染安全评审 ✅；**双击 exe 可对话（人工验收）** ✅；人工确认清单全部闭环（转正/放弃两态）✅；`count-features.sh` = **324** ✅；`check-doc-links.sh` 显式传参 0 失效 ✅；`license-audit.sh` exit 0（vendor 登记）✅。
- **16c**：9 张卡全勾 ✅；工作面板三 Tab 可用（文件树/变更评审/子代理监控）✅；提示词库/MCP 向导/辅助模型卡/Profiles/导入导出/CLI TUI 各面验收 ✅；报告入 `plan-p3-progress.md` ✅。
- **16d**：6 张卡全勾 ✅；技能管理（清单/编辑器/来源目录）✅；子智能体管理（内置五预设/自定义/模型 fallback 链/权限 chips）✅；指令中心/快捷键/语音设置各面验收 ✅。
- P3 对账：27 条逐条状态表（落地/放弃理由）入 progress ✅。
- **段收官产出《P3 功能全景与借鉴映射》**（`YYYYMMDD_P3功能全景与借鉴映射.md`——P0/P1 惯例固化）✅。
