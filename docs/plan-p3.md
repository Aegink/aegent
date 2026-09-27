# P3 实施计划（产品化层）

> **性质**：P3 优先级层全阶段计划（U 域 8 条 / 批次 16 / 9 张卡），2026-09-28 展卡——**用户裁决新增层**："让 aegent 从内核变成产品"。
> **执行协议**：沿用 [`plan-p0.md`](plan-p0.md) §0；推进模式一会话一批次（批次 16 单批，可在批次 15e 收官后接力执行）。
> **锚点纪律**：U 域 8 条锚点于 2026-09-28 展卡逐一核对（cc-switch 的 config.rs/app_store.rs/tauri 侧、pi·client、pi-desktop、codex·dpapi——产品形态锚全部命中；cc-switch 的**产品主题就是多供应商配置切换**，U1/U2/U5 的行为蓝本）。
> **执行前置**：批次 16 在批次 15a~15e（P2，[`plan-p2.md`](plan-p2.md)）收官之后——U3 依赖 15a 的 Q2 检索面、U8 依赖 15d 的 IM/webhook 端与 15b/15c 面。

## §1 全局约束（P3 段）

1. **一份资产两端共用不变**：U4 精美化只动 `ui/`——桌面壳（K2）与网页（K5）同时受益，不出现第二份 UI。
2. **凭据红线全程**：U2 的 key 管理走 DPAPI/私有档（D8 延伸），配置文件与日志零明文；U8 各平台凭据由用户提供、掩码入 `private/`。
3. **构建链最小化**：U4 不引入前端框架（React/Vite 不取——ui/ 原生 ES module 已工作，重写无验收收益）；渲染增强用 marked（MIT）+ highlight.js（BSD-3）两个纯库 vendor 本地化（`ui/vendor/`，THIRD_PARTY 登记）。
4. **体积目标分列陈述**：§6.1 的 60MB 是"壳"目标（无 node runtime）；U6 引入运行时随包后安装器体积重新陈述（壳 + runtime 分列，不混用旧口径）。
5. **工程纪律不变**：新域 managed:true 入册；工具链四件收官必跑；count-features = **318**（P3 列已扩）。

## §2 批次 16 卡序（9 张：U1/U2/U3/U5/U4/U6/U7/U8 + 收口；2026-09-28 展卡）

**展卡核对结论（我方现状 × 8 条）**：
1. **U1/U2/U5 的行为蓝本就是 cc-switch 的产品主题**（多供应商配置切换）——config.rs 的配置读写/迁移/默认值分层 + app_store.rs 的凭据隔离存储直接映射我方 settings 面；我方增量 = `~/.aegent/settings.json` + 优先级链（环境变量 > 配置文件 > 默认值）+ 启动装载接进 CLI/host/桌面三入口（现三者全靠环境变量——实测发现的真实空白）。
2. **U2 是 D8 的产品化延伸**：DPAPI 加密（P0 已落）+ cc-switch 的凭据隔离存储行为 → key 的录入/更换/删除 CLI 命令（`aegent config set-key <provider>` 形态）+ UI 设置页；零明文断言复用 license-audit 思路（grep 配置目录）。
3. **U3 消费两个既有面**：Q2 SQL 检索（P2 15a 将落）+ M3 resume（P0 已落）——本卡是"入口面"（UI 侧栏 + CLI 子命令），不是新机制；pi-desktop 只学"会话列表的信息架构"行为。
4. **U4 渲染增强两库**（marked/highlight.js）而非框架重写（全局约束 3）；流式打字 = 事件流渲染的节拍面（text-delta 追加节流）；工具卡展开 = 既有通知渲染的折叠增强；diff 视图 = write/apply 类工具的 args/result 对照。
5. **U6 的真实定形点**（展卡预判）：node 运行时随包三案——①node 22 SEA（需 esbuild 先 bundle 成单文件 CJS——SEA 对多文件 ESM 支持有限）②便携 node.exe 随安装包（+~80MB，最稳）③要求用户自装 node（现状——不满足"双击即用"验收）。**倾向 ①**（真单文件 ~50MB，esbuild 是新 devDep）；执行时按 SEA 实测定形，失败回退 ②。
6. **U7 依赖 U6 的分发形态**（updater 升级包就是 sidecar 产物的版本化）；签名走 minisign（cc-switch pubkey 形态——Tauri updater 内置支持）。
7. **U8 是人工确认清单的闭环卡**：P1/P2 累积的真实联调项（Anthropic wire/飞书/Slack/STT/OAuth/ACP 客户端）逐项跑掉——每项都需要用户供给真实凭据/环境；跑不掉的明确"放弃"也记档（不悬挂）。

**词汇表预判**：U1~U7 零事件预判（全部是入口/渲染/分发面——既有 wire 与事件词汇在位）；U8 联调若暴露协议缺口走 §0 待澄清。无 #28 立案候选预判。

#### T-P3-101 · U1 · 配置文件面（settings 持久化 + 优先级链） `[ ]`
- **依据需求**：U1（"settings 持久化；环境变量 > 配置文件 > 默认值；损坏配置 fail-closed 且给出修复指引"）
- **上游首选参考**：[cc-switch·src/config.rs](../oss/cc-switch/src-tauri/src/config.rs) + [app_store.rs](../oss/cc-switch/src-tauri/src/app_store.rs)（配置读写/迁移/默认值的产品形态）
- **取什么 / 别抄什么**：取"配置分层（默认值 → 文件 → 环境变量覆盖）+ 损坏 fail-closed + 迁移版本号"行为；不抄其 Rust 结构（TS 实现）与其多应用切换语义（我方单应用）
- **要产出**：`src/session/settings.ts`——`SettingsShape`（provider 列表/默认 provider+model/权限档/沙箱档/外观/语言）+ `loadSettings(dir?)`（`~/.aegent/settings.json`：损坏 → SettingsError 带行列号与修复指引——parseProviderConfig 同款定位纪律）+ 优先级合并（env > file > default——agent-child 的 AEGENT_* 与此对接）+ `--settings <path>` 参数面；CLI/host server/agent-child 三入口接线（不带环境变量可启动）
- **验收**：`npx vitest run src/session/settings.test.ts src/cli/index.test.ts`（扩）——优先级三档合并 + 损坏 fail-closed（错误带指引）+ 默认值启动（无 env 无文件）+ 三入口接线断言
- **依赖**：无（P3 首卡）
- **风险 / 未知**：配置 schema 版本迁移（v1 起步——迁移链 P1 sqlite 同款纪律）

#### T-P3-102 · U2 · 凭据管理入口（录入/更换/删除 + DPAPI 落盘） `[ ]`
- **依据需求**：U2（"key 的录入/更换/删除走 CLI/UI；落盘经 DPAPI 加密；配置文件与日志零明文"）
- **上游首选参考**：[cc-switch·app_store.rs](../oss/cc-switch/src-tauri/src/app_store.rs)（凭据隔离存储）+ [codex·dpapi.rs](../oss/codex/codex-rs/windows-sandbox-rs/src/dpapi.rs)（P0 D8 已落加密面）
- **取什么 / 别抄什么**：取"凭据与配置分离存储 + 专用管理命令"行为；DPAPI 面复用 D8（win32-helper 已有）
- **要产出**：`src/session/credentials.ts`——`setKey/getKey/deleteKey`（provider 维度；DPAPI 加密落 `~/.aegent/credentials.bin`——非 Windows 回退 0600 权限文件记档）+ CLI `aegent key set/get/delete <provider>` 命令 + settings 面集成（provider 配置引用凭据档——settings.json 零 key 断言）+ license-audit 式零明文扫描
- **验收**：`npx vitest run src/session/credentials.test.ts`——往返 + 加密断言（落盘字节非明文）+ 删除面 + settings 零明文 + 非Windows 回退
- **依赖**：T-P3-101（settings 面）
- **风险 / 未知**：DPAPI 在非交互会话的可用性（P0 已验证面）；UI 录入页随 U4（本卡 CLI 面）

#### T-P3-103 · U3 · 会话历史管理（列表/续聊/删除入口） `[ ]`
- **依据需求**：U3（"历史会话列表/续聊/删除；崩溃恢复一键续跑"）
- **上游首选参考**：[pi-desktop 会话列表行为](../oss/pi-desktop)（🔴 只学行为：列表信息架构）+ P2 15a 的 Q2 检索面
- **取什么 / 别抄什么**：取"列表（时间/标题/状态）+ 点开续聊 + 删除确认"的信息架构；机制全部复用（Q2 查询/resume/删除走 Q4 清理面）——本卡是入口面
- **要产出**：①CLI：`aegent sessions list/resume/delete` 子命令（Q2 查询 + session/resume 请求 + Q4 删除面）；②UI 侧栏：历史列表 + 续聊按钮（query 信封扩展 `op:"sessions"` 或独立只读面——wire 形状扩展先例）+ 删除确认对话框
- **验收**：`npx vitest run src/session/sessions-cli.test.ts src/host/server.test.ts`（扩）——列表/续聊/删除三面 + resume 一键（interrupted 会话续跑）+ UI 资产断言
- **依赖**：P2 15a（Q2/Q4 面）；T-P3-101（settings）
- **风险 / 未知**：wire query 扩展的形状（op 枚举追加——批次 12/14 先例）

#### T-P3-104 · U5 · 模型/端点管理 UI（多供应商切换 + 健康徽标） `[ ]`
- **依据需求**：U5（"多供应商列表、会话期切换、健康徽标"）
- **上游首选参考**：[cc-switch 核心形态](../oss/cc-switch)（多供应商配置一键切换——本仓的产品主题即此）
- **取什么 / 别抄什么**：取"供应商卡片列表 + 一键切换 + 状态显示"的界面行为；不抄其 Claude/Codex/Gemini 特定配置语义（我方 provider 泛型配置）
- **要产出**：①settings 的 provider 列表 UI（ui/ 设置页：列表/新增/编辑/默认标记——U1 配置的渲染端）；②会话期切换：UI 下拉 → `model/switch` 请求（J6 wire 面已有——即时生效下一轮）；③健康徽标：J16 probeProvider 的 UI 消费（列表项状态点——探测节流面）
- **验收**：`npx vitest run src/host/server.test.ts`（扩）+ ui 资产断言——切换请求往返 + 下一轮 request/header modelId 变化 + 健康探测触发
- **依赖**：T-P3-101/102（settings + 凭据）
- **风险 / 未知**：切换时在途轮的语义（J6 既有语义——新 turn 生效）

#### T-P3-105 · U4 · UI 精美化（渲染分层 + 交互升级，一份资产） `[ ]`
- **依据需求**：U4（"markdown/代码高亮/流式打字/工具卡展开/diff 视图/审批卡优化；仍一份 ui/ 资产两端共用"）
- **上游首选参考**：[pi·client](../oss/pi/packages/client)（🔴 只学行为：渲染分层与增量更新纪律）
- **取什么 / 别抄什么**：取"渲染分层（纯文本层/markdown 层/代码层）+ 增量追加不重排"行为；不抄其 React 框架与组件树（全局约束 3——原生 ES module + 两 vendor 库）
- **要产出**：①`ui/vendor/`（marked + highlight.js 本地化 + THIRD_PARTY 登记）；②渲染分层：assistant/message 走 markdown+高亮（user/message 保持纯文本——注入面防呆：模型产出渲染、用户输入不渲染）；③流式打字：text-delta 节流追加（requestAnimationFrame 面）；④工具卡展开：tool/call→result 成对折叠卡（args JSON 格式化 + 写操作 diff 对照——args.path/content 前后文）；⑤审批卡优化（C55 拒绝面 alternatives 展示——P2 15b 落地后）+ 错误重试交互（prompt 重提）
- **验收**：`npx vitest run src/diagnostics/tauri-shell.test.ts`（扩——vendor 在位与资产完整性）+ ui 资产冒烟（静态托管断言扩展）+ **人工确认清单**：浏览器/WebView 实际渲染走查
- **依赖**：T-P3-104（设置页定形后统一动 ui/）
- **风险 / 未知**：XSS 面（模型产出的 markdown 渲染——marked 配置禁 HTML + 渲染结果只进 innerHTML 白名单策略——安全评审落完成记录）；人工视觉验收

#### T-P3-106 · U6 · 桌面壳 sidecar 分发（双击即用） `[ ]`
- **依据需求**：U6（"壳管理 host 进程生命周期；node 运行时随包；双击即用"）
- **上游首选参考**：[cc-switch·tauri 侧](../oss/cc-switch/src-tauri)（externalBin sidecar 形态）
- **取什么 / 别抄什么**：取"壳 = 进程管理器（起/健康/收束）"行为；运行时随包方案执行时定形（展卡预判：**倾向 esbuild bundle 成单文件 CJS + node 22 SEA** 真单文件 ~50MB；SEA 实测失败回退便携 node.exe 随包 +~80MB——全局约束 4 体积分列陈述）
- **要产出**：①host 的单文件 bundle 面（esbuild devDep + `build:single` 脚本——dist 全量打进一个 CJS）；②SEA 产物（`node --experimental-sea-config` 流程脚本）或便携 node 回退；③Tauri 壳 Rust 侧进程管理（起 sidecar/健康探测/退出收束——tauri shell 插件或 std::process 最小面）；④壳启动参数来自 U1 配置（host 端口/session）
- **验收**：**真实机器双击 exe → 自起 host → UI 可对话（人工验收）** + `npx vitest run src/diagnostics/tauri-shell.test.ts`（扩——sidecar 配置形状）+ 安装器体积分列数字落完成记录
- **依赖**：T-P3-101（配置）；批次 13 K2 壳面
- **风险 / 未知**：SEA 对依赖树的兼容（better-sqlite3 原生模块——SEA 内嵌 .node 有限制，**这是 ①案最大风险点**，失败即回退 ②）；Windows Defender 对 SEA exe 的误报（签名面随 U7）

#### T-P3-107 · U7 · 自动更新（updater + 版本清单 + 签名，本地演示面） `[ ]`
- **依据需求**：U7（"updater 插件 + 版本清单 + 签名校验；本地演示面——分发渠道不建"）
- **上游首选参考**：[cc-switch·tauri-plugin-updater](../oss/cc-switch/src-tauri/Cargo.toml)（pubkey + endpoints 形态）
- **取什么 / 别抄什么**：取"签名 + 清单 + 插件校验安装"链路；不建真实分发渠道（endpoints 指向本地文件/localhost——演示面）
- **要产出**：tauri-plugin-updater 接入（九插件群解禁的例外——updater 单插件入册）+ minisign 密钥对生成流程（私钥 `private/`）+ 版本清单 `latest.json` 生成脚本（tools/）+ 本地演示：旧版装 → 清单指向新版 → 校验安装（人工演示记录）；签名拒绝负例
- **验收**：本地 updater 演示两路（通过/拒绝）落完成记录 + `npx vitest run src/diagnostics/tauri-shell.test.ts`（扩——updater 配置形状）
- **依赖**：T-P3-106（sidecar 产物即升级对象）
- **风险 / 未知**：本地 HTTPS 端点需求（updater 要求 https——本地演示用 localhost 例外或 http 豁免配置——执行时定形）

#### T-P3-108 · U8 · 真实平台联调收尾（人工确认清单闭环） `[ ]`
- **依据需求**：U8（"Anthropic 真实端点、飞书/Slack 真实机器人、STT 真实端点、OAuth 真实流程、ACP 真实客户端——人工确认清单逐项闭环"）
- **上游首选参考**：各平台真实环境（P1/P2 联调项的汇总闭环——无单一新锚）
- **取什么 / 别抄什么**：——（验证卡）
- **要产出**：逐项联调记录（每项：凭据掩码入 `private/` + 实测结果 + 缺口修复或放弃理由）：①Anthropic 真实端点一轮（cache_control 标记策略——T-P1-108 的终验）；②飞书/Slack 真实机器人一轮（P2 15d K6/K7 面）；③STT 真实端点（P2 15d P4 面）；④OAuth 真实流程（P2 15e J17 面）；⑤ACP 真实客户端（T-P1-117 终验）；⑥Windows 真机桌面壳+S4 屏幕操作（U6/P2 15d S4 的真机面）
- **验收**：人工确认清单逐项状态更新（转正/放弃两态——不悬挂）+ 联调缺口若涉产品代码 → 当场修复回归
- **依赖**：P2 15d/15e 全部 + T-P3-106（桌面壳真机）
- **风险 / 未知**：**各项都需要用户提供真实凭据/环境**——用户不可用时明确记档放弃（不阻塞 P3 收官）

#### T-P3-109 · 收口 · P3 盘点 + 产品化终验收 `[ ]`
- **依据需求**：批次 16 收口
- **要产出**：盘点面：①U1 优先级链 × 三入口一致性（CLI/host/桌面同配置源）；②U2 凭据零明文全链扫描；③U4 渲染 XSS 面评审结论；④U6 分发形态定形记录（SEA 或回退）+ 体积分列陈述；⑤U8 闭环状态表；⑥快照即规格：双击 exe 全链一条（人工）；⑦全量回归 + 工具链四件
- **验收**：`npx vitest run`（全量）+ 工具链四件（count-features = 318）+ license-audit + **P3 对账**：8 条逐条状态表入 progress
- **依赖**：T-P3-101 ~ 108 全部
- **风险 / 未知**：无

## §3 批次 16 完成定义

- 9 张卡全部打勾 ✅（每勾附「命令 + 结果摘要」）；`npx tsc --noEmit` 干净 ✅；`count-features.sh` = **318**（U 域 8 条 P3）✅；`check-doc-links.sh` 显式传参 0 失效 ✅；`license-audit.sh` exit 0（vendor 库登记）✅。
- **产品化验收**：CLI 不带环境变量可启动（读配置）✅；凭据零明文 ✅；UI 精美化人工走查通过 ✅；**双击 exe 可对话（U6 人工验收）** ✅；人工确认清单全部闭环（转正/放弃两态）✅。
- 报告 + 下一步提示词入 `plan-p3-progress.md` ✅。
