# P2 执行进度 · 批次 15 起

> 本文件接续 [`plan-p1-progress.md`](plan-p1-progress.md)（P0 全程 + P1 批次 1-14，2026-09-28 P1 全部收官定格，全量基线 **1293 passed / 1 skipped**，词汇表 26 事件）——**自批次 15（P2 段）起的执行进度**（批次报告 / 待澄清 / 人工确认清单）记入本文件。
> 执行协议沿用 [`plan-p0.md`](plan-p0.md) §0；计划本体在 [`plan-p2.md`](plan-p2.md)（48 条 / 五批 / 52 卡，2026-09-28 一次展卡——P0 式全阶段计划）。
> **待澄清编号接续（#22 起）**——词汇表立案管线不变（`l0-events.md` §8 落地记录全局连续，批次 15a 收官后现为 **27 事件**；**最新全量基线 1337 passed / 1 skipped**）。
> **批次进度**：15a ✅（2026-09-28 收官，本文件报告）→ 15b（下一批）→ 15c → 15d → 15e。

---

> **P3 已立项**（2026-09-28 用户裁决）：U 域 8 条产品化层见 [`plan-p3.md`](plan-p3.md)——本文件提示词链执行到 15e 收官后，接 `plan-p3-progress.md` 的批次 16 提示词。

## 批次 15b 提示词（当前活跃）

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

## 人工确认清单（批次 15 起）

| 需求ID / 批次 | 为什么不能机验 | 人工要怎么确认 | 状态 |
| --- | --- | --- | --- |
| —（批次 15a） | 本批无新增项——全部验收机可验（本地库/内存面，无真实端点/平台联调；维护 CLI 已本机端到端实测） | — | 无需人工确认 |
