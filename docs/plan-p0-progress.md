# P0 执行进度

> 本文件由**执行会话**反复重写；计划本体在 [`plan-p0.md`](plan-p0.md)（执行会话只改任务卡的勾选框、「偏离 / 建议」「完成记录」三个字段）。
> 本文件当前是**骨架**：计划编写完成（2026-09-25），尚未开始执行。

---

## 台账（一行一个已完成的勾）

| 日期 | 任务卡 | 需求ID | commit | 验收命令 | 结果摘要 |
| --- | --- | --- | --- | --- | --- |
| （暂无） | | | | | |

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
