# P2 实施计划

> **后续层**：P3 产品化层（U 域 8 条，2026-09-28 用户裁决新增）见 [`plan-p3.md`](plan-p3.md)——批次 15e 收官后接批次 16。

> **性质**：P2 优先级层全阶段计划（48 条需求 / 五批 / 约 43 卡），2026-09-28 展卡。
> **执行协议**：沿用 [`plan-p0.md`](plan-p0.md) §0（取卡 / 做卡 / 验收 / 打勾 / 提交 / 自动继续 / 四种停下情况）——本会话只改任务卡的勾选框、「偏离 / 建议」「完成记录」三个字段。
> **推进模式**：一会话一批次（批次 15a → 15b → 15c → 15d → 15e），每批收官照批次 8~14 先例出组报告（写入 `plan-p2-progress.md`）并更新下一批提示词。
> **锚点核对底册**：[`20260926_P2研究_批次圈定建议.md`](20260926_P2研究_批次圈定建议.md) §2.1——48/48 锚点有效零勘误（含 2 处行号锚 `compact.rs:483` / `compact.rs:470` 逐一开文件验证）；本展卡（2026-09-28）另抽核 10 处代表锚点全部命中。
> **批次顺序裁决依据**：[`20260926_P1剩余批次全量圈定研究.md`](20260926_P1剩余批次全量圈定研究.md) §四（五组归并 + 跨段依赖标注：K9←S4、S1/S2/M11←M1/M2 底座〔批次 10 已落〕、判官组←C56〔批次 9 已落接口面〕）。

## §1 全局约束（P2 段）

1. **词汇表单向门不变**（Q9 纪律）：每处新事件/载荷扩展走立案管线（`plan-p2-progress.md` 待澄清表，编号接 P1 的 #22 起）；`l0-events.md` §8 落地记录全局连续（现为 26 事件）。各批展卡时逐条预判。
2. **工程纪律工具链**：`architecture:check`（新域一律 managed:true 入册）/ `vocabulary:check` / `count-features`（310 不变）/ `check-doc-links`（显式传参）收官必跑；T4 豁免理由落地后 architecture-policy 的 exceptions 逐条补齐 reason（现状已带）。
3. **密钥红线**：J17 OAuth、S3/S4 凭据、K6/K7 webhook token 一律环境变量或 `private/`（gitignore）；文档与记录只写掩码。
4. **锚点纪律**：🔴 标记的锚（pi-desktop 全部）**只学行为零代码摘取**；其余锚取行为与纪律，代码形态我方自定（TS 单包 + 现有域结构）。
5. **P2 不做的**（全段）：多租户/身份/配额（Q2"使用者=只有我自己"）；上传应用商店/签名分发（K2 后续）；付费 API 之外的云服务依赖；**H 族子代理本体**（P0/P1 已落——本段只做 H6 后端可插）。

## §2 批次划分总表（48 条 / 五批）

| 批次 | 主题 | 条目 | 数 | 依赖锚点 |
| --- | --- | --- | --- | --- |
| 15a | 会话数据与生命周期 | Q6 Q8 Q4 M4 Q2 E6 E9 | 7 | E5 fork（批次 5）、sqlite store |
| 15b | 判官与权限 P2 | C40 C55 C42 | 3 | C56 接口面（批次 9）、权限链 P0 |
| 15c | 插件生态与远程后端 | M7 I5 I4 I7 I8 I10 I11 I14 H6 D12 | 10 | HookRegistry/plugin-manifest（P1）、E6 树（15a） |
| 15d | 端与自动化 | S1 M11 S2 S5 N5 P4 S3 S4 K9 K6 K7 | 11 | M1/M2 job 底座（批次 10）、K5/K8 端面（批次 12/14） |
| 15e | 观测与工程纪律 P2 | T3 T4 T7 T8 O27 O28 O29 O30 A16 F19 F27 F16 L9 L5 L6 J21 J17 | 17 | T1/T2（批次 13）、压缩引擎（P0）、L3 usage |

**排序理由**：15a 先行（会话数据是 Q/E 域基础，E6 树是 15c 的 H6 前置）；15b 判官组紧随（权限深化独立域、架构影响大但面窄）；15c 插件生态（依赖 15a 的树 + P1 的 hook/manifest 地基）；15d 端与自动化（依赖最重——S1/M11 吃 job 底座、K9 吃 S4、IM 端吃 N5 推送面，靠后）；15e 收尾（观测与纪律横切件多而独立，J17 OAuth 独立大件殿后）。

## §3 批次 15a 卡序（8 张：Q6/Q8/Q4/M4/Q2/E6/E9 + 收口；2026-09-28 展卡）

**锚点纪律**：7 条锚点以 P2 研究 48/48 核对为底，本批抽核 3 处（dsh·session-query 包目录 / pi-desktop·ADR 0023 / qwen·session-idle-reaper design 目录——全部命中）。零勘误。

**展卡核对结论**：
1. **Q2 是本批大件**：dsh·session-query 是完整包组（SQLite 检索 + 模型五工具 + 导出三面）——我方取"SQL 检索 + agent 工具化"两件（导出归 E7 transcript 已有面扩展，记档）；"查询走 SQL 而非全量加载"的验收落 sqlite 事件库的检索面（store 已有 readAll 全量——Q2 增加的是**条件检索**：按会话/时间/类型/内容 LIKE）。
2. **E6"同一套抽象不写两套"**：E5（批次 5 fork）已落 SessionStore.fork（position/atSeq）——E6 树 = 谱系元数据（parent/children）+ 未知边界不创建子会话（fork 目标会话不存在时拒绝而非静默新建）。ADR 0023 取"协议命令 + host 所有权"行为（host server 的 session/fork 已有 wire 面）。
3. **Q4×Q6×Q8 三件一体**：Q6 保留常量（审计 90 天/任务 100 条）是 Q4 清理的策略来源；Q8 归档独立一档（归档 ≠ 删除——codex 压缩目录先例）是 Q4 清理的动作分型；Q4 消费两者。M4 空闲回收是运行时半边（内存），Q4 是存储半边（磁盘）——两件配合但分域。
4. **E9 会话引用**：dsh·session-reference 的行为 = 会话间引用（@session 形态的上下文带入）——我方最小面：引用走 AttachmentRef 同款引用纪律（流存引用不存内容），读取时注入。

**词汇表预判（#22 候选）**：E6 树谱系——`session/fork` 载荷扩展 `parentSeq?/treeId?`（载荷扩展计数不变）或独立 log-only 元事件；Q8 归档——`session/archive` log-only 元事件候选。执行时立案。

#### T-P2-101 · Q6 · 保留策略常量（审计 90 天 / 任务运行记录 100 条） `[x]`
- **依据需求**：Q6（"保留策略常量：审计 90 天 / 任务运行记录 100 条；常量集中可查"）
- **上游首选参考**：pi-desktop·db/migrations.rs（保留策略与迁移同域管理的行为）
- **取什么 / 别抄什么**：取"常量集中单一来源 + 清理动作消费常量"行为；不抄其 Rust 迁移框架（我方 migrate.ts 已有）
- **要产出**：`src/session/retention.ts`——`RETENTION_POLICY = { auditDays: 90, taskRunRecords: 100 }` 导出常量 + 纯函数 `retentionCutoff(now): {auditBefore, keepLatestTaskRuns}` + 文档注释说明数值来源；消费方接口（Q4 卡消费）
- **验收**：`npx vitest run src/session/retention.test.ts`——常量形状 + cutoff 计算 + 与 Q4 的消费契约（类型面）；tsc 干净
- **依赖**：无（本批首卡热身）
- **风险 / 未知**：无
- **完成记录**：2026-09-28。产出 `src/session/retention.ts`——`MS_PER_DAY` + `RetentionPolicy`（auditDays/taskRunRecords）+ `RETENTION_POLICY`（Object.freeze({auditDays:90, taskRunRecords:100})，数值锚 pi-desktop·migrations.rs:3-4 同值）+ `resolveRetentionPolicy(overrides?)`（缺省为底合并覆盖 + 全字段非负整数校验 fail-closed——坏策略拒绝执行而不是按 0 清理）+ `retentionCutoff(now, policy?)` 纯函数（时钟由调用方给——清理是显式动作不在库内藏隐式 Date.now；产物 `RetentionCutoff {auditBefore, keepLatestTaskRuns}` 即 Q4 消费面）。零依赖零 IO（纯常量 + 纯函数，方向单向：Q4 卡消费、本模块不 import 任何存储/内核面）。测试 `src/session/retention.test.ts` 5 用例：常量形状 + 冻结 / cutoff 计算（90 天毫秒口径）+ 常量与计算一致面 / 显式覆盖部分覆盖 / 坏策略四路拒绝 / 消费契约类型面（RetentionPolicy + RetentionCutoff 形状钉死）。**验收**：`npx vitest run src/session/retention.test.ts` → **5 passed**；`npx tsc --noEmit` 干净。**记档**：①"审计记录/任务运行记录"两种表对象在本仓当下尚无常驻表（审计记录现走 logger 宣告面、job 面在内存）——本卡只交付策略声明，清理动作的数据面（表与写入面）随 T-P2-103 清理器落，消费契约已由 RetentionCutoff 形状预先钉死。

#### T-P2-102 · Q8 · 会话归档独立一档（归档 ≠ 删除） `[x]`
- **依据需求**：Q8（"归档是独立一档（ARCHIVED_SESSIONS_SUBDIR），不是删除"）
- **上游首选参考**：codex·rollout/compression.rs（归档目录独立、压缩/归档分型的行为）
- **取什么 / 别抄什么**：取"归档是独立一档 + 归档可查"行为；不抄其压缩实现（我方压缩在上下文域）
- **要产出**：`src/session/archive.ts`——`ARCHIVED_SESSIONS_SUBDIR` 常量 + `archiveSession(dbPath, sessionId)`（会话数据移入归档子目录——文件级移动非删除）+ `listArchivedSessions()` + 归档事件（**#22 立案候选**：`session/archive {reason?}` log-only——归档前落流尾）；归档后主库不可查（fail-closed）但归档档可查
- **验收**：`npx vitest run src/session/archive.test.ts`——归档往返（主库消失 + 归档档在 + 流尾事件）+ 归档后 readAll 拒绝 + listArchived 可查
- **依赖**：T-P2-101（保留策略同域）
- **风险 / 未知**：归档粒度（会话级文件移动 vs 行级迁移）——会话级文件移动最小面（我方 sqlite 单库多会话——归档 = 会话行导出到归档库文件 + 主库删除，卡内定形）
- **完成记录**：2026-09-28。产出：①**#22 立案（词汇表 26→27）**——新增 `session/archive {reason?}` log-only 会话级元事件（events.ts + EVENT_TYPES + 编译闸门 / project.ts validation + 投影不消费 / invariants.ts O7 豁免 / l0-events.md §8 落地记录 22 + §3.2 行 27（顺带补回落地记录 21 遗漏的 image/offload 表格行）+ plan-p2-progress 待澄清 #22 在案；✅ 追认于 2026-09-28（"认可22"））；②`src/session/archive.ts`——`ARCHIVED_SESSIONS_SUBDIR = "archived_sessions"`（codex·lib.rs:87 同值，主库所在目录下·库可搬家）+ `archiveSession(dbPath, sessionId, {reason?, now?})`（卡面定形：会话级导出到归档档独立 sqlite（`archived_meta` + `archived_events` 两表）+ 主库单事务记账本/删 events+sessions+session_index；归档标记先落流尾且**幂等**（流尾已有不追加第二枚——崩溃重试路径）；归档档 tmp + rename 原子替换（log-archive.ts 同款 Windows 语义）；归档前 `Projector.fold` 流完整性闸门——坏流拒绝搬进归档档）+ `listArchivedSessions`（扫归档档元数据——**不依赖主库账本**，账本删除也照样可查）+ `readArchivedSession`（归档档完整可读）+ `ArchiveError` 六拒绝码（BAD_DB_PATH/BAD_SESSION_ID/SESSION_MISSING/ALREADY_ARCHIVED/NOT_FOUND/FILE_CORRUPT）；③主库侧联动——migrate.ts v2→v3（`archived_sessions` 账本表，`CURRENT_SCHEMA_VERSION = 3`）+ db.ts `SessionArchivedError` 与 readAll fail-closed 拒绝（"查无此会话"与"已归档"两类事实——静默空流会把归档误报成不存在；restore 路径同闸）。测试 `src/session/archive.test.ts` 5 用例：归档往返（主库行/会话/索引消失 + 账本在 + 归档档在 + 前 N 条逐条等值 + 流尾标记 + 另一会话零影响）/ 归档后 readAll 类型化拒绝 / listArchived 可查（账本删除复核）/ 标记幂等（预置流尾标记 → 归档不追加第二枚）/ 失败面六码。**验收**：`npx vitest run src/session/archive.test.ts` → **5 passed**；关联面 `src/kernel/events.test.ts src/obs/replay.test.ts src/session/migrate.test.ts src/session/db.test.ts src/session/project.test.ts src/kernel/invariants.test.ts` → 全绿（计数断言 26→27 更新、migrate.test 注入链补 v2→v3 切片）；`npx tsc --noEmit` 干净；`architecture:check` 0 error / 21 warning（基线）；`vocabulary:check` 0 问题。**偏离 / 记档**：①db.test/migrate.test 的既有计数与注入链断言随 v3 更新（有意行为，非回归）；②归档档为每会话独立 sqlite 文件（而非 JSON 导出物）——读取面可 SQL 查询、元数据自足，与 E8 导出物（自包含 JSON 快照）分域不重复；③归档不动 git-checkpoint / 附件等旁路资产（会话流归档是 Q8 范围——旁路资产生命周期随各自域记档）。

#### T-P2-103 · Q4 · 旧数据清理（消费保留策略 + 归档） `[x]`
- **依据需求**：Q4（"旧数据清理；与 M4 idle 回收配合"）
- **上游首选参考**：pi-desktop·db/migrations.rs（清理与保留策略联动行为）
- **取什么 / 别抄什么**：取"按保留策略清理 + 清理是显式动作（非后台魔法）"行为
- **要产出**：`src/session/cleanup.ts`——`cleanupSessions(dbPath, now, policy?)`：审计记录超 90 天删（RETENTION_POLICY 消费）+ 任务运行记录留最新 100 条 + 超保留的会话走 Q8 归档（不直删）；dry-run 面（返回清理清单不执行——人工确认半边）；CLI/库面调用点
- **验收**：`npx vitest run src/session/cleanup.test.ts`——三类清理各一用例 + dry-run 零副作用 + 归档联动
- **依赖**：T-P2-101/102
- **风险 / 未知**：后台定时不做（显式调用/CLI 触发——调度面随 15d S1）
- **完成记录**：2026-09-28。产出：①`src/session/cleanup.ts`——**写入面**（运维账本登记原语：`recordAudit(db, record)`（kind/phase/requestId/tool/surface/approver/at 为检索清理列 + payload 整条 JSON）与 `recordTaskRun(db, run)`（TaskRunStatus 四值 + started/ended/detail））+ **清理面** `cleanupSessions(dbPath, now, options?)`：审计记录按窗删（`at < now − auditDays 天`，RETENTION_POLICY 消费）+ 任务运行记录每 task 留最新 100 条（窗口函数 ROW_NUMBER 分区删——与计数同一 SQL 语义）+ 超保留会话走 Q8 `archiveSession(reason:"retention")`（**归档不直删**）；`dryRun:true` 只算不执行（清单即预告——三类候选同列，`archived` 恒空）；`sessionRetentionDays` 缺省 = 策略 auditDays（旧数据同一保留窗，可显式分窗）；显式 now（无隐式 Date.now——清理是显式动作）。②schema v4：`audit_log` + `task_runs` 两表（运维账本非会话轨迹——L1 不破：会话事实仍在 events 表；判据列索引 idx_audit_log_at / idx_task_runs_task）。③CLI 调用点 `src/cli/maintenance.ts`（照 doctor 形状：`npm run maintenance -- cleanup --db <path> [--dry-run] [--audit-days N] [--keep-runs N] [--session-days N] [--json <path>]`；退出码 0/1/2）+ package.json script。测试 `src/session/cleanup.test.ts` 3 用例：三类清理全链（审计 3 条删 2 留 1 + payload 原样 / task-A 105→100 保最新 + task-B 3 条不动 / 两旧会话归档（主库消失 + 账本在 + 归档档流尾标记 + s-new 不动））/ dry-run 零副作用（三类候选全列 + 一行不删一档不写）/ 幂等与分窗（二次清理零命中 + 已归档不再候选 + session-days 显式分窗 + 审计窗边界严格小于 + audit-days=0 覆盖）。**验收**：`npx vitest run src/session/cleanup.test.ts` → **3 passed**；`npx tsc --noEmit` 干净；`architecture:check` 0 error / 21 warning（基线）；`vocabulary:check` 0 问题；**CLI 端到端实测**——bad flag → exit 2；seed 一个 100 天前会话 → `npm run maintenance -- cleanup --db <tmp>` 打印三类清单 + 归档回执（s-o → archived_sessions/s-o.sqlite，7 事件）→ exit 0、归档档真实落盘。**偏离 / 记档**：①审计/任务运行两表的**生产者接线**（L2 审计 sink → audit_log；task 运行 → task_runs）不在本卡面——写入原语已在位（测试经它登记），生产消费方随各自域接线（L2 sink 落库随需求、task runs 随 15d S1/M11 调度域），记档；②审计记录当前只走 logger 宣告面（无持久面）——本卡把持久面补齐（Q6"审计 90 天"由此可执行）；③CLI 用独立 maintenance 入口而非 REPL 斜杠命令——清理需与运行时 store 隔离（跨进程显式动作，避免与活动会话的内存序竞争），REPL 面不做记档；④M4 内存回收不在本卡（运行时域，T-P2-104）；Q3 spill 临时文件清理属 spill 域（已有 spill-gc），分域记档。

#### T-P2-104 · M4 · 会话空闲回收（不常驻内存） `[x]`
- **依据需求**：M4（"空闲会话被回收，不常驻内存"）
- **上游首选参考**：qwen·session-idle-reaper（design 文档：空闲判定 + 回收动作 + 可配置时限）
- **取什么 / 别抄什么**：取"空闲判定（最后活跃时间 + 阈值）→ 回收（内存态释放，存储态保留）+ 回收是可观测事件"三行为；不抄其进程模型（qwen 是多进程 daemon——我方单进程 host）
- **要产出**：`src/host/idle-reaper.ts`——`IdleReaper`（AgentHost 注册表面：空闲阈值可配、最后活跃 = 最近写命令/事件时间、到期回收 = 子代理会话的内存态释放 + 通知广播）；主 host 会话不回收（单会话模型——回收面向 15a E6 树产生的子会话与 15c H6 后端会话）；回收落流（log-only 元事件候选，随 #22 立案）
- **验收**：`npx vitest run src/host/idle-reaper.test.ts`——空闲判定（时钟注入）+ 到期回收 + 主会话豁免 + 回收后可查（存储面完整）
- **依赖**：T-P2-102/103（生命周期域先行）
- **风险 / 未知**：回收边界（"回收"只清内存不清存储——存储半边归 Q4，卡内定形）
- **完成记录**：2026-09-28。产出：①`src/host/idle-reaper.ts`——`IdleReaper`（`sweep()` 被动扫描原语 + 阈值可配（缺省 30 分钟 = qwen 同值；0/Infinity 禁用）+ 时钟注入 + `onReap` 通知广播面）+ `SessionReapedNotice {sessionId, hostId, reason:"idle_timeout", lastActiveAt, idleMs, reapedAt}`；**四守卫**（qwen §4.2 同构）：reapable 显式 opt-in（主 host 会话豁免）/ 无连接端（连接即存活性）/ 无持约者（绝不杀进行中的工作——qwen 目标 2）/ 严格超过阈值（恰在界上不动）。**不做后台定时器**（被动扫描——调度随调用方，统一调度面 15d S1；deadline.ts 同款纪律）；回收动作 = `AgentHost.dispose()`（内存态释放，registry 摘除）——**存储态零触碰**（模块不碰盘，存储半边归 Q4）。②`src/host/registry.ts` 扩展——`AgentHostOptions.reapable?`（缺省 false = 主会话豁免）+ `now?` 时钟注入 + `AgentHost.lastActiveAt`/`markActive(at?)`（emit 对 ts>0 的真实事件自动推进活跃；ts=0 占位伪事件不污染）。测试 `src/host/idle-reaper.test.ts` 5 用例：空闲判定（时钟注入 + 边界严格超过 + 通知广播 + dispose 后 emit 静默）/ 活跃推进（markActive + 事件流入 + 伪事件不污染）/ 主会话豁免与守卫（连接端/持约者/断线释约后回收）/ 禁用面与阈值可配 / **回收后可查（存储面完整——事件流逐字节不变且零新增 + EVENT_TYPES 27 基线复核）**。**验收**：`npx vitest run src/host/idle-reaper.test.ts src/host/registry.test.ts src/host/lease.test.ts` → **27 passed**（3 文件）；`npx tsc --noEmit` 干净。**#22 定形结论（M4 回收事实）**：**零词汇表扩展**——回收是**进程内运行时事实**（重启后重新判定、可重复发生），不是会话状态变更；落流会把进程生命周期噪音写进会话持久流（与 M9/job 面"进程内事实 + 回调不进词汇表"先例冲突，jobs.ts 头注释同款纪律）。可观测性经 `onReap` 回调广播（装配接线到通知面）。EVENT_TYPES 27 基线复核在位。**记档**：①回收的对象面 = reapable 的子会话（E5 fork 树产物 / 15c H6 后端会话）——当前代码库尚无子 host 注册点（E6/H6 后续批次接线 reapable:true），本卡交付机制与判定；②`host server` 的周期调用（sweep 定时）不做——调用方决定（15d S1）。

#### T-P2-105 · Q2 · 会话查询（含工具化） `[x]`
- **依据需求**：Q2（"agent 可查询历史会话；查询走 SQL 而非全量加载"）
- **上游首选参考**：dsh·session-query（包组：SQLite 检索 + 模型工具 + 导出）
- **取什么 / 别抄什么**：取"SQL 条件检索 + 查询作为 agent 工具暴露"两行为 + 检索列设计（会话/时间/类型/内容）；不抄导出面（E7 transcript 已有）与其五工具全集（我方最小面：两工具）
- **要产出**：①`src/session/query.ts`——`querySessions(dbPath, criteria)`：按 sessionId 前缀/时间区间/事件类型/内容 LIKE 条件检索（SQL WHERE——**不全量加载**，LIMIT/OFFSET 分页）；②工具化：`session_query`/`session_get` 两 BUILTIN 工具（工具 schema + 只读执行面——走 policy 只读类）；③dsh 的 FTS 全文索引不取（LIKE 即达验收——YAGNI 记档）
- **验收**：`npx vitest run src/session/query.test.ts src/kernel/tools/builtin.test.ts`（扩）——四类条件检索 + 分页 + SQL 断言（EXPLAIN 无全表扫描或 LIMIT 在位）+ 工具化往返（agent 调用 → 结果落 tool/result）
- **依赖**：T-P2-102（归档后主库语义）
- **风险 / 未知**：内容 LIKE 在大库的性能（P2 单机规模可接受——索引随需要记档）；查询工具的权限面（只读类——C 族规则可直接用）
- **完成记录**：2026-09-28。产出：①`src/session/query.ts`——`querySessions(dbPath, criteria)`（四类条件：sessionIdPrefix/**范围谓词**（`>= prefix AND < 上界`——索引友好且无通配符语义，不用 LIKE）/ fromTs..toTs 含界 / types（EVENT_TYPES 闭集校验）/ contentLike（对 payload 做 LIKE 子串 + `%_\` 转义 + 命中摘录前后各 60 字符）；SQL WHERE 参数绑定 + `LIMIT ? OFFSET ?`——**不全量加载**（本模块从不 load/readAll）；结果 {rows, total, limit, offset, hasMore, archivedSessions}）+ `getSessionEvents(dbPath, sessionId, {fromSeq, limit})`（单会话 seq 升序分页 + total/hasMore；归档会话 → SessionArchivedError fail-closed；不存在 → SessionQueryError SESSION_NOT_FOUND）+ `buildSessionQuery(criteria)`（SQL 组装唯一出口，供 EXPLAIN 机检）+ 校验面（limit 1..500 / offset ≥0 / types 闭集 / contentLike 非空 ≤256——外部输入 fail-closed）。②工具化 `src/kernel/tools/builtin/session-query.ts`——`session_query`（条件检索摘要行 + 摘录 + 归档提示）与 `session_get`（单会话事件 JSON 行 + 单条 2000 字符截断）两 BUILTIN 工具（`parallel: true` 只读类——不入 WRITE_EXECUTE_TOOLS，plan 模式可用、M9 计读类；无规则时按不变量 3 默认 ask——读用户数据不加 meta-ops 白名单，记档）+ 描述文件两枚（descriptions/session_query.txt、session_get.txt）+ `BUILTIN_TOOL_NAMES` 17→19 + 装配线（ChildAssemblyOptions.sessionQuery → agent-process registerBuiltinTools → agent-child 在 `cli.db` 在位时注入）。③dsh 的 FTS5 全文索引不取（LIKE/范围谓词即达验收——YAGNI 记档）；导出面不取（E7 transcript 已有）。测试：`src/session/query.test.ts` 5 用例（四类条件 + AND 组合；分页与 hasMore / 两页无重叠；**SQL 断言**——EXPLAIN QUERY PLAN 前缀条件走主键索引（USING INDEX + session_id>?，非 SCAN）+ rowsSql 含 LIMIT 在位 + 坏条件八路拒绝；归档语义（主库 total=0 但 archivedSessions 列出 + getSessionEvents 类型化拒绝）；getSessionEvents 分页边界）；`src/kernel/tools/builtin/builtin.test.ts` 扩 3 用例（装配面条件注册 + 描述在位 / 工具直取与类型化错误回喂 / **工具化往返**——ScriptedProvider 调 session_query → tool/result 落流 → 第二次请求模型读到结果 → 被查会话零变化）。**验收**：`npx vitest run src/session/query.test.ts src/kernel/tools/builtin/builtin.test.ts` → **50 passed**（5 + 45）；全量 `npx vitest run` → **1319 passed / 1 skipped**（1293 → 净增 26）；`npx tsc --noEmit` 干净；`architecture:check` 0 error / 21 warning（基线）；`vocabulary:check` 0 问题。**偏离 / 记档**：①前缀检索用范围谓词而非 LIKE（EXPLAIN 实测 LIKE 前缀在 (session_id,type) 索引上仍全表扫描且 ESCAPE 会禁用 LIKE 优化——范围谓词走 PK 索引，语义严格等价）；②contentLike 全表扫描 + temp b-tree 排序是承认的性能面（P2 单机规模；FTS/索引随真实规模需要——记档）；③plan-mode.test 的全配置断言随 BUILTIN_TOOL_NAMES 17→19 更新（有意行为）。

#### T-P2-106 · E6 · fork 树（谱系元数据 + 未知边界不创建） `[x]`
- **依据需求**：E6（"fork（树）；同一套抽象，不写两套；未知边界不创建子会话"）
- **上游首选参考**：pi-desktop·ADR 0023（协议命令 + host 所有权）+ pi·storage.fork(ForkOptions)（同一套抽象）
- **取什么 / 别抄什么**：取"同一套抽象（复用 E5 的 SessionStore.fork 不新建第二套）+ 谱系可查 + 未知边界拒绝"三行为；不抄 ADR 的 Electron 面与我方已有的 wire 命令
- **要产出**：①`src/session/fork-tree.ts`——`ForkTree`（parent→children 谱系：从流内 session/fork 事件重建——E5 已落 fork 事件；`treeOf(sessionId)`/`childrenOf(parentId)`/`rootOf()` 纯读面）；②**未知边界不创建**：fork 目标/源会话不存在时类型化拒绝（UNKNOWN_HOST_SESSION 同款——不静默新建）；③**#22 立案候选**：session/fork 载荷扩展 `depth?: number`（树深度——载荷扩展计数不变）或 log-only `session/tree` 事件——执行时定形立案
- **验收**：`npx vitest run src/session/fork-tree.test.ts src/session/store.test.ts`（扩）——三层树重建 + 未知边界拒绝 + 同一抽象断言（fork-tree 只读 store 流不另建表）
- **依赖**：T-P2-105（查询面提供树的可视化消费）
- **风险 / 未知**：跨库 fork（归档会话作源）——归档源拒绝（fail-closed）记档
- **完成记录**：2026-09-28。产出：①`src/session/fork-tree.ts`——`ForkTree`（`fromStreams` 纯函数重建 + `fromStore` 读 store 内存序）+ 只读面 `treeOf`（{sessionId, root, ancestors, depth, children, descendants}）/`childrenOf`/`rootOf`/`roots`/`danglingParents`；**同一抽象**（不写第二套 fork：谱系全部从 E5 `store.fork` 写的 `session/fork` 事件重建，零建表零落流，源码证伪断言在测试）+ **未知边界两种拒绝**（读取面对未知会话 id 类型化 `ForkTreeError UNKNOWN_SESSION`——绝不静默空树/凭空建节点；数据面悬空父（父不在已知集，如已归档）不造父节点——子作新根 + `danglingParents()` 如实记录；动作面 fork 的源/目标拒绝由 E5 store.fork 既有类型化错误承载，本模块不复制）。②`SessionStore.sessionIds()`（内存序键集只读快照——fromStore 的输入面）。**关键发现（执行中实测）**：E5 的 fork 把源流前缀整段复制进子流——被 fork 出来的会话，其血统标记会随前缀落进孙代的流**中段**；本会话自己的标记=流内**最后**一条 `session/fork`（测试实测 leaf 流两枚标记 [parent=root, parent=mid] 顺序；`find`（取首）会把祖父误读成父——树深当场错，`findLast` 语义已钉死并在三层树用例复证）。测试 `src/session/fork-tree.test.ts` 6 用例：三层树重建（深度/祖先链/子孙/根/childrenOf 全谱系 + 多标记取最后复证）/ 未知边界三路类型化拒绝 / 悬空父不造节点（子作新根 + dangling 如实 + childrenOf 未知仍拒绝）/ 同一抽象（E5 fork 产出即树事实 + 重建前后流逐字节不变 + 源码零 db/archive/建表/E5 拒绝面复制）/ fromStreams 输入零改动 / 空流单会话边界；`src/session/store.test.ts` 扩 1 用例（sessionIds 随 append/fork/restore 更新）。**验收**：`npx vitest run src/session/fork-tree.test.ts src/session/store.test.ts` → **18 passed**；`npx tsc --noEmit` 干净。**#22 定形结论（E6 谱系）**：**零词汇表扩展**——`session/fork` 载荷**不加 `depth`**、不落 `session/tree` 事件：深度是**派生事实**（沿 parentSessionId 链一步算出），落进载荷即冗余缓存（与流内事实可能漂移，违反"状态是投影、事实在流"的单向纪律）；`session/tree` 事件无新增事实（谱系已由 fork 事件完整承载）。EVENT_TYPES 27 基线不变。**记档**：①跨库 fork（归档会话作源）——归档从主库移出后不在 store 内存序，store.fork 的源要求在内存序中（FORK_SOURCE_MISSING fail-closed 是结构性保证）；从归档档恢复谱系可喂 `fromStreams(readArchivedSession().events)`，卡内未接线记档；②15c H6 子代理后端是 E6 树的第一消费方（子会话谱系）；Q2 查询面是其可视化消费（T-P2-105 依赖兑现）。

#### T-P2-107 · E9 · 会话可被其他会话引用 `[x]`
- **依据需求**：E9（"会话可被其他会话引用"）
- **上游首选参考**：dsh·session-reference（引用即上下文带入的行为）
- **取什么 / 别抄什么**：取"引用是流内事实 + 读取时注入内容（流存引用不存内容——P1 附件同款纪律）"两行为；不抄其独立 context 包结构（单域目录足够）
- **要产出**：`src/session/reference.ts`——`SessionRef {sessionId, upToSeq?}` + prompt 携带引用面（agent-protocol prompt 载荷扩展 `sessionRefs?`——wire 形状扩展先例）+ 投影消费：buildChatMessages 注入引用会话的摘要/transcript 头（upToSeq 视窗——**引用不展开全量**，摘要 + 头部 N 条）；引用环检测（A 引 B、B 引 A 拒绝）
- **验收**：`npx vitest run src/session/reference.test.ts src/session/messages.test.ts`（扩）——引用注入 + 环拒绝 + upToSeq 视窗 + 流内引用事实断言（载荷无内容字节）
- **依赖**：T-P2-106（树谱系提供引用合法性：不能引用自己的祖先环）
- **风险 / 未知**：引用的 token 预算（摘要长度上限常量——卡内定形）；词汇表：prompt 载荷扩展非事件（wire 先例）
- **完成记录**：2026-09-28。产出：①`src/session/reference.ts`——`SessionRef {sessionId, upToSeq?}`（**type 别名而非 interface**：TS interface 无隐式索引签名，会破坏 wire 层 `Exclude<AgentRequest, JsonValue>` 型证——实测踩到并记档，AttachmentRef 同款形式纪律）+ `validateSessionRefs`（形状/上限 **≤3**（dsh maxReferences 同值）/去重（同 id 留首现）/坏形状 fail-closed）+ `assertNoReferenceCycle`（创建时环检测：BFS 引用传递闭包，触达源即 REFERENCE_CYCLE；自引拒绝；读不到的会话视作无引用——单会话内存模型的已知边界记档）+ `refsOfEvents`（流→引用列表读取原语）+ `buildReferenceExcerpt`（**有界快照**：视窗 seq ≤ upToSeq / 最新已结算压缩摘要优先（started/failed 不作数——E17 同口径）/ 头部 `MAX_REF_HEAD_EVENTS=20` 条 user+assistant / 总字符预算 `MAX_REF_CHARS=4000` 截断带标记 / **固定不可信背景警示**（dsh"untrusted model context"纪律——场景⑦外部输入当数据不当指令的引用面兑现））。②**流存引用不存内容**：`UserMessageEvent.sessionRefs?` 载荷扩展（events.ts + project.ts 形状校验；事件计数 27 不变）+ wire 扩展（agent-protocol prompt `sessionRefs?` 校验 + 剥空键）+ queue `enqueue(content, attachments, sessionRefs)` + loop `runTurn(prompt, attachments, sessionRefs)`（首条与 steer 注入口都在）+ agent-process 编排面（wire 校验后**环检测 fail-closed**：类型化 error 行 `REFERENCE_CYCLE`/`REFERENCE_TOO_MANY`，拒绝在收执之前不留残迹）。③**读取时注入**：`buildChatMessages` 新增 `resolveSessionRef` 注入位（纯函数保持；快照文本追加 content 之后）+ loop.buildMessages 接线（resolver = store.load → buildReferenceExcerpt；读不到不注入）。测试：`src/session/reference.test.ts` 6 用例（形状/上限/去重/坏形状 / 环检测四态（间接环、直接环、自引、读不到边界）/ 快照视窗+头部上限+摘要优先+警示 / 字符预算截断 / **流存引用不存内容**（引用方流零被引内容字节 + 快照现算可含）/ refsOfEvents 聚合去重）；`src/session/messages.test.ts` 扩 4 用例（注入追加 / 缺省与 null 零变化 / 多引用按序与空串不落 / 事件载荷零内容）；`src/kernel/agent-protocol.test.ts` 扩（wire 形状合法解析/去重/空数组剥键/四类坏形状拒绝）。**验收**：`npx vitest run src/session/reference.test.ts src/session/messages.test.ts` → **14 passed**；关联 `src/kernel/agent-protocol.test.ts` → 27 passed（3 文件合计）；全量 `npx vitest run` → **1336 passed / 1 skipped**（1293 → 净增 43）；`npx tsc --noEmit` 干净。**记档**：①正文内联 mention 语法（dsh 的 `@[label]` + `dsh-session:` URI 形态）不取——引用由 wire/宿主显式给出（YAGNI；CLI 文本语法随需要）；②跨库（被引会话仅在 DB、不在内存序）不注入（resolver 读 store 内存序；从库读的 resolver 随需要——Q2 面已有读取原语）；③引用目标未知（sessionId 不存在）不注入快照（返回 null——引用是弱事实，不阻塞轮；环检测才 fail-closed）；④`upToSeq` 缺省 = 引用方可见的最新（捕获点语义——快照读取时现算，非捕获时冻结）。

#### T-P2-108 · 收口 · 15a 盘点 + 快照 `[x]`
- **依据需求**：批次 15a 收口（照批次 4~14 先例）
- **要产出**：盘点面：①Q6/Q4/Q8 保留-清理-归档三件策略一致性（同一 RETENTION_POLICY 消费链）；②M4 内存回收 × Q4 存储清理分域（内存态 vs 磁盘态）；③Q2 SQL 检索 × 流轻量纪律（查询是读面不落流）；④E6 树 × E5 fork 同一抽象断言；⑤E9 引用 × 流存引用不存内容；⑥#22 立案状态复核；⑦快照即规格：fork 树三层重建 + 未知边界拒绝一条
- **验收**：`npx vitest run`（全量）+ 工具链四件 + license-audit
- **依赖**：T-P2-101 ~ 107 全部
- **风险 / 未知**：无
- **完成记录**：2026-09-28。**盘点七面（零真冲突）**：①**Q6/Q4/Q8 三件策略一致性**——同一 `RETENTION_POLICY`（90 天/100 条）单一来源：Q4 清理器只从 retention.ts 取数（`resolveRetentionPolicy` 覆盖 + `retentionCutoff` 判据），清理动作里无裸数值；归档动作唯一入口 = Q8 `archiveSession`（Q4 只调它不自己搬数据）；清理的"会话候选"从 `session_index.updated_ts` 判龄、归档后账本行使其不再候选（幂等复核在 cleanup.test 用例三）。②**M4 × Q4 分域**——M4 只清**内存态**（IdleReaper dispose + registry 摘除，模块零碰盘，reaper.test 用例五钉"存储面逐字节不变且零新增"）；Q4 只清**磁盘态**（审计/任务运行表行 + 归档搬运，零碰 registry）；两者互不调用、无共享状态（唯一交点：Q6 数值面——M4 的 30 分钟阈值是独立常量，非保留策略，记档避免误并）。③**Q2 检索 × 流轻量纪律**——query.ts 只 SELECT（从不 load/readAll 全量、零 INSERT/UPDATE 事件表）；工具化 exec 零落流（builtin.test 往返用例断言被查会话零变化 + 工具自身不产事件）；检索列索引形态机内化（EXPLAIN 断言前缀走主键索引）。④**E6 树 × E5 fork 同一抽象**——fork-tree 零第二套 fork（源码证伪：不 import db/archive、无建表、无 ForkOptions 复制）；血统唯一来源 = E5 写的 `session/fork` 事件；关键细节（子流内多标记取最后一条）已实测钉死（三层树用例）。⑤**E9 引用 × 流存引用不存内容**——user/message 载荷只有 `{sessionId, upToSeq?}` 指针（reference.test 断言引用方流零被引内容字节；messages.test 断言注入纯属投影行为）；快照读取时现算且有界（20 条/4000 字符/不可信警示）。⑥**#22 立案状态复核**——#22 已用于 `session/archive`（词汇表 26→27，events.test/replay.test 计数 27 同步，l0-events.md §8 落地记录 22 + §3.2 行 27 在案）；E6/M4 两处候选**零扩展定形**（E6 深度是派生事实不加 depth/不落 session/tree；M4 回收是进程内运行时事实走 onReap 回调——jobs.ts 同款"进程内事实不进词汇表"纪律），EVENT_TYPES 27 基线复核在位；E9 载荷扩展（sessionRefs）计数不变。⑦**快照即规格**——新增 `src/session/lifecycle.snapshot.test.ts`：fork 三层树（E6）→ 引用注入与环拒绝（E9）→ SQL 检索（Q2）→ 归档与 fail-closed 读面（Q8）→ 清理候选 dry-run（Q4）一条链，钉卡与卡的接缝（归档后检索面 `archivedSessions` 明示"已归档"而内存树仍按流事实可读）。**验收**：全量 `npx vitest run` → **1337 passed / 1 skipped**（154 文件；批次入口基线 1293 → 净增 44）；`npx tsc --noEmit` 干净；`architecture:check` 0 error / 21 warning（基线保持）；`vocabulary:check` 0 问题；`count-features.sh` = **337（层数 20；P2=48）不变**；`check-doc-links.sh`（显式传参 11 文件）**829 链接 0 失效**；`license-audit.sh` exit 0（LEAK 未命中 / SOURCEMAP 无）。**人工确认清单**：本批无新增（全部验收机可验——本批为本地库/内存面，无真实端点或平台联调项）。**记档**：批次报告与 15b 提示词已写入 `plan-p2-progress.md`。

## §4 批次 15b 卡序（4 张：C40/C55/C42 + 收口；2026-09-28 展卡）

**锚点纪律**：3 条锚点以 P2 研究核对为底，本批抽核 qwen·classifier.ts 与 codex·execpolicy（全部命中）。零勘误。

**展卡核对结论**：
1. **C42 是 P2 权限链的架构大件**：qwen classifier 两阶段（Stage1 fast path 低 token 快判 → Stage2 review 修正假阳性）——我方落"判官是 provider 消费方"（J3 配置面复用——判官用的模型独立配置）；**fail-closed 且带 unavailable 标记**（判官不可用 ≠ 拒绝＝fail-closed 到人——C56 接口面的 abstain 槽位兑现）；**abort 不算失败**（用户取消判官流程 ≠ 判官错误）；**超时预算刻意宽松并写明理由**（判官是贵路径——预算注释写明）。
2. **C40 具名参数匹配先行**：`Agent(model:opus)` 形态的 toolParamMatchers——规则匹配面的扩展（C 族规则结构扩展，非事件）；是 C42 的前置（判官输入包含参数上下文）。
3. **C55 拒绝纪律**：justification 必填 + forbidden 拒绝给替代做法——拒绝消息的结构化面（拒绝面消息形状，policy 域内）。
4. **C56 状态核对**：批次 9 已落四件接口面（abstain 落回人/判官预算/超时常量/受管可强制）——C42 是判官本体的兑现卡（接口已在，落实现）。

**词汇表预判**：C42 判官裁决是审批面扩展（C31 三事实已有——判官裁决走 approval 面 source 标记，无新事件预判）；C40 规则结构扩展非事件。零新事件候选。

#### T-P2-201 · C40 · 规则可匹配具名参数（toolParamMatchers） `[ ]`
- **依据需求**：C40（"规则可匹配具名参数（如 `Agent(model:opus)`）；`toolParamMatchers`"）
- **上游首选参考**：qwen·permissions（toolParamMatchers 的规则结构与匹配语义）
- **取什么 / 别抄什么**：取"具名参数匹配器挂在规则上 + 参数名/值两维匹配 + 通配"行为；不抄其规则 DSL 解析器（我方 C 族规则结构已有——声明性扩展）
- **要产出**：policy 域规则结构 + `paramMatchers?: {name, value|pattern}[]`（声明性扩展——既有规则零变化）+ 匹配面（gate 层工具参数上下文喂入 + 全 matcher 与语义）；linter 面（C23 的 never-match 检查覆盖参数 matcher——参数名不存在警告）
- **验收**：`npx vitest run src/policy/`（扩）——精确值/通配/多参数 AND/无 matcher 零变化四用例 + linter 警告
- **依赖**：无（本批首卡）
- **风险 / 未知**：参数嵌套路径（`args.model.id` 深路径）——平面参数名即达验收（深路径 YAGNI 记档）

#### T-P2-202 · C55 · 拒绝面纪律（justification 必填 + forbidden 给替代做法） `[ ]`
- **依据需求**：C55（"`justification` 必填；`forbidden` 须给替代做法；拒绝要能告诉用户怎么办"）
- **上游首选参考**：codex·execpolicy（拒绝结构化 + 替代建议的行为）
- **取什么 / 别抄什么**：取"拒绝是结构化对象（原因 + 替代做法）而非裸字符串"行为；不抄其 Rust 策略引擎
- **要产出**：policy 域拒绝面——`DenialShape {reason, justification?: string, alternatives?: string[]}`（forbidden 类规则**必须**带 alternatives——linter 强制）+ 规则声明扩展（forbidden 规则的 alternatives 字段）+ gate 拒绝消息渲染（用户可见"怎么办"）
- **验收**：`npx vitest run src/policy/`（扩）——forbidden 无 alternatives 被 linter 拒绝 + 渲染面 + 既有拒绝零变化
- **依赖**：T-P2-201（同批规则面）
- **风险 / 未知**：无

#### T-P2-203 · C42 · 两阶段 LLM 判官（fail-closed + unavailable 标记） `[ ]`
- **依据需求**：C42（"两阶段 LLM 判官（贵路径修正便宜路径的假阳性）；fail-closed 且带 `unavailable` 标记；abort 不算失败；超时预算刻意宽松并写明理由"）
- **上游首选参考**：qwen·classifier.ts（Stage1 fast 32 token → Stage2 review 两阶段 + fail-closed 行为）
- **取什么 / 别抄什么**：取两阶段结构（便宜路径先判、贵路径复核假阳性）+ fail-closed 语义（判官不可用→落回人，带 unavailable 标记）+ abort≠失败 三行为；不抄其 prompt 模板内容（我方判官 prompt 卡内定形）与其 SDK 形态（我方 provider 消费）
- **要产出**：①`src/policy/judge.ts`——`LlmJudge`（provider 消费方：J3 配置面独立 judge 段；Stage1 快判 → 置信不足/边界 → Stage2 复核；输出三值 allow/deny/abstain + unavailable 标记）；②C56 接口兑现（abstain 落回人——PendingApprovals 面；判官自身预算——C56 的 budget 槽）；③超时常量（宽松——注释写明理由：判官是贵路径，误杀比慢更贵）；④abort 语义（用户取消 → abstain 非失败——不触发熔断/不计错误）；⑤判官调用落审计（L2 面——judge 决策可追溯）
- **验收**：`npx vitest run src/policy/judge.test.ts`（扩）——两阶段路由（快判置信直出/边界进复核）+ unavailable fail-closed 到人 + abort ≠ 失败（不计熔断）+ 超时宽松常量断言 + mock provider 全链
- **依赖**：T-P2-201/202（参数上下文 + 拒绝纪律）；C56 接口面（批次 9 已落）
- **风险 / 未知**：判官 prompt 质量（人工面——机验钉结构不钉语义）；判官模型配置缺省（无 judge 段 = 判官不可用 fail-closed 到人——可降级运行）

#### T-P2-204 · 收口 · 15b 盘点 + 快照 `[ ]`
- **依据需求**：批次 15b 收口
- **要产出**：盘点面：①C42 判官 × 权限链既有三值裁决（allow/deny/abstain）零冲突（判官只是 abstain→allow/deny 的修正路径）；②C40 参数匹配 × C17 JsonValue 校验（匹配在校验后）；③C55 × 既有拒绝面零破坏；④快照即规格：两阶段判官全链一条（规则不匹配 → 判官 → abstain → 落回人）
- **验收**：`npx vitest run`（全量）+ 工具链四件
- **依赖**：T-P2-201 ~ 203
- **风险 / 未知**：无

## §5 批次 15c 卡序（11 张：M7/I5/I4/I7/I8/I10/I11/I14/H6/D12 十条 + 收口；2026-09-28 展卡）

**锚点纪律**：10 条锚点以 P2 研究核对为底，本批抽核 pi-desktop·plugin-websocket.ts 与 dsh·subagent 包目录（全部命中）。零勘误。

**展卡核对结论**：
1. **M7 deadline 库是横切底座先行**：dsh·util/timeout 的行为 = 超时/截止集中一处（各工具不再各写超时）——我方现状盘点：M6/J23（批次 7）已落三种超时语义（总时长/空闲/可重臂）在工具执行层，B18 参数合并——M7 的增量 = 把分散的 deadline 概念收敛成共享原语（deadline token + 剩余时间查询），供 15d 的 S2 webhook / M11 闲时复用。
2. **I5 SDK → I4 进程外插件的依赖序**：SDK 是插件作者面（manifest + 生命周期接口——P1 的 plugin-manifest 已有地基），I4 是传输面（websocket 进程外——K3/K4 遗留生产化）。SDK 先行（I4 的 ws 插件就是 SDK 的第一个进程外消费方）。
3. **I10 superseded 是词汇表候选**：hook 复核结论被后续复核取代且取代本身持久——zcode session.events 的行为 = 取代事件落流。我方 hook 复核在 approval 面（C31 三事实）——superseded 落 log-only 元事件（#23 立案候选）。
4. **H6 五后端的"可插"最小面**：dsh 六包结构不取——我方取"SubagentBackend 接口 + 进程内 fork 一个实现 + ACP 实现复用 src/acp"（五后端中两个真实落地，其余三个接口留位——CC/Codex/DSH-SDK 无对应锚实现价值，YAGNI 记档）。
5. **D12 SSH 三层**：dsh·packages/ssh 的 fs-ssh/sandbox-ssh/subprocess-ssh 三层 = 执行域抽象的远端实现——我方 ExecutionEnv 接口（批次 4）的 SSH 实现位；凭据环境变量/private 纪律（全局约束 3）。

**词汇表预判（#23 候选）**：I10 superseded log-only 元事件；I4 插件生命周期（plugin/attach 等）若需落流走同一管线。I5/I7/I8/I11/I14/H6/D12 预判零事件。

#### T-P2-301 · M7 · 统一 deadline 库（超时原语集中） `[ ]`
- **依据需求**：M7（"统一 deadline 库；超时逻辑集中，不在各工具里重复实现"）
- **上游首选参考**：dsh·util/timeout/src/index.ts（deadline token + 剩余时间 + 超时组合的行为）
- **取什么 / 别抄什么**：取"deadline 是可查询的共享原语（不是每次 setTimeout）"行为；不抄其包结构（我方单域文件）
- **要产出**：`src/kernel/deadline.ts`——`Deadline`（绝对截止 + `remainingMs()` + `expired()` + `throwIfExpired()` 类型化 TimeoutError）+ `fromTimeoutMs()`/`combine()`（多 deadline 取最近）+ 工具执行层接线（M6 的超时消费 deadline 原语——既有语义零变化）；不做后台定时器（被动查询式——卡内定形）
- **验收**：`npx vitest run src/kernel/deadline.test.ts`——remaining/expired/combine + 工具层回归（M6 既有用例全绿）
- **依赖**：无（本批首卡）
- **风险 / 未知**：无

#### T-P2-302 · I5 · 插件 SDK（第三方可写不碰内核） `[ ]`
- **依据需求**：I5（"插件 SDK；第三方可写插件而不碰内核"）
- **上游首选参考**：opencode·plugin（SDK 表面：钩子注册 + 事件订阅 + 受限能力）
- **取什么 / 别抄什么**：取"SDK = 受限能力面 + 生命周期契约"行为；不抄其 JS API 形状（我方 P1 plugin-manifest 已有——SDK 是其作者面补全）
- **要产出**：`src/mcp/plugin-sdk.ts`——`AegentPlugin` 接口（manifest 声明 + onActivate/onEvent/onDispose 生命周期 + 受限能力 token：工具注册/事件订阅——**无内核句柄暴露**）+ SDK 文档注释（作者视角三段式）+ 加载面校验（manifest 缺字段类型化拒绝——P1 地基复用）
- **验收**：`npx vitest run src/mcp/plugin-sdk.test.ts`——SDK 契约（生命周期序 + 能力受限断言：SDK 对象无内核引用路径）+ 坏 manifest 拒绝
- **依赖**：T-P2-301（deadline 供插件超时）
- **风险 / 未知**：SDK 稳定性承诺（P2 阶段标记 experimental——版本化随需要）

#### T-P2-303 · I4 · 进程外插件（websocket 传输 + 不可信隔离） `[ ]`
- **依据需求**：I4（"进程外插件（websocket）；不可信插件隔离"）
- **上游首选参考**：pi-desktop·plugin-websocket.ts（🔴 只学行为：ws 连接 + 消息协议 + 断线处理）
- **取什么 / 别抄什么**：取"插件宿主外置 + ws 传输 + 断线降级（插件缺席不崩内核）"行为；不抄其 Electron 面；K4 ACP 复用（同款行协议纪律）
- **要产出**：`src/mcp/ws-plugin.ts`——`WsPluginHost`（连接 ws 插件进程：握手复用 host/protocol 的 hello 面 + 插件消息信封 + 断线 → 插件能力注销 + 重连面缺省不做记档）；不可信边界：ws 插件的工具注册走 C 族审批（不受信来源默认deny——策略面消费）；隔离 = 进程外即隔离（无共享内存——沙箱面不做二次加固记档）
- **验收**：`npx vitest run src/mcp/ws-plugin.test.ts`——ws 往返（真实 ws server 内存桥）+ 断线注销 + 工具注册走审批 + 坏信封不崩
- **依赖**：T-P2-302（SDK 契约）
- **风险 / 未知**：ws 插件协议版本化（hello version 复用 PROTOCOL_VERSION）

#### T-P2-304 · I7 · hook 协议兼容既有生态（claude-code / codex 形态） `[ ]`
- **依据需求**：I7（"hook 协议可兼容既有生态；DSH 同时提供 hooks-claude-code 与 hooks-codex"）
- **上游首选参考**：dsh·packages/hooks（兼容层的适配器形态）
- **取什么 / 别抄什么**：取"兼容 = 输入/输出映射层（既有生态 hook 的 stdin/stdout 契约 → 我方 HookRegistry 调用）"行为；不抄 dsh 的双包结构（我方单域双适配器文件）
- **要产出**：`src/mcp/hook-compat.ts`——claude-code hook 适配器（其事件名/JSON 契约 → 我方 hook 调用）+ codex hook 适配器 + 兼容面只读演示（真实生态脚本样本在测试 fixture——不做端到端联调，接口面即验收）；不兼容语义记档（我方审批模型与生态差异点）
- **验收**：`npx vitest run src/mcp/hook-compat.test.ts`——两适配器映射往返 + 未知事件类型化拒绝
- **依赖**：T-P2-302（SDK 面）
- **风险 / 未知**：生态契约的版本漂移（适配器按公开文档钉死 fixture——真实生态联调随需要）

#### T-P2-305 · I8 · 人格 / agent 预设（按会话选预设） `[ ]`
- **依据需求**：I8（"人格 / agent 预设；可按会话选预设"）
- **上游首选参考**：codex·templates/personalities（预设 = 模板文件 + 会话期选择的形态）
- **取什么 / 别抄什么**：取"预设 = 系统提示模板 + 会话期选择"行为；不抄其模板内容（我方预设卡内定形两例）
- **要产出**：`src/session/persona.ts`——`Persona {id, name, systemPromptTemplate}` + 内置两例（default/coder——内容自定）+ 会话期选择面（agent-child --persona 或 config/refresh 消费——J6 换模同款受理点）；落流（system/message 已有——persona 切换落系统消息非新事件）
- **验收**：`npx vitest run src/session/persona.test.ts`——预设选择 + 模板渲染 + 未知预设拒绝 + 落流断言
- **依赖**：无（独立面）
- **风险 / 未知**：预设来源（内置两例起步——文件加载随需要记档）

#### T-P2-306 · I10 · hook 复核 superseded（取代是持久事实） `[ ]`
- **依据需求**：I10（"hook 复核结论可被 superseded，且取代本身是持久事实；复核可被后续复核取代"）
- **上游首选参考**：zcode·session.events.ts（取代事件落流的行为）
- **取什么 / 别抄什么**：取"取代事件是流内事实 + 链式取代（后续可再取代）"行为；不抄其事件 schema（我方词汇表管线）
- **要产出**：**#23 立案**：`approval/superseded {requestId, byRequestId, reason?}` log-only 元事件（审批裁决被后续裁决取代——链式：投影面取最新有效裁决，历史保留）+ 投影消费（activeApprovals 索引更新——C31 三事实的第四面）
- **验收**：`npx vitest run src/policy/audit-fields.test.ts src/session/project.test.ts`（扩）——取代落流 + 链式取代 + 投影最新有效 + 词汇表 26→27 管线全走
- **依赖**：T-P2-302（hook 面）
- **风险 / 未知**：与 approval_settled 的关系（取代 ≠ 撤销——settled 事实仍在流内，superseded 是叠加事实——卡内定形）

#### T-P2-307 · I11 · 治理逻辑可插拔（重复工具提醒/超时策略不在核心硬编码） `[ ]`
- **依据需求**：I11（"治理逻辑（重复工具提醒、超时策略）做成可插拔插件；不在核心里硬编码"）
- **上游首选参考**：dsh·packages/guard（治理规则插件化的形态）
- **取什么 / 别抄什么**：取"治理 = 挂在事件流上的规则插件（可注册/可卸载）"行为；不抄其具体规则内容（我方治理插件卡内定形）
- **要产出**：`src/mcp/guard.ts`——`GuardPlugin` 接口（订阅工具调用事件 + 建议面：提醒/降速/超时建议——**建议非强制**（强制走 C 族策略））+ 内置两例插件（重复工具提醒 / 超时预算建议）+ 注册面（SDK 的 onEvent 消费——I5 契约复用）
- **验收**：`npx vitest run src/mcp/guard.test.ts`——两内置插件触发 + 建议不拦截断言（治理≠策略）+ 卸载后零影响
- **依赖**：T-P2-302/303（SDK + ws 面）
- **风险 / 未知**：无

#### T-P2-308 · I14 · 跨层跳 next.to(e, tier)（托管层直达） `[ ]`
- **依据需求**：I14（"跨层跳 `next.to(e, tier)`；托管层可跳过中间层直达"）
- **上游首选参考**：claude-official·mods/README.md（洋葱链分层直达的语义）
- **取什么 / 别抄什么**：取"链控制对象支持跳层（指定目标层执行后直接回）"行为；🔴 专有仓只学语义零代码摘取
- **要产出**：`src/kernel/chain.ts` 扩展——ChainControl + `to(tier)`（跳过中间层直达目标层——目标层执行后跳过其余层收束；**跳层是显式声明面**：仅白名单层可被跳——安全面：审批层不可跳（C 族不变量——fail-closed 纪律））
- **验收**：`npx vitest run src/kernel/chain.test.ts`（扩）——跳层直达 + 跳层后回程语义 + 审批层不可跳断言 + 既有链零变化
- **依赖**：无（独立小件）
- **风险 / 未知**：跳层的回程语义（目标层后直接收束 vs 继续回程——直接收束，卡内定形）

#### T-P2-309 · H6 · 子代理执行后端可插（接口 + 两实现） `[ ]`
- **依据需求**：H6（"子代理执行后端可插；五种：ACP / CC / Codex / DSH-SDK / 进程内 fork"）
- **上游首选参考**：dsh·subagent-*（后端接口抽象的形态）
- **取什么 / 别抄什么**：取"后端是接口 + 注册表选择"行为；五后端取两（进程内 fork——P0 E5 已有；ACP——批次 12 已有 acp 域）实落，CC/Codex/DSH-SDK 接口留位（无锚实现价值 YAGNI 记档）；不抄其六包结构
- **要产出**：`src/session/subagent-backend.ts`——`SubagentBackend` 接口（spawn 会话 + 事件流 + 结果回收——E5/H2 既有面的抽象提取）+ `InProcessBackend`（E5 fork 复用）+ `AcpBackend`（src/acp 复用）+ 注册表（按名字选择——task 工具的 --backend 参数面）
- **验收**：`npx vitest run src/session/subagent-backend.test.ts src/kernel/tools/builtin.test.ts`（扩）——两后端同语义往返（同一 task 走两后端结果一致形状）+ 未知后端类型化拒绝
- **依赖**：T-P2-106（15a E6 树——子会话谱系）
- **风险 / 未知**：ACP 后端与进程内后端的事件流形状差异（抽象面收敛——事件词汇同源断言）

#### T-P2-310 · D12 · SSH 远程执行后端（三层） `[ ]`
- **依据需求**：D12（"SSH 远程执行后端；fs-ssh / sandbox-ssh / subprocess-ssh 三层"）
- **上游首选参考**：dsh·packages/ssh（三层的执行域抽象）
- **取什么 / 别抄什么**：取"执行域三面（文件/沙箱/子进程）都有远端实现位"的抽象；不抄其实现（SSH 客户端我方用 node:ssh? 无内置——**依赖决策**：ssh2 包（零传递依赖候选）或 ssh 命令行子进程包装——卡内定形：**命令行 ssh 子进程包装**（零新依赖，凭据走系统 ssh-agent 红线友好））
- **要产出**：`src/sandbox/ssh-backend.ts`——`SshExecutionEnv implements ExecutionEnv`（execFile ssh 远端命令——批次 4 ExecutionEnv 接口的第二个实现）+ fs-ssh 面（文件操作经 ssh 命令——读写受限只读演示）+ 连接失败类型化拒绝；凭据零落盘（系统 ssh 配置——红线）
- **验收**：`npx vitest run src/sandbox/ssh-backend.test.ts`——ssh 命令包装（本地 loopback sshd 或 mock 进程——**无真实 sshd 时用命令注入 mock**）+ 三层接口断言 + 失败类型化；真实 sshd 联调列人工确认
- **依赖**：T-P2-301（deadline）
- **风险 / 未知**：无真实 sshd 的测试环境（mock 面 + 人工确认清单）；Windows ssh 可用性（OpenSSH client 系统自带）

#### T-P2-311 · 收口 · 15c 盘点 + 快照 `[ ]`
- **依据需求**：批次 15c 收口
- **要产出**：盘点面：①M7 deadline × M6/J23 既有超时语义（原语收敛零行为变化）；②I5 SDK 能力受限 × 内核句柄不外泄断言；③I4 ws 插件不可信边界 × C 族审批（不受信来源默认 deny）；④I10 superseded × approval_settled 叠加事实（取代≠撤销）；⑤H6 两后端同语义（事件词汇同源断言——acp 面 × 进程内面）；⑥D12 SSH × ExecutionEnv 接口（第二实现零接口变化）+ 凭据零落盘；⑦快照即规格：ws 插件注册工具走审批全链一条
- **验收**：`npx vitest run`（全量）+ 工具链四件 + license-audit
- **依赖**：T-P2-301 ~ 310 全部
- **风险 / 未知**：无

## §6 批次 15d 卡序（11 张：S1/M11/S2/S5/N5/P4/S3/S4/K9/K6+K7 十条一卡承载 + 收口；2026-09-28 展卡）

**锚点纪律**：11 条锚点以 P2 研究核对为底（N5 自研无锚——需求明示），本批抽核 zcode·offPeakDispatchSettlement.ts 与 codex·computer_use_config.rs（全部命中）。零勘误。

**展卡核对结论**：
1. **M1/M2 job 底座已落**（批次 10）——S1 定时/M11 闲时/S2 webhook 是其三个消费方：S1 = cron 触发的 job 派发；M11 = job 取号 + 闲时窗口核销（zcode offPeak 的行为：取号 → 窗口判定 → 核销 → 不重复执行）；S2 = webhook 入站 → fire-and-forget 会话。
2. **S4 计算机使用是风险最高件**（需求原文）——最强审批 = 每次操作显式审批（C 族 fail-closed + 不进 unattended）；K9 画中画是其 UI 面（用户看得见 agent 在操作什么——zcode cuaPipSession 行为：浮动窗口显示操作）。
3. **N5 推送自研**（无锚）：我方 host 域已是推送模型（WS event 流——批次 14）——N5 的增量 = 状态变更的分类推送面（会话状态/审批挂起/任务完成的通知分型——deliveryKind push 已有，落通知载荷形状）。
4. **K6/K7 IM 端**：场景③ 的 IM 端 = 审批经 IM 应答（bridge 审批广播的远端消费）——pideck FeishuBridge / opencode slack 的行为 = webhook 入站 + 消息格式化 + 审批应答回传；两者同构（一张卡承载两 IM——适配器分文件）。webhook 凭据红线（全局约束 3）。
5. **P4 语音转文字**：dsh api-speech-to-text 是"非必需"标注——我方最小面：附件域扩展（audio mediaType + STT provider 调用 → 文本落流）；STT 端点复用 OpenAI 协议（audio/transcriptions——真实端点联调随用户供给）。

**词汇表预判（#24 候选）**：M11 闲时核销——`job/offer {jobId, window}` log-only 候选；S1 定时触发——调度事实走 command/run 已有面预判零扩展；N5 通知分型——wire 载荷非事件。执行时逐条立案。

#### T-P2-401 · S1 · 定时任务（cron/星期定义，复用 job 调度器） `[ ]`
- **依据需求**：S1（"可按 cron/星期定义；与 M 层 job 复用调度器"）
- **上游首选参考**：codex·ScheduledTaskWeekday.ts + kimi·cron-store.ts（cron/星期 schema + 持久存储的形态）
- **取什么 / 别抄什么**：取"调度定义持久化 + 到期派发 job"行为；不抄其前端 schema 生成（我方 TS 直接定义）
- **要产出**：`src/scheduler/cron.ts`——`CronSpec`（五字段 cron + 星期枚举——解析器自写最小面 node 零依赖，工具坑：与 CronCreate 语义一致不复刻其全部）+ `CronStore`（持久化——sqlite 同款表）+ 到期检查（被动轮询——host server 面消费）+ 到期 → M1/M2 job 派发（底座复用）
- **验收**：`npx vitest run src/scheduler/cron.test.ts`——cron 解析（对齐表驱动用例）+ 星期面 + 到期派发 + 持久往返
- **依赖**：M1/M2（批次 10 已落）
- **风险 / 未知**：cron 解析器自写的边界（最小面：分/时/日/月/星期 + `*` 与列表与步进——区间语法 YAGNI 记档）

#### T-P2-402 · M11 · 闲时任务（取号 + 闲时窗口核销，不重复执行） `[ ]`
- **依据需求**：M11（"长任务取号、闲时窗口核销执行（择时省钱）；闲时窗口核销，不重复执行"）
- **上游首选参考**：zcode·offPeakDispatchSettlement.ts（取号 → 窗口判定 → 核销 → 幂等的行为）
- **取什么 / 别抄什么**：取"取号（ticket）→ 闲时窗口判定 → 核销（settle）→ 不重复"四步行为；不抄其桌面端集成（我方 host 面消费）
- **要产出**：`src/scheduler/offpeak.ts`——`OffPeakQueue`（job 带 `offPeak: true` 入闲时队列 + ticket 取号）+ 窗口判定面（`isOffPeakWindow(now, config)`——时段配置 + 时区 Asia/Shanghai 默认）+ 核销（执行后标记 settled——重放不重复执行）+ **#24 立案候选**：核销事实落流
- **验收**：`npx vitest run src/scheduler/offpeak.test.ts`——取号/窗口/核销/幂等四用例 + 时区边界
- **依赖**：T-P2-401（同批调度面）
- **风险 / 未知**：闲时窗口的"闲"判定（时段配置式而非负载探测式——卡内定形，负载探测 YAGNI）

#### T-P2-403 · S2 · webhook 触发会话（fire-and-forget） `[ ]`
- **依据需求**：S2（"webhook 触发会话；fire-and-forget 型会话（如 GitHub 事件）"）
- **上游首选参考**：dsh·packages/webhook（入站接收 → 会话派发的行为）
- **取什么 / 别抄什么**：取"HTTP 入站端点 → 校验（签名/密钥）→ fire-and-forget 会话派发"行为；不抄其具体 webhook 生态适配（GitHub 等——payload 透传最小面）
- **要产出**：`src/scheduler/webhook.ts`——`WebhookEndpoint`（HTTP POST 入站——host server 同端口 /webhook/<token> 路径 token 鉴权）+ 签名校验（HMAC 可配）+ fire-and-forget 派发（job 底座——不阻塞响应 202）+ payload 大小上限防呆
- **验收**：`npx vitest run src/scheduler/webhook.test.ts`——入站派发 + token/HMAC 鉴权拒绝 + 202 fire-and-forget + 上限防呆
- **依赖**：T-P2-401（job 底座消费同款）
- **风险 / 未知**：入站面与 K5 静态托管的端口共存（路径分型——/webhook/* 归 webhook）

#### T-P2-404 · S5 · 反馈上报（消息/命令反馈 + doctor 随报） `[ ]`
- **依据需求**：S5（"用户可对消息/命令反馈；doctor 报告随反馈一起报"）
- **上游首选参考**：codex·feedback_processor.rs（反馈的结构化面 + 诊断随报）
- **取什么 / 别抄什么**：取"反馈是结构化事实（关联消息/命令 + 类型）+ doctor 报告可随附"行为；不抄其上报远端（我方本地落流——无遥测外发，红线）
- **要产出**：`src/obs/feedback.ts`——`FeedbackRecord {targetSeq|commandId, kind: up|down, comment?}` + CLI /feedback 命令 + doctor 报告随附（doctor.ts 已有——附上最近健康/诊断摘要）+ 落流（log-only `feedback/note` **#24 立案候选**——用户反馈是会话事实）
- **验收**：`npx vitest run src/obs/feedback.test.ts`——反馈落流 + 关联校验（targetSeq 存在）+ doctor 随附
- **依赖**：无（独立面）
- **风险 / 未知**：无

#### T-P2-405 · N5 · 推送（状态变更分类推送到端） `[ ]`
- **依据需求**：N5（"状态变更可推送到端"；自研无锚点）
- **上游首选参考**：自研（需求明示）——行为参照我方 host 域既有 broadcast 面
- **取什么 / 别抄什么**：——
- **要产出**：`src/host/notify.ts`——通知分型闭集（approval_pending / turn_settled / job_settled / surface_changed 四类）+ `NotificationPayload` 形状 + HostBridge 广播面扩展（notification 信封的 name 归类——既有审批广播复用）+ deliveryKind poll 端的游标补投（poll 语义兑现——lease.ts 的 poll 分型消费）
- **验收**：`npx vitest run src/host/notify.test.ts`——四类分型推送 + poll 端游标补投 + push 端零变化
- **依赖**：T-P2-402/403（job 面的分类源）
- **风险 / 未知**：poll 补投的游标存续（连接级内存——重连走 query 恢复复用）

#### T-P2-406 · P4 · 语音转文字（附件域 STT 扩展） `[ ]`
- **依据需求**：P4（"语音转文字；非必需"）
- **上游首选参考**：dsh·api-speech-to-text（STT provider 调用 + 文本落流的行为）
- **取什么 / 别抄什么**：取"音频 → STT → 文本进上下文"链路；不抄其实验包结构（附件域扩展最小面）
- **要产出**：附件域扩展——mediaType 白名单 + audio/mp4|wav|webm 三类（limits.ts 扩展）+ `src/attachments/stt.ts`（STT 调用面：OpenAI 协议 audio/transcriptions——provider 复用）+ 落流（转写文本作为 user/message 附件投影的文本面——流存音频引用 + 转写文本）
- **验收**：`npx vitest run src/attachments/`（扩）——类型白名单 + STT mock 往返 + 投影文本断言；真实端点联调列人工确认（随用户供给 STT 端点）
- **依赖**：P1 附件域（批次 13 已落）
- **风险 / 未知**：STT 端点无实测（mock 面 + 人工确认）；"非必需"标注——规模最小化

#### T-P2-407 · S3 · 浏览器使用（单独沙箱与网络策略） `[ ]`
- **依据需求**：S3（"浏览器使用；需单独沙箱与网络策略（含 NOTICE）"）
- **上游首选参考**：qwen·packages/browser-use（浏览器工具面 + 沙箱策略的形态）
- **取什么 / 别抄什么**：取"浏览器是工具族 + 独立网络策略 + 风险标注（NOTICE）"行为；不抄其 CDP 实现细节（我方最小面：CDP 经 playwright-core? 无——**决策：http 请求级浏览器面（fetch 工具扩展）不做真浏览器**？"浏览器使用"验收要浏览器——最小面：CDP over ws（node 原生 ws 客户端复用——Chrome/Edge 系统自带 --remote-debugging-port））
- **要产出**：`src/scheduler/browser.ts`——`BrowserTool`（CDP ws 连接系统浏览器：navigate/screenshot/extract 三工具）+ 网络策略联动（D3 已有——浏览器进程的域白名单策略面）+ NOTICE 风险标注（工具描述与审批面）+ 审批：每次 navigate 显式审批（C 族）
- **验收**：`npx vitest run src/scheduler/browser.test.ts`——CDP mock 往返 + 三工具 schema + 审批联动；真实浏览器联调列人工确认
- **依赖**：T-P2-301（deadline——页面超时）
- **风险 / 未知**：CDP 协议面大（三工具最小面——截图/抽取的真实渲染随人工确认）；系统浏览器依赖

#### T-P2-408 · S4 · 计算机使用（屏幕/输入控制，最强审批） `[ ]`
- **依据需求**：S4（"屏幕/输入控制；风险最高，需最强审批"）
- **上游首选参考**：codex·computer_use_config.rs（配置面 + 审批强度的行为）
- **取什么 / 别抄什么**：取"配置面 + 操作审批最强档"行为；不抄其 Rust 协议 schema；🔴 操作执行面（屏幕捕获/注入）Windows 专属——与批次 3/4 的 Windows 沙箱纪律一致：**Rust 子进程**（T9 语言边界即进程边界——src/sandbox/win32-helper 扩展）
- **要产出**：`src/scheduler/computer.ts`——`ComputerTool`（screenshot/click/type/key 四操作——win32-helper 的 Rust 面扩展 + TS 工具包装）+ **最强审批**：每操作显式审批（C 族 forced-approval 级——unattended 恒拒）+ 操作审计全落流（L2 面）
- **验收**：`npx vitest run src/scheduler/computer.test.ts`——四操作 schema + 强制审批断言（无审批不执行）+ Rust 面 mock（helper 存根）；真实屏幕操作列人工确认（Windows 会话环境依赖）
- **依赖**：T-P2-407（浏览器面先行——同为操作类）
- **风险 / 未知**：Rust helper 扩展量（屏幕注入 API 面——Windows 会话隔离环境的真实可用性人工确认）；K9 前置

#### T-P2-409 · K9 · 画中画（agent 屏幕操作浮动窗口显示） `[ ]`
- **依据需求**：K9（"把 agent 的屏幕操作显示在浮动窗口；用户看得见 agent 在操作什么"）
- **上游首选参考**：zcode·cuaPipSession.ts（🔴 只学行为：PiP 会话窗口 + 操作回显）
- **取什么 / 别抄什么**：取"操作可视化 = 屏幕截图流 + 浮动窗"行为；不抄其桌面服务集成（我方 Tauri 壳面）
- **要产出**：ui/ 扩展——PiP 面板（computer 操作的事件流渲染：操作截图 + 动作标注——S4 操作审计的消费端）+ Tauri 壳的 PiP 窗口（第二窗口小尺寸 always-on-top——tauri.conf windows 数组扩展）+ 通知联动（N5 computer_operation 分型）
- **验收**：`npx vitest run src/diagnostics/tauri-shell.test.ts`（扩——双窗口形状）+ ui 资产面板断言；视觉面人工确认
- **依赖**：T-P2-408（S4 操作流）
- **风险 / 未知**：Tauri 双窗口最小面（conf 声明即可达——交互随人工确认）

#### T-P2-410 · K6+K7 · 飞书与 Slack 端（场景③ IM 端，一卡两适配器） `[ ]`
- **依据需求**：K6（"飞书；场景③ 的 IM 端"）+ K7（"Slack；有现成参考"）——一卡承载（同构适配器两份，锚点行为一致）
- **上游首选参考**：pideck·FeishuBridge.ts + opencode·packages/slack（webhook 入站 + 消息格式化 + 审批应答回传的同构行为）
- **取什么 / 别抄什么**：取"IM = webhook 入站 + 事件流格式化出站 + 审批卡片应答"三行为；不抄其平台 SDK 依赖（HTTP API 直调——fetch 零依赖）；凭据环境变量（全局约束 3）
- **要产出**：`src/host/im-feishu.ts` + `src/host/im-slack.ts`——同构 `ImSurface` 接口两实现（入站：消息 → prompt 派发；出站：事件流摘要 → IM 消息；审批：挂起卡片 → 应答回传 approve——replySource "feishu"/"slack" **#25 立案候选**：APPROVAL_SURFACES 追加）+ N5 通知分型消费
- **验收**：`npx vitest run src/host/im-feishu.test.ts src/host/im-slack.test.ts`——mock HTTP 往返（两端点各一）+ 审批应答链 + 凭据缺省跳过（未配置不激活）；真实平台联调列人工确认
- **依赖**：T-P2-405（N5 分型）、T-P2-403（webhook 面复用）
- **风险 / 未知**：平台 API 真实联调（mock 面 + 人工确认清单）；replySource 闭集扩展走立案

#### T-P2-411 · 收口 · 15d 盘点 + 快照 `[ ]`
- **依据需求**：批次 15d 收口
- **要产出**：盘点面：①S1/M11/S2 三消费方 × M1/M2 job 底座（派发/取号/核销语义一致性）；②S4 最强审批 × unattended 恒拒（C 族 fail-closed 不变量在操作类工具上的兑现）；③K9 画中画 × S4 操作审计（消费端同源）；④K6/K7 IM × APPROVAL_SURFACES 追加（#25 立案状态）+ replySource 链路（L2 审计）；⑤N5 四类分型 × deliveryKind push/poll 两语义；⑥P4 语音 × 附件域白名单扩展纪律；⑦快照即规格：webhook 入站 → job 派发 → 会话 → N5 通知一条
- **验收**：`npx vitest run`（全量）+ 工具链四件 + license-audit
- **依赖**：T-P2-401 ~ 410 全部
- **风险 / 未知**：无

## §7 批次 15e 卡序（18 张：T3/T4/T7/T8/O27/O28/O29/O30/A16/F19/F27/F16/L9/L5/L6/J21/J17 + 收口；2026-09-28 展卡）

**锚点纪律**：17 条锚点以 P2 研究核对为底（含 2 处行号锚 compact.rs:483/470 研究期已逐一验证），本批抽核 pi-mono·cache-retention.ts 与 codex·context_snapshot.rs（全部命中）。零勘误。

**展卡核对结论**：
1. **T 族四件是批次 13 T1/T2 的直接延伸**：T3 模块阅读包（architecture-policy 消费——policy.json 的 roots/entrypoints 产出阅读清单命令）；T4 豁免带理由（policy exceptions 已带 reason——T4 的增量是**检查器强制**：exception 缺 reason 已拒绝（T-P1-121 已落）——核对后可能关闭记档）；T7 性能断言防复杂度退化（复杂度断言不是耗时断言——kimi README 同款纪律：实测溢出点 + 余量倍数已有先例 T-P1-123）；T8 known-diffs（以某上游为蓝本须产出分歧清单——retro 面式文档纪律）。
2. **O 族四件是测试政策**：O27 快照长行截断（codex MAX_SNAPSHOT_LINE_CHARS=160 + 长指引一行标签）；O28 keyless 快照层写下来的测试政策（dsh test-support 包组的政策化——我方 test-support 已有 snapshots——O28 = 政策文档 + 包组升降级规则）；O29 期望外错误 panic（测试内 EventMsg::Error => panic!——我方 vitest 等价：fixture 解析遇未知事件 fail 而非静默）；O30 跨组件因果断言（"装完必须出现在注册表"——端到端因果链断言）。
3. **F19/F27 压缩族是词汇表重点候选**：F19 两级压缩（microcompact 边界事件——strategy 值域扩展或新事件 **#26 立案候选**）；F27 策略具名（Memento/PrefixCompaction——**strategy 值域收闭集扩展**，#18 同款载荷纪律）。F16 缓存健康诊断（pi-mono 新仓锚——读/写 token 数 + 前缀漂移/thinking 剥离分型——L3 usage 已有 cacheRead/cacheCreation 字段，F16 增量 = 诊断归因面）。
4. **J17 OAuth 独立大件殿后**：kimi·oauth 独立模块（device flow + token 刷新 + 凭据存储）——我方 models 域扩展（auth.ts 已有刷新面——OAuth 是 auth 面的 OAuth 流程实现）；凭据存 private 纪律。
5. **J21 成本核算**：hermes billing_usage 行为 = token → 成本（价格表 + 会话/轮聚合）——我方 L3 usage 已落 token 分列（L3 验收原文含 total_cost_usd 分列——**核对：批次 10 L3 是否已落成本列**——若已落，J21 部分覆盖核对后记档；未落则本卡补）。

**词汇表预判（#26/#27 候选）**：F19 microcompact 边界事件 / F27 strategy 值域扩展 / I10（15c）superseded / A16 零扩展预判 / L9 计时载荷扩展（step/end timing 已有——分段计时的载荷扩展候选）。执行时逐条立案。

#### T-P2-501 · T3 · 模块阅读包命令（architecture:read <module>） `[ ]`
- **依据需求**：T3（"给定模块 id 产出读该模块所需的上下文包；降低读一个模块要开十个文件的成本"）
- **上游首选参考**：zcode·architecture-policy.yaml（policy 元数据驱动的行为）
- **取什么 / 别抄什么**：取"policy 元数据 → 阅读清单"行为；不抄其 yaml（我方 policy.json）
- **要产出**：`tools/architecture-read.mjs`——按模块 id 产出：entrypoints 文件清单 + requires 邻接模块的 entrypoints + 域内文件列表 + 相关测试文件；输出到 stdout（人读）+ `--json`；package.json `architecture:read`
- **验收**：`node tools/architecture-read.mjs host`——输出含 server.ts/protocol.ts + requires 邻接；坏模块 id 类型化拒绝；`npx vitest run src/diagnostics/architecture-read.test.ts`（fixture 隔离）
- **依赖**：无（本批首卡）
- **风险 / 未知**：无

#### T-P2-502 · T4 · 架构豁免带理由（现状核对 + 强制面收口） `[ ]`
- **依据需求**：T4（"架构豁免必须带理由，写在同一条抑制语句上"）
- **上游首选参考**：zcode·architecture-policy.yaml（exceptions + reason 必填）
- **取什么 / 别抄什么**：核对在先——T-P1-121 已实现"exception 缺 reason 全拒绝"（形状自检）；本卡核对增量面
- **要产出**：核对结论 + 缺口补齐（若有）：代码内行级抑制（若有 // architecture:disable 类内联豁免——须带理由）——我方现状无内联豁免机制（仅 policy exceptions 文件级——已带 reason）→ 预判**核对关闭**（部分覆盖属实）；若核对有缺口按缺口落
- **验收**：核对结论落完成记录 + （若落）检查器负例
- **依赖**：无
- **风险 / 未知**：预判部分覆盖——展卡核对后可能直接关闭（J25/L10 先例）

#### T-P2-503 · T7 · 性能断言进测试套件（防复杂度退化） `[ ]`
- **依据需求**：T7（"性能断言进测试套件防复杂度退化（不是防慢）；断言的是复杂度不是耗时"）
- **上游首选参考**：kimi·tree-sitter-bash/README.md（复杂度断言纪律——实测溢出点 + 余量倍数；T-P1-123 同锚同纪律先例）
- **取什么 / 别抄什么**：取"断言复杂度形状（增长曲线）不断言绝对耗时"行为；已有先例盘点（project 10k=10.8ms 阈值 200ms——T-1-04 计时断言已是复杂度断言形态）
- **要产出**：**热点复杂度断言补齐**——盘点核心算法面（project fold 增量/全量、buildChatMessages 视窗、query 检索）各一条增长曲线断言（n 与 2n 的耗时比 < 常数倍——线性/对数形状验证，绝对值仅作 console.info 基线不打闸）；已有断言盘点落完成记录
- **验收**：`npx vitest run src/session/project.test.ts src/session/query.test.ts`（扩）——增长曲线断言三件 + 既有零回归
- **依赖**：T-P2-105（query 面——15a）
- **风险 / 未知**：增长曲线断言的机器方差（比值断言比绝对值稳——2× 余量定形）

#### T-P2-504 · T8 · known-diffs 清单（以某上游为蓝本须产出分歧清单） `[ ]`
- **依据需求**：T8（"以某上游为蓝本须产出 known-diffs 清单（对齐 + 记录分歧）"）
- **上游首选参考**：kimi·known-diffs.txt（逐条分歧 + 理由的清单形态）
- **取什么 / 别抄什么**：取清单纪律（格式 + 逐条理由）；不抄其语料域内容
- **要产出**：`docs/known-diffs.md`——回溯汇总：本仓以哪些上游为蓝本的域（host/protocol ← pi·protocol、acp ← xai-acp-lib、附件 ← kimi/pi-desktop、offload ← dsh、policy ← zcode 等——P0/P1 完成记录的"不抄什么"行汇拢）+ 逐条分歧与理由；新蓝本域随卡追加的纪律写进文件头
- **验收**：文档落地 + 抽查 5 域与完成记录一致 + check-doc-links 传参通过
- **依赖**：无
- **风险 / 未知**：无（文档件）

#### T-P2-505 · O27 · 快照长行截断 + 长指引标签化 `[ ]`
- **依据需求**：O27（"长行截断（160 字符）+ 已知长指引替换成一行标签；MAX_SNAPSHOT_LINE_CHARS"）
- **上游首选参考**：codex·context_snapshot.rs（截断常量 + 标签替换的行为）
- **取什么 / 别抄什么**：取"160 字符截断 + 长文本一行标签（稳定 diff）"两行为；不抄其 snapshot 场景（我方 normalize.ts 已有归一化——O27 是其行纪律补齐）
- **要产出**：`src/test-support/normalize.ts` 扩展——`truncateLines(s, 160)`（超长截断 + `[truncated N chars]` 尾标）+ 长指引标签替换表（已知超长提示 → `[directive: <name>]`）+ snapshotToString 接线
- **验收**：`npx vitest run src/test-support/`（扩）——截断/标签/既有快照零破坏
- **依赖**：无
- **风险 / 未知**：既有快照测试的 diff 抖动（标签化后部分既有快照更新——有意行为收紧记档）

#### T-P2-506 · O28 · keyless 快照层测试政策（写下来的政策 + 包组升降级规则） `[ ]`
- **依据需求**：O28（"keyless 快照层作为写下来的测试政策；测试基础设施自成包组且有升降级规则"）
- **上游首选参考**：dsh·test-support（7 包 22k 行的包组形态——只取政策化行为）
- **取什么 / 别抄什么**：取"测试基建是受治理的包组（有清单 + 有升降级规则）+ keyless（快照不依赖机器/时间/ID）"政策面；不抄其包组规模（我方 test-support 单域）
- **要产出**：`docs/test-policy.md`——test-support 域清单（http-mock/normalize/snapshots/现有件）+ keyless 纪律（stableStringify/StableLabels 既有——政策化成文）+ 升降级规则（新件入组条件/废弃条件）+ 各测试文件的基建使用规约
- **验收**：文档落地 + keyless 复核（既有快照测试跑两遍逐字节等——既有断言即规格）
- **依赖**：T-P2-505（快照行纪律先行）
- **风险 / 未知**：无（政策件）

#### T-P2-507 · O29 · 期望外错误 panic（测试 fixture 显式忽略臂） `[ ]`
- **依据需求**：O29（"期望外的错误直接 panic；其余未识别事件走显式忽略臂"）
- **上游首选参考**：codex·compact.rs:470（`EventMsg::Error(e) => panic!` + 显式 `_ => {}` 忽略臂——研究期已验证关键行）
- **取什么 / 别抄什么**：取"测试 fixture 对错误类事件 fail-loud、对已知无关事件显式忽略（不留静默通配）"行为；vitest 等价 = throw
- **要产出**：`src/test-support/` 测试事件泵 helper——fixture 流处理约定：error 类事件 → throw（fail-loud）+ switch 显式枚举已知事件 + default 臂 throw（未知事件也 fail——**比 codex 更严**：未知默认 panic 记档理由：我方词汇表闭面 C14 已保证已知集，未知即异常）；接入既有流式测试 fixture（agent-process.test 等——渐进，触碰的 fixture 先行）
- **验收**：`npx vitest run src/test-support/ src/kernel/agent-process.test.ts`（扩）——错误 panic + 未知 panic + 已知无关忽略
- **依赖**：T-P2-506（政策同域）
- **风险 / 未知**：渐进接入范围（全部 fixture 一次切换噪音大——本卡只落 helper + 两个示范 fixture，全面切换随触碰记档）

#### T-P2-508 · O30 · 跨组件因果断言（端到端因果链） `[ ]`
- **依据需求**：O30（"断言跨组件因果（装完必须出现在注册表），不只断言字段值"）
- **上游首选参考**：pi-desktop·plugins/tests.rs（🔴 只学行为：装配动作 → 注册表可见的因果断言）
- **取什么 / 别抄什么**：取"断言因果链而非终态字段"纪律；不抄其 Rust 测试结构
- **要产出**：因果断言三件（本仓真实装配链）：①工具注册 → BUILTIN 清单可见；②provider 配置 → 换模注册表可见；③host server 装配 → WS 面 hello 可达（server.test 已有——盘点复核）；写成 `src/diagnostics/causal.test.ts`（跨域 import 只读装配面）
- **验收**：`npx vitest run src/diagnostics/causal.test.ts`——三因果链全绿
- **依赖**：无
- **风险 / 未知**：与既有端到端测试的重叠（盘点先做——已有即复核记档不重写）

#### T-P2-509 · A16 · 输入排空后重置启发式计数 `[ ]`
- **依据需求**：A16（"输入排空后重置相关的启发式计数；排空即复位，不留上一轮的计数污染"）
- **上游首选参考**：zcode·turn-loop.ts（排空点与计数复位的位置）
- **取什么 / 别抄什么**：取"队列排空点 = 启发式计数复位点"的时序纪律
- **要产出**：盘点我方启发式计数面（F28 抖动计数 / J19 熔断计数 / M9 工具类计数——批次 6/11 落的面）——核对各计数在 prompt 排空时的复位语义；缺口补齐（排空钩子复位——queue 面已有 drain 点）；预判部分在位（F28 复位语义 T-P1-93 已落）——按盘点结果定形
- **验收**：`npx vitest run src/kernel/loop.test.ts src/kernel/queue.test.ts`（扩）——排空复位用例 + 盘点清单落完成记录
- **依赖**：无
- **风险 / 未知**：预判部分覆盖——核对后可能缩为小补丁

#### T-P2-510 · F19 · 压缩分两级（microcompact 与 compact 各有边界事件） `[ ]`
- **依据需求**：F19（"压缩分两级（microcompact 与 compact 各有边界事件）；两级"）
- **上游首选参考**：zcode·session.events.ts（两级压缩的事件分型行为）
- **取什么 / 别抄什么**：取"两级各自有边界事件、语义分型"行为；不抄其事件 schema（我方词汇表管线）
- **要产出**：microcompact 层（轮内轻量裁剪——工具结果旧副本裁剪，**无独立事件预判**：microcompact 是投影策略非流事实？——展卡定形：若 microcompact 改变模型请求面则须事件（#26 立案）——按 dsh/zcode 对照定形）+ compact 层已有（E17 compaction 事件）+ 两级边界语义文档化（何时 micro 何时 full——F11 兜底链复用）
- **验收**：`npx vitest run src/context/ src/session/messages.test.ts`（扩）——两级触发边界 + 词汇表管线（若立案）
- **依赖**：无（压缩引擎 P0 已落）
- **风险 / 未知**：microcompact 的事件语义是本卡最大定形点（展卡预判 → 执行定形立案 #26）

#### T-P2-511 · F27 · 压缩策略具名（摘要式 / 前缀式闭集） `[ ]`
- **依据需求**：F27（"压缩策略具名（摘要式 / 前缀式）；Memento / PrefixCompaction"）
- **上游首选参考**：codex·compact.rs:483（CompactionStrategy::Memento 枚举——研究期已验证）
- **取什么 / 别抄什么**：取"策略是具名闭集（落流可归因）"行为；我方 compaction 事件 strategy 已收闭集（#18：full_summary | recent_window_fallback）——**增量 = 前缀式（prefix）第二策略的实现**（重放活前缀不冷写——F15 缓存族思想，P1 未做 F15；最小面：prefix 策略 = 保留近期消息原文 + 摘要只覆盖更早区间）
- **要产出**：compaction 路径 + prefix 策略实现（strategy: "prefix_window" 值域扩展 **#26 同案立案**——#18 闭集追加纪律）+ 触发面（配置选择策略）
- **验收**：`npx vitest run src/context/compaction.test.ts`（扩）——prefix 策略往返 + 摘要区间正确 + 闭集扩展管线
- **依赖**：T-P2-510（两级语义同域）
- **风险 / 未知**：prefix 策略与 F26 指纹的交互（策略入指纹——指纹内容已含 strategy? 核对）

#### T-P2-512 · F16 · 缓存健康可诊断（前缀漂移 / thinking 剥离分型） `[ ]`
- **依据需求**：F16（"缓存健康可诊断：区分前缀漂移与 thinking 被剥离，并记录读/写 token 数；缓存命中率下降可定因"）
- **上游首选参考**：pi-mono·cache-retention.ts（🔴 新仓锚——缓存保留与诊断的行为）
- **取什么 / 别抄什么**：取"命中率下降可归因（分型：前缀漂移 / thinking 剥离）+ 读写 token 记录"行为；不抄其 retention 策略实现
- **要产出**：`src/models/cache-health.ts`——逐请求缓存统计（usage 的 cacheRead/cacheCreation——L3 已有分列）+ 归因面：连续请求命中率下降时 diff 请求前缀（messages 前缀比对——prefix drift 检测）+ thinking 剥离检测（reasoning 内容不进后续请求前缀的核对——推理模型联调发现的真实面：deepseek reasoning 不回传前缀）+ 诊断报告（logs 或查询面）
- **验收**：`npx vitest run src/models/cache-health.test.ts`——命中率统计 + 漂移归因 mock 用例 + thinking 剥离用例（真实端点样本 fixture）
- **依赖**：无（L3/usage 已有）
- **风险 / 未知**：归因是启发式（分型准确率人工面——机验钉统计与比对结构）

#### T-P2-513 · L9 · 循环内分段计时（mcp / tools 各自打点） `[ ]`
- **依据需求**：L9（"循环内分段计时（mcp / tools 各自打点）；各段耗时可见"）
- **上游首选参考**：zcode·turn-loop.ts（分段打点的位置）
- **取什么 / 别抄什么**：取"轮内分段（模型请求/工具执行/压缩）各自计时可见"行为
- **要产出**：step/end timing 载荷扩展（**#27 立案候选**：`timing.segments?: {modelMs, toolsMs}`——step/end 已有 firstTokenLatency/streamDuration——分段扩展载荷）+ loop 打点位（模型流累计/工具执行累计——T-P1-18 埋点复用）
- **验收**：`npx vitest run src/kernel/loop.test.ts src/kernel/events.test.ts`（扩）——分段计时落流 + 载荷扩展管线
- **依赖**：无
- **风险 / 未知**：载荷扩展管线（#27）

#### T-P2-514 · L5 · HTTP 级录制（调试模型交互） `[ ]`
- **依据需求**：L5（"HTTP 级录制；调试模型交互"）
- **上游首选参考**：opencode·http-recorder（录制/回放的形态）
- **取什么 / 别抄什么**：取"请求/响应成对录制 + 敏感头掩码 + 回放驱动测试"行为；不抄其包结构（我方 test-support 域）
- **要产出**：`src/test-support/http-recorder.ts`——录制面（fetch 包装：请求/响应流成对落盘——JSON 行；authorization 掩码复用 redactSecrets）+ 回放面（录制样本 → http-mock 脚本生成——SseScript 复用）+ 录制开关（env——生产缺省关）
- **验收**：`npx vitest run src/test-support/http-recorder.test.ts`——录制往返 + 掩码断言 + 回放生成
- **依赖**：T-P2-506（test 政策同域）
- **风险 / 未知**：录制文件的入库边界（fixture 化须掩码复核——政策面）

#### T-P2-515 · L6 · 审计报表（汇总危险操作与审批） `[ ]`
- **依据需求**：L6（"审计报表；汇总危险操作与审批"）
- **上游首选参考**：hermes·gateway（审计汇总的维度面）
- **取什么 / 别抄什么**：取"按会话/时间窗汇总危险操作与审批率"的报表维度；不抄其网关形态（我方本地库面）
- **要产出**：`src/obs/audit-report.ts`——`auditReport(events, {window})`：危险操作计数（C 族 deny/escalate 裁决聚合）+ 审批率（approve/deny/timeout 比例）+ 判官介入率（C42 后）+ 按 tool 分组；CLI/查询面暴露（Q2 工具化复用——audit_report 只读工具候选）
- **验收**：`npx vitest run src/obs/audit-report.test.ts`——三维度聚合 + 空窗零除防呆
- **依赖**：T-P2-105（Q2 查询面复用）、T-P2-203（判官面——15b）
- **风险 / 未知**：无

#### T-P2-516 · J21 · 成本核算（token → 成本，按会话/轮可查） `[ ]`
- **依据需求**：J21（"成本核算；token → 成本可算；按会话/按轮可查"）
- **上游首选参考**：hermes·billing_usage.py（价格表 + 聚合的行为）
- **取什么 / 别抄什么**：取"价格表驱动 + 会话/轮两级聚合"行为；不抄其计费账户面
- **要产出**：**先核对**：L3 验收原文"`total_cost_usd` 分列"——若 T-P1-9x 已落成本列则 J21 部分覆盖核对关闭；未落则 `src/models/cost.ts`（价格表配置 + usage×单价 → 成本 + 事件流聚合查询）——执行时按核对结果定形
- **验收**：核对结论落完成记录 +（若落）cost 聚合测试
- **依赖**：T-P2-105（查询面）
- **风险 / 未知**：预判部分覆盖——核对后可能缩为关闭记档（J25/L10 先例）

#### T-P2-517 · J17 · OAuth（独立模块不侵入内核） `[ ]`
- **依据需求**：J17（"OAuth；独立成模块，不侵入内核"）
- **上游首选参考**：kimi·packages/oauth（device flow + token 刷新 + 凭据存储的独立模块形态）
- **取什么 / 别抄什么**：取"独立模块 + device flow + 刷新 + 安全存储"四行为；不抄其厂商端点（我方 OpenAI 兼容面 OAuth 端点卡内定形——真实厂商 OAuth 联调随需要）；凭据 private 纪律（全局约束 3）
- **要产出**：`src/models/oauth.ts`——device flow（授权请求 + 轮询 token）+ token 刷新（auth.ts 的 authResolver 复用——J13 面）+ 凭据存储（private/ 或系统钥匙串——环境变量优先）+ **不侵入内核断言**（models 域内闭环——architecture requires 断言）
- **验收**：`npx vitest run src/models/oauth.test.ts`——device flow mock（端点 mock 复用 http-mock）+ 刷新 + 存储掩码 + 架构断言；真实 OAuth 端点联调列人工确认
- **依赖**：J13 鉴权刷新（批次 11 已落）
- **风险 / 未知**：真实厂商 OAuth 端点（mock 面 + 人工确认）

#### T-P2-518 · 收口 · 15e 盘点 + P2 段终验收 `[ ]`
- **依据需求**：批次 15e 收口 + P2 段终验收（48 条全段收官）
- **要产出**：盘点面：①F19/F27 压缩族 × E17/F26/F11 既有压缩语义（策略闭集 + 指纹交互）；②O29 测试政策 × C14 词汇表闭面；③J17/J21 × J2/J13 模型运维域；④S 族（15d）× M1/M2 底座的调度一致性；⑤known-diffs（T8）全段回填完整性；⑥全段待澄清案复核（#22~#27 全部转正或回退面在案）；⑦快照即规格：全段抽样一条端到端（S1 cron → job 派发 → M11 核销 → N5 通知）
- **验收**：`npx vitest run`（全量）+ 工具链四件 + license-audit + **P2 段对账**：48 条逐条状态表（落地/核对关闭/记档）入 progress
- **依赖**：全部 P2 卡
- **风险 / 未知**：无

## §8 P2 段完成定义

- 五批全部收官：每批卡全勾（每勾附「命令 + 结果摘要」）+ 批次报告入 `plan-p2-progress.md` ✅；`npx tsc --noEmit` 全程干净 ✅；`count-features.sh` = 310 不变 ✅、`check-doc-links.sh` 显式传参 0 失效 ✅、`license-audit.sh` exit 0 ✅。
- 词汇表管线：#22~#27 各案走立案（含回退面，追认后 `l0-events.md` §8 落地记录全局连续）✅；零扩展卡复核 EVENT_TYPES 基线 ✅。
- 工程纪律：新域一律 managed:true 入册 ✅；T4 核对结论落档 ✅；T8 known-diffs 落地并随新蓝本域追加 ✅。
- P2 段对账：48 条逐条状态表（落地/核对关闭/记档）入终验收 ✅；人工确认清单（真实端点/平台联调/Windows 会话面）单列 ✅。
- **段收官产出《P2 功能全景与借鉴映射》**（`YYYYMMDD_P2功能全景与借鉴映射.md`——P0/P1 惯例固化：段收官快照 + 批次地图 + 产出索引 + 词汇表演进）✅。
