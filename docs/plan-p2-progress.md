# P2 执行进度 · 批次 15 起

> 本文件接续 [`plan-p1-progress.md`](plan-p1-progress.md)（P0 全程 + P1 批次 1-14，2026-09-28 P1 全部收官定格，全量基线 **1293 passed / 1 skipped**，词汇表 26 事件）——**自批次 15（P2 段）起的执行进度**（批次报告 / 待澄清 / 人工确认清单）记入本文件。
> 执行协议沿用 [`plan-p0.md`](plan-p0.md) §0；计划本体在 [`plan-p2.md`](plan-p2.md)（48 条 / 五批 / 52 卡，2026-09-28 一次展卡——P0 式全阶段计划）。
> **待澄清编号接续（#22 起）**——词汇表立案管线不变（`l0-events.md` §8 落地记录全局连续，批次 15e 收官后为 **29 事件**〔#22/#23/#24/#27 已追认转正——2026-09-28 用户："有待澄清就认可"；#25 闭集记录案在案；#26 零扩展定形关闭；F27 闭集落地记录 25 同批追认〕；**P2 段收官全量基线 1672 passed / 7 skipped**〔新增 live-p2 真实联调 6 用例 env gate 默认 skip〕）。
> **批次进度**：15a ✅ → 15b ✅ → 15c ✅ → 15d ✅ → **15e ✅（2026-09-28 收官，本文件报告）——P2 段全部收官**，下一层接 [`plan-p3.md`](plan-p3.md) 批次 16。

---

> **P3 已立项**（2026-09-28 用户裁决）：U 域 8 条产品化层见 [`plan-p3.md`](plan-p3.md)——本文件提示词链执行到 15e 收官后，接 `plan-p3-progress.md` 的批次 16 提示词。

## 批次 15e 提示词（已执行归档）

```
继续 aegent 批次 15e 的实施（P2 段收官批：观测与工程纪律 P2；17 条需求 ID：
T3 T4 T7 T8 O27 O28 O29 O30 A16 F19 F27 F16 L9 L5 L6 J21 J17）。推进模式不变：
一会话一批次——本会话只做批次 15e，做完 P2 段收官（出组报告 + 词汇表/基线
定格）即停，批次 16（P3 产品化）由 plan-p3.md 接力。批次 15e 卡序已展
（docs/plan-p2.md §7，18 张 T-P2-501~518），读 §1 全局约束后从第一张 [ ]
任务卡开始执行（执行协议沿用 docs/plan-p0.md §0）。本批特有的注意：
1. 展卡锚点核对以 20260926_P2研究_批次圈定建议.md（48/48 零勘误）为底——
   执行中若发现锚点与实际不符仍走 §0 待澄清。
2. 词汇表预判（#26/#27 候选）：F19 两级压缩 microcompact 边界事件（strategy
   值域扩展或新事件）；F27 策略具名 Memento/PrefixCompaction（strategy 值域
   收闭集扩展）；L9 分段计时载荷扩展；T4/T8/O 族/A16/J21 预判零扩展——执行
   时逐条定形并复核 EVENT_TYPES 29 基线（#24 feedback/note 本批已立案待
   追认）。J21 成本核算先核对批次 10 L3 是否已落 total_cost_usd 分列（已落
   则核对后记档，未落则本卡补）。
3. 全量基线 1625 passed / 1 skipped；词汇表 29 事件（#24 待追认、#23/#22
   已追认定案）；工程纪律工具链四件收官必跑（T4 豁免理由检查器若重复实现
   核对后可关闭记档）。收官出组报告（写入本文件），更新本文件与
   plan-p3-progress.md 的批次 16 提示词衔接 + 全量基线定格后停止——
   不要开始批次 16。不要问要不要继续。
```

---

## 批次 15e · 观测与工程纪律 P2（17 条：T3 T4 T7 T8 O27 O28 O29 O30 A16 F19 F27 F16 L9 L5 L6 J21 J17）

**状态**：✅ 收官（2026-09-28）——18 张卡全关（T-P2-501 ~ 518）。台账：T-P2-501 T3 阅读包 ✅（policy 驱动阅读包四件 + CLI，4 passed）。T-P2-502 T4 豁免理由 ✅（核对关闭零缺口）。T-P2-503 T7 性能断言 ✅（增长曲线三件，3 passed）。T-P2-504 T8 known-diffs ✅（18 蓝本域）。T-P2-505 O27 截断标签化 ✅（64 passed）。T-P2-506 O28 测试政策 ✅（test-policy 成文 + keyless 复核，65 passed）。T-P2-507 O29 事件泵 ✅（84 passed 含 agent-process 哨兵接入）。T-P2-508 O30 因果断言 ✅（3 因果链全绿）。T-P2-509 A16 排空复位 ✅（guard 订阅 user/message 复位 + 三类计数盘点，61 passed）。T-P2-510 F19 两级压缩 ✅（#26 零事件定形 + 次序语义，142 passed）。T-P2-511 F27 prefix_window ✅（闭集三值落地记录 25 + 策略入指纹，132 passed）。T-P2-512 F16 缓存健康 ✅（归因三型，4 passed）。T-P2-513 L9 分段计时 ✅（#27 载荷扩展落地记录 26，55 passed）。T-P2-514 L5 HTTP 录制 ✅（掩码 + 回放生成，4 passed）。T-P2-515 L6 审计报表 ✅（三维度，9 passed 含 audit-fields 回归）。T-P2-516 J21 成本核算 ✅（核对 L3 未落成本列——本卡补；3 passed）。T-P2-517 J17 OAuth ✅（RFC 8628 + 域内闭环，12 passed）。T-P2-518 收口 ✅（七面盘点 + P2 段对账 48 条 + 工具链五件）。

### 批次 15e 报告（收官于 2026-09-28）

- **打勾情况**：18/18 卡全关（每勾附「命令 + 结果摘要」，见 plan-p2.md §7 各卡完成记录）。
- **展卡结论**：17 条锚点零勘误（执行期逐条复核；codex·compact.rs:470/483 两处行号锚研究期验证后执行期再核命中）。关键定形十一处——①T3 阅读包的邻接"无收敛入口给顶层文件"定形；②T4 四面核对关闭（检查器强制/负例/空集/无内联豁免）；③T7 比值上界 4 = 线性理论 2 的 2× 余量 + min-of-3 降噪；④O27 tag 接线在 system 字段值域（JSON 转义整行无法段匹配）；⑤O29 未知事件拒绝比 codex 静默通配更严（C14 闭面保证）；⑥O30 第③件 e2e 指认机内化（源码文本断言防悬空）；⑦A16 排空点 = user/message 落流（queue 注入与常规输入同形状）；⑧F19/#26 零事件判据 = 事实能否从流重算（micro 确定性投影 vs full 不可重算落流）；⑨F27 策略入指纹（retainedFromEnd 是结果、strategy 是原因——双入防失明）；⑩L9 segments 嵌套 timing 内（向后兼容非平级）；⑪J17 凭据 env 优先 + private 文件 0600 + 掩码固化。
- **产出的文件**：`tools/architecture-read.mjs`；`docs/known-diffs.md`（18 域）、`docs/test-policy.md`；`src/test-support/` 四件（event-pump/http-recorder + normalize O27 扩 + snapshots 接线）；`src/diagnostics/` 三件（architecture-read.test/causal.test + 既有）；`src/session/complexity.test.ts`；`src/mcp/guard.ts` A16 复位扩展；`src/context/` 四件（two-level.test/strategy.test + compaction.ts 策略面 + result-trim.ts 文档化）；`src/kernel/` 扩（events.ts timing.segments + loop.ts 分段打点 + assembly.ts compactionStrategy）；`src/models/` 三件（cache-health.ts/oauth.ts + 各测试）；`src/obs/` 三件（audit-report.ts/cost.ts + audit-fields.ts outcome 扩）；`docs/l0-events.md`（落地记录 25/26 + strategy 闭集）；`docs/20260928_P2功能全景与借鉴映射.md`（段收官文档）。
- **验收台账**：全量 `npx vitest run` **1672 passed / 1 skipped**（191 文件；批次入口基线 1625 → 净增 47）；`npx tsc --noEmit` 全程干净；`count-features.sh` = **337（层数 20；P2=48）不变**；`check-doc-links.sh`（显式传参 15 文件）**1237 链接 0 失效**；`architecture:check` 全程 0 error / 21 warning（基线保持）；`vocabulary:check` 0 问题；license-audit **输入面核实**：oss/refs 零未提交变化（本批零新仓，15d 收官 exit 0 结果有效）+ P2 新引用仓 pi-mono 抽查通过（LICENSE 在位 / 泄露面零命中）——全量重跑在 Windows 大仓 grep 上超时（后台 20 分钟未完成），记档为基建面。
- **词汇表扩展**：**29 基线不变 + 两案记录**——①#26（F19 microcompact）**零扩展定形**：判据 = 事实能否从流重算（micro = F8 result-trim 确定性投影可重算零事件；full 摘要不可重算已落流）；②#27（L9）`step/end.timing.segments{modelMs,toolsMs}` 载荷扩展（#9 前向兼容同款，落地记录 26 **已追认**）；③F27 `compaction.strategy` 闭集三值追加（`prefix_window`，落地记录 25 **已追认**——#18 同款值域扩展事件计数不变）；④其余 14 条零扩展定形（T3/T4/T7/T8/O27/O28/O29/O30/A16/F16/L5/L6/J21/J17 逐条复核 EVENT_TYPES 29）。
- **盘点结论**：七面零真冲突（T-P2-518 完成记录详载）：①F19/F27 × E17/F26/F11——策略闭集 {full_summary, recent_window_fallback, prefix_window} 与指纹交互（strategy 入指纹 + retainedFromEnd 显式配置优先于策略缺省）；②O29 × C14——未知事件 throw 的正当性由词汇表闭面保证；③J17/J21 × J2/J13——OAuth AuthResolver 挂 J13 既有接口（authMaterial 形状零变化）、成本消费 L3 usage 分列不建第二份轨迹；④S 族 × M1/M2（15d 盘点复核）；⑤known-diffs 18 域抽查一致（5 域逐字核对）；⑥#22~#27 全链闭合（#22/#23/#24/#27 追认转正〔2026-09-28 收官后用户统一认可〕、#25 记录案、#26 零扩展、F27 落地记录 25 同批追认）；⑦全段抽样端到端链复核（p15d 快照三环 cron→派发→核销→通知在位）。
- **新发现的约束或坑**：(a) **联合类型 Omit 不分发**（event-pump 测试 mk 直用 DistributiveOmit 产物 NewSessionEvent——15a SessionRef 先例的再现）；(b) **flush 未 await 落库竞态**（cost 测试——write-behind 面的测试纪律）；(c) **events 表 config 在 payload JSON 内**（SQL 用 json_extract(payload,'$.config.modelId') 非 h.config 列）；(d) **min-of-3 的预热残余**（complexity 比值 0.49 <1——比值断言只设上界，低值非异常）；(e) **agent-process.test 的 beforeAll npm run build 失败以套件级失败呈现**（根因排查先看 tsc）；(f) **license-audit 全量在 Windows 大仓 grep 超时**（后台 20 分钟——输入面核实 + 抽查替代，基建面记档）。
- **偏离计划的地方**：逐卡「完成记录」已记档——要点：T4 核对关闭（零代码产出，J25/L10 先例）；J21 核对后落实现（L3 未建成本列——usage.ts 头注释的"留给届时同批"兑现）；O29 "两个示范 fixture"实际 1 处即达示范语义；T-P2-510 发现 microcompact 层已存在（F8 result-trim——展卡时未盘点到的既有面，直接定形零扩展）。
- **遗留风险与未知**（→ 人工确认清单）：**新增 2 项**——J17 真实厂商 OAuth IdP 联调（device flow 全链）；F16 tracker 的 loop 装配接线 + 真实推理模型归因验证。技术债记档：成本真实价格表配置（PricingTable 构造注入——用户供给）；guard/审计/成本等库面的 CLI/工具暴露随需要。
- **批次完成定义核对**：全部 ✅（plan-p2.md §8 的 15e 相关项——17 卡全勾 + tsc 干净 + 337 不变 + 1237 链接 0 失效 + license 输入面核实 + #24/#27 追认转正 + #26 零扩展定形 + 报告/对账/基线更新 + **段收官全景文档落地**）。
- **P2 段收官**：48 条逐条状态表见下节；段收官文档 [`20260928_P2功能全景与借鉴映射.md`](20260928_P2功能全景与借鉴映射.md)；下一层接 `plan-p3.md` 批次 16。

---

## P2 段对账（48 条逐条状态表，2026-09-28 终验收）

| 批次 | 需求 ID | 状态 | 一句要点 |
| --- | --- | --- | --- |
| 15a | Q6 | 落地 | RETENTION_POLICY 常量 + cutoff 纯函数 |
| 15a | Q8 | 落地 | 归档独立一档（#22 session/archive，已追认） |
| 15a | Q4 | 落地 | 清理器三类 + dry-run + maintenance CLI（v4 两表） |
| 15a | M4 | 落地 | IdleReaper 四守卫 + onReap 回调（零事件定形） |
| 15a | Q2 | 落地 | SQL 条件检索 + session_query/session_get 两工具 |
| 15a | E6 | 落地 | ForkTree 从 fork 事件重建（findLast 血统语义） |
| 15a | E9 | 落地 | sessionRefs 载荷扩展 + 有界快照注入 + 环拒绝 |
| 15b | C40 | 落地 | 声明式 paramMatchers + 全分型 AND + linter |
| 15b | C55 | 落地 | DenialShape + 渲染面 + missing-alternatives 检出 |
| 15b | C42 | 落地 | 两阶段 LLM 判官（fail-closed/unavailable/abort 语义） |
| 15c | M7 | 落地 | Deadline 原语（combine/withDeadline）+ timeout 薄壳化 |
| 15c | I5 | 落地 | 插件 SDK 受限能力 token + 结构化克隆投递 |
| 15c | I4 | 落地 | ws 插件宿主（缺省全拒 + 断线注销 + 坏信封不崩） |
| 15c | I7 | 落地 | CC/Codex hook 双方言桥（不兼容显式拒绝） |
| 15c | I8 | 落地 | 人格预设（agent-child --persona，首落 system 叠加） |
| 15c | I10 | 落地 | approval/superseded（#23，已追认）+ 取代链投影 |
| 15c | I11 | 落地 | GuardPlugin 治理可插拔（建议非强制） |
| 15c | I14 | 落地 | 跳层三重闸（显式命名/审批硬保护/白名单） |
| 15c | H6 | 落地 | SubagentBackend 接口 + 进程内/ACP 两实现（CC/Codex/DSH-SDK 留位记档） |
| 15c | D12 | 落地 | SshExecutionEnv 命令行包装（probe/凭据零落盘） |
| 15d | S1 | 落地 | cron 解析器 + v5 CronStore + 被动轮询派发 |
| 15d | M11 | 落地 | OffPeakQueue 四步状态机（核销零事件定形） |
| 15d | S2 | 落地 | webhook 处理器面（token/HMAC + 202 + 413 防呆） |
| 15d | S5 | 落地 | feedback/note（#24 已追认）+ wire/CLI 全链 |
| 15d | N5 | 落地 | NotificationHub 五类分型 + push/poll 双投递 |
| 15d | P4 | 落地 | transcribeAudio mock 面 + 白名单 4→7（真实端点待联调） |
| 15d | S3 | 落地 | CDP 三工具 + 域白名单 + 每导航强制审批 |
| 15d | S4 | 落地 | 最强审批三层 + L2 审计（Win32 实现待补——人工确认） |
| 15d | K9 | 落地 | Tauri 双窗口 + pip 只读资产（视觉面待人工） |
| 15d | K6 | 落地 | 飞书端同构 ImSurface（#25 replySource 闭集） |
| 15d | K7 | 落地 | Slack 端同构 ImSurface + 抢约派发 |
| 15e | T3 | 落地 | architecture:read 阅读包四件 + --json |
| 15e | T4 | **核对关闭** | 检查器 reason 强制/负例/空集/无内联豁免四面核对零缺口 |
| 15e | T7 | 落地 | 复杂度增长曲线断言三件（比值上界 4） |
| 15e | T8 | 落地 | known-diffs.md 18 蓝本域 + 随卡追加纪律 |
| 15e | O27 | 落地 | 160 截断 + persona 指引标签化 + snapshotToString 接线 |
| 15e | O28 | 落地 | test-policy 成文（keyless 两条 + 升降级 + 十场景） |
| 15e | O29 | 落地 | 测试事件泵三约定 + agent-process 哨兵接入 |
| 15e | O30 | 落地 | 三因果链（BUILTIN 注册/换模注册/host e2e 指认） |
| 15e | A16 | 落地 | repeat-tool-reminder 排空复位 + 三类计数盘点（F28/J19 不复位是设计） |
| 15e | F19 | **零扩展定形** | micro = F8 投影可重算零事件（#26）；full 落流已有；次序语义钉死 |
| 15e | F27 | 落地 | prefix_window 策略（闭集三值落地记录 25 + 策略入指纹） |
| 15e | F16 | 落地 | CacheHealthTracker 归因三型（接线随推理模型联调记档） |
| 15e | L9 | 落地 | timing.segments 载荷扩展（#27，落地记录 26 已追认） |
| 15e | L5 | 落地 | HttpRecorder 掩码录制 + JSONL + 回放脚本生成 |
| 15e | L6 | 落地 | auditReport 三维度 + settled.outcome 派生 |
| 15e | J21 | 落地 | 价格表驱动 + J25 四类加权 + 两级聚合（L3 核对：token 分列已落、成本列本卡补） |
| 15e | J17 | 落地 | RFC 8628 device flow + 刷新 + env/private 存储 + 域内闭环（真实 IdP 待联调） |

> 状态口径：**落地** = 实体面交付且机验通过；**核对关闭** = 需求语义已被既有实现覆盖、核对零缺口（T4）；**零扩展定形** = 预判事件候选定形为零词汇表扩展（F19/#26——判据见卡面完成记录）。48 条中：落地 46、核对关闭 1、零扩展定形 1（J21 核对后落实现计入落地）。

---

## 批次 15d 提示词（已执行归档）

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

**状态**：✅ 收官（2026-09-28）——11 张卡全关（T-P2-401 ~ 411）。台账：T-P2-401 S1 定时任务 ✅（cron 最小解析器 + v5 CronStore + 被动轮询派发，39 passed）。T-P2-402 M11 闲时任务 ✅（OffPeakQueue 四步取号/窗口/核销/幂等，12 passed；#24 候选定形零事件）。T-P2-403 S2 webhook ✅（处理器面 + token/HMAC 鉴权 + 202 fire-and-forget + 上限防呆，8 passed）。T-P2-404 S5 反馈上报 ✅（#24 立案 feedback/note 词汇表 28→29 + 提交面/wire 面/CLI 面全链，6 passed）。T-P2-405 N5 推送 ✅（NotificationHub 四类分型 + poll 游标补投 + bridge 三类归类，12 passed）。T-P2-406 P4 语音转文字 ✅（白名单 4→7 + transcribeAudio mock 面 + 投影转写文本，39 passed）。T-P2-407 S3 浏览器使用 ✅（CDP 直连三工具 + 域白名单 + 每导航强制审批 + NOTICE 描述，13 passed）。T-P2-408 S4 计算机使用 ✅（最强审批三层 + 四操作 + L2 审计全落 + helper 存根，13 passed）。T-P2-409 K9 画中画 ✅（Tauri 双窗口 + pip 只读渲染资产 + N5 五类分型，19 passed）。T-P2-410 K6+K7 飞书/Slack 端 ✅（#25 立案 APPROVAL_SURFACES 追加 + 同构 ImSurface 两实现 + 抢约派发语义，14 passed）。T-P2-411 收口 ✅（七面盘点 + p15d 快照三环一条链 + 工具链四件）。

---

### 批次 15d 报告（收官于 2026-09-28）

- **打勾情况**：11/11 卡全关（T-P2-401 S1 定时任务 / T-P2-402 M11 闲时任务 / T-P2-403 S2 webhook / T-P2-404 S5 反馈上报 / T-P2-405 N5 推送 / T-P2-406 P4 语音转文字 / T-P2-407 S3 浏览器使用 / T-P2-408 S4 计算机使用 / T-P2-409 K9 画中画 / T-P2-410 K6+K7 飞书与 Slack 端 / T-P2-411 收口七面盘点 + 快照），每勾附「命令 + 结果摘要」。
- **展卡结论**：11 条锚点零勘误（执行期逐条复核：codex·ScheduledTaskWeekday/kimi·cron-store/zcode·offPeakDispatchSettlement/dsh·webhook/codex·feedback_processor/qwen·browser-use 含 NOTICE/codex·computer_use_config/zcode·cuaPipSession〔🔴 只学行为〕/pideck·FeishuBridge/opencode·slack 全部命中）。关键定形九处——①cron 解析器自写最小面（`*`/列表/步进三形态、区间 YAGNI、dom/dow 双受限 vixie OR）；②M11 四步状态机（取号→窗口→核销→幂等）+ transient 重试上限（zcode"确定性失败不无限重试"纪律）；③webhook 处理器面不自建监听（host server 路径分型挂载）；④反馈是会话事实落流 vs M11 进程内事实走回调（#24 两候选的分野判据 = "事实是否持久"）；⑤N5 分型是 wire 载荷非事件 + push/poll 双投递语义；⑥STT 转写文本端侧上送（agent 子进程零 STT 依赖）；⑦浏览器/计算机双操作类工具的审批纵深（链上 gate 是外层 + 工具面 approve 回调缺省恒拒）；⑧S4 最强审批三层（unattended 恒拒先于审批）；⑨IM 抢约派发（IM 发消息 = 声明控制端，N7 单 holder 兼容）。
- **产出的文件**：`src/scheduler/` 新域八件（cron.ts/offpeak.ts/webhook.ts/computer.ts/browser.ts + 三测试 + p15d.snapshot.test.ts）——architecture-policy 入册 managed:true（requires=[kernel]）；`src/session/migrate.ts` v4→v5（SCHEMA_V5_CRON_DDL 运维账本第三张）+ db.ts 版本 bump；`src/attachments/` 四新扩（limits.ts IMAGE/AUDIO 分型白名单 4→7、stt.ts、types.ts transcription 字段、store.ts 双实现透传）；`src/host/` 五件（notify.ts NotificationHub、im-surface.ts 同构接口、im-feishu.ts、im-slack.ts、bridge.ts N5 三类归类集成）；`src/obs/feedback.ts`；`src/kernel/` 扩（events.ts 词汇表 29 + FeedbackNoteEvent、agent-protocol.ts feedback wire 请求、agent-process.ts feedback/审计落流分支、invariants.ts 豁免）；`src/session/project.ts`（feedback/note 校验+投影分支）；`src/session/messages.ts`（音频转写文本投影占位行）；`src/policy/audit-fields.ts`（#25 APPROVAL_SURFACES 追加）；`src/cli/repl.ts`（/feedback 命令）；ui/ 三新件（pip.html/pip.js/pip.css）；`src-tauri/`（tauri.conf.json 双窗口 + capabilities 双窗口）；`src/kernel/tools/descriptions/` 七新件（browser_* 三 + computer_* 四——NOTICE 风险标注）；win32-helper Rust `computer` 动作存根。
- **验收台账**：全量 `npx vitest run` **1625 passed / 1 skipped**（180 文件；批次入口基线 1493 → 净增 132）；`npx tsc --noEmit` 全程干净；`count-features.sh` = **337（层数 20；P2=48）不变**；`check-doc-links.sh`（显式传参 12 文件）**1002 链接 0 失效**；`license-audit.sh` exit 0（LEAK 未命中 / CLEAN-ROOM 无明确声明 / SOURCEMAP 无）；`architecture:check` 全程 0 error / 21 warning（基线保持）；`vocabulary:check` 0 问题；`cargo check` exit 0。
- **词汇表扩展**：**28→29 一案 + #25 立案（非事件）+ 两处零扩展定形**——①`feedback/note {kind, targetSeq?, commandId?, comment?, doctorSummary?}`（S5/T-P2-404——log-only 会话级元事件；**#24 待追认**；l0-events.md §8 落地记录 24 在案）；②#25 = APPROVAL_SURFACES 闭集追加 feishu/slack（K6/K7——**闭集扩展非事件**，词汇表单向门不触发）；③M11 闲时核销零扩展定形（进程内 job 生命周期事实走 onSettled 回调——jobs.ts/M4 onReap 同款纪律）；④N5 分型四→五类（+computer_operation，wire 载荷非事件）。EVENT_TYPES 29 基线复核在位。
- **盘点结论**：七面零真冲突（T-P2-411 完成记录详载）：①S1/M11/S2 × M1/M2 同一 JobRegistry 三消费方语义一致；②S4 最强审批三层 × unattended 恒拒（拒绝与执行同权落审计）；③K9 × S4 消费端同源（pip 只读渲染 + notify 桥接）；④K6/K7 × #25 replySource 链路零改线；⑤N5 五类 × push/poll 双语义（既有广播零变化）；⑥P4 × 白名单纪律（存储面/请求面分型）；⑦快照即规格 = p15d.snapshot.test.ts 三环一条链。
- **新发现的约束或坑**：(a) **JSDoc 注释含 `*/` 字面量提前闭合块注释**（cron.ts TS1443——注释改写不含 `*/` 序列）；(b) **parseField restricted 判定**：全星号位图全 true ≠ restricted（写明具体值才算——vixie OR 的判据面，纯星号不算、`*/step` 算）；(c) **webhook 413 防呆**：超限 `req.destroy()` 会把响应一起断（客户端只见 socket error）——改"丢弃内容继续收完再 413"；(d) **CdpConnection 内部自建 ws 与测试 fake 分家**（emit 落孤儿实例超时——构造注入 WebSocketImpl + instances 取连接真正持有的实例）；(e) **asyncIterator 方法简写内 this 指向迭代器对象**（快照泵静默死亡三查——`const self = this` 捕获实例，notify.test 同款坑二次确认）；(f) **Windows 并行偶发一例**（首跑 1 失败复跑全绿——15b/15c 先例）。
- **偏离计划的地方**：逐卡「完成记录」已记档——要点：T-P2-404 #24 编号归 S5（预判里 M11/S5 两候选共用编号，M11 定形零扩展）；T-P2-406 转写接线定形为端侧上送（卡面未明说接线点）；T-P2-407 工具描述走 B2 描述文件（卡面"工具描述与审批面"的承载方式）；T-P2-408 Rust 面按卡面落存根（NOT_IMPLEMENTED 结构化 fail-closed——真实 Win32 实现随人工确认）；T-P2-409 N5 分型扩五类（卡面预判"computer_operation 分型"兑现为闭集扩展）。
- **遗留风险与未知**（→ 人工确认清单）：**新增 5 项**——P4 真实 STT 端点联调（随用户供给端点）；S3 真实浏览器 CDP 联调；S4 真实屏幕操作（Win32 实现补齐 + Windows 会话环境）；K6/K7 平台真实联调（飞书/Slack 凭据与 webhook 配置）；K9 画中画视觉面。15c 遗留 2 项（真实 sshd / 真实 ACP agent）维持待确认（本批无新增环境）。技术债记档：S1/M11/S2 的装配接线（host server 面消费 tick/drain/endpoint——本批交付域面，进程装配随托管层）；S4 computer 审计的 recordAudit 落库接线（结构已对齐 audit_log 表）；IM 端 webhook 路径挂载到 host server（/im/feishu、/im/slack 路径分型随装配）；判官/跳层/白名单等 15b/15c 记档的技术债不变。
- **批次完成定义核对**：全部 ✅（plan-p2.md §8 的 15d 相关项——11 卡全勾 + tsc 干净 + 337 不变 + 1002 链接 0 失效 + license exit 0 + #24 立案在案〔待追认〕+ #25 立案在案 + M11/N5 零扩展复核 EVENT_TYPES 29 + 报告/提示词/基线更新）。
- **下一批**：**批次 15e 观测与工程纪律 P2（17 条：T3 T4 T7 T8 O27 O28 O29 O30 A16 F19 F27 F16 L9 L5 L6 J21 J17）**——卡序已展（plan-p2.md §7，18 张 T-P2-501~518），下一会话直接执行，做完收官即停；15e 收官后 P2 段完成，接 plan-p3.md 批次 16。
- **下一批提示词**：见本文件头部「批次 15e 提示词（当前活跃）」。

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
| #24 | S5 | 反馈事实需要流内持久落点，但词汇表 28 事件无承载（plan-p2.md §6 展卡预判的 #24 候选——预判里 M11 job/offer 与 S5 feedback/note 两候选共用编号；执行定形：M11 闲时核销是进程内 job 生命周期事实走 onSettled 回调零扩展，S5 反馈是会话事实落流——分野判据 = "事实是否持久"；codex·feedback_processor 结构化面锚） | 无矛盾——需求明示"用户可对消息/命令反馈"（结构化反馈 + 不变量 1：状态变更必须有事件承载） | 新增 `feedback/note {kind: "up"\|"down", targetSeq?, commandId?, comment?, doctorSummary?}` log-only 会话级元事件（targetSeq/commandId 二选一，存在性校验在提交面；doctor 随附 = codex attachment 同构；遥测外发不取——本地落流）；词汇表 28→29；回退面齐备（约 1.5 小时） | 2026-09-28 立案（T-P2-404 落地）；events.ts / project.ts / invariants.ts / obs/feedback.ts / agent-protocol.ts（wire feedback 请求）/ agent-process.ts / cli/repl.ts 已接线，events.test/replay.test/idle-reaper.test 计数 29；l0-events.md §8 落地记录 24 在案；**追认于 2026-09-28（用户："有待澄清就认可"），此案关闭，§3.2 正式计数 29 事件定案** |
| #25 | K6/K7 | IM 端审批应答需要 replySource 身份承载，但 APPROVAL_SURFACES 闭集 ["cli","web","desktop"] 无 IM 端成员（plan-p2.md §6 展卡预判的 #25 候选；audit-fields.ts:23 闭集锚） | 无矛盾——需求明示场景③"审批经 IM 应答"；闭集扩展非事件（词汇表单向门不触发）——**本条是字段闭集扩展的记录性立案**（不占词汇表管线，走"只追加不替换"纪律：audit-fields.ts 文件头明示批次 14 多端先例） | APPROVAL_SURFACES 追加 "feishu"/"slack"（T-P2-410 落地）；IM 应答经 approve.source 走既有 replySource 审计面（C6 通道零改线）；audit-fields.test 断言同步 | 2026-09-28 立案并落地（T-P2-410）；闭集五值在位；无回退面风险（追加面，回退 = 删两成员） |
| #26 | F19 | microcompact 层边界事件预判候选（plan-p2.md §7 展卡预判；zcode·session.events.ts `microcompact_boundary` 事件锚——trigger/strategy/pre-post token/cleared/kept toolCallIds） | 无矛盾——定形结论：**零词汇表扩展**。判据 = 事实能否从流重算：我方 microcompact 层 = F8 result-trim（T-P1-104 既有面——keepLast/maxChars 确定性投影规则，幂等、可重算），zcode 落事件因其 microcompact 是引擎决策（cleared/kept 选择不可重算） | 不立案新事件：micro 层保持投影级零落流；两级边界语义文档化（result-trim.ts 头注释 + two-level.test 次序语义钉死——溢出判定按未裁尺寸） | 2026-09-28 定形（T-P2-510）；EVENT_TYPES 29 不变；回退面 = 无（零新增面）；**零扩展定形，此案关闭** |
| #27 | L9 | 循环内分段计时需要载荷承载，step/end.timing 仅有 firstTokenLatency/streamDuration 两字段（plan-p2.md §7 展卡预判；zcode·turn-loop.ts 分段打点锚） | 无矛盾——需求明示"各段耗时可见"；载荷扩展非新事件（#9 前向兼容同款，事件计数 29 不变） | `step/end.timing` 嵌套扩展可选 `segments?: {modelMs, toolsMs}`（modelMs 与 streamDurationMs 同源；toolsMs = 工具执行累计墙钟，0 = 无工具如实事实）；仅随 timing 携带（B19 既有规则）；回退面齐备（约 30 分钟） | 2026-09-28 立案（T-P2-513 落地）；events.ts / loop.ts / loop.test 已接线；**l0-events.md §8 落地记录 26 在案**；**追认于 2026-09-28（用户："有待澄清就认可"），此案关闭** |

## P2 真实端点联调（2026-09-28，用户供给双端点）

**执行载体**：`src/diagnostics/live-p2.test.ts`（env gate `AEGENT_LIVE=1` 默认 skip——不进常规套件；凭据经环境变量，掩码档 `private/live-endpoints.md`）。**结果：6/6 passed**（端点 1 `<redacted-endpoint>`〔cline-pass/deepseek-v4.1-flash，OpenAI 协议 + reasoning 流〕；端点 2 `<redacted-endpoint-2>` 两次连接超时不可达——记档，备用未用）。

| # | 用例 | 覆盖面 | 结果与关键事实 |
| --- | --- | --- | --- |
| 1 | 真实流式 turn（工具往返） | L0 前提 + L9 + J21 | ✅ bash 真实执行（echo 输出进 tool/result）、usage 真实落流、step/end `timing.segments.modelMs>0` 落流、`costRollup` 经 request/header 关联算出真实成本（modelId=cline-pass/deepseek-v4.1-flash） |
| 2 | C42 判官真实联调 | C42/C56 | ✅ git push 走 ask 分支 → **judge-audit 审计 reviewed + outcome∈{allow,deny,abstain}**（真实模型两阶段裁决）；approvalTimeoutMs=3s 确定性收口（C50 超时语义）——**人工确认项 C42 关闭** |
| 3 | F16 缓存健康归因 | F16 | ✅ 真实流 `delta.reasoning` 产出（reasoning-delta 映射命中）；连续 3 请求同前缀纯追加零漂移；命中率随网关 cached_tokens 透传面如实归因（无透传则 provider_no_cache）——**人工确认项 F16 归因面关闭**（loop 装配接线仍记档） |
| 4 | F19/F27 压缩 | F19/F27/F5 | ✅ 真实 LLM 摘要（非截断模板）+ `strategy="prefix_window"` 落流 + 小窗口溢出触发 + 压缩后新轮正常 |
| 5 | 会话数据面 | Q2/Q8/Q4/E6/E9 | ✅ 真实库条件检索、fork 树重建（前缀复制路径）、归档往返（主库 fail-closed + 归档档可读）、清理 dry-run |
| 6 | L6 审计报表 | L6/C5/C24 | ✅ 规则 ask → 挂起 → 编程 allow（审批链真实往返）→ approved 聚合 |

**执行期发现（记档）**：(a) 内置工具注册名小写 `bash`——规则 wildcardMatch 大小写敏感（15b 记档的实战复现，`Bash` 规则永不命中）；(b) 缺省 ask 兜底使无规则命中的执行类工具（含 echo）一律挂起——真实环境下裸跑 agent 必须显式配 allow 规则或配判官；(c) fork 产物须先 flush 才能归档（archiveSession 读主库行）；(d) store.load 是内存序不受归档影响（Q8 fail-closed 断言对象是 db.readAll）；(e) Windows 下 sqlite 句柄未关先删目录会 EBUSY（测试 afterEach 先 close）。

## 人工确认清单（批次 15 起）

| 需求ID / 批次 | 为什么不能机验 | 人工要怎么确认 | 状态 |
| --- | --- | --- | --- |
| —（批次 15a） | 本批无新增项——全部验收机可验（本地库/内存面，无真实端点/平台联调；维护 CLI 已本机端到端实测） | — | 无需人工确认 |
| C42（批次 15b） | 判官 prompt 的语义质量机验只钉结构；真实模型下 safe/risky 分界需联调评估 | 配置 J3 judge 段接真实判官模型跑真实 ask 场景，核对 judge-audit 的 reviewed outcome/reason | ✅ 2026-09-28 真实联调通过（live-p2 用例 2——judge-audit reviewed + 裁决三值，深度求索端点） |
| D12（批次 15c） | 测试全走命令注入 mock（无真实 sshd 环境）；probe 对不可达/认证失败/网络超时的真实行为、远端命令真实退出码/编码面、Windows OpenSSH client 实测均未联调 | 在有可用 sshd 的环境实测：SshExecutionEnv.probe() 对不可达主机（255→SshConnectionError）、认证失败（BatchMode 禁交互快速失败）、远端命令执行的编码与退出码 | 待人工确认（有 sshd 环境时） |
| H6（批次 15c） | ACP 后端经内存桥测试（真实协议往返）；transport 缺省 spawn 实现（真进程）与真实 ACP agent 的协议面（initialize 版本协商、session/update 通知方言、长请求超时行为）未联调 | 起一个真实 ACP agent 进程，跑 createAcpBackend 的 spawn 全链：核对 initialize/session/new/session/prompt 往返与 stopReason 映射 | 待人工确认（有 ACP agent 可联调时） |
| P4（批次 15d） | transcribeAudio 全走 mock fetch（OpenAI 协议 multipart 契约钉死）；真实 STT 端点（baseURL/模型名/鉴权）未实测——用户未供给端点 | 配置真实 STT 端点（SttConfig.baseUrl/apiKey/model），录一段真实音频跑 transcribeAudio 全链：核对 multipart 兼容性、language 参数效果与响应 text 字段形状 | 待人工确认（随用户供给 STT 端点） |
| S3（批次 15d） | CDP 往返全走 fake ws（协议形状钉死）；真实系统浏览器（Chrome/Edge --remote-debugging-port）未联调——页面导航/截图/文本抽取的真实渲染、跨域页面行为、CSP 干扰未验证 | 启动系统浏览器 --remote-debugging-port=9222，跑 cdpWsUrlOf + browserNavigate/Screenshot/Extract 全链：核对三工具真实往返与域白名单在真实页面的行为 | 待人工确认（有调试端口的浏览器环境时） |
| S4（批次 15d） | helper `computer` 动作为存根（请求校验 + 操作分发给全，四操作 NOT_IMPLEMENTED fail-closed）——SendInput/BitBlt 的 Win32 实现未写、Windows 会话隔离环境的屏幕捕获/注入真实可用性未验证 | 人工确认 Windows 会话环境后补齐 win32-helper 四操作的 Win32 实现（windows-sys 需加 GDI/Input features），跑真实 screenshot/click/type/key 验证 | 待人工确认（Windows 会话环境 + 实现补齐时） |
| K6/K7（批次 15d） | 飞书/Slack HTTP API 全走 mock fetch（token 缓存/握手/消息形状钉死）；真实平台联调未做——tenant_access_token 时效、事件订阅签名校验、rate limit、卡片消息格式未实测 | 配置真实飞书应用（appId/secret）与 Slack bot（xoxb token），完成事件订阅 URL 配置后跑端到端：核对消息收发、审批卡片应答与 replySource=feishu/slack 审计落地 | 待人工确认（有平台凭据与 webhook 配置时） |
| K9（批次 15d） | 画中画双窗口形状机验钉死（conf/资产/只读面），视觉面（窗口尺寸/置顶/截图渲染效果/交互）未人工确认 | 跑 tauri:dev 打开双窗口，主面触发 computer_* 操作：核对 PiP 窗口 always-on-top 显示、操作截图与动作标注的渲染效果 | 待人工确认（视觉面） |
| J17（批次 15e） | device flow 全链走 http-mock 端点（RFC 8628 语义钉死）；真实厂商 OAuth IdP（授权页/轮询节奏/refresh 时效/scope 面）未联调 | 配置真实 OAuth 端点（OAuthClientConfig.endpoints + clientId），跑 requestDeviceAuthorization → 浏览器授权 → pollDeviceToken → refreshAccessToken 全链：核对轮询语义与凭据落 private 掩码面 | 待人工确认（用户提供 IdP 端点时） |
| F16（批次 15e） | CacheHealthTracker 原语机验钉死；真实推理模型的归因面未验证 | 接真实 deepseek 跑多轮同前缀会话核对归因分型 | ✅ 2026-09-28 真实联调通过（live-p2 用例 3——reasoning 产出 + 零漂移 + 归因面；loop 装配接线仍记档为技术债） |
