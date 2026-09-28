# P3 执行进度 · 批次 16

> 本文件接续 [`plan-p2-progress.md`](plan-p2-progress.md)（P2 段批次 15a~15e **已于 2026-09-28 全部收官**——48 条逐条对账表与段收官文档 [`20260928_P2功能全景与借鉴映射.md`](20260928_P2功能全景与借鉴映射.md)；全量基线 1672 passed / 1 skipped（191 文件）、词汇表 29 事件〔#24/#27 已于 P2 段追认〕、count-features 337、架构检查 0 error / 21 warning）——**P3 产品化层执行进度**（批次报告 / 待澄清 / 人工确认清单）记入本文件。
> 执行协议沿用 [`plan-p0.md`](plan-p0.md) §0；计划本体在 [`plan-p3.md`](plan-p3.md)（U 域 **27 条** / 批次 16a~16d / 31 卡，2026-09-28 用户裁决"让 aegent 从内核变成产品"）。
> **待澄清编号接续（#28 起）**——词汇表立案管线不变（`l0-events.md` §8 落地记录全局连续；P3 零事件预判，16a 零事件兑现）。

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

## 待澄清（执行会话新发现；编号接续 #28 起）

| # | 需求ID | 我看到的（含路径:行） | 与需求文档的矛盾 | 建议 | 裁决与落实 |
| --- | --- | --- | --- | --- | --- |
| #28 | U14 | requirements.md:653 原文列"…沙箱档/**代理**/语言/**日志**/关于的多分节设置页"；上游行为锚 oss/cc-switch/src/components/settings/**LogConfigPanel.tsx** 在位。16a 落地六分节（providers/credentials/permission/sandbox/appearance/about）——无日志分节；plan-p3.md T-P3-103 卡"取什么"未明示日志分节不取（"代理"有展卡 YAGNI 裁决，"日志"没有）。缺口在收口后补核 requirements 原文时发现（用户质疑待澄清表"无"的核对支撑，2026-09-29）。 | U14"日志"分节未落地且无卡内豁免记录——原文与实现不符 | 建议补落"日志"分节（settings v1 增 logging 段：E14 rawLogDir 开关/目录——LogConfigPanel 行为映射），可随 16c 提示词库或 16d 设置扩展顺手做；或用户裁决豁免记档 | **用户认可补落（2026-09-29）**——立卡 **T-P3-132**（plan-p3.md §3 末尾追加，编号不重排），随 16b 会话首卡之前执行；落实后本格回填"已落实（T-P3-132）" |

## 人工确认清单（批次 16）

| 需求ID / 批次 | 为什么不能机验 | 人工要怎么确认 | 状态 |
| --- | --- | --- | --- |
| U14 设置中心视觉走查（T-P3-103） | 视觉可读性/布局无自动化判据 | 浏览器打开 host 页 → ⚙ 设置 → 走查六分节布局/亮暗主题切换/凭据输入不回显/改动即存 | 待人工走查 |
| U5 健康徽标真实探测（T-P3-104） | 真实网络端点的探测需真实供应商环境 | 配置真实 baseUrl 条目 → 点"测健康" → 状态点与延迟显示 | 待用户供真实端点 |
| U3 历史列表真实数据走查（T-P3-105） | 真实多会话数据的列表可读性 | 带 --db 跑几轮会话 → ☰ 历史 → 清单/查看/删除确认全链 | 待人工走查 |
| U6 双击即用（T-P3-113） | 安装器在真实 Windows 会话的双击/自起 host/对话全链是人工面 | 双击 exe → 壳自起 host → UI 对话一轮 | 待批次 16b 执行 |
| U8 各平台真实联调（T-P3-115） | 需要用户供给真实凭据与环境 | Anthropic/飞书/Slack/STT/OAuth/ACP 逐项实测；不可用项记档放弃 | 待用户提供凭据 |
| U4 渲染视觉走查（T-P3-107） | 视觉可读性无自动化判据 | 浏览器/WebView 实际走查 markdown/高亮/流式/工具卡 | 待批次 16b 执行 |

---

## 批次 16b 提示词（当前活跃——批次 16a 收官后接力；2026-09-29 用户裁决后重写）

```
继续 aegent 的 P3 实施。推进模式不变：一会话一批次——本会话先补全 16a
遗留（T-P3-132 一张卡），再做批次 16b 全批（P3 产品化层第二批：体验与分
发；9 条需求 ID：U4 U9 U10 U11 U12 U13 U6 U7 U8），做完收官即停，16c 由
下一会话接力。卡序：docs/plan-p3.md §3 末尾的 T-P3-132（16a 补全：U14 日
志分节，#28 裁决落实）→ §4 的 10 张 T-P3-107~116，读 §1 全局约束后从第一
张 [ ] 任务卡开始执行（执行协议沿用 docs/plan-p0.md §0）。本批特有的注意：
1. **开工三件套（每次会话必做，缺一不可）**：①读 plan 卡序与全局约束；
   ②打开 docs/requirements.md 对应域原文（本会话 = U14 与 U4/U9~U13/U6/
   U7/U8），与卡面"依据需求"摘录**逐字对照**——发现摘录漏项/失真立即写
   progress 待澄清立案，不擅自扩范围（16a 教训：卡面漏抄导致 U14 日志分
   节缺口，收口才被用户发现）；③`bash tools/snapshot.sh` + `git diff
   oss/SOURCES.lock` 核对上游锚点漂移，漂移则先重验锚点再动手。
2. 已裁决事项（不再翻案）：16a 补核结论 U1/U2/U5 与原文一致；U3 列表走
   session_index 聚合（Q2 消费面归 U9）——用户定案不改；#28（U14 日志分
   节）用户认可补落 → T-P3-132。全量基线 **1710 passed / 7 skipped**（196
   文件；7 skipped 中 6 例 = live-p2 真实联调，无凭据即跳过）、词汇表 29、
   count-features 337、architecture:check 0 error / 21 warning（exceptions
   已豁免 live-p2.test.ts 与 server.test.ts 两条长 e2e——新增长测试拆新
   文件而非再豁免）。工具链五件收官必跑。
3. 本批最大风险点：U6 桌面壳 sidecar 分发的 SEA + better-sqlite3 原生
   模块兼容（展卡预判 ①案失败即回退 ②案便携 node.exe）；U4 的 marked/
   highlight.js vendor 本地化 + XSS 评审（人工走查列确认清单）；U8 是人工
   确认清单的闭环卡——需要用户供给真实凭据，跑不掉的明确"放弃"记档。
4. 收官出组报告（写入本文件），更新本文件的批次 16c 提示词与全量基线后
   停止。不要问要不要继续。
```
