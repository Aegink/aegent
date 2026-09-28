# P2 执行进度 · 批次 15 起

> 本文件接续 [`plan-p1-progress.md`](plan-p1-progress.md)（P0 全程 + P1 批次 1-14，2026-09-28 P1 全部收官定格，全量基线 **1293 passed / 1 skipped**，词汇表 26 事件）——**自批次 15（P2 段）起的执行进度**（批次报告 / 待澄清 / 人工确认清单）记入本文件。
> 执行协议沿用 [`plan-p0.md`](plan-p0.md) §0；计划本体在 [`plan-p2.md`](plan-p2.md)（48 条 / 五批 / 52 卡，2026-09-28 一次展卡——P0 式全阶段计划）。
> **待澄清编号接续（#22 起）**——词汇表立案管线不变（`l0-events.md` §8 落地记录全局连续，批次 15c 收官后为 **28 事件**〔#23 已追认〕；**最新全量基线 1493 passed / 1 skipped**）。
> **批次进度**：15a ✅（2026-09-28）→ 15b ✅（2026-09-28）→ 15c ✅（2026-09-28 收官，本文件报告）→ 15d（下一批）→ 15e。

---

> **P3 已立项**（2026-09-28 用户裁决）：U 域 8 条产品化层见 [`plan-p3.md`](plan-p3.md)——本文件提示词链执行到 15e 收官后，接 `plan-p3-progress.md` 的批次 16 提示词。

## 批次 15d 提示词（当前活跃）

```
继续 aegent 批次 15d 的实施（P2 段第四批：端与自动化；11 条需求 ID：S1 M11 S2 S5
N5 P4 S3 S4 K9 K6 K7）。推进模式不变：一会话一批次——本会话只做批次 15d，做完
收官即停，批次 15e 由下一会话接力。批次 15d 卡序已展（docs/plan-p2.md §6，11 张
T-P2-401~411），读 §1 全局约束后从第一张 [ ] 任务卡开始执行（执行协议沿用
docs/plan-p0.md §0）。本批特有的注意：
1. 展卡锚点核对以 20260926_P2研究_批次圈定建议.md（48/48 零勘误）为底，plan-p2.md
   各批卡序头已落展卡核对结论——执行中若发现锚点与实际不符仍走 §0 待澄清。
2. 词汇表预判（#24 候选）：M11 闲时核销 `job/offer {jobId, window}` log-only；
   S5 反馈 `feedback/note` log-only；K6/K7 的 replySource 闭集扩展（APPROVAL_SURFACES
   追加 feishu/slack——#25 候选）——执行时逐条定形并复核 EVENT_TYPES 28 基线。
3. 全量基线 1493 passed / 1 skipped；词汇表 28 事件（#23 approval/superseded
   已追认定案）；工程纪律工具链四件收官必跑。15c 遗留人工确认 2 项（真实 sshd
   联调 T-P2-310 / 真实 ACP agent 进程联调 T-P2-309）随本批端面联调一并处理。
   收官出组报告（写入本文件），更新本文件的批次 15e 提示词与全量基线后停止——
   不要开始 15e。不要问要不要继续。
```

## 批次 15d · 端与自动化（11 条：S1 M11 S2 S5 N5 P4 S3 S4 K9 K6 K7）

**状态**：🚧 进行中（2026-09-28 开工）——台账：T-P2-401 S1 定时任务 ✅（cron 最小解析器 + v5 CronStore + 被动轮询派发，39 passed）。T-P2-402 M11 闲时任务 ✅（OffPeakQueue 四步取号/窗口/核销/幂等，12 passed；#24 候选定形零事件）。T-P2-403 S2 webhook ✅（处理器面 + token/HMAC 鉴权 + 202 fire-and-forget + 上限防呆，8 passed）。T-P2-404 S5 反馈上报 ✅（#24 立案 feedback/note 词汇表 28→29 + 提交面/wire 面/CLI 面全链，6 passed）。T-P2-405 N5 推送 ✅（NotificationHub 四类分型 + poll 游标补投 + bridge 三类归类，12 passed）。

---

## 批次 15c · 插件生态与远程后端（10 条：M7 I5 I4 I7 I8 I10 I11 I14 H6 D12）

**状态**：✅ 收官（2026-09-28）——11 张卡全关（T-P2-301 ~ 311）。

**展卡注意**（承接展卡核对结论，卡序头在 plan-p2.md §5）：
1. 10 条锚点以 P2 研究 48/48 核对为底，展卡抽核 pi-desktop·plugin-websocket.ts 与 dsh·subagent 包目录（全部命中）——零勘误。执行中锚点语义逐条复核：pi-desktop 锚实为"出站 socket 宿主代理"（取有界/随插件死/transport 可注入三行为）；dsh guard 两包正是需求点名的两例（重复工具提醒/超时策略）。
2. M7 deadline 是横切底座先行（M6/J23 三语义已落——本批收敛为共享原语）；I5 SDK → I4 ws → I7 兼容 → I11 治理的插件生态链；I10 是 #23 立案卡（词汇表 27→28）；H6 五后端取两实落（进程内 + ACP）；D12 三层取命令行包装最小面。
3. 词汇表预判执行兑现：#23 `approval/superseded` 立案落地（词汇表 27→28）；其余九条零事件（M7/I5/I7/I8/I11/I14/H6/D12 逐条定形零扩展）。

### 批次 15c 报告（收官于 2026-09-28）

- **打勾情况**：11/11 卡全关（T-P2-301 M7 统一 deadline 库 / T-P2-302 I5 插件 SDK / T-P2-303 I4 进程外插件 ws / T-P2-304 I7 hook 协议兼容 / T-P2-305 I8 人格预设 / T-P2-306 I10 #23 superseded 立案 / T-P2-307 I11 治理可插拔 / T-P2-308 I14 跨层跳 / T-P2-309 H6 子代理后端可插 / T-P2-310 D12 SSH 后端 / T-P2-311 收口七面盘点 + 快照），每勾附「命令 + 结果摘要」。
- **展卡结论**：10 条锚点零勘误；关键定形——①M7 deadline 原语（Deadline 绝对截止 token + combine 取最近 + withDeadline），timeout.ts 薄壳化（既有语义零变化）；②I5 SDK 受限能力 token（属性闭集 + 内核句柄零暴露）；③I4 ws 插件（hello 版本握手复用 host/protocol + 审批位缺省全拒 + 执行往返 + 断线能力注销）；④I7 双方言桥只桥工具前后两点位 + 事件闭集 fail-closed；⑤I8 人格段进首落 system/message（非独立落流——事件归属纪律）；⑥I10 取代链（单链约束 + 投影期 fail-closed）；⑦I11 建议非强制（治理 ≠ 策略）；⑧I14 跳层三重闸（显式命名/审批层硬保护/白名单）；⑨H6 两后端同语义（词汇同源收敛）；⑩D12 命令行包装（零新依赖 + 凭据零落盘）。
- **产出的文件**：`src/kernel/` 三新件（deadline.ts / deadline.test.ts / chain-jump.test.ts + chain.ts 扩展 + hooks.ts 转发面）；`src/mcp/` 八新件（plugin-sdk.ts / ws-plugin.ts / hook-compat.ts / guard.ts / p15c.snapshot.test.ts + 四测试）；`src/session/` 四新件（persona.ts / subagent-backend.ts / supersession.test.ts + 两测试）；`src/sandbox/ssh-backend.ts`（+ 测试）；扩 `src/kernel/events.ts`（词汇表 28 + ApprovalSupersededEvent）/ `project.ts`（校验 + 取代链消费 + effectiveApproval/supersessionChain）/ `invariants.ts`（豁免）/ `assembly.ts`（personaId）/ `agent-child.ts`（--persona）/ `tools/registry.ts`（deadline 消费）/ `tools/builtin/task.ts`（--backend）+ `architecture-policy.json`（mcp.requires += host）+ `docs/l0-events.md`（§3.2 行 28 + §8 落地记录 23）。
- **验收台账**：全量 `npx vitest run` **1493 passed / 1 skipped**（批次入口基线 1379 → 净增 114，169 文件）；`npx tsc --noEmit` 全程干净；`count-features.sh` = **337（层数 20；P2=48）不变**；`check-doc-links.sh`（显式传参 11 文件）**987 链接 0 失效**；`license-audit.sh` exit 0（LEAK 未命中 / CLEAN-ROOM 无明确声明 / SOURCEMAP 无）；`architecture:check` 全程 0 error / 21 warning（基线保持）；`vocabulary:check` 0 问题。
- **词汇表扩展**：**27→28 一案 + 九条零扩展**——①`approval/superseded {requestId, byRequestId, reason?}`（I10/T-P2-306——log-only 元事件，**#23 已追认〔2026-09-28 用户："全部认可"〕**；l0-events.md §8 落地记录 23 在案、§3.2 行 28）；②其余九条（M7/I5/I4/I7/I8/I11/I14/H6/D12）逐条定形**零事件**（deadline 纯原语 / 插件机制 / 人格走既有 system/message / 取代以外的治理与执行后端全走既有面）——EVENT_TYPES 28 基线复核在位（events.test/replay.test/idle-reaper.test 计数断言同步）。
- **盘点结论**：七面零真冲突（T-P2-311 完成记录）：①M7 deadline × M6/J23（薄壳化后既有 46 用例全绿）；②I5 能力受限 × 句柄零暴露（闭集 + 源码证伪 + 无 ctx）；③I4 不可信边界 × C 族审批（trust 恒 untrusted + 缺省全拒）；④I10 取代 ≠ 撤销（历史保留 + 叠加事实）；⑤H6 两后端同语义（字段集合相等）；⑥D12 第二实现零接口变化 + 凭据零落盘；⑦快照即规格 = `p15c.snapshot.test.ts` 两条链（ws 插件全链 + SDK×桥共存）。
- **新发现的约束或坑**：(a) **架构检查两次实战拦截**——ws-plugin import host/protocol 触发 mcp→host 跨域（按"先声明后收紧"声明 mcp.requires += host）；subagent-backend 初版 import src/acp/jsonrpc 同时触发**深导入 + 新依赖环**（session→acp→…→session）——改为协议形状复用 + 编解码自持（acp 域"仅 8 文件"硬约束下唯一无环解）；(b) **ChainNext.to 必填破坏 16 处 fake next 构造**——to 可选化（"能力如实表达"+composeChain 恒装配）+ hooks 生产转发面 + jumpTo 判空入口；(c) **ws 测试清理纪律**——fake server 须先 terminate 活跃连接再 close（宿主未 dispose 时 server.close 等待连接自然关闭挂死 afterEach）；(d) **project.test/chain.test 行数临界**——新用例拆独立文件（supersession.test / chain-jump.test / p15c.snapshot.test）；(e) Windows 全量并行偶发一例（llm-replay 单跑复证通过——非回归）；(f) **hooks.ts 的 hookNext 需转发 to**——hook 是链上一环不切断跳层能力（配额守卫同款）。
- **偏离计划的地方**：逐卡「完成记录」已记档——要点：T-P2-301 timeout.ts 薄壳化（原计划仅"工具层接线"，实际做了原语家迁移使 withTimeout 收敛薄壳）；T-P2-305 消费点选卡面"或"字的 agent-child --persona 分支（会话期动态切换需 wire 命令扩展，记档）；T-P2-306 验收文字"26→27"系展卡笔误（按 27→28 执行）；T-P2-309 "src/acp 复用"降级为"协议形状复用"（架构环约束）；T-P2-310 runner 注入 + probe 显式（exec 255 歧义记档）。
- **遗留风险与未知**（→ 人工确认清单）：**新增 2 项**——真实 sshd 联调（T-P2-310，测试全走命令注入 mock）；真实 ACP agent 进程联调（T-P2-309，transport 缺省 spawn 未实测）。技术债记档：ws 插件与 SDK 插件的工具登记到 ToolRegistry 的装配接线（本批交付登记面与审批位）；治理建议的宿主消费点（注入上下文/展示）随装配域；跳层能力的装配配置（skippableLayers）随 15d/托管层；15d 端面（S2 webhook/M11 闲时）将消费本批 deadline 原语与 job 面。
- **批次完成定义核对**：全部 ✅（plan-p2.md §8 的 15c 相关项——11 卡全勾 + tsc 干净 + 337 不变 + 987 链接 0 失效 + license exit 0 + #23 立案在案〔已追认〕+ 九条零扩展复核 EVENT_TYPES 28 + 报告/提示词/基线更新）。
- **下一批**：**批次 15d 端与自动化（11 条：S1 M11 S2 S5 N5 P4 S3 S4 K9 K6 K7）**——卡序已展（plan-p2.md §6，11 张 T-P2-401~411），下一会话直接执行，做完收官即停。
- **下一批提示词**：见本文件头部「批次 15d 提示词（当前活跃）」。

---

## 批次 15c 提示词（已执行归档）

```
继续 aegent 批次 15c 的实施（P2 段第三批：插件生态与远程后端；10 条需求 ID：M7
I5 I4 I7 I8 I10 I11 I14 H6 D12）。推进模式不变：一会话一批次——本会话只做批次
15c，做完收官即停，批次 15d 由下一会话接力。批次 15c 卡序已展（docs/plan-p2.md
§5，11 张 T-P2-301~311），读 §1 全局约束后从第一张 [ ] 任务卡开始执行（执行协议
沿用 docs/plan-p0.md §0）。本批特有的注意：
1. 展卡锚点核对以 20260926_P2研究_批次圈定建议.md（48/48 零勘误）为底，plan-p2.md
   各批卡序头已落展卡核对结论——执行中若发现锚点与实际不符仍走 §0 待澄清。
2. 词汇表预判（#23 候选）：I10 superseded——`approval/superseded {requestId,
   byRequestId, reason?}` log-only 元事件；I4 插件生命周期若需落流走同一管线；
   M7/I5/I7/I8/I11/I14/H6/D12 预判零事件——执行时逐条定形并复核 EVENT_TYPES 27
   基线。
3. 全量基线 1379 passed / 1 skipped；词汇表 27 事件；工程纪律工具链四件收官必跑。
   收官出组报告（写入本文件），更新本文件的批次 15d 提示词与全量基线后停止——
   不要开始 15d。不要问要不要继续。
```

---

## 批次 15b · 判官与权限 P2（3 条：C40 C55 C42）

**状态**：✅ 收官（2026-09-28）——4 张卡全关（T-P2-201 ~ 204）。

**展卡注意**（承接展卡核对结论，卡序头在 plan-p2.md §4）：
1. 3 条锚点以 P2 研究 48/48 核对为底，展卡抽核 qwen·classifier.ts 与 codex·execpolicy 全部命中——零勘误。
2. C42 是本批大件（C56 批次 9 已落四件接口面——abstain 落回人/预算/超时常量/受管可强制，判官本体是兑现卡）；C40 的 literal 分型 key:value 文本解析在 P1 T-P1-67/68 已部分落地——执行中发现并按增量定形。
3. 词汇表预判零新事件候选（C42 判官裁决走审计面不走事件、C40/C55 规则结构扩展非事件）——执行兑现。

### 批次 15b 报告（收官于 2026-09-28）

- **打勾情况**：4/4 卡全关（T-P2-201 C40 具名参数匹配 / T-P2-202 C55 拒绝面纪律 / T-P2-203 C42 两阶段 LLM 判官 / T-P2-204 收口四面盘点 + 快照），每勾附「命令 + 结果摘要」。
- **展卡结论**：3 条锚点零勘误；三处关键定形——①C40 增量=声明式 `paramMatchers`（RuleSource 新字段，加载时与解析产物合并为单一 `toolParamMatchers`）+ 全分型 AND（command/path/domain 在 specifier 命中后再 AND 参数 matcher，`evaluateParamMatchers` 提取为共享原语）+ linter `unknown-param-name`（knownToolParams 缺省面取 `builtinToolParamNames()` 真实 schema 派生）；②C55 的"justification 必填"定形=声明时必须非空白（codex 同款），"forbidden 须给替代做法"=deny 规则缺 alternatives 由 linter 检出（警告不拦截——既有纪律不动，拦截会违反"既有拒绝零变化"）；③C42 语义分流——qwen 失败落 shouldBlock=true，我方 C56 已裁决 unavailable→abstain 落回人（fail-closed 到人）；abort 在判官内消化为 abstain（非失败、审计 phase:"aborted"）。
- **产出的文件**：`src/policy/` 六新件（judge.ts / denial.ts / rule-match.ts〔自 rule-loader 分出——行数纪律〕 + judge.test.ts / judge.snapshot.test.ts / denial.test.ts / param-matchers.test.ts 四测试件中的三个新文件 + 分出件）；扩 `rule-loader.ts`（RuleSource/LoadedRule 声明面字段 + 加载归一 + re-export）/ `specifier-kinds.ts`（evaluateParamMatchers 共享原语）/ `linter.ts`（unknown-param-name + missing-alternatives 两检出 + knownToolParams 选项）/ `rules.ts`（ruleDenial 回调）/ `chain.ts`（PolicyOutcome.denial）/ `decision.ts`（Verdict.denial 透传）/ `gate.ts`（deniedResult 渲染接线）/ `judge-port.ts`（JudgeRequest.signal 槽位）/ `assembly.ts`（knownToolParams + judgeModel/requireJudge 装配 + builtinToolParamNames 接入）/ `tools/builtin/index.ts`（builtinToolParamNames——桩依赖注册表读真实 schema，模块级缓存）/ `architecture-policy.json`（policy.requires += models——judge 的真实依赖入册）+ 测试扩（gate.test 判官全链 5 用例与 C40 两用例、linter.test、builtin.test 漂移对账）。
- **验收台账**：全量 `npx vitest run` **1379 passed / 1 skipped**（批次入口基线 1337 → 净增 42，158 文件）；`npx tsc --noEmit` 全程干净；`count-features.sh` = **337（层数 20；P2=48）不变**；`check-doc-links.sh`（显式传参 12 文件）**1232 链接 0 失效**；`license-audit.sh` exit 0（CLEAN-ROOM 无明确声明 / SOURCEMAP 无）；`architecture:check` 全程 0 error / 21 warning（基线保持）；`vocabulary:check` 0 问题。
- **词汇表扩展**：**零扩展**（27 事件不变）——C42 判官裁决走 L2 审计面（`JudgeAuditRecord`，logger 宣告面与审批审计同款）不走事件流；C40/C55 均为规则结构扩展非事件。EVENT_TYPES 27 基线复核在位（events.test 计数断言）。
- **盘点结论**：四面零真冲突（T-P2-204 完成记录）：①判官只在 gate ask/abstain 分支被咨询（快照行为断言 allow/deny 规则命中时判官零调用零审计）；②匹配在参数 JSON 校验后（坏参数直达链底 TOOL_ARGUMENTS_INVALID，规则与判官零触达）；③既有拒绝面零破坏（逐字节等值断言 + 全量回归绿）；④快照即规格 = `judge.snapshot.test.ts` 一条链（git push 无规则命中 → 链 abstain → gate ask 分支 → 判官 Stage1 risky→Stage2 abstain → PendingApprovals 挂起 → 人答 deny 生效，全程零执行）。
- **新发现的约束或坑**：(a) **host server 静态托管用例偶发端口竞争**（server.test 在全量并行下两度偶发失败、单跑复证通过——Windows 测试基建面，非回归；两次均重跑全量绿）；(b) **测试文件 400 行上限**——rule-loader.test/rule-loader.ts/judge.test 三度触线，拆出 param-matchers.test.ts / rule-match.ts（rule-loader re-export 保持导入面零变动）/ 判官 gate 集成段并入 gate.test.ts（基线 21 warning 保持）；(c) **policy.requires 白名单**——judge.ts import models/{identity,provider} 触发两处 requires 警告，判官是真实的 provider 消费方（C42 卡面明示），按"先声明后收紧"纪律把 models 声明进 policy.requires（architecture-policy.json）；(d) **合并信号的取消/超时区分**——AbortSignal.any 合并用户信号与超时信号后，catch 里必须判 `userSignal.aborted`（超时触发的是合并信号、用户信号未中止），否则取消会被误标 unavailable；(e) **builtinToolParamNames 的桩依赖面**——registerBuiltinTools 按 deps 门控注册（todo/webfetch/question/task/session_query 等），桩面须补齐（todoEmit noop / createNetworkGuard({policy:"deny"}) / new PendingApprovals() / runSubagent stub / {dbPath:"stub"}）才能派生全量参数名表。
- **偏离计划的地方**：逐卡「完成记录」已记档——要点：C40 文本 DSL 的 key:value 解析保持 literal 分型 only（Windows 盘符 `C:\` 形状守卫——扩分型解析会违反"既有规则零变化"），声明式 paramMatchers 承担其余分型；C55 "justification 必填"非"每条规则必填"（破坏既有配置）而是"声明时非空白"；T-P2-204 盘点面②的"C17 JsonValue 校验"需求 ID 与原文不符（C17=插件事件泛型逃生舱，requirements.md:279）——按实质执行（匹配在参数校验后）不阻塞记档。
- **遗留风险与未知**（→ 人工确认清单）：**新增 1 项**——判官 prompt 质量（机验只钉结构：Stage1 闭集/Stage2 标签格式/三值路由；语义质量需真实判官模型联调评估）。技术债记档：gate→判官的 turn 级 signal 未接线（LoopContext 无信号面——JudgeRequest.signal 槽位已在）；ChatRequest 无 maxOutputTokens 面（Stage1 低 token 由 prompt 纪律承担）；会话历史不喂判官（JudgeRequest 无历史面）；MCP 工具的参数 matcher 拒配（qwen 支持、我方 fail-closed 记档——15c I4/I5 插件面或需回头扩展）；qwen 的 MCP 参数匹配面不取。
- **批次完成定义核对**：全部 ✅（plan-p2.md §8 的 15b 相关项——4 卡全勾 + tsc 干净 + 337 不变 + 1232 链接 0 失效 + license exit 0 + 零扩展复核 EVENT_TYPES 27 + 报告/提示词/基线更新）。
- **下一批**：**批次 15c 插件生态与远程后端（10 条：M7 I5 I4 I7 I8 I10 I11 I14 H6 D12）**——卡序已展（plan-p2.md §5，11 张 T-P2-301~311），下一会话直接执行，做完收官即停。
- **下一批提示词**：见本文件头部「批次 15c 提示词（当前活跃）」。

---

## 批次 15b 提示词（已执行归档）

```
继续 aegent 批次 15b 的实施（P2 段第二批：判官与权限 P2；3 条需求 ID：C40 C55
C42）。推进模式不变：一会话一批次——本会话只做批次 15b，做完收官即停，批次
15c 由下一会话接力。批次 15b 卡序已展（docs/plan-p2.md §4，4 张
T-P2-201~204），读 §1 全局约束后从第一张 [ ] 任务卡开始执行（执行协议沿用
docs/plan-p0.md §0）。本批特有的注意：
1. 展卡锚点核对以 20260926_P2研究_批次圈定建议.md（48/48 零勘误）为底，plan-p2.md
   各批卡序头已落展卡核对结论——执行中若发现锚点与实际不符仍走 §0 待澄清。
2. 词汇表预判：C42 判官裁决走 approval 面 source 标记（C31 三事实已有——无新事件
   预判）；C40 规则结构扩展非事件——零新事件候选，执行时复核 EVENT_TYPES 27 基线。
3. 全量基线 1337 passed / 1 skipped；词汇表 27 事件（批次 15a 的 #22 session/archive
   已追认定案）；工程纪律工具链四件收官必跑。
   收官出组报告（写入本文件），更新本文件的批次 15c 提示词与全量基线后停止——
   不要开始 15c。不要问要不要继续。
```

---

## 批次 15a · 会话数据与生命周期（7 条：Q2 Q4 Q6 Q8 M4 E6 E9）

**状态**：✅ 收官（2026-09-28）——8 张卡全关（T-P2-101 ~ 108）。

**展卡注意**（承接展卡核对结论，卡序头在 plan-p2.md §3）：
1. 7 条锚点以 P2 研究 48/48 核对为底，展卡抽核 3 处（dsh·session-query 包目录 / pi-desktop·ADR 0023 / qwen·session-idle-reaper design 目录）全部命中——零勘误。
2. Q2 是大件（dsh 包组取"SQL 检索 + 工具化"两件；导出归 E7、五工具全集与我方两工具最小面）；E6"同一套抽象"复用 E5 store.fork 不新建第二套；Q4×Q6×Q8 三件一体（策略/动作分型/消费）；M4 是运行时半边、Q4 是存储半边；E9 走 AttachmentRef 同款引用纪律。
3. 词汇表预判 #22 候选三条（E6 树谱系 / Q8 归档事件 / M4 回收事实）——执行时逐条定形（见下"词汇表扩展"）。

### 批次 15a 报告（收官于 2026-09-28）

- **打勾情况**：8/8 卡全关（T-P2-101 Q6 保留策略常量 / T-P2-102 Q8 归档独立一档 / T-P2-103 Q4 旧数据清理 + 维护 CLI / T-P2-104 M4 空闲回收 / T-P2-105 Q2 会话查询 + 工具化 / T-P2-106 E6 fork 树 / T-P2-107 E9 会话引用 / T-P2-108 收口七面盘点 + 快照），每勾附「命令 + 结果摘要」。
- **展卡结论**：7 条锚点零勘误；四处定形落地——①归档粒度（会话级导出到归档档独立 sqlite + 主库账本 + 删行，非行级迁移）；②Q2 前缀检索改**范围谓词**（LIKE 前缀在 (session_id,type) 索引上仍全表扫描且 ESCAPE 会禁用 LIKE 优化，EXPLAIN 实测后改 `>= prefix AND < 上界`——走主键索引，语义等价）；③M4 回收的"事件 vs 回调"定形（零事件扩展——进程内运行时事实走 onReap 回调，jobs.ts 同款纪律）；④E6 深度零扩展（派生事实不加 depth、不落 session/tree 事件）。
- **产出的文件**：`src/session/` 八新件（retention.ts / archive.ts / cleanup.ts / query.ts / fork-tree.ts / reference.ts + lifecycle.snapshot.test.ts + 各自测试）、`src/host/idle-reaper.ts`（+ 测试）、`src/kernel/tools/builtin/session-query.ts`（session_query/session_get 两工具 + descriptions 两枚）、`src/cli/maintenance.ts`（维护入口）；扩 `src/kernel/events.ts`（词汇表 26→27 + sessionRefs 载荷）/ `project.ts`（session/archive 校验 + sessionRefs 校验）/ `invariants.ts`（豁免面）/ `store.ts`（sessionId/sessionRefs 只读面 + sessionIds()）/ `messages.ts`（resolveSessionRef 注入）/ `queue.ts` / `loop.ts` / `agent-protocol.ts` / `agent-process.ts` / `agent-child.ts`（引用 wire + 编排 + 装配）/ `session/db.ts`（SessionArchivedError + readAll fail-closed）/ `session/migrate.ts`（v2→v3 归档账本 + v3→v4 运维两表）/ `session/project.ts` / `agent-process.ts`（工具注册透传）/ `tools/builtin/index.ts`（BUILTIN_TOOL_NAMES 17→19）/ `package.json`（maintenance 脚本）+ `docs/l0-events.md`（§3.2 行 26/27 + §8 落地记录 22）。
- **验收台账**：全量 `npx vitest run` **1337 passed / 1 skipped**（批次入口基线 1293 → 净增 44，154 文件）；`npx tsc --noEmit` 全程干净；`count-features.sh` = **337（层数 20；P2=48）不变**；`check-doc-links.sh` 829 链接 0 失效（显式传参 11 文件）；`license-audit.sh` exit 0（LEAK 未命中 / SOURCEMAP 无）；`architecture:check` 全程 0 error / 21 warning（基线保持）；`vocabulary:check` 0 问题。**CLI 端到端实测**：`npm run maintenance -- cleanup --db <tmp>` 真实库 dry-run/执行两态 + 归档档真实落盘。
- **词汇表扩展**：**26→27 一案 + 两处零扩展定形 + 一处载荷扩展**——①`session/archive {reason?}`（Q8/T-P2-102——log-only 会话级元事件，归档前落流尾随数据进归档档；**#22 已追认（2026-09-28 用户："认可22"）**；l0-events.md §8 落地记录 22 在案，§3.2 表格补行 26/27（含补回 image/offload 遗漏行））；②E6 谱系**零扩展**（深度派生不加 depth——避免与流内事实漂移）；③M4 回收事实**零扩展**（进程内运行时事实走 onReap 回调，不进词汇表）；④`user/message.sessionRefs?` 载荷扩展（E9——流存引用不存内容；计数不变）。events.test / obs/replay.test 计数断言同步 27。
- **盘点结论**：七面零真冲突（T-P2-108 完成记录）：①Q6/Q4/Q8 同一 RETENTION_POLICY 消费链（清理动作零裸数值 + 归档唯一入口 + 候选判龄幂等）；②M4 内存态 × Q4 磁盘态分域（互不调用；M4 阈值独立常量非保留策略）；③Q2 只读零落流（SQL 只 SELECT + 工具零事件）；④E6 零第二套 fork（源码证伪 + 血统唯一来源 = E5 事件 + 多标记取最后一条实测钉死）；⑤E9 流存引用不存内容（引用方流零被引字节 + 注入纯投影）；⑥#22 立案在案 + 两零扩展定形 + EVENT_TYPES 27 基线复核；⑦快照即规格 = `lifecycle.snapshot.test.ts` 五环一条链（fork 树 → 引用注入与环拒绝 → SQL 检索 → 归档 fail-closed → 清理 dry-run）。
- **新发现的约束或坑**：(a) **fork 子流内多枚血统标记**——E5 把源流前缀整段复制，被 fork 出来的会话其标记会落进孙代流中段；本会话自己的标记恒为**最后**一条 session/fork（`find`（取首）会把祖父误读成父——实测两枚标记顺序后改 findLast，三层树用例钉死）；(b) **接口 vs 类型别名与 wire 型证**——`interface SessionRef` 无隐式索引签名，破坏 `Exclude<AgentRequest, JsonValue>` 编译期型证（tsc 当场报 true≠false）；改 type 别名（AttachmentRef 同款形式纪律）；(c) **LIKE 前缀 + ESCAPE 禁用索引优化**（EXPLAIN 实测 SCAN e；范围谓词走 PK 索引）；(d) `session_index.updated_ts` 是清理判龄的唯一时点源（flush 落库时点——测试须显式 UPDATE 构造旧活跃）；(e) doc-link 检查器会把完成记录里的 Markdown 内联链接形态（`@[label]` + `dsh-session:` URI 写法）当相对链接误报（改写为反引号形态）。
- **偏离计划的地方**：逐卡「完成记录」已记档——要点：Q2 前缀检索 LIKE→范围谓词（见上 (c)）；Q4 的审计/任务运行两表随 v4 迁移落库（本仓此前无持久表——L2 审计原只走 logger；生产者接线随各自域记档）；M4 零事件扩展（卡面"落流候选"定形为回调）；E6 深度零扩展；E9 引用注入走 loop.buildMessages 的 store resolver（正文内联 mention 语法不取）。
- **遗留风险与未知**（→ 人工确认清单）：**本批无新增人工确认项**（全部验收机可验——本批为本地库/内存面，无真实端点/平台联调）。技术债记档：Q2 内容 LIKE 全表扫描（P2 单机规模可接受——FTS/索引随真实规模）；审计/任务运行表的**生产者接线**未做（写入原语在位）；跨库会话引用不注入（resolver 读内存序）；15c H6 后端与 15d 调度域将消费本批的树/查询/reapable 面。
- **批次完成定义核对**：全部 ✅（plan-p2.md §8 的 15a 相关项——8 卡全勾 + tsc 干净 + 337 不变 + 829 链接 0 失效 + license exit 0 + #22 立案在案 + 两零扩展复核 + 报告/提示词/基线更新）。
- **下一批**：**批次 15b 判官与权限 P2（3 条：C40 C55 C42）**——卡序已展（plan-p2.md §4，4 张 T-P2-201~204），下一会话直接执行，做完收官即停。
- **下一批提示词**：见本文件头部「批次 15b 提示词（当前活跃）」。

---

## 批次 15a 提示词（已执行归档）

```
继续 aegent 批次 15a 的实施（P2 段首批：会话数据与生命周期；7 条需求 ID：Q2 Q4 Q6
Q8 M4 E6 E9）。推进模式不变：一会话一批次——本会话只做批次 15a，做完收官即停，
批次 15b 由下一会话接力。批次 15a 卡序已展（docs/plan-p2.md §3，8 张
T-P2-101~108），读 §1 全局约束后从第一张 [ ] 任务卡开始执行（执行协议沿用
docs/plan-p0.md §0）。本批特有的注意：
1. 展卡锚点核对以 20260926_P2研究_批次圈定建议.md（48/48 零勘误）为底，plan-p2.md
   各批卡序头已落展卡核对结论——执行中若发现锚点与实际不符仍走 §0 待澄清。
2. 词汇表预判：#22 候选（E6 树谱系 / Q8 归档事件 / M4 回收事实）——本批执行时
   逐条定形立案，零扩展也要复核 EVENT_TYPES 26 基线。
3. 全量基线 1293 passed / 1 skipped；词汇表 26 事件；工程纪律工具链四件收官必跑。
   收官出组报告（写入本文件），更新本文件的批次 15b 提示词与全量基线后停止——
   不要开始 15b。不要问要不要继续。
```

---

## 待澄清（执行会话新发现；编号接续 #22 起）

| # | 需求ID | 我看到的（含路径:行） | 与需求文档的矛盾 | 建议 | 裁决与落实 |
| --- | --- | --- | --- | --- | --- |
| #22 | Q8 | 归档动作需要"何时因何归档"的流内落点，但词汇表 26 事件无承载（plan-p2.md §3 展卡预判的 #22 候选；codex·rollout/src/lib.rs:87 `ARCHIVED_SESSIONS_SUBDIR` 锚） | 无矛盾——需求未明示事件形状，属"状态变更必须有事件承载"（不变量 1）的补齐 | 新增 `session/archive {reason?}` log-only 会话级元事件（归档前落流尾，随数据进归档档；幂等——流尾已有不重复追加）；词汇表 26→27；回退面齐备（约 1.5 小时） | 2026-09-28 立案（T-P2-102 落地）；events.ts / project.ts / invariants.ts / archive.ts 已接线，events.test 计数 27；l0-events.md §8 落地记录 22 在案；**#22 追认于 2026-09-28（用户："认可22"），此案关闭，§3.2 正式计数 27 事件定案** |
| #23 | I10 | 取代事实需要流内持久落点，但词汇表 27 事件无承载（plan-p2.md §5 展卡预判的 #23 候选；zcode·session.events.ts `WorkspaceHookReviewSuperseded{interactionId, supersededByInteractionId}` 锚——取代事件落流） | 无矛盾——需求明示"取代本身是持久事实"（不变量 1 的直接要求） | 新增 `approval/superseded {requestId, byRequestId, reason?}` log-only 元事件（单链约束：一个 requestId 至多被取代一次；投影消费 = 取代链索引 + effectiveApproval/supersessionChain 查询；投影期重复/成环 fail-closed 拒绝）；词汇表 27→28；回退面齐备（约 1.5 小时） | 2026-09-28 立案（T-P2-306 落地）；events.ts / project.ts（校验+消费+查询）/ invariants.ts 已接线，events.test/replay.test/idle-reaper.test 计数 28；l0-events.md §8 落地记录 23 在案；**#23 追认于 2026-09-28（用户："全部认可"），此案关闭，§3.2 正式计数 28 事件定案** |

## 人工确认清单（批次 15 起）

| 需求ID / 批次 | 为什么不能机验 | 人工要怎么确认 | 状态 |
| --- | --- | --- | --- |
| —（批次 15a） | 本批无新增项——全部验收机可验（本地库/内存面，无真实端点/平台联调；维护 CLI 已本机端到端实测） | — | 无需人工确认 |
| C42（批次 15b） | 判官 prompt 的语义质量机验只钉结构（Stage1 闭集 / Stage2 标签格式 / 三值路由——judge.test 钉死）；真实模型下"safe/risky 分界是否合理、Stage2 理由是否可信"需联调评估 | 配置 J3 judge 段（AssemblyOptions.judgeModel）接真实判官模型，跑若干真实 ask 场景：核对 judge-audit 日志里 reviewed 的 outcome/reason 是否与人的判断一致（假阳性修正率），unavailable/aborted 比例是否可接受 | 待人工确认（判官模型接入时） |
| D12（批次 15c） | 测试全走命令注入 mock（无真实 sshd 环境）；probe 对不可达/认证失败/网络超时的真实行为、远端命令真实退出码/编码面、Windows OpenSSH client 实测均未联调 | 在有可用 sshd 的环境实测：SshExecutionEnv.probe() 对不可达主机（255→SshConnectionError）、认证失败（BatchMode 禁交互快速失败）、远端命令执行的编码与退出码 | 待人工确认（有 sshd 环境时） |
| H6（批次 15c） | ACP 后端经内存桥测试（真实协议往返）；transport 缺省 spawn 实现（真进程）与真实 ACP agent 的协议面（initialize 版本协商、session/update 通知方言、长请求超时行为）未联调 | 起一个真实 ACP agent 进程，跑 createAcpBackend 的 spawn 全链：核对 initialize/session/new/session/prompt 往返与 stopReason 映射 | 待人工确认（有 ACP agent 可联调时） |
