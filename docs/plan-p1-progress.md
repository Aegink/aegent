# P1 执行进度 · 批次 11 起

> 本文件接续 [`plan-p0-progress.md`](plan-p0-progress.md)（P0 全程 + P1 批次 1-10，2026-09-27 收官，全量基线 1081 passed / 1 skipped，词汇表 23 事件）——**自批次 11 起的执行进度**（批次报告 / 待澄清 / 人工确认清单）记入本文件，旧文件定格不再追加。
> 执行协议沿用 [`plan-p0.md`](plan-p0.md) §0（取卡 / 做卡 / 验收 / 打勾 / 提交 / 自动继续 / 四种停下情况）；计划本体在 [`plan-p1.md`](plan-p1.md)（执行会话只改任务卡的勾选框、「偏离 / 建议」「完成记录」三个字段）。
> **待澄清编号接续旧文件（#16 起）**——避免跨文件引用歧义；词汇表立案管线不变（`l0-events.md` §8 落地记录全局连续，现为 19；**#16~#19 已全部追认转正**——#16 选型 Anthropic、#17/#18 词汇表形状、#19 surface/attach + surface/detach 23→25（2026-09-28 用户："认可#19"））。

---

## 批次 13 提示词（当前活跃）

```
继续 aegent P1 批次 13 的实施（多模态与工程纪律；8 条需求 ID：P1 P2 P3 +
T1 T2 T5 T6 + L4）。推进模式不变：一会话一批次——本会话只做批次 13，做
完收官即停，批次 14 由下一会话接力。批次 13 尚未展卡：先照批次 7~12 展
卡先例逐条锚点核对 requirements.md §4（把卡序追加进 docs/plan-p1.md，
展卡核对结论落卡序头），再从第一张 [ ] 任务卡开始执行（执行协议沿用
docs/plan-p0.md §0）。上一批（批次 12）报告在 docs/plan-p1-progress.md
（批次 12 报告 + 待澄清 #19 + 人工确认清单均在该文件）。本批特有的注意：
1. 批次 12 遗留：#19（surface/attach + surface/detach 23→25，两枚 log-only
   会话级元事件）待追认——若用户已表态追认则在 l0-events.md §8 落地记录
   19 落"已追认"转正，未追认不阻塞批次 13（回退面齐备，可选字段前向兼
   容口径）。批次 12 新产出多端地基（host/registry、host/protocol、acp/
   、sync/ 四新域）与 J5 Anthropic 适配已收官——批次 13 的 T1 架构即代
   码落地后可反哺后续批次展卡纪律。
2. 词汇表影响预判（圈定研究标注"低"）：P 族附件若需事件承载（user/message
   载荷扩展 vs 新事件）展卡时预判立案（编号接 #20 起）；L4 轨迹回放是纯
   读面零扩展预判；T5/T6 小件预计零扩展。每处扩展仍走 Q9 单向门立案。
3. 全量基线 1239 passed / 1 skipped；词汇表 25 事件（#19 待追认口径）。
   收官照批次 8~12 先例出组报告（写入本文件），更新本文件的批次 14 提
   示词与全量基线后停止——不要开始批次 14。不要问要不要继续。
```

---

## 批次 11 · 上下文与模型运维收尾（11 条：F7 F8 F11 F18 F25 F26 F29 F30 + J5 J13 J16）

**状态**：✅ 收官（2026-09-27）——10 张执行卡全关（T-P1-99 ~ 107 + 109）；T-P1-108（J5 第二厂商）未展占位（待澄清 #16 用户追认后展开）。提示词"12 条"系误计——圈定研究批次分配表为 11 条，P1 F/J 剩余全集对账 8 F + 3 J 无第 12 条。

**展卡注意**（承接批次 10 报告）——展卡核对结论已落卡序头（plan-p1.md 批次 11 卡序节）：
1. 疑似覆盖核对：F25 × M10 windowId（部分覆盖属实——编号化/三元组/恢复恒等增量落 T-P1-99）；F29 ← J6/J7+F24（在位——断言链落 T-P1-100，model_switch 标记 N/A 记档）；J16 ← J19 熔断（在位——探测/熔断分域落 T-P1-107）。
2. F18 显式终态 blocked 复用 `TurnEndReason` 既有槽位——词汇表影响确认**为零**；有界重试是真实缺口（withRetry D15 流边界的 loop 级补全）。
3. **J5 第二厂商选型开放：已立案待澄清 #16（建议 Anthropic，pi-mono 锚点最厚）供追认**；用户未回前 T-P1-108 保持未展、其余卡照常。

### 批次 11 报告（收官于 2026-09-27）

- **打勾情况**：10/10 执行卡全关（T-P1-99 F25 窗口编号化 / T-P1-100 F26+F29 指纹+换模压缩断言链 / T-P1-101 F11 三级兜底 / T-P1-102 F18 流中断恢复 / T-P1-103 F7 时间注入 / T-P1-104 F8 历史裁剪器 / T-P1-105 F30 两段式刷新 / T-P1-106 J13 鉴权刷新 / T-P1-107 J16 健康检查 / T-P1-109 收口八面盘点），每勾附「命令 + 结果摘要」；T-P1-108 未展占位。
- **展卡结论**：11 条锚点逐一核对零内容勘误；疑似覆盖裁决——F25 部分覆盖属实（M10 windowId 是派生串，增量 = 编号化/三元组/恢复恒等）；F29/J16"在位"属实（落断言链/分域面，不落新机制）；F18 三分核对（锚点结构性在位 / 有界重试真实缺口 / blocked 槽位零扩展）；F8 生产时半边在位（B5 boundedOutput），增量 = 投影级历史裁剪；F30 发现真实缺口（refresh 逐键应用的部分应用缺陷）；J13 不被 J5 未决阻塞（适配层无关面——圈定研究"J13 ← J5"依赖方向反了）。
- **产出的文件**：`src/context/window.ts` / `time-reminder.ts` / `result-trim.ts`、`src/kernel/stream-recovery.ts`、`src/models/auth.ts` / `health.ts` 六个新模块 + 七个新测试文件（window / time-reminder / result-trim / stream-recovery / auth / health / assembly.compaction）；扩 `compaction.ts`（指纹+触发+兜底检查点）/ `llm-summarizer.ts`（有界重试+预检+分块）/ `events.ts`（compHash / failureReason 载荷）/ `loop.ts`（恢复重试循环+裁剪消费）/ `session-config.ts`（两段式刷新）/ `openai-compat.ts`（authResolver）/ `assembly.ts`（窗口归一+指纹触发+时间注入+contextWindow 接线）/ `agent-process.ts`（streamRecovery 缺省 2 + resultTrim 透传）。
- **验收台账**：全量 `npx vitest run` **1144 passed / 1 skipped**（批次 10 收官 1081 → 净增 63，129 文件）；`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变；`check-doc-links.sh` 882 链接 0 失效（显式传参 4 文件）；`license-audit.sh` exit 0（LEAK 未命中/SOURCEMAP 无，与批次 10 同形态）。
- **词汇表扩展**：事件计数 **23 不变**——两案载荷/值域扩展立案待追认：#17 `compaction.compHash?: string`（T-P1-100）；#18 `strategy` 值域收闭集 + `compaction.failureReason?: string` 闭集（T-P1-101）；`reason:"comp_hash_changed"` 是 2026-09-25 预声明槽位兑现非新值；`l0-events.md` §8 落地记录 17/18 已同步，回退面齐备。
- **盘点结论**：八面零真冲突（T-P1-109 完成记录）：①F18×D15 两段重试分域（首 chunk 前后）；②F11 兜底×E17 三态（fallback completed 恰是切换权威认可的结算）；③F26 指纹重压喂 F28 抖动计数（口径一致）+ 单边界不双压；④F25/F22/M10/F7 四消费方同源 currentWindow；⑤三注入面措辞前缀分域（goal/预算在不同 hook）；⑥F8 裁剪不制造孤儿 + 溢出判定按未裁尺寸（保守方向）；⑦J13/J16/J19 三面正交（改熔断状态/发流量/变身份三权分立）；⑧F18 恢复全链 10 位事件序列快照。
- **新发现的约束或坑**：(a) `JSON.stringify` 的 replacer 数组作用于**所有层级**——嵌套对象键不在清单即整层丢弃（T-P1-100 指纹首版对 model 变化失明，测试当场抓出，改显式字面量键序）；(b) `llm-replay.test.ts` 回放等价用例 flaky 复现一次（93 文件并行资源竞态，隔离复跑全绿——与批次 6 T-P1-48 同形态，test-only 候选修复）；(c) E16 校验要求 injected 注入落在**开启中**的 turn（测试 fixture 时序教训——真实 loop 在轮内调用 hook）；(d) 源码扫描类断言须剥离注释（health.ts 头注释自述文本曾误触发——T-P1-87 已有同款先例）。
- **偏离计划的地方**：逐卡「完成记录」已记档——要点：T-P1-99 两处有意行为收紧（started/failed 不换窗、revert 回退窗口——E17/new-window 口径对齐）+ 装配测试落位新文件；T-P1-100 指纹触发位在溢出检查之后（单边界不双压）；T-P1-101 llm-summarizer 截断回退语义被 F11 链取代（三处既有测试有意更新——manual 触发钉死 E17 形状）；T-P1-104 落点 loop.buildMessages（buildChatMessages 是多消费方公共 helper，不加选项）；T-P1-107 探测路径 GET / + failed 改名 unreachable。
- **遗留风险与未知**（→ 人工确认清单）：T-P1-108 J5 未展（#16 选型待追认——建议 Anthropic）；#17/#18 待追认（回退面齐备，未追认不阻塞后续——载荷可选前向兼容）；llm-replay flaky（test-only）；F6 缓存命中率统计面留真实厂商终验（§6.2）。
- **批次完成定义核对**：全部 ✅（见 plan-p1.md 批次 11 完成定义——10 卡全勾 + tsc 干净 + 310 不变 + 882 链接 0 失效 + license exit 0 + 两案立案 + 红线断言在位 + 报告/提示词/基线更新）。
- **下一批**：**批次 12 多端架构·无 UI（10 条：K3 K4 K8 + N1 N2 N3 N7 N8 N9 N10）**——未展卡，下一会话先展卡（锚点核对 + 卡序落 plan-p1.md）再执行，做完收官即停。
- **下一批提示词**：见本文件头部「批次 12 提示词（当前活跃）」。

---

## 批次 12 · 多端架构·无 UI（10 条：K3 K4 K8 + N1 N2 N3 N7 N8 N9 N10 + T-P1-108 J5）

**状态**：✅ 收官（2026-09-27）——11 张卡全关（T-P1-110 ~ 118 + 108 + 120）；T-P1-108（J5 Anthropic，#16 追认后）本批展开执行完毕。

**展卡注意**（承接批次 11 报告）——展卡核对结论已落卡序头（plan-p1.md 批次 12 卡序节）：
1. 10 条锚点逐一打开核对零内容勘误（K3 agent-host-bridge.ts 全文 / K4 xai-acp-lib 8 文件结构 / K8 pi protocol 三件 / N7 zcode sessionRealtimePort / N8 claude-code.d.ts 🔴只学语义 / N9-N10 config_sync merge+crypto）；疑似覆盖核对：N4 关闭记档消费（T-P1-87 ExecutionEpoch 打底在位，本批不扩流内载荷）；M9 记档"全局/会话两级上限留 K3"兑现（T-P1-112 chainToolAcquire）。
2. N7+N3 一卡承载（同一机制两面——N7 验收自引 Q6 互斥）；N9/N10 拆两卡（N10 合并纯函数先行、N9 子系统消费）。
3. 词汇表预判立案：#19 = N8 surface/attach + surface/detach（两枚而非一枚 op 二值——判据字段差异 C14 自洽）；T-P1-108 J5 展开执行（#16 已追认 Anthropic）。

### 批次 12 报告（收官于 2026-09-27）

- **打勾情况**：11/11 卡全关（T-P1-110 N1 统一会话 ID / T-P1-111 N10 三方合并 / T-P1-112 K3 HostRegistry / T-P1-113 N7+N3 租约互斥 / T-P1-114 N8 roster 事件 / T-P1-115 K8 端间协议 / T-P1-116 N2 跨端审批 / T-P1-117 K4 ACP / T-P1-118 N9 同步子系统 / T-P1-108 J5 Anthropic / T-P1-120 收口），每勾附「命令 + 结果摘要」。
- **展卡结论**：10 条锚点零勘误；K3"只学行为"落 host 包装不重写（pi-desktop 行为复用纪律）；K8"内核协议自有"落信封化我方词汇（AgentRequest/AgentMessage 复用，不取 CBOR/三级路由——YAGNI 记档）；K4"独立包"落 src/acp 独立域 + 三结构红线机内化（≤8 文件 / cli 零 import / 单向依赖——pnpm workspace 不引入记档）；N8 两事件而非单事件（判据字段差异 C14 自洽）；N9 KDF scrypt 替代 Argon2id（Node 内置，引原生依赖违反纪律——记档）。
- **产出的文件**：四新域——`src/host/`（registry / lease / protocol / bridge / roster 五模块 + 五测试）、`src/acp/`（jsonrpc / acp-agent / main 三模块 + 测试，恰 4 文件 ≤8）、`src/sync/`（merge / vault / store / journal / coordinator 五模块 + 两测试）、`src/session/session-id.ts` + 测试、`src/models/anthropic-messages.ts` + 测试；扩 `kernel/events.ts`（词汇表 23→25）/ `kernel/agent-child.ts`（--session/--provider anthropic）/ `kernel/agent-process.ts`（toolAcquire 注入）/ `kernel/invariants.ts` + `session/project.ts`（surface 校验豁免）/ `cli/index.ts`（resolveChildSessionArgv）。
- **验收台账**：全量 `npx vitest run` **1239 passed / 1 skipped**（批次 11 收官 1144 → 净增 95，139 文件）；`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变；`check-doc-links.sh` 492 链接 0 失效（显式传参 4 文件）；`license-audit.sh` exit 0（LEAK 未命中/SOURCEMAP 无）。
- **词汇表扩展**：**23→25 一案**——#19 `surface/attach {surfaceId, deliveryKind?}` + `surface/detach {surfaceId, reason?}`（log-only 会话级元事件，roster 持久面 + activeRoster 流重建恢复恒等）；落地记录 19 同步（§3.2 表格 24/25 行 + 原 22/23 缺行补齐）；回退面齐备（删两事件 + 校验/豁免/roster/hub 回调，约 1.5 小时全部新增面）。
- **盘点结论**：八面零真冲突（T-P1-120 完成记录）：①三层并发次序（全局→会话→B17 RwLock，计数独立）；②两租约域分立（host 面 run 保护 × port 面命令准入——场景③钉死）；③roster log-only 零模型历史污染 + 恢复恒等 + 会话级/进程级分域；④两协议词汇同源（类型 import 编译期防漂移）；⑤ACP 映射边界（词汇不漏内核 + 三结构断言）；⑥跨连接审批审计链完整（source 自由文本，答复端闭集收口随批次 14 记档）；⑦vault × DPAPI 两套加密分域（import 零交叉）；⑧快照即规格 = bridge.test 场景③逐信封序列 + roster 落流三形状。
- **新发现的约束或坑**：(a) **merge 缺席语义缺口**（对 T-P1-111 回修）——local 缺席曾被误判删除/冲突，按 pi"缺席仅在 base 有意义、显式墓碑才表达删除"补四条缺席分支（12 既有用例零回归）；(b) **per-device knownBase 设计发现**——全局单一 base 让后推设备静默取边（正是 N10 要防的"后写覆盖先写"），协调器加设备侧认可基线后冲突在前推方 pull 阶段显式撞出；(c) 内存桥 kill 只 end output 挂死——runAgentChildStdio 等 `Promise.race([readline close, output error])`，end() 不触发 error（test fixture 教训——须 end stdin）；(d) 连接身份真源在构造期（HostProtocolServerOptions.surfaceId）——hello 的 surfaceId 字段是校验回执非设定点；(e) HttpMock SseScript 无 event: 行（Anthropic data.type 兜底可用）且 includeDone 缺省注入 [DONE]（Anthropic wire 无此词——适配器解析容忍非闭集帧带 error 对象才抛）；(f) flaky 两例（llm-replay / http-mock 并行竞态各复现 1 次，隔离复跑全绿——批次 6/11 同形态）。
- **偏离计划的地方**：逐卡「完成记录」已记档——要点：协议信封三处扩展（hello +surfaceId/deliveryKind、ServerEnvelope +notification、ClientEnvelope +lease——wire 形状非事件词汇表，批次 9 先例）；HostBridge 编排面新模块（N2 场景③的承载——卡面"零新机制"修正为"零新机制 + 编排面"，审批广播/回执匹配/租约校验是组合逻辑）；N9 coordinator + knownBase 与 result.base（设计发现 (b) 的落点）；K4 恰 4 文件（≤8 内——main/jsonrpc/acp-agent/测试，多余抽象不预建）。
- **遗留风险与未知**（→ 人工确认清单）：#19 待追认（回退面齐备，未追认不阻塞）；真实网络传输层缺位（K8 的 TCP/WS 传输、N9 的 WebDav 远端、租约 TTL 心跳——接口面在位随批次 14/部署）；ACP 规范全文对齐随真实客户端联调；Anthropic 真实端点联调随 §6.2（含 cache_control 标记策略）；答复端闭集（APPROVAL_SURFACES 并入）随批次 14 真实端面。
- **批次完成定义核对**：全部 ✅（见 plan-p1.md 批次 12 完成定义——11 卡全勾 + tsc 干净 + 310 不变 + 492 链接 0 失效 + license exit 0 + #19 立案 + 结构红线机内化 + 报告/提示词/基线更新）。
- **下一批**：**批次 13 多模态与工程纪律（8 条：P1 P2 P3 + T1 T2 T5 T6 + L4）**——未展卡，下一会话先展卡（锚点核对 + 卡序落 plan-p1.md）再执行，做完收官即停。
- **下一批提示词**：见本文件头部「批次 13 提示词（当前活跃）」。

---

## 待澄清（执行会话新发现；接续旧文件编号——#16 起）



| # | 需求ID | 我看到的（含路径:行） | 与需求文档的矛盾 | 建议 | 裁决与落实 |
| --- | --- | --- | --- | --- | --- |
| #16 | J5 | 展卡时开放问题（批次 11 提示词明示"展卡时先立案"）：第二厂商选型候选按参考仓覆盖面为 Anthropic（pi-mono·packages/ai/src/api/ 锚点最厚——anthropic-cache-split.ts 等）与 Gemini（qwen） | 非矛盾——用户决策项（技术选型，§0 第 7 条第 3 款） | 建议 **Anthropic**：pi-mono 锚点最厚（流式 wire/缓存切分/工具块映射均有同仓先例），且 F6/F13-F15 缓存族已按 pi-mono 语义落过锚；Gemini（qwen）备选 | **✅ 已追认（2026-09-27 用户："Anthropic"）**——T-P1-108（J5 第二厂商适配）照批次 12 提示词既定安排并入批次 12 展卡执行 |
| #17 | F26 | T-P1-100 落地：`compaction` 事件载荷增可选字段 `compHash?: string`（events.ts CompactionEvent——压缩指纹，三次落盘 started/failed/completed 同值；`reason:"comp_hash_changed"` 是词汇表 2026-09-25 定稿注释中**预先声明**的 P1 槽位，非新值） | 无矛盾——载荷扩展按 Q9 封闭联合纪律走立案（事件计数 23 不变） | 追认 `compHash` 可选载荷；回退面 = 字段删除后旧流/新流均零影响（可选字段前向兼容，缺省读作"无指纹"不触发重压——codex turn.rs:1304"缺值不触发"纪律） | **✅ 已追认（2026-09-27 用户："全部认可"）——l0-events.md §8 落地记录 17 转正，词汇表正式形状 |
| #18 | F11 | T-P1-101 落地：`compaction` 事件 (a) `strategy` 值域收闭集 `"full_summary" \| "recent_window_fallback"`（原注释"唯一直值"演进——F11 兜底检查点是真实第二策略）+ (b) 新增可选字段 `failureReason?: string`（**闭集** no_new_history/summary_budget/summary_provider/checkpoint_oversized——ADR 0302 纪律"closed vocabulary instead of provider error text"，provider 错误原文绝不落流） | 无矛盾——值域扩展 + 载荷扩展按 Q9 纪律走立案（事件计数 23 不变；旧流 strategy 缺省读作 full_summary 语义） | 追认 strategy 值域收闭集 + failureReason 可选载荷；回退面 = 删除字段后兜底检查点退回"failed 事件 + 上抛"旧行为（E17/T-P1-93 语义），旧流零影响 | **✅ 已追认（2026-09-27 用户："全部认可"）——l0-events.md §8 落地记录 18 转正，词汇表正式形状 |
| #19 | N8 | T-P1-114 落地：词汇表 23→25——新增 `surface/attach {surfaceId, deliveryKind?}` 与 `surface/detach {surfaceId, reason?}` 两枚 log-only 会话级元事件（surface roster 生命周期——host 连接 connect/close/断线自动释放经 SurfaceHub onLifecycle → AgentHost emit → 装配方 append 落流；`src/host/roster.ts` activeRoster 纯函数流重建，恢复恒等） | 无矛盾——N8 验收"端的加入/离开是持久事件"要求落事件流（内存 roster 随进程消失）；两枚而非一枚 op 二值：attach/detach 判据字段差异大（C14 各自形状自洽，command/run+done 配对先例）；替代面已评估记档——plugin 逃生舱不专（roster 是核心域）、单事件 op 二值校验分支化 | 追认两枚新事件（23→25）；回退面 = 删两事件 + project/invariants/roster/hub 回调 + events.test 计数回 23（约 1.5 小时，全部新增面不触碰既有 23 事件语义），回退后 roster 回落内存面（持久验收缺失） | **✅ 已追认（2026-09-28 用户："认可#19"）——l0-events.md §8 落地记录 19 转正，词汇表正式形状，§3.2 正式计数 25 事件** |
| #20 | P1 | T-P1-124 落地：`user/message` 事件载荷新增可选字段 `attachments?: AttachmentRef[]`（`{attachmentId, mediaType, name?, size}`——流存引用不存字节，字节在 AttachmentStore；事件计数 25 不变） | 无矛盾——载荷扩展按 Q9 封闭联合纪律走立案；字段缺省旧流前向兼容（缺值读作"无附件"） | 追认 attachments 可选载荷；回退面 = 删字段 + attachments 域接线（约 2 小时全部新增面），旧流/新流均零影响；回退后附件能力关闭（ATTACHMENTS_UNSUPPORTED 恒拒绝） | ⏳ 待追认 |

## 人工确认清单（批次 11 起）

| 需求ID / 批次 | 为什么不能机验 | 人工要怎么确认 | 状态 |
| --- | --- | --- | --- |
| llm-replay flaky（批次 11 测试基建） | `llm-replay.test.ts` 回放等价用例在 93 文件并行负载下偶发失败（批次 11 期间复现 1 次，隔离复跑两次全绿）——疑似端口/时序资源竞态，非产品代码缺陷 | 多次全量跑观察复现率；若复现频繁，下一会话以 test-only 修复（如固定端口/串行化该文件） | 观察中（批次 6 T-P1-48 同形态） |
| J16 健康探测真实端点（T-P1-107） | 探测的 reachability/degraded 判据已单测钉死，但真实厂商端点的 TTFB 分布未实测 | 下次真实厂商联调时顺带跑 `runHealthCheck`（degraded 阈值 6000ms 是否合理） | 待真实厂商联调（同 §6.2 终验窗口） |
| #19 surface/attach + surface/detach（批次 12 词汇表 23→25） | 两枚 log-only 会话级元事件的词汇表扩展走 Q9 单向门——追认是用户决策项（§0 第 7 条第 3 款） | 追认则 l0-events.md §8 落地记录 19 落"已追认"转正；不追认按回退面删除（约 1.5 小时全部新增面，roster 回落内存面） | **✅ 已追认转正（2026-09-28 用户："认可#19"）** |
| 真实网络传输层（批次 12 host 域） | K8 端间协议的 TCP/WS 传输、N9 的 WebDav 远端、租约 TTL 心跳均接口面在位未实装（无真实部署形态） | 批次 14 UI 部署形态定形时选传输并补端到端实测 | 待批次 14 / 真实部署 |
| ACP 规范全文对齐 + Anthropic 真实端点（T-P1-117 / T-P1-108） | 方法映射按公开约定最小面（四方法）+ wire 语义 http-mock 钉死；真实 ACP 客户端与 Anthropic 端点未实测 | 真实客户端联调时对齐规范全文（fs 工具面/read_resource 等）；Anthropic 端点跑通一轮真实会话（cache_control 标记策略同窗口） | 待真实联调（§6.2 终验窗口） |
| 全量 flaky 两例（llm-replay / http-mock，批次 12 期间各复现 1 次） | 93+ 文件并行负载下的端口/时序资源竞态（隔离复跑全绿）——批次 6 T-P1-48 同形态，非产品代码缺陷 | 多次全量跑观察复现率；若频繁，下一会话以 test-only 修复（固定端口/串行化该文件） | 观察中（与批次 11 llm-replay 在案项合并观察） |
