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
| 2026-09-25 | T-2-04 | J22 | `27b1ef7` | `npx vitest run src/kernel/timeout.test.ts` | 5 passed；超时 code=TOOL_TIMEOUT 带 timeoutMs；内层晚完成双向无 unhandledRejection；嵌套靠 code 判归属（内层先到透传内层码） |
| 2026-09-25 | T-3-01 | I12 | `011ca06` | `npx vitest run src/kernel/chain.test.ts` | 9 passed；两层序=前1前2链底后2后1；截断跨层传播（链底没发生即 truncated）；trace/budget 留槽；三点位 toolCall/modelRequest/turnEnd 决定先落卡后动手 |
| 2026-09-25 | T-3-02 | A1/A6 | `8046579` | `npx vitest run src/kernel/loop.test.ts` | 8 passed；A1 反向钉死（无 toolCall+continue 仍继续）；三链全走到；attempt 不伪造消息；工具崩溃回喂 isError；消息从事件投影重建 |
| 2026-09-25 | T-3-03 | A2/A9 | `58270ac` | `npx vitest run src/kernel/queue.test.ts` | 6 passed；入队收执仅 `{messageId}`、@ts-expect-error 钉死无 finished()；all 全量 FIFO / one-at-a-time 每边界最旧一条；step 边界注入顺序与入队一致不丢不重 |
| 2026-09-25 | T-3-04 | A7 | `cf128ff` | `npx vitest run src/kernel/loop.cancel.test.ts` | 6 passed；流中取消恰一条 turn/end{aborted}+interrupted 前缀、其后无同轮事件；cause 落盘拷声明字段（stack 不进事件）；first-wins+idle no-op；undici 冻结回归测试 |
| 2026-09-25 | T-3-05 | A3 | `8250b93` | `npx vitest run src/kernel/run-state.test.ts` | 4 passed；双重故障注入后 busy 停留、恢复路径归位 idle；closeTurn 尾部唯一归位点；error/blocked/aborted 三路径同样归位 |
| 2026-09-25 | T-3-06 | T9 | `46c1906` | `npx vitest run src/kernel/agent-process.test.ts` + `node scripts/cold-start.mjs` | 6 passed；真 stdio spawn 3 条 prompt 收全事件（管道零 mock）+ 协议 JsonValue 型证；**冷启动 median 90.4ms（best 89.6，3 轮）< 500ms 达标** |
| 2026-09-25 | T-3-07 | O7–O11 | `8ef2d8f` | `npx vitest run src/test-support/` | 19 passed；真 loop 流四不变量全过（轮号/step 配对/tool 配平/终态恰一）；断列流含 seq 的人话失败；O10 header+O11 previous 复证；T-3-02/04/06 测试复用改造 |
| 2026-09-25 | T-4-01 | B1/B2 | `d957c4f` | `npx vitest run src/kernel/tools/registry.test.ts` | 8 passed；动态注册即证扩展面、txt 改 A→B description 随变代码零 diff、TOOL_NOT_FOUND/ARGS_INVALID 落 isError 保配平；附带 assertJsonSafe 菱形误报本修（loop 克隆 workaround 移除，全量 137 passed） |
| 2026-09-25 | T-4-02 | B3（前半） | `0b012da` | `npx vitest run src/kernel/tools/builtin/` | 8 passed；read 切片+续读提示+ENOENT/空文件/越界边界、write 自动建父目录+覆盖+0 字节、bash 参数校验落地留桩 TOOL_NOT_IMPLEMENTED（stdout/exit code 随 T-4-05 回填补跑） |
| 2026-09-25 | T-4-03 | B3（后半） | `408a5fb` | `npx vitest run src/kernel/tools/builtin/` | 16 passed；六工具各 ≥2 用例；edit 唯一匹配/$& 不解释、glob 绝对路径+截断、grep 行号+include 按名过滤+INVALID_PATTERN；rg 主路径因 D4（spawn 属 env）推迟 T-4-05；踩坑：块注释内写"星对斜杠"提前闭合注释 |
| 2026-09-25 | T-4-04 | B4 | `a3e0e9c` | `npx vitest run src/kernel/tools/write-queue.test.ts` | 6 passed；同路径 20 并发落完整值无交错、异路径 20×30ms 总耗时 <300ms（串行下界 600ms 之半）、失败不毒化+自摘尾巴；edit 整个读改写进队列，write/edit 构造注入共享实例 |
| 2026-09-25 | T-4-05 | D4 | `7f72dc4` | `npx vitest run src/kernel/tools/env.test.ts` + grep 证伪 + 冷启动 | env.test 8 passed（真执行 6 + 类型封闭 2）；child_process 证伪 0 行；bash 回填（stdout/exit code/TOOL_TIMEOUT）；agent-process 接线注册表分发；冷启动 median 109.6ms 达标；build 脚本补描述 txt 拷贝（T-4-01 预记的 dist 风险实爆已修） |
| 2026-09-25 | T-4-06 | B5/B10/B11 | `24b359c` | `npx vitest run src/kernel/tools/truncate.test.ts` | 6 passed；51KB/2000 行双触发（多字节不切断）、spill 首行 Q13 JSON 标记（sessionId/tool/callId/deletable）、完整原文落盘、registry 统一出口接入 meta 合并、isError 同截断；B11 描述声明落 4 个 txt |
| 2026-09-25 | T-4-07 | B12 | `837d5cb` | `npx vitest run src/kernel/tools/contract.test.ts` | 5 passed；契约富值（函数+5000 行对象）经 dispatch 投影，事件 payload 无 value/函数且 <500B；isError/error/meta 通道齐；loop 落盘事件流端到端验证；投影点在 registry.dispatch（loop 零改动） |
| 2026-09-25 | T-4-08 | B9/B14 | `3757753` | `npx vitest run src/kernel/budget.test.ts` | 7 passed；tick 超数量/超时 throw（注入钟）、progress 只查截止；真实 loop 流 expectPaired(tool/call) 配平 + toolCallId 三段同源；预算耗尽停发缺席（取消同款语义）、turn 正常收束；默认 256 次/120s 可 Infinity 禁轴 |
| 2026-09-25 | T-5-01 | C58/C20/C2 | （本卡提交后回填） | `npx vitest run src/policy/chain.test.ts` | 10 passed；同两条规则托管/核心换位结果翻转（层序即权威）；[Bash(*)允许, Bash(git*)询问] → git status 落允许、反转落 ask（首匹配胜）；POLICY_LAYERS 唯一层序常量导出断言；模块崩溃上抛不跳过（fail-open 禁止）；rules.ts 泛型化只管顺序语义，通配匹配归 T-5-02 |

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
| 1 | E4 | `plan-p0.md` T-1-05 明文"追加 revert 标记事件"，但 `l0-events.md` §3.2 的定稿 13 事件无回退标记落点；`src/kernel/events.ts` 原按 13 实现 | 词汇表定稿与计划卡不一致：不追加事件则 revert 状态变更无事件承载（违反不变量 1"事件是唯一真相"）；追加则词汇表 13→14 | 按计划卡执行：新增 `session/revert {targetSeq, phase}`（会话级元事件，最新标记生效），词汇表 13→14，l0-events.md §8 记落地记录 2，events.test 计数同步改 14 | ✅ **已追认（2026-09-25 用户："词汇表 13→14，允许"）**——案关，§3.2 正式计数为 14 事件 |

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

## 阶段 2 报告（完成于 2026-09-25）

- **打勾情况**：4 / 4（T-2-01 ~ T-2-04 全部完成，无未完成项）
- **产出的文件**：
  - `src/models/config.ts`（约 240 行，含 RFC 8259 定位扫描器）+ `identity.ts` + `config.test.ts` + `identity.test.ts`——T-2-01
  - `src/models/provider.ts`（统一流接口 + ProviderHttpError）+ `openai-compat.ts`（SSE wire 映射）+ `provider.test.ts`——T-2-02
  - `src/models/retry.ts`（显式分类 + 退避 + Retry-After）+ `retry.test.ts`——T-2-03
  - `src/kernel/timeout.ts`（TOOL_TIMEOUT + withTimeout）+ `timeout.test.ts`——T-2-04
- **验收台账**：4 卡 4 命令全部通过（见台账表）；全量 `npx vitest run` **83 passed / 0 failed**（阶段 1 收尾时 53 → 阶段 2 净增 30），`npx tsc --noEmit` 全程干净
- **阶段完成定义核对**：http-mock 走通"流式增量到达（三段剧本不丢不重）+ 429 触发按策略重试（退避/Retry-After）+ 超时抛 TOOL_TIMEOUT 作用域错误"——三条均有自动化用例
- **偏离计划的地方**：
  1. **Delta = 词汇表 StreamChunk**：卡面"Delta 含 text/thinking/tool_call/usage"直接落成 events.ts 的 `StreamChunk`（text-delta/reasoning-delta/tool-call-delta/usage/done）——词汇表注释本就要求适配层映射到它，不造第二套增量词汇（T-2-02）
  2. 新增 `ProviderHttpError{status,retryAfter,bodyPreview}` 接口面（卡面未预写）——T-2-03 重试分类的判据，抛出点在响应头阶段（T-2-02）
  3. 重试"mock 时间"用 sleep/rand **注入**而非 vi.useFakeTimers——真端口 IO 与 fake timers 混用易死锁（T-2-03）
  4. withTimeout 不用 Promise.race 裸写——内层 rejection 无人接会变 unhandled rejection；内层 .then 双分支挂 handler（T-2-04）
  5. DSH 的"signal 换回/恢复"在 P0 promise 风格下无 exec 可换——等价纪律落为"错误带 code 按码路由"，DSH 接线纪律写进 timeout.ts 头注释，阶段 3/4 定形时照落（T-2-04）
- **新发现的约束或坑**：
  - Node 22 对**顶层 token 错误**（`not json`）的 JSON.parse 错误消息**不含位置**（对象内错误才带 position/line-column）——"报错含位置"不能靠解析 V8 文案，配了 ~120 行 RFC 8259 定位扫描器（JSON.parse 仍是权威裁决，扫描器只管定位）
  - `data: [DONE]` 到达时适配层必须**产出** StreamChunk 的 `done` 终块再终止——初版直接 return，被验收测试抓出（消费方依赖 done 判流终）
  - OpenAI 流式 tool_call 分片只在首片带 id/name，后续片仅 index+arguments——适配层按 index 记录开着的调用补回 id（风险/未知栏预警的 index 对齐，已落用例）
- **遗留风险与未知**：
  - J2 真实厂商连通性仍是人工确认清单项（真实 SSE 分片/usage 行为留 T-8-05 可选验收，无 key 时标注人工确认）
  - Retry-After 的 HTTP 日期格式只在 parseRetryAfterMs 纯函数层测（withRetry 层 Date.now 不可注入）
  - 词汇表 13→14 追认事项不变（待澄清执行会话新发现 #1）
  - openai-compat 的流中途畸形帧按 MODEL_WIRE_ERROR 严格抛（不跳过不重试）——真实厂商若发非标准帧（如 keep-alive 注释行）需复核；SSE 注释行（`:` 开头）已跳过
- **下一阶段提示词**：

```
继续 aegent 内核的实施。读 docs/plan-p0.md 的 §0 执行协议，然后从「阶段 3」
的第一张 [ ] 任务卡开始。上一阶段报告在 docs/plan-p0-progress.md。
本阶段特有的注意：1) T-3-01 洋葱链的三个点位选择（候选：工具调用前=权限、
模型请求前=上下文、turn 结束=压缩）必须先在卡内写决定与理由再动手，选错
连锁影响阶段 4/5/7；2) loop 的模型调用直接消费 T-2-02 的
ModelProvider/StreamChunk 与 T-2-03 的 withRetry（ProviderHttpError 只在
响应头阶段抛、流产出后不重试的语义已在 retry.test 钉死）；3) T-3-06 冷启动
<500ms 要实测，超标不自行改设计，停下写待澄清。不要问要不要继续。
```

---

## 阶段 3 报告（完成于 2026-09-25）

- **打勾情况**：7 / 7（T-3-01 ~ T-3-07 全部完成，无未完成项）
- **产出的文件**：
  - `src/kernel/chain.ts` + `chain.test.ts`——洋葱链骨架（T-3-01）
  - `src/kernel/loop.ts` + `loop.test.ts` + `loop.cancel.test.ts` + `loop.test-utils.ts`——主循环 / 取消 / 测试共用工具（T-3-02/04）
  - `src/kernel/queue.ts` + `queue.test.ts`——prompt 队列与 step 边界注入（T-3-03）
  - `src/kernel/run-state.ts` + `run-state.test.ts`——运行态服务（T-3-05）
  - `src/kernel/agent-protocol.ts` + `agent-process.ts` + `agent-child.ts` + `agent-protocol.test.ts` + `agent-process.test.ts`——出进程与 JSON 行协议（T-3-06）
  - `src/test-support/event-asserts.ts` + 测试；`snapshots.ts` 增 header（O10/O11）（T-3-07）；`scripts/cold-start.mjs`——冷启动基准
- **验收台账**：7 卡 7 命令全部通过（见台账表）；全量 `npx vitest run` **128 passed / 0 failed**（阶段 2 收尾 83 → 净增 45），`npx tsc --noEmit` 全程干净；`count-features.sh`=310 不变、`check-doc-links.sh`=0 失效
- **阶段完成定义核对**：假 provider 驱动的 continue/end 两路径 ✓（loop.test）；取消后事件流有终止记录 ✓（恰一条 turn/end{aborted}）；进程模式冷启动实测落档 ✓（median 90.4ms < 500ms）
- **偏离计划的地方**：
  1. **T-3-01 三点位按用户指示提前到该卡落卡**（卡面原文留 T-3-02 钉）：`toolCall`/`modelRequest`/`turnEnd`（命名取被包动作，DSH `tools/execute` 同款），决定与排除项写进卡面与 chain.ts 头注释
  2. **assertJsonSafe 菱形引用误报**（T-1-01 产物）：同一对象在事件树出现两次（非循环）被判循环引用——T-3-02 实测踩中（usage 同挂 stream 与顶层字段），本阶段在 loop 侧克隆绕过；**本修建议（walk 子树后 seen.delete 回溯 + 共享引用用例）留给阶段 4 开工前做**，未擅改 T-1-01 产物
  3. T-3-06 基准脚本 `scripts/cold-start.mjs` 而非卡面 `cold-start.ts`（node 22 无 TS loader、选型无 tsx）；子进程只跑 dist 产物，测试 beforeAll `npx tsc`
  4. T9 协议面按 A9 落法：`prompt` 应答只有 `accepted{messageId}` 收执（即答），**无** session.finished、无 per-prompt 结果——轮终态由父进程观察 turn/end 事件（dsh followup-enqueue 同款）
- **新发现的约束或坑**：
  - **事件转发是子进程的关键接线**：append 进 store ≠ 协议可见（首版因此挂起）——转发型 SessionStore 子类（append 即发 event 行）是出进程的标准形态，T-8 CLI 端沿用
  - Windows spawn + node 启动 + ESM 图加载实测 ~90ms：**Q16 的 spawn 开销担忧实测排除**；基准带 OS 缓存预热 + 3 轮取中位数
  - agent 子进程依赖图不含 better-sqlite3（InMemory store）——原生模块不进冷启动路径是 <500ms 的结构性前提，T-8 若给子进程接 SQLite 存储需重新实测
  - loop 消息序列从 `store.load()` 投影重建（不变量 1，不养第二份历史），buildMessages 已处理 revert 有效视窗——阶段 7 压缩接入时在同一入口扩展
- **遗留风险与未知**：
  - assertJsonSafe 菱形误报待修（见偏离 2）：阶段 4 的 tool/result.meta 若共享引用会再踩，建议进阶段 4 开工前先修
  - run-state 是进程内 Map；CLI（T-8）跨进程看子进程运行态需协议层转发 status 事实（本阶段未加该消息，需要时补）
  - withRetry 只在单测层验证；子进程 echo provider 未经过真实 429 路径（J2 人工确认清单不变）
  - 子进程 dispose 的"协作退出"依赖 runTurn 正常结算；loop 崩溃（AGENT_LOOP_CRASH）时子进程 exit(1)，父进程恢复语义留 T-8
- **下一阶段提示词**：

```
继续 aegent 内核的实施。读 docs/plan-p0.md 的 §0 执行协议，然后从「阶段 4」
的第一张 [ ] 任务卡开始。上一阶段报告在 docs/plan-p0-progress.md。
本阶段特有的注意：1) 开工先修 assertJsonSafe 的菱形引用误报（src/kernel/
events.ts 的 WeakSet 无回溯——walk 完子树 seen.delete 回溯，并补一条
"同一对象出现两次"的合法用例；这是 T-1-01 产物的 bug 修复，在 T-4-01 卡的
commit 里带上并记偏离）；2) 工具执行必须走 T-3-01 的 toolCall 链（注册表
分发是链底 terminal，阶段 5 权限层挂同一链），ToolContext 不暴露裸进程
API（D4）随 T-4-05 定形；3) B10/B11 落盘打标记与 toolCallId 贯穿在事件层
已有形状（tool/result.meta、callId 配平），别造第二套词汇。不要问要不要继续。
```

---

## 阶段 4 报告（完成于 2026-09-25）

- **打勾情况**：8 / 8（T-4-01 ~ T-4-08 全部完成，无未完成项）
- **产出的文件**：
  - `src/kernel/tools/registry.ts` + `registry.test.ts`——工具注册表（链底 terminal）与描述分离（T-4-01）
  - `src/kernel/tools/builtin/{read,write,bash,edit,glob,grep,patterns,util,index}.ts` + `builtin.test.ts`——六个内置工具与注册入口（T-4-02/03/05）
  - `src/kernel/tools/descriptions/{read,write,bash,edit,glob,grep}.txt`——B2 描述分离 + B11 上限声明（T-4-02/03/06）
  - `src/kernel/tools/write-queue.ts` + 测试——B4 同路径 FIFO 写队列（T-4-04）
  - `src/kernel/tools/env.ts` + `context.ts` + `env.test.ts`——D4 ExecutionEnv/ToolContext 与类型封闭闸门（T-4-05）
  - `src/kernel/tools/truncate.ts` + 测试——B5/B10/B11 截断与 spill（T-4-06）
  - `src/kernel/tools/contract.ts` + 测试——B12 输出契约（T-4-07）
  - `src/kernel/budget.ts` + 测试——B14 双轴预算（T-4-08）
  - `src/kernel/loop.ts`（B14 接入 + 菱形修复连带）、`agent-process.ts`（工具装配接线）、`scripts/copy-assets.mjs`、`package.json`（build 含资产拷贝）
- **验收台账**：8 卡 8 命令全部通过（见台账表）；全量 `npx vitest run` **188 passed / 0 failed**（阶段 3 收尾 128 → 净增 60），`npx tsc --noEmit` 全程干净；`count-features.sh`=310 不变、`check-doc-links.sh`=0 失效；冷启动重跑 median 109.6ms < 500ms；D4 证伪 `grep -rn child_process src/kernel/tools/ | grep -v env.ts` = 0 行
- **开工前置项兑现**：assertJsonSafe 菱形误报本修随 T-4-01 commit（walk 子树 seen.delete 回溯 + 合法用例 + loop 克隆 workaround 移除，用户开工指示的完成）
- **偏离计划的地方**：
  1. **grep 的 ripgrep 主路径未回填**（T-4-03 偏离②改口）：rg 是 spawn，受 D4 约束必须走 ExecutionEnv；JS 版已验收且语义等价，按 YAGNI 留待有性能需求时经 env 接入（rg 14.1.1 本机在位）
  2. **ToolContext P0 面 = {env?, toolCallId, signal?}**：卡面清单的 policy/emit 随阶段 5 与 B7 接入，不预埋空字段（T-4-05 偏离②，待用户追认）
  3. **agent-process 提前接线**（T-4-05 偏离⑥，兑现 T-4-02 偏离⑥承诺）：executeTool 槽位 = registry.dispatch，tools = registry.toChatTools()
  4. **build 脚本补资产拷贝**：descriptions/*.txt 不进 dist 曾致子进程装配即抛（T-4-01 预记的 dist 风险实爆，agent-process.test 抓到）——`tsc && node scripts/copy-assets.mjs`；schema.sql 同题仍留待需要时同批
  5. bash 输出原样转述不 trim；预算缺省启用（256 次/120s）而非默认关闭（T-4-08 偏离④）
- **新发现的约束或坑**：
  - **块注释内写 glob 原文（含"星对斜杠"序列）会提前闭合注释**，后面全部代码被 lexer 状态错乱误报（初判 TS7 lexer bug，最小重现排除后定位）——写文档注释引用模式时必须改写措辞
  - D4 的证伪命令按字面 grep：注释里出现 "child_process" 字样也命中（初版 4 行注释全中），一律写"裸进程 API"
  - tsc（TS7.0.2）不拷非 ts 资产，凡运行时读取的伴生文件必须进 copy-assets 清单
  - better-sqlite3 / 原生模块之外，Windows 下 spawn bash 依赖 Git Bash 在 PATH（P0 已知前提，D11 P1 跨壳）
- **遗留风险与未知**：
  - rg 提速、canonical path 归一（大小写/符号链接）、ContractResult 泛型化（ToolDef<V>）三项按 YAGNI 留 P1，已记卡面
  - grep JS 版在大目录（node_modules 级）是全遍历，无提前终止——若阶段 5/6 的被测场景变重再接 rg
  - ToolContext.signal 是类型槽未接线；取消传达给工具执行留 P1（loop 的协作式取消目前只到 await 边界）
  - 人工确认清单不变（J2 真实厂商连通性、D3、§6.2 常驻内存）
- **下一阶段提示词**：

```
继续 aegent 内核的实施。读 docs/plan-p0.md 的 §0 执行协议，然后从「阶段 5」
的第一张 [ ] 任务卡开始。上一阶段报告在 docs/plan-p0-progress.md。
本阶段特有的注意：1) 权限层挂 T-3-01 定形的 toolCall 链（C9 求值在执行前，
截断=拒绝执行），工具装配面是 T-4-05 的 ToolContext{env?,toolCallId,signal?}
——policy 字段随本阶段接入，别另开旁路；2) C27 shell 语义分析的被测对象是
T-4-05 回填后的 bash 工具（经 ExecutionEnv，本机 Git Bash）；C43 max() 与
C35 是同一结构解（阶段 5 不做什么栏已列，先做 T-5-06 的聚合再谈例外）；
3) T-4-06 的 spill/truncate 与 T-4-07 的 contract 投影在工具出口（registry.
dispatch）已就位，权限层截断发生在其上游，拒执行时不产生工具输出。
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
