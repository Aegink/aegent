# P0 执行进度

> 本文件由**执行会话**反复重写；计划本体在 [`plan-p0.md`](plan-p0.md)（执行会话只改任务卡的勾选框、「偏离 / 建议」「完成记录」三个字段）。
> 本文件当前是**骨架**：计划编写完成（2026-09-25），尚未开始执行。

---

## 台账（一行一个已完成的勾）

| 日期 | 任务卡 | 需求ID | commit | 验收命令 | 结果摘要 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-25 | T-1-00 | （脚手架，无功能 ID） | `05a14ba` | `npx tsc --noEmit && npx vitest run --passWithNoTests` | 退出码 0；`git check-attr eol` 新文件均 lf；钉 pnpm@10.29.2（corepack 0.34 与 pnpm 12 布局不兼容） |
| 2026-09-25 | T-1-01 | C14/C15/C16/E12 | `d3cf18a` | `npx vitest run src/kernel/events.test.ts` | 12 passed；13 成员与 EVENT_TYPES 互等；C16 失效演示实测 TS2345；assertJsonSafe 十类非法值全拒；E12 类型+运行时断言过 |
| 2026-09-25 | T-1-02 | E1/E13/E10 | `d33775f` | `npx vitest run src/session/store.test.ts` | 11 passed；append 同步可见/seq 单调；崩溃模拟已 flush 序连续存活；snapshot 先 flush 防回归；C14 整批拒绝、seq 断层拒绝重建 |
| 2026-09-25 | T-1-03 | E2 | `67df483` | `npx vitest run src/session/db.test.ts` | 4 passed；1000 事件建库→重开→seq 连续+payload 逐条相等；user_version 迁移幂等；better-sqlite3 句柄泄漏（open 失败关连接）已修 |
| 2026-09-25 | T-1-04 | E3/E16 | `aadf88d` | `npx vitest run src/session/project.test.ts` | 8 passed；project(10k)=10.8ms<200ms；乱序/未知类型 append 前 reject；增量=全量语义等价；校验接入 append/restore |
| 2026-09-25 | T-1-05 | E4 | `619fe03` | `npx vitest run src/session/revert.test.ts` | 5 passed；append5→revert(2)→投影仅前 2 条效果→unrevert 恢复；标记落流 append-only；最新标记生效；越界/空会话拒绝 |
| 2026-09-25 | T-1-06 | O1–O6 | `bccfd6e` | `npx vitest run src/test-support/` | 13 passed；归一化自测路径/ID/时间戳三类；真端口 fetch 收 SSE；两次快照逐字节相等 |
| 2026-09-25 | T-2-01 | J3/J4 | `d0b9452` | `npx vitest run src/models/` | 10 passed；非法 JSON 四类形状全拒且报错含行列（顶层 token 错误 V8 消息无位置→自写 RFC 8259 扫描器定位）；身份二元组跨厂商可区分、键同身份相等 |
| 2026-09-25 | T-2-02 | J1/J2 | `dd27bdf` | `npx vitest run src/models/provider.test.ts` | 5 passed；三段剧本增量不丢不重（args 拼接回 JSON）、usage 终块过 C14 可落载荷；ProviderHttpError 透传 status/Retry-After；http-mock 与 wire 实测一致未改 mock |
| 2026-09-25 | T-2-03 | J26 | `78e23f2` | `npx vitest run src/models/retry.test.ts` | 10 passed；429 退避重试 waits=[500,1000]、400/unknown 一次不打、Retry-After:2 覆盖默认退避、流产出后不重试防重复送达 |
| 2026-09-25 | T-2-04 | J22 | （阶段报告提交时回填） | `npx vitest run src/kernel/timeout.test.ts` | 5 passed；超时 code=TOOL_TIMEOUT 带 timeoutMs；内层晚完成双向无 unhandledRejection；嵌套靠 code 判归属（内层先到透传内层码） |

---

## 计划编写报告（2026-09-25，编写会话产出）

- **产出文件**：`docs/plan-p0.md`（含 8 阶段 / 62 张任务卡 / §4 全量索引 310 行）、本文件骨架
- **锚点核对**：P0 104 条逐条打开确认。**99 条命中**；**5 条需求锚点有误**（F21 · F24 · F26 · F27 · J25）+ 1 条偏弱（F2）——任务卡已改用核对过的正确路径，见下方「待澄清」表第 1 条
- **数字核对**：`bash tools/count-features.sh` → P0=104 / P1=158 / P2=48 / 总计 310，与 §4 索引表行数一致；`bash tools/check-doc-links.sh` → 547 链接 0 失效（编写时基线）
- **未修改** `docs/requirements.md`（编写时纪律遵守）
- **追记（2026-09-25）**：用户裁决「所有待澄清按照建议来」→ 六处锚点勘误已回修 `requirements.md` §4（commit `a3e535d`），计划与进度文档已同步关闭待澄清表（见下表裁决列）

### 阶段一览（同 plan-p0.md §1）

| 阶段 | 主题 | 需求条数 | 卡数 |
| --- | --- | ---: | ---: |
| 1 | 事件词汇表 + 事件源存储 + 测试基建 | 17 | 7（含 T-1-00 脚手架） |
| 2 | 模型接入 | 6 | 4 |
| 3 | loop + 洋葱链 + agent 进程 + 事件流断言 | 13 | 7 |
| 4 | 工具层 | 11 | 8 |
| 5 | 权限与审批（P0 最重阶段） | 30 | 16 |
| 6 | 沙箱 | 7 | 6 |
| 7 | 上下文与压缩 | 15 | 9 |
| 8 | CLI + 可观测 + 恢复 + 收尾验收 | 5 | 5（含 T-8-05 全量验收） |
| **合计** | | **104** | **62** |

---

## 待澄清（已全部裁决：2026-09-25 用户答复「所有待澄清按照你的建议来」）

| # | 需求ID | 我看到的（含路径:行） | 与需求文档的矛盾 | 建议 | 裁决与落实 |
| --- | --- | --- | --- | --- | --- |
| 1 | F21 | `oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:68`：`state.modelStepCount === 0 ? CompactPhase.PreRequest : CompactPhase.MidTurn` | `requirements.md` F21 锚点写的是 `zcode·compact.ts`——该文件里**没有**相位枚举（只有 rapidRefill 抖动计数，那是 F28 的证据） | 若认可，把 F21 的「参考」改指 turn-loop.ts:68（F28 保持 compact.ts 不变） | ✅ 已回修（commit a3e535d） |
| 2 | F24 | `oss/codex/codex-rs/core/src/compact_model_fallback.rs:29`：`CompactionReason::ModelDownshift => "model_downshift"` | `requirements.md` F24 锚点写 `compact_token_budget.rs`——该文件 84 行，是压缩执行入口，**没有** ModelDownshift 枚举 | F24 参考改为 compact_model_fallback.rs:29 | ✅ 已回修（commit a3e535d） |
| 3 | F26 | `oss/codex/codex-rs/core/src/compact_model_fallback.rs:30`：`CompactionReason::CompHashChanged => "comp_hash_changed"` | 同上（F26 与 F24 共用原锚点） | F26 参考改为 compact_model_fallback.rs:30 | ✅ 已回修（commit a3e535d） |
| 4 | F27 | `oss/codex/codex-rs/core/src/compact.rs:483`：`strategy: CompactionStrategy::Memento`（`CompactionStrategy` 定义在 `codex_analytics` 包） | `requirements.md` F27 锚点写 `compact_token_budget.rs`——其中没有 Memento/PrefixCompaction | F27 参考改为 compact.rs:483（P2，暂不展开成卡） | ✅ 已回修（commit a3e535d） |
| 5 | J25 | `oss/codex/codex-rs/core/src/rollout_budget.rs:62-63`：`usage.output_tokens.max(0) as f64 * state.config.sampling_token_weight + usage.non_cached_input() as f64 * state.config.prefill_token_weight` | `requirements.md` J25 锚点写 `compact_token_budget.rs`——其中**无任何权重计算** | J25 参考改为 rollout_budget.rs:62（与 M10 同文件） | ✅ 已回修（commit a3e535d） |
| 6 | F2 | `oss/opencode/AGENTS.md` 是**被加载的项目指令文件实例**（内容是 opencode 自己的开发规范）；"按目录层级就近生效"的**加载器实现**在 opencode 源码里未定位（`grep AGENTS.md` 于 `packages/opencode/src` 只命中 command 模板） | F2 的锚点支撑"文件长什么样"，不支撑"怎么加载" | 接受 F2 为自研语义（CWD 向上收集 + 就近覆盖），执行会话可在 `oss/opencode/packages/opencode/src/server/` 等处再找加载器；找到则回填参考 | ✅ 按建议执行：requirements/reference-cases 已标注自研，T-7-09 已更新 |
| 7 | （全局） | T-1-00 / `plan-p0.md` §2.6：vitest + pnpm + better-sqlite3 + 单包 | 这三项工程选型需求文档未规定，是计划编写员的**默认决定** | 用户若不同意改 T-1-00 一张卡即可；同意则勾掉本条 | ✅ 用户认可默认选型，T-1-00 按此执行 |

> 此表全部关闭。执行会话新发现的待澄清项**另起新表**（勿追加在此）。

## 待澄清（执行会话新发现）

| # | 需求ID | 我看到的（含路径:行） | 与需求文档的矛盾 | 建议 | 裁决与落实 |
| --- | --- | --- | --- | --- | --- |
| 1 | E4 | `plan-p0.md` T-1-05 明文"追加 revert 标记事件"，但 `l0-events.md` §3.2 定稿 13 事件无回退标记落点；`src/kernel/events.ts` 原按 13 实现 | 词汇表定稿与计划卡不一致：不追加事件则 revert 状态变更无事件承载（违反不变量 1"事件是唯一真相"）；追加则词汇表 13→14 | 按计划卡执行：新增 `session/revert {targetSeq, phase}`（会话级元事件，最新标记生效），词汇表 13→14，l0-events.md §8 记落地记录 2，events.test 计数同步改 14 | ⏳ 待用户追认（2026-09-25 执行会话按计划卡先行落地，commit 见台账 T-1-05） |

## 人工确认清单

| 需求ID | 为什么不能机验 | 人工要怎么确认 |
| --- | --- | --- |
| J2（部分） | 真实厂商连通性需要 API key；单测只覆盖 mock 流 | 用户提供一个真实端点跑一次会话，确认流式与 usage 正常 |
| T9 冷启动 | 「<500ms」依赖本机负载 | 看 T-3-06 完成记录里的实测数字，超标则进待澄清 |
| D3 弱承诺 | 「网络策略只管工具层」是声明不是代码属性 | 读 T-6-03 产出的 README 声明是否醒目 |
| §6.2 常驻内存 | 任务管理器观察（需求原文如此） | 用户空闲时目测 <150MB |

## 阻塞

| 任务卡 | 卡在哪 | 已试过什么 |
| --- | --- | --- |
| （暂无） | | |

---

## 阶段 1 报告（完成于 2026-09-25）

- **打勾情况**：7 / 7（T-1-00 ~ T-1-06 全部完成，无未完成项）
- **产出的文件**：
  - `package.json` / `tsconfig.json` / `vitest.config.ts` / `.gitignore`/`.gitattributes`（复用既有）——脚手架
  - `src/kernel/events.ts`（约 300 行）+ `events.test.ts`——L0 词汇表 13+1 事件
  - `src/session/store.ts` + `schema.sql` + `db.ts` + `project.ts` + `revert.ts` + 各自测试——事件源存储层
  - `src/test-support/http-mock.ts` + `normalize.ts` + `snapshots.ts` + 3 个测试文件——测试基建
- **验收台账**：7 卡 7 命令全部通过（见台账表）；全量 `npx vitest run` **53 passed / 0 failed**，`npx tsc --noEmit` 全程干净；`bash tools/count-features.sh` = 310 不变
- **偏离计划的地方**：
  1. **词汇表 13→14**（唯一实质偏离）：T-1-05 按卡新增 `session/revert` 标记事件，词汇表定稿本无此落点——已按待澄清流程立案（见上方"执行会话新发现"表 #1），**等用户追认**
  2. pnpm 钉 10.29.2（corepack 0.34 兼容性）；tsconfig include 含 `vitest.config.ts`（TS18003 规避）
  3. 台账 commit 哈希回填约定：**哈希在该卡提交后于下一卡提交/阶段收尾提交时回填**（amend 会重写哈希造成自引用悖论；T-1-00 行的 `753c809` 是 amend 前的悬空对象，本报告提交时已修正为 `05a14ba`）
- **新发现的约束或坑**（建议进 `notes/01-workspace-gotchas.md` 或保持在本报告）：
  - corepack 0.34 无法运行 pnpm 12（bin 从 `pnpm.cjs` 改 `pnpm.mjs`）；pnpm 10 需 `pnpm.onlyBuiltDependencies` 白名单才放行 better-sqlite3 的 postinstall
  - better-sqlite3：`open()` 初始化失败路径必须 `db.close()`，否则 Windows 句柄泄漏 → 临时库文件 EBUSY 删不掉
  - 未提交文件不受 `git checkout --` 保护（本会话曾用 `git checkout` 还原未跟踪文件失败，靠 python 重写恢复）
  - pnpm 10 默认拦截依赖 postinstall（见上）；TS7 + vitest 5 + Node 22 组合全链路正常
- **遗留风险与未知**：
  - 词汇表 13→14 若被否决，回退面 = events.ts / events.test.ts / project.ts / revert.ts 一条链（约 1 小时工作量）
  - project(10k) 基线 10.8ms 是本机数字，CI 方差出现前不拆独立 bench 文件
  - 投影有效视图中 `openSteps`/`openToolCalls` 保持全流真值（无 seq），revert 切点后的消费方不依赖它们——阶段 3 loop 接入时复核
  - `tsc` build 不会把 `schema.sql` 拷进 dist（P0 不交付 dist，记录在案）
  - J2 真实厂商连通性、D3 弱承诺等人工确认项不变（见人工确认清单）
- **下一阶段提示词**：

```
继续 aegent 内核的实施。读 docs/plan-p0.md 的 §0 执行协议，然后从「阶段 2」
的第一张 [ ] 任务卡开始。上一阶段报告在 docs/plan-p0-progress.md。
本阶段特有的注意：1) 词汇表现为 14 事件（含 session/revert，待澄清 #1 已按
建议先行落地，若用户追认前发现回修需求以 l0-events.md §8 落地记录 2 为准）；
2) T-2-02 起直接消费 src/test-support/http-mock 的 OpenAI 形 SSE（data: … +
[DONE]），适配层 wire 映射如实测与 mock 不符可改 mock（成本为零）但要在卡上
记偏离；3) T-2-03 的 Retry-After 头按 J26 验收要点自加（kimi 参考文件没有）。
不要问要不要继续。
```

---

## 阶段 N 报告模板（执行会话每阶段复制一份填写，勿删本模板）

### 阶段 N 报告（完成于 YYYY-MM-DD）

- 打勾情况：X / Y（未完成的逐条说明为什么）
- 产出的文件：<路径 + 行数>
- 验收台账：<见台账表，这里给汇总>
- 偏离计划的地方：<哪条、为什么>
- 新发现的约束或坑：<要不要更新 AGENTS.md / notes/01-workspace-gotchas.md>
- 遗留风险与未知：<不要留空壳，"没有"也要写"没有">
- 下一阶段提示词：

```
继续 aegent 内核的实施。读 docs/plan-p0.md 的 §0 执行协议，然后从「阶段 N+1」
的第一张 [ ] 任务卡开始。上一阶段报告在 docs/plan-p0-progress.md。
本阶段特有的注意：<1–3 条>。不要问要不要继续。
```
