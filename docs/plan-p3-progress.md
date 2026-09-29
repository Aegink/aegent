# P3 执行进度 · 批次 16

> 本文件接续 [`plan-p2-progress.md`](plan-p2-progress.md)（P2 段批次 15a~15e **已于 2026-09-28 全部收官**——48 条逐条对账表与段收官文档 [`20260928_P2功能全景与借鉴映射.md`](20260928_P2功能全景与借鉴映射.md)；全量基线 1672 passed / 1 skipped（191 文件）、词汇表 29 事件〔#24/#27 已于 P2 段追认〕、count-features 337、架构检查 0 error / 21 warning）——**P3 产品化层执行进度**（批次报告 / 待澄清 / 人工确认清单）记入本文件。
> 执行协议沿用 [`plan-p0.md`](plan-p0.md) §0；计划本体在 [`plan-p3.md`](plan-p3.md)（U 域 **27 条** / 批次 16a~16d / 31 卡，2026-09-28 用户裁决"让 aegent 从内核变成产品"）。
> **待澄清编号接续（#28/#29 已立案——#28 已落实关闭、#29 待用户裁决；新增立案从 #30 起）**——词汇表立案管线不变（`l0-events.md` §8 落地记录全局连续；16a/16b 零事件兑现，词汇表 29 不变）。

---

## 批次报告（追加于收官时）

### 批次 16a · 收官报告（2026-09-29）

**状态**：✅ 收官（2026-09-29）——6 张卡全关（T-P3-101 ~ 106）。台账：T-P3-101 U1 settings 持久化 ✅（SettingsShape v1 + SettingsError 行列号修复指引 + resolveChildLaunchArgv 三档优先级〔CLI 显式 > env AEGENT_* > file > 缺省〕+ --settings 参数面 CLI/host 接线 + agent-child 补 --base-url/--api-key/--model argv 面；16+回归 82 passed）。T-P3-102 U2 凭据 ✅（CredentialStore：DPAPI blob〔包 SecureKeyStore，补 deleteKey/listKeys〕/ 非 Windows 0600 回退 + CLI key set|get|delete|list〔stdin 读入不进命令行、get 只出掩码〕+ 装配消费 credentialKey 槽〔apiKey 槽序：显式 > env > 凭据〕+ settings.json 零 key 断言；13 passed 含真 PowerShell DPAPI 往返）。T-P3-103 U14 设置中心 ✅（settings 直答信封〔op 闭集 get/update/credentials-*/probe/session-delete；parse 层形状 + gateway 层段白名单双层分工〕+ FileSettingsGateway + ui 六分节抽屉面板 + 即改即存 500ms 防抖 + 主题 CSS 变量化暗/亮全端一致 + 快照即规格机验〔UI 改 → 文件变 → 重新 loadSettings 一致〕；14 passed）。T-P3-104 U5 模型/端点管理 ✅（多注册表装配〔settings providers 全条目实例化 + 凭据解密 → J6 ModelSwitchService 可选面；显式单模型分支零变化〕+ UI 会话期切换〔model/switch 非写命令免租约、新 turn 生效〕+ 健康徽标〔settings op:probe → J16 probeProvider，UI 状态点 + 10s 节流，不触碰熔断器〕+ 条目编辑面；9+回归 50 passed）。T-P3-105 U3 会话历史 ✅（listSessionSummaries〔session_index + 首条 user/message 前 60 字标题〕+ deleteSession 四表事务 + CLI sessions list|resume|delete〔--yes 硬删除闸；resume = 同 id 再开进程机制复用〕+ query op:"sessions" 清单 + events 放宽任意会话只读〔跨会话回源 SQLite 库；写命令仍限本会话〕+ settings op:"session-delete" + UI 历史侧栏〔查看只读 + confirm 删除确认 + resume 入口提示〕；16+回归 65 passed）。T-P3-106 收口 ✅（五项盘点 + 工具链五件全绿，见下）。

- **验收台账**：全量 `npx vitest run` **1710 passed / 7 skipped**（196 文件；批次入口基线 1672/1〔191 文件〕→ 净增 38 passed、5 文件。7 skipped 中 6 例 = live-p2 真实端点联调文件——本会话无真实凭据环境条件跳过〔P2 15e 收官时人工供凭据 6/6 跑过〕，1 例既有；本批新增测试 44 例全部通过）；`npx tsc --noEmit` 全程干净；`count-features.sh` = **337（层数 20；P3=27）不变**；`check-doc-links.sh`（显式传参 10 文件）**1206 链接 0 失效**；`architecture:check` **0 error / 21 warning**（基线保持；治理动作：session requires 增补 sandbox〔U2 凭据 DPAPI 依赖〕、host requires 增补 models〔U5 健康探测与掩码工具〕、cli requires 增补 models〔key 命令掩码〕、exceptions 新增 2 条长 e2e 测试文件豁免〔live-p2.test.ts 427 行 / server.test.ts 639 行——reason 入 policy〕）；`vocabulary:check` 0 问题（16a 零事件兑现）；license-audit exit 0。

**盘点面（T-P3-106 五项）**：
1. **U1 优先级链 × 三入口一致性** ✅——CLI（index.ts）与 host（server.ts main）同走 `resolveChildLaunchArgv`（session/settings.ts 单一翻译面），桌面壳只加载 ui 静态资产、host 进程即其入口（壳经 host 间接共用）。链序：CLI 显式参数 > env（AEGENT_*，agent-child parseArgs env 回退、argv 覆盖）> 配置文件档 > 缺省；文件档**整体生效或不生效**（defaultProvider 选中条目整体注入 adapter/baseUrl/model——cc-switch 配置切换语义），provider 槽被 env/显式占用时条目不参与。机验：settings.test（优先级链 5 例）+ cli/index.test（假子进程 argv 观察窗——"不带环境变量可启动"）。
2. **U2 凭据零明文全链扫描** ✅——凭据库 credentials.bin：Windows 落 DPAPI blob（测试 sk- 证伪：落盘 JSON 无明文）、非 Windows 0600 权限文件（平台差异记档）；settings.json 零 apiKey 字段（save 往返断言）；CLI key 命令明文不进命令行（stdin 读入）、get 只输出掩码（maskToken）；wire 回执只带掩码（server.test credentials-set 断言）；agent-child 装配凭据按条目名从 credentials.bin 解密后进子进程参数——该面（进程命令行对本机可见）为 P0 T-8 定形的既有装配面，非本批新增暴露（记档）。
3. **U14 设置分节 × settings 模块一一对应** ✅——六分节 providers/credentials/permission/sandbox/appearance/about ↔ SettingsShape 六段（appearance 兼语言——cc-switch LanguageSettings 同款分节）；tauri-shell.test 资产断言分节 id 齐全；settings patch 段白名单（applySettingsPatch）= parseSettingsShape 已知字段集，version 不许 patch（迁移链单向门）。
4. **U5 切换 × J6 语义（新 turn 生效）** ✅——server.test e2e：model/switch 请求往返 ok（非写命令免租约）→ 下一轮 request/header 的 config.modelId = 新值 + model/switch 落流事件（J9）可见；在途轮用启动时捕获值跑完（J6/J7 既有语义，装配多注册表零语义新增）。
5. **快照即规格：设置改 → 文件变 → 重启生效一条** ✅——server.test e2e：settings update（theme+providers+defaultProvider）→ response 返回合并结果 → 磁盘 settings.json 内容断言 → 重新 loadSettings（重启模拟）读回一致。

**U 域原文与锚点核对（收口补做，2026-09-29——用户质疑待澄清表"无"的核对支撑后补）**：
- **方法**：①docs/requirements.md:644-654 U1/U2/U3/U14/U5 原文逐字对照 plan-p3.md 卡面摘录与落地实现；②`bash tools/snapshot.sh` 刷新 oss/SOURCES.lock——**全部上游 commit SHA 零漂移**（仅生成日期变化，已还原）；③16a 引用的 7 个上游锚点（cc-switch config.rs/app_store.rs/settings 组件族/theme-provider.tsx、codex dpapi.rs、pi-desktop、cc-switch）存在性全 OK；④抽查 config.rs 默认值面与 settings 组件族清单。
- **核对结论**：U1 ✅（五要素+优先级链+fail-closed 指行+无 env 启动全覆盖）；U2 ✅（CLI/UI 双通道+DPAPI+往返+零明文）；U5 ✅（列表/会话期切换/健康徽标全覆盖）；**U3 路径偏离记档**（非失真，**用户裁决 2026-09-29：定案不改**——列表走 session_index 聚合、Q2 消费面归 U9，后续会话不再翻案）——原文"复用 Q2 SQL 查询"，落地列表走 session_index 聚合（Q1 v2/E8 面，`listSessionSummaries`）而非 query.ts 的 querySessions 函数：列表是索引聚合、Q2 是内容检索，语义本不同面，功能达成；Q2 的 UI 消费按计划在 U9 跨会话搜索（16b）。**U14 缺口 → #28 立案**（原文"日志"分节未落且无卡内豁免——上游 LogConfigPanel.tsx 行为锚在位）。
- **流程教训**：执行会话开工三件套应为 ①读 plan 卡序 + ②**requirements.md 对应域原文逐字核对** + ③`snapshot.sh` 锚点漂移检查——16a 开工时只做了①，②③在收官后由用户质疑触发补做。

**卡内定形记档**（16a 特有）：
- settings 信封（U14）：host 面配置直答通道——op 闭集 get/update/credentials-set/delete/list/probe/session-delete；段白名单在 gateway 层（parse 层只管信封形状——双层分工），未知段回 SETTINGS_PATCH_SECTION_UNKNOWN 且不落盘。
- settings patch 语义：段级整体替换（providers 数组整体替换、对象段整体替换）——UI 发整段，防抖 500ms 合并。
- provider 槽双命名空间：--provider/AEGENT_PROVIDER 是适配器名（openai/anthropic/echo），settings 条目名/defaultProvider 是供应商别名——文件档整体生效语义即由此（不做槽级交叉组合）。
- 同 identity 去重（U5 多注册表）：identity = {adapter, modelId}，两条目同 identity 时取先注册（记档）；无 model 的条目跳过（无法成 identity）。
- events 查询放宽（U3）：任意 sessionId 只读（历史查看入口）——跨会话直接回源 SQLite 库（历史会话不在 host 内存镜像）；本会话仍内存序（E1 读面选择不变）；写命令路由仍限本会话（bridge send 校验不变）。

### 批次 16b · 收官报告（2026-09-29）

**状态**：✅ 收官（2026-09-29）——补全卡 + 10 张卡全关（T-P3-132 + T-P3-107 ~ 116）。台账：
- **T-P3-132 U14 日志分节补落** ✅（#28 裁决落实——settings `logging` 段 + 白名单 + ui 第七分节 + `resolveChildLaunchArgv` `--raw-log-dir` 装配槽；31 passed；16a 全闭）。
- **T-P3-107 U4 渲染分层** ✅（vendor 本地化 marked 16.4.2 + highlight.js 11.12.0〔esbuild ESM bundle，THIRD_PARTY 登记〕+ `ui/render.js` 管线〔禁 HTML 透传 + href 白名单——机验 XSS 十例〕+ assistant markdown 气泡 + rAF 流式打字回放 + 工具卡 callId 成对 + 写操作 diff + 审批卡 chip/倒计时 + C55 拒绝面 + 错误重试；18 passed）。
- **T-P3-108 U9 导航检索** ✅（query op:"search"〔Q2 消费面 + `querySessionsDb`〕+ 会话内 Ctrl+F 高亮跳转 + 跨会话搜索面板 + 小地图三色导航条；24 passed）。
- **T-P3-109 U10 Composer** ✅（textarea 多行 + ready 协议扩展〔tools/skills 清单〕+ query op:"files"/"meta" + @//补全 + 粘贴图入附件链〔限额同源〕；35 passed）。
- **T-P3-110 U11 项目管理** ✅（settings `projects`/`activeProject` 段 + ui 项目分节 CRUD + 切换 = 新会话生效语义〔偏离记档：host 内多会话路由随 U6 后运行时面〕；34 passed）。
- **T-P3-111 U12 用量可视化** ✅（query op:"usage" 单源聚合〔usage_rollup + compactionStats + costRollup〕+ settings `pricing` 段 + ui 用量面板〔上下文计量条 + 成本表〕；host requires +obs；60 passed）。
- **T-P3-112 U13 通知引导** ✅（N5 hub→WS n5 广播 + 通知中心/Toast + settings `onboardingDone` 首跑引导 + M3 恢复横幅 + 更新横幅与发布说明〔T-P3-114 接线点〕；51 passed）。
- **T-P3-113 U6 sidecar 分发** ✅（**SEA 实测失败实证**〔ERR_UNKNOWN_BUILTIN_MODULE: better-sqlite3——官方限制〕→ 回退 ②案便携 node.exe；`build:single` 双 bundle〔host.cjs 0.3MB + agent-child.cjs 0.5MB，import.meta shim〕+ 五类伴生资产镜像；壳 Rust 进程管理〔spawn/TCP 健康探测/退出收束〕；`--agent-entry` 旗标；**安装布局真机等效冒烟通过**——真壳自起 host → WS 对话 turn/end completed；NSIS 安装器 **31.08 MiB**；体积分列：壳 ui/ 0.3MB ‖ runtime 108.2MB〔node.exe 81.3 + bundles 0.8 + better-sqlite3 26.1〕）。
- **T-P3-114 U7 自动更新** ✅（tauri-plugin-updater 单插件入册〔九插件群解禁例外——计划授权〕+ `dangerousInsecureTransportProtocol` 本地演示例外 + minisign 密钥对〔private/ 掩码〕+ `createUpdaterArtifacts` 签名安装器〔31.08 MiB + .sig〕+ `tools/update-demo.mjs` 两路演示产物〔valid/rejected〕+ 启动检查 → `window.aegentShowUpdate` UI 横幅钩子闭环；updater 启动检查请求真机实证）。
- **T-P3-115 U8 联调收尾** ✅（逐项两态闭环 **4 放弃 + 2 部分转正，零悬挂**——见人工确认清单的 U8 闭环表；放弃项域面/契约机验全部在库，用户供凭据可重开）。
- **T-P3-116 收口** ✅（见下盘点面）。

- **验收台账**：全量 `npx vitest run` **1732 passed / 7 skipped**（197 文件；16a 基线 1710 → 净增 22 passed + 1 文件。7 skipped 中 6 例 = live-p2 env gate〔P2 15e 已 6/6 真实跑过〕，1 例既有）。`npx tsc --noEmit` 干净。工具链五件：
  - `count-features.sh` = **337**（层数 20；P3=27）——**口径记档 #29**：T-P3-116 卡面与 §7 写的 "324" 与脚本实况不符（count-features 统计需求总表条目、不随实现变化；324 疑为展卡笔误），建议用户裁决修正卡面数字；
  - `check-doc-links.sh`（显式传参 10 文件）**991 链接 0 失效**；
  - `architecture:check` **0 error / 22 warning**——16b 期间曾因 bridge.ts/server.ts 超行涨到 2 error，**拆分治理归还基线**：onQuery 分流拆 `query-gateway.ts`、argv 解析拆 `argv.ts`、静态服务拆 `static-files.ts`（host 均 ≤347 行）；+1 warning = settings.ts 445 行〔非 managed 存量域，渐进收紧路线〕；
  - `vocabulary:check` 0 问题（**16b 零事件兑现**——全部为 wire 载荷/配置面扩展，词汇表 29 不变）；
  - `license-audit` exit 0（vendor 两库已登记 THIRD_PARTY）。

**盘点面（T-P3-116 七项）**：
1. **U1 优先级链 × 三入口一致性** ✅——16a 结论维持；本批 `resolveChildLaunchArgv` 增 `--raw-log-dir` 槽（logging 段装配消费，同一优先级语义 file 补位/env 同值/显式最高）。
2. **U2 凭据零明文全链扫描** ✅——16a 结论维持；本批 settings 新增段（logging/projects/activeProject/pricing/onboardingDone）均无凭据字段（save 往返断言覆盖）。
3. **U14 设置分节 × settings 模块一一对应** ✅——八分节 providers/credentials/permission/sandbox/appearance/logging/projects/about ↔ SettingsShape 各段（+activeProject/pricing/onboardingDone 三个标量位同在白名单）；tauri-shell 分节断言更新到位。
4. **U4 渲染 XSS 面评审结论** ✅——机验十例（script/img 恒转义、javascript:/data: 恒 "#"、hljs 输出转义、safeHref 白名单）+ 设计面（renderMarkdown 调用点全部在 assistant 分支；用户输入/工具结果/args 恒 textContent；vendor 固定版本）；残余面 = 上游零-day（记档），人工走查列清单。
5. **U6 分发形态定形记录** ✅——**②案便携 node.exe**（SEA ①案实测失败——better-sqlite3 原生模块不可内嵌，tools/sea-attempt.mjs 留复现脚本）；体积分列陈述如上（安装器 31.08 MiB）。
6. **U8 闭环状态表** ✅——4 放弃（Anthropic 真实端点/飞书 Slack/STT/OAuth/ACP/S4——各注域面机验在位与重开路径）+ 2 部分转正（桌面壳等效冒烟/S4 域面），见人工确认清单闭环表。
7. **快照即规格** ✅——"设置改→文件变→重启生效"（server.test e2e，16a 既有 + 本批 logging/projects 段扩展）；"双击 exe 全链"——人工双击归 U6 行，**机器等效链真机通过**（安装布局运行真壳 → 自起 host → HTTP 200 → WS 对话 → turn/end completed + updater 检查请求发出）。

**P3 对账表（14 条逐条状态——T-P3-116 验收）**：

| 需求ID | 条目 | 状态 | 落点 |
| --- | --- | --- | --- |
| U1 | 配置文件面 | ✅ 落地（16a） | settings.ts + resolveChildLaunchArgv + 三入口 |
| U2 | 凭据管理入口 | ✅ 落地（16a） | credentials.ts + CLI key 命令 + DPAPI |
| U14 | 设置中心与主题 | ✅ 落地（16a + T-P3-132 补日志分节） | ui 设置面板八分节 + 主题变量 |
| U5 | 模型/端点管理 UI | ✅ 落地（16a） | 多注册表装配 + model/switch + 健康徽标 |
| U3 | 会话历史管理 | ✅ 落地（16a；路径偏离已裁决定案） | sessions CLI + query op:"sessions" + 历史侧栏 |
| U4 | UI 渲染分层基础 | ✅ 落地（16b T-P3-107） | render.js 管线 + 气泡/工具卡/流式/审批卡 |
| U9 | 对话导航与检索 UI | ✅ 落地（16b T-P3-108） | op:"search" + Ctrl+F + 小地图 |
| U10 | 输入区升级 | ✅ 落地（16b T-P3-109） | Composer 多行/补全/粘贴图 |
| U11 | 项目/工作区管理 | ✅ 落地（16b T-P3-110；切换=新会话生效语义记档） | settings 项目档 + 项目分节 |
| U12 | 用量与上下文可视化 | ✅ 落地（16b T-P3-111） | op:"usage" + 用量面板 |
| U13 | 通知与引导体验 | ✅ 落地（16b T-P3-112） | 五件套（n5 广播/引导/恢复/更新横幅/发布说明） |
| U6 | 桌面壳 sidecar 分发 | ✅ 落地（16b T-P3-113；②案定形） | build:single + 壳进程管理 + NSIS 31.08MiB |
| U7 | 自动更新 | ✅ 落地（16b T-P3-114；本地演示面） | updater 插件 + 签名链 + 两路演示 |
| U8 | 真实平台联调收尾 | ✅ 闭环（16b T-P3-115；4 放弃 + 2 部分转正，零悬挂） | U8 逐项闭环表 |

**卡内定形记档（16b 特有）**：
- query op 闭集扩至 events|sessions|search|files|meta|usage——全部只读直答不落流；op 分流实现居 `query-gateway.ts`（依赖注入式——capabilities 活查询）。
- ready 协议扩展（tools/skills 可选载荷）：清单来源 = 子进程注册表（所有者出进程面）；旧子进程/测试注入零变化。
- U11 切换语义：activeProject = 新会话以项目 workspace 启动（host 单会话 spawn 语义不动——多会话路由随 U6 后运行时面，YAGNI 记档）。
- updater 端点 https 强制 → `dangerousInsecureTransportProtocol` 官方例外（仅本地演示）；下载安装动作随真实分发（演示面只走"发现→横幅"链）。
- K2 红线断言随 U7 解禁例外更新（零插件 → 恰一插件 updater）。
- **已知 flake 记档（非本批引入）**：①`llm-replay.test` 计时字段抖动（modelMs/streamDurationMs 0/1 边界——normalize 未平滑计时）；②`http-mock.test` Windows 端口分配竞态（"bad port"）。两次全绿运行在案；建议后续批次顺手修（normalize 加计时平滑 / 端口重试）。


## 待澄清（执行会话新发现；编号接续 #28 起）

| # | 需求ID | 我看到的（含路径:行） | 与需求文档的矛盾 | 建议 | 裁决与落实 |
| #29 | U6/U7 收口 | T-P3-116 卡面与 plan-p3.md §7 的 16b 完成定义写 "count-features = 324"；脚本实况 **337**（tools/count-features.sh 统计 requirements.md §4 条目数——U 域扩至 27 后恒为 337，不随实现变化）。 | 计划数字与脚本口径不符（324 无从对上任何历史口径——疑为展卡笔误） | 建议按脚本实况修正 §7 与 T-P3-116 卡面数字为 337（与 16a 收口口径一致）；本批报告按 337 记录 | 待用户裁决 |
| --- | --- | --- | --- | --- | --- |
| #28 | U14 | requirements.md:653 原文列"…沙箱档/**代理**/语言/**日志**/关于的多分节设置页"；上游行为锚 oss/cc-switch/src/components/settings/**LogConfigPanel.tsx** 在位。16a 落地六分节（providers/credentials/permission/sandbox/appearance/about）——无日志分节；plan-p3.md T-P3-103 卡"取什么"未明示日志分节不取（"代理"有展卡 YAGNI 裁决，"日志"没有）。缺口在收口后补核 requirements 原文时发现（用户质疑待澄清表"无"的核对支撑，2026-09-29）。 | U14"日志"分节未落地且无卡内豁免记录——原文与实现不符 | 建议补落"日志"分节（settings v1 增 logging 段：E14 rawLogDir 开关/目录——LogConfigPanel 行为映射），可随 16c 提示词库或 16d 设置扩展顺手做；或用户裁决豁免记档 | **用户认可补落（2026-09-29）**——立卡 **T-P3-132**（plan-p3.md §3 末尾追加，编号不重排），随 16b 会话首卡之前执行；**已落实（T-P3-132，2026-09-29）**——logging 段 + 白名单 + ui 第七分节 + resolveChildLaunchArgv `--raw-log-dir` 装配槽，验收 31 passed（settings 14 + tauri-shell 7 + server 10），16a 全闭 |

## 人工确认清单（批次 16）

| 需求ID / 批次 | 为什么不能机验 | 人工要怎么确认 | 状态 |
| --- | --- | --- | --- |
| U14 设置中心视觉走查（T-P3-103） | 视觉可读性/布局无自动化判据 | 浏览器打开 host 页 → ⚙ 设置 → 走查八分节布局/亮暗主题切换/凭据输入不回显/改动即存 | 待人工走查 |
| U5 健康徽标真实探测（T-P3-104） | 真实网络端点的探测需真实供应商环境 | 配置真实 baseUrl 条目 → 点"测健康" → 状态点与延迟显示 | 待用户供真实端点 |
| U3 历史列表真实数据走查（T-P3-105） | 真实多会话数据的列表可读性 | 带 --db 跑几轮会话 → ☰ 历史 → 清单/查看/删除确认全链 | 待人工走查 |
| U6 双击即用（T-P3-113） | 安装器在真实 Windows 会话的双击/自起 host/对话全链是人工面 | 双击 `src-tauri/target/release/bundle/nsis/aegent_0.1.0_x64-setup.exe` 安装 → 启动 aegent → UI 对话一轮；**机器等效链已真机通过**（安装布局运行真壳 → 壳自起 host → HTTP 200 → WS 对话 turn/end completed，2026-09-29） | 等效冒烟 ✅；人工双击走查待用户 |
| U7 更新两路真机演示（T-P3-114） | updater 运行时接受/拒绝需要已安装应用 + 本地端点服务 | `node tools/update-demo.mjs --serve 8789` 起端点 → 安装壳启动 → 端点指 valid/latest.json 横幅出现（通过路）；指 rejected/latest.json 更新被拒（拒绝路）。**签名产物已构建**（NSIS + .sig 落盘）；启动检查链已真机实证（对 localhost 端点发出检查请求日志） | 产物/链路 ✅；两路真机演示待用户 |
| U4 渲染视觉走查（T-P3-107） | 视觉可读性/排版无自动化判据 | 浏览器/WebView 走查：①assistant 气泡 markdown 排版（标题/列表/表格/引用）；②代码块高亮 + 复制按钮回显"已复制"；③流式打字（echo 轮可见逐字追加）；④工具卡点开 args/diff（write/edit 增删着色）；⑤审批卡 chip/倒计时；⑥错误轮"重试上一条"；⑦XSS：模型输出含 script 标签与 javascript 伪协议链接时原样可见不执行 | 待人工走查（机验 XSS 十例已过——ui-render.test.ts） |
| U8 各平台真实联调（T-P3-115） | 需要用户供给真实凭据与环境 | 见下方 U8 逐项闭环表——转正/放弃两态记档（放弃项用户可随时重开） | 已闭环（4 放弃 + 2 部分转正） |

### U8 真实平台联调逐项闭环表（T-P3-115，2026-09-29）

| # | 联调项 | 状态 | 依据与记档 |
| --- | --- | --- | --- |
| 1 | Anthropic 真实端点（cache_control 策略） | **放弃**（无 Anthropic 协议端点凭据） | 真实端点联调已由 P2 15e 覆盖最近似面：live-p2 6/6 passed（真实流式 turn/工具往返/usage 落流/**F16 缓存归因**/判官/压缩——OpenAI 协议 deepseek 端点，掩码档 private/live-endpoints.md）。Anthropic 协议的 cache_control 断点策略保持 P2 机验面（J 族）；用户供给 Anthropic 端点可重开 |
| 2 | 飞书/Slack 真实机器人 | **放弃**（无凭据与 webhook 配置——15d K6/K7 遗留延续） | K6/K7 域面机验齐（feishu/slack 协议契约 + IM 审批应答链）；真实机器人一轮需用户提供应用凭据，可重开 |
| 3 | STT 真实端点 | **放弃**（用户未供给端点——15d P4 遗留延续） | transcribeAudio OpenAI 协议 multipart 契约机验钉死；真实端点联调可重开（SttConfig.baseUrl/apiKey/model） |
| 4 | OAuth 真实流程 | **放弃**（无凭据） | OAuth AuthResolver 已挂 J13 authMaterial 既有接口（P2 15e 盘点④）；真实授权码流转需用户环境，可重开 |
| 5 | ACP 真实客户端 | **放弃**（无真实 ACP agent——15c H6 遗留延续） | ACP 后端经内存桥协议往返机验齐；真实进程 spawn 链联调可重开 |
| 6a | Windows 真机桌面壳 | **部分转正**（机器等效链 2026-09-29 真机通过） | 安装布局运行真壳 → Rust 自起 host（TCP 健康探测）→ WS 对话 turn/end completed；人工双击安装器走查归 U6 行（待用户） |
| 6b | S4 真实屏幕操作 | **放弃**（无 Windows 交互桌面会话环境——15d 遗留延续） | S4 Win32 实现与审计面机验在位；真实屏幕操作联调可重开 |

> 放弃 ≠ 删除：以上各项的域面/契约机验全部在库（grep live 相关 env-gate 用例与各域 .test.ts），用户提供凭据/环境后按各表"怎么确认"栏重开即可；**本批不再悬挂任何"待提供"状态项**。

---

## 批次 16c 提示词（当前活跃——批次 16b 收官后接力；2026-09-29 收官时更新）

```
继续 aegent 的 P3 实施。推进模式不变：一会话一批次——本会话做批次 16c 全批
（P3 产品扩展组；8 条需求 ID：U15 U16 U17 U18 U19 U20 U21 U27；9 张卡
T-P3-117~123 + T-P3-131〔U27 判断修正补录〕+ T-P3-124 收口），做完收官即
停，16d 由下一会话接力。卡序：docs/plan-p3.md §5，读 §1 全局约束后从第一
张 [ ] 任务卡开始执行（执行协议沿用 docs/plan-p0.md §0）。本批特有的注意：
1. **开工三件套（每次会话必做，缺一不可）**：①读 plan 卡序与全局约束；
   ②打开 docs/requirements.md 对应域原文（本会话 = U15~U21/U27，在
   requirements.md:657-663/668/669），与卡面"依据需求"摘录**逐字对照**——
   发现摘录漏项/失真立即写 progress 待澄清立案，不擅自扩范围；③
   `bash tools/snapshot.sh` + `git diff oss/SOURCES.lock` 核对上游锚点漂
   移，漂移则先重验锚点再动手。
2. 已裁决/已定案事项（不再翻案）：U3 列表走 session_index 聚合（Q2 消费
   面归 U9）——定案；#28（U14 日志分节）已落实关闭；#29（count-features
   口径 324 vs 337）待裁决——脚本实况 337 为准，若 16c 卡面再遇同类数字
   矛盾同样立案不擅改。**编号撞号警示**：plan-p3.md §5 U27 卡与展卡结论
   里写的"#28 立案预判（协作消息事件形状）"是展卡时的旧编号——#28 已被
   U14 日志分节占用并关闭；U27 若需词汇表/wire 立案，从当前编号接续
   （本收官时待澄清已到 #29，U27 立案 = #30 起）。全量基线 **1732 passed
   / 7 skipped**（197 文件；6 skipped = live-p2 env gate，P2 15e 已真实跑
   过；两例既有基建 flake 已记档——llm-replay 计时抖动/http-mock 端口竞
   态，遇到失败先重跑确认是否命中 flake 再排查）、词汇表 29、count-
   features 337、architecture 0 error / 22 warning（+1 = settings.ts 445
   行存量 warn——host 域行数曾超限已拆分治理，新增长文件注意 400 行上限：
   managed 域是硬 error）。工具链五件收官必跑（check-doc-links 显式传参）。
3. 本批最大风险点：U27 会话间协作的事件形状定形（流内新事件 vs E9 扩展
   ——按"协作消息是持久事实"判据，词汇表扩展走立案管线）；U15 变更评审
   的提取纯函数性能（从流算不建状态）；U21 CLI 编辑器在 Windows 终端的
   按键兼容（Ctrl+W/Ctrl+R 差异——跨终端负例记档）；U17 MCP 向导的连接
   校验（echo 型 mock server 演示——真实生态随 U8 重开）。
4. 收官出组报告（写入本文件），更新本文件的批次 16d 提示词与全量基线后
   停止。不要问要不要继续。
```
