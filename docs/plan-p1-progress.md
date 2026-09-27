# P1 执行进度 · 批次 11 起

> 本文件接续 [`plan-p0-progress.md`](plan-p0-progress.md)（P0 全程 + P1 批次 1-10，2026-09-27 收官，全量基线 1081 passed / 1 skipped，词汇表 23 事件）——**自批次 11 起的执行进度**（批次报告 / 待澄清 / 人工确认清单）记入本文件，旧文件定格不再追加。
> 执行协议沿用 [`plan-p0.md`](plan-p0.md) §0（取卡 / 做卡 / 验收 / 打勾 / 提交 / 自动继续 / 四种停下情况）；计划本体在 [`plan-p1.md`](plan-p1.md)（执行会话只改任务卡的勾选框、「偏离 / 建议」「完成记录」三个字段）。
> **待澄清编号接续旧文件（#16 起）**——避免跨文件引用歧义；词汇表立案管线不变（`l0-events.md` §8 落地记录全局连续，现为 18；**#16~#18 三案已经用户 2026-09-27 追认全部转正**——#16 选型 Anthropic、#17/#18 词汇表形状）。

---

## 批次 12 提示词（当前活跃）

```
继续 aegent P1 批次 12 的实施（多端架构·无 UI；10 条需求 ID：K3 K4 K8 +
N1 N2 N3 N7 N8 N9 N10）。推进模式不变：一会话一批次——本会话只做批次
12，做完收官即停，批次 13 由下一会话接力。批次 12 尚未展卡：先照批次
7~11 展卡先例逐条锚点核对 requirements.md §4（把卡序追加进
docs/plan-p1.md，展卡核对结论落卡序头），再从第一张 [ ] 任务卡开始执行
（执行协议沿用 docs/plan-p0.md §0）。上一批（批次 11）报告在
docs/plan-p1-progress.md（批次 11 报告 + 待澄清 #16~#18 + 人工确认清单
均在该文件）。本批特有的注意：
1. K3 远程 host 是 K4/K8/N7/N8 的地基（圈定研究"K3 先行"）——展卡先定形
   host/租约/协议层，K4 ACP 与 K8 端间协议是其消费面；N7/N8 是"每个界面
   一个 host + roster"的多端模型。
2. 接旧账三条：N2 ← C6 跨端应答通道（批次 9 在位——lease/answer 面）；
   N9/N10 ← N1（配置跨设备同步的地基）；M9 记档"全局/会话两级上限结构
   留 K3"（批次 6）+ M8/N4 execution epoch（批次 10）+ N6 lease 语义扩展
   （批次 9 C6 卡记档"多端并发 holder 留 N7"）——多端打底逐条消费。
3. 词汇表高风险预判（圈定研究）：N8 surface roster attach/detach 事件——
   展卡时预判立案（编号接 #19 起）；批次 11 遗留案状态：#16 已追认
   （Anthropic）——T-P1-108（J5 Anthropic Messages 适配）在本批展卡执行
   （锚点照卡序头草案：opencode llm 分层 + pi-mono anthropic api）；#17
   （compHash 载荷）/ #18（strategy 值域 + failureReason 载荷）已经用户
   2026-09-27"全部认可"追认转正——无遗留待澄清案。
4. 全量基线 1144 passed / 1 skipped；词汇表 23 事件。收官照批次 8~11
   先例出组报告（写入本文件），更新本文件的批次 13 提示词与全量基线后
   停止——不要开始批次 13。不要问要不要继续。
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

## 待澄清（执行会话新发现；接续旧文件编号——#16 起）

| # | 需求ID | 我看到的（含路径:行） | 与需求文档的矛盾 | 建议 | 裁决与落实 |
| --- | --- | --- | --- | --- | --- |
| #16 | J5 | 展卡时开放问题（批次 11 提示词明示"展卡时先立案"）：第二厂商选型候选按参考仓覆盖面为 Anthropic（pi-mono·packages/ai/src/api/ 锚点最厚——anthropic-cache-split.ts 等）与 Gemini（qwen） | 非矛盾——用户决策项（技术选型，§0 第 7 条第 3 款） | 建议 **Anthropic**：pi-mono 锚点最厚（流式 wire/缓存切分/工具块映射均有同仓先例），且 F6/F13-F15 缓存族已按 pi-mono 语义落过锚；Gemini（qwen）备选 | **✅ 已追认（2026-09-27 用户："Anthropic"）**——T-P1-108（J5 第二厂商适配）照批次 12 提示词既定安排并入批次 12 展卡执行 |
| #17 | F26 | T-P1-100 落地：`compaction` 事件载荷增可选字段 `compHash?: string`（events.ts CompactionEvent——压缩指纹，三次落盘 started/failed/completed 同值；`reason:"comp_hash_changed"` 是词汇表 2026-09-25 定稿注释中**预先声明**的 P1 槽位，非新值） | 无矛盾——载荷扩展按 Q9 封闭联合纪律走立案（事件计数 23 不变） | 追认 `compHash` 可选载荷；回退面 = 字段删除后旧流/新流均零影响（可选字段前向兼容，缺省读作"无指纹"不触发重压——codex turn.rs:1304"缺值不触发"纪律） | **✅ 已追认（2026-09-27 用户："全部认可"）——l0-events.md §8 落地记录 17 转正，词汇表正式形状 |
| #18 | F11 | T-P1-101 落地：`compaction` 事件 (a) `strategy` 值域收闭集 `"full_summary" \| "recent_window_fallback"`（原注释"唯一直值"演进——F11 兜底检查点是真实第二策略）+ (b) 新增可选字段 `failureReason?: string`（**闭集** no_new_history/summary_budget/summary_provider/checkpoint_oversized——ADR 0302 纪律"closed vocabulary instead of provider error text"，provider 错误原文绝不落流） | 无矛盾——值域扩展 + 载荷扩展按 Q9 纪律走立案（事件计数 23 不变；旧流 strategy 缺省读作 full_summary 语义） | 追认 strategy 值域收闭集 + failureReason 可选载荷；回退面 = 删除字段后兜底检查点退回"failed 事件 + 上抛"旧行为（E17/T-P1-93 语义），旧流零影响 | **✅ 已追认（2026-09-27 用户："全部认可"）——l0-events.md §8 落地记录 18 转正，词汇表正式形状 |
| #19 | N8 | T-P1-114 落地：词汇表 23→25——新增 `surface/attach {surfaceId, deliveryKind?}` 与 `surface/detach {surfaceId, reason?}` 两枚 log-only 会话级元事件（surface roster 生命周期——host 连接 connect/close/断线自动释放经 SurfaceHub onLifecycle → AgentHost emit → 装配方 append 落流；`src/host/roster.ts` activeRoster 纯函数流重建，恢复恒等） | 无矛盾——N8 验收"端的加入/离开是持久事件"要求落事件流（内存 roster 随进程消失）；两枚而非一枚 op 二值：attach/detach 判据字段差异大（C14 各自形状自洽，command/run+done 配对先例）；替代面已评估记档——plugin 逃生舱不专（roster 是核心域）、单事件 op 二值校验分支化 | 追认两枚新事件（23→25）；回退面 = 删两事件 + project/invariants/roster/hub 回调 + events.test 计数回 23（约 1.5 小时，全部新增面不触碰既有 23 事件语义），回退后 roster 回落内存面（持久验收缺失） | （待追认） |

## 人工确认清单（批次 11 起）

| 需求ID / 批次 | 为什么不能机验 | 人工要怎么确认 | 状态 |
| --- | --- | --- | --- |
| llm-replay flaky（批次 11 测试基建） | `llm-replay.test.ts` 回放等价用例在 93 文件并行负载下偶发失败（批次 11 期间复现 1 次，隔离复跑两次全绿）——疑似端口/时序资源竞态，非产品代码缺陷 | 多次全量跑观察复现率；若复现频繁，下一会话以 test-only 修复（如固定端口/串行化该文件） | 观察中（批次 6 T-P1-48 同形态） |
| J16 健康探测真实端点（T-P1-107） | 探测的 reachability/degraded 判据已单测钉死，但真实厂商端点的 TTFB 分布未实测 | 下次真实厂商联调时顺带跑 `runHealthCheck`（degraded 阈值 6000ms 是否合理） | 待真实厂商联调（同 §6.2 终验窗口） |
