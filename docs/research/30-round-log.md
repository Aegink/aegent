# 轮次记录（第 5–9 轮）

> 这些是**整理前的原始记录**，从 `docs/requirements.md` 搬出 —— 需求文档只放"要做什么"，
> 过程记录放这里备查。**整理后这些条目已全部进入需求文档 §4 的功能总表**，
> 编号变更见 `docs/requirements.md` §10。
>
> | 轮次 | 主题 | 产出文档 |
> | --- | --- | --- |
> | 第五轮 | Codex / ZCode / kimi-code / DSH / PI-Desktop 代码精读 | `10-zcode.md` `11-codex.md` `13-kimi-code.md` `14-dsh.md` `15-pi-desktop.md` |
> | 第六轮 | 主循环 / 压缩与持久化 / 执行层 | 同上（已合并入） |
> | 第七~九轮 | 测试基础设施 / 测试断言 / 测试实现 | `20-testing.md` |
>
> **读法**：想知道"为什么这么定"→ 读对应主题文档；想知道"当时怎么一步步发现的"→ 读这里。

---

### 12. 第五轮记录（Codex / ZCode / kimi-code / DSH / PI-Desktop 代码精读）

> 产出：`docs/research/11-codex.md`(447) / `10-zcode.md`(279) /
> `13-kimi-code.md`(228) / `14-dsh.md`(262) / `15-pi-desktop.md`(177)。
> 本轮**只记新条目与新待定**，不重复前几轮已记结论。

#### 12.1 新增需求项

**C 层（权限）—— 本轮最密集**

| 编号 | 条目 | 优先级 | 来源 |
| --- | --- | --- | --- |
| C43 | **权限聚合语义改为 `max()` 最严格者胜**（单调性 → 结构上关掉 C35） | **P0** | Codex `policy.rs:403` |
| C44 | **规则自带 `match`/`not_match` 样例，加载期校验** | **P0** | Codex execpolicy |
| C45 | **权限配置 linter**：检出"永不生效"的模式（通配符用在内置工具上、名字不完整、未知工具） | **P0** | kimi-code `evaluate.ts:85` |
| C46 | **保留元数据路径**（`.git` / 指令文件 / 配置目录）硬拦，**规则不得授权** | **P0** | Codex `permissions.rs:36-38` |
| C47 | **批准的持久化作用域显式化**：一次性 / 会话 / 项目 / 用户 / 受管 | **P0** | Codex `ReviewDecision` 7 变体 |
| C48 | **规则提案由引擎计算，模型只能发命令**（C35 的结构解） | **P0** | Codex `ExecPolicyAmendment` |
| C49 | **多来源权限按交集合成，无交集则拒绝启动**（不可合成时报错，不放宽） | **P0** | Codex `permission_profile_intersection.rs` + kimi `isToolActiveComposed` |
| C50 | **审批超时/取消必须带类型地失败**，禁止静默默认 | **P0** | ZCode `broker.ts:110` + Codex `TimedOut` |
| C51 | **默认权限实现是拒绝**（未配置权限客户端 = deny） | **P0** | ZCode `DenyPermissionBroker` |
| C52 | **审批支持 `modifiedInput`**（改成这样再执行） | P1 | ZCode `turn-machine.ts:251` |
| C53 | basename 规则必须绑**绝对路径清单**（反解释器路径绕过） | P1 | Codex `host_executable` |
| C54 | 审批来源分类配置（5 类）；**关闭某类 ≠ 放行 = 硬拒绝** | P1 | Codex `GranularApprovalConfig` |
| C55 | `justification` 必填；`forbidden` 须给替代做法 | P2 | Codex execpolicy |
| C56 | 若做 LLM 判官，P0 定四件事：abstain 落回人 / 判官自身预算 / 超时常量被上层复用 / 受管可强制 | P1 | Codex `guardian/` |

**★ C43–C51 九条全部是 P0，且互相独立** —— 这是本轮最大的需求增量。

**E / F / J 层**

| 编号 | 条目 | 优先级 | 来源 |
| --- | --- | --- | --- |
| E16 | **每域一个 `fold`，同时用作投影与不变量校验；写入前校验"已有流+新事件"** | **P0** | DSH 38 处 `invariant.ts` |
| E17 | **原子操作的中间态（reservation/promoting/rollback）也进事件流**，投影不猜 | P1 | ZCode `session.events.ts` |
| F11 | **压缩/截断切点必须工具调用-结果配平**，且从内容现算（不依赖可能被重写的 step 标记） | **P0** | DSH `tool-pairing.ts` |
| F12 | **模型流中断恢复**：锚点先于故障持久化 / 有界重试 / **显式终态 `blocked`** | P1 | ZCode `StreamRecovery*` 6 事件 |
| F13 | **压缩分两级**（microcompact 与 compact 各有边界事件） | P2 | ZCode |
| J21 | **超时必须带错误码作用域**（多层嵌套时判定"谁超时"不能靠 signal） | **P0** | DSH `timeout-policy` |
| J22 | **区分三种超时**：总时长 / 空闲 / **可重臂空闲**（有传输活动则续期） | P1 | DSH `IdleWatchdog.pulse()` |
| J23 | **`setTimeout` 上限 2^31-1**（超出被静默钳到 1ms） | P1 | DSH `MAX_TIMER_DELAY_MS` |

**B 层**

| 编号 | 条目 | 优先级 | 来源 |
| --- | --- | --- | --- |
| B14 | **凡设工作量上限处要两个轴：数量 + 时间**；**时间轴须在长循环内部检查** | **P0** | kimi `budget.ts` `tick()`/`progress()` |
| B15 | **每次调用不同的约束不得进工具 schema**（schema 是全局的，有效模式是每调用真相） | P1 | DSH `escalation.ts` |
| B16 | 工具声明的元数据**按 step 快照保留**，执行期用当初的清单 | P1 | Codex `parallel.rs` |
| B17 | 工具并发用**一把 `RwLock`**：读=并行、写=排他；**未声明即不可并行** | P1 | Codex `parallel.rs:191` |
| B18 | 超时参数**三档合并**（提示/默认/上限），**非法值抛错，上限不可关闭** | P1 | DSH `clampTimeout` |

**D 层**

| 编号 | 条目 | 优先级 | 来源 |
| --- | --- | --- | --- |
| D15 | **沙箱升级只能"严格更宽"**（阶梯表），且**执行期算，不进 schema** | P1 | DSH `WIDER_MODES` |
| D16 | **网络隔离需 OS 身份 + WFP**，Job Object 只管进程生命周期，**不够** | **P0**（见待定8） | Codex `windows-sandbox-rs` |

**I / Q / 全局**

| 编号 | 条目 | 优先级 | 来源 |
| --- | --- | --- | --- |
| I16 | 插件清单**安装期**全量校验、闭集枚举、**未实现的能力直接拒绝声明**（不是忽略/警告） | P1 | pi-desktop `plugins/validation.rs` |
| I17 | hook 复核结论**可被 `superseded`**，且取代本身是持久事实 | P2 | ZCode |
| I18 | 治理逻辑（重复工具提醒、超时策略）做成**可插拔插件** | P2 | DSH `guard/` |
| Q2 | **启动期对账**：把上次崩溃遗留的 `running` 全部改为 `interrupted`，**按对象类型细分错误码** | **P0** | pi-desktop `boot_maintenance` |
| Q3 | 保留策略常量：审计 90 天 / 任务运行记录 100 条 | P2 | pi-desktop |
| 全局 | **深度/递归上限要写实测溢出点与余量倍数**（进 `AGENTS.md`） | P1 | kimi `README` |
| 全局 | **畸形输入永不抛异常，降级返回 + 显式错误标志** | P1 | kimi |
| 全局 | **性能断言进测试套件防复杂度退化**（不是防慢） | P2 | kimi |
| 全局 | **以某上游为蓝本须产出 `known-diffs` 清单**（对齐 + 记录分歧） | P2 | kimi `known-diffs.txt` |

#### 12.2 本轮跨仓共性（三个独立实现给出同一答案）

1. **多来源权限合成只能"取交/取最严"，不能"覆盖"**
   —— Codex `permission_profile_intersection` + kimi `isToolActiveComposed` + pi-desktop `config_sync/merge.rs`（拒绝 last-write-wins）。**三次独立。**
2. **"配置写错了但静默不生效"是真实故障模式，必须有工具检出**
   —— Codex `match`/`not_match`（加载期校验）+ kimi `findInactiveToolPatterns`（linter）。**两次独立，两种语言。**
3. **审批超时必须带类型地失败，不能静默默认**
   —— ZCode `PermissionTimeout` reject + Codex `TimedOut` 一等结局。对照 hermes-agent 的静默超时 bug。
4. **工具失败后的处置，两个仓给出相反答案** —— ZCode「失败即收口」vs pi-desktop ADR 0207「3 次重试预算」。**我方选 pi-desktop。**

#### 12.3 新增待定

**待定8：Windows 上是否接受"建 OS 账户"这个前提？**
Codex 用两个真实本地账户（`CodexSandboxOffline`/`CodexSandboxOnline`）+ WFP 防火墙
实现网络隔离。接受 → 有真隔离但工程量大（账户/DPAPI/WFP/隐藏/提权安装/卸载）；
不接受 → **必须显式声明"网络策略只在工具层生效，对任意子进程不可强制"**（诚实的弱承诺）。
**与待定7（agent 是否出进程）同级，共同决定 D 层边界。**

**待定9：`permissionUpdates` 由谁产生？**
ZCode 允许审批结果携带权限配置更新。**若允许模型填，就是 C35 那个缺口**；
Codex 的做法是引擎算提案、用户接受。**必须选边。**（与 C48 相关。）

**待定10：我方的 shell 权限分析做到哪一档？**
三档：Codex 前缀 token 匹配 / qwen-code shell 语义分析 / kimi-code 完整 bash 语法树。
对应三档工程成本。**"承诺的保护强度到哪一档"必须显式选，不能默认。**
（`ls && rm -rf /` 的首 token 是 `ls` —— 这是前缀方案的固有软肋。）

**待定11：配置是否跨设备同步？**
pi-desktop 把 `config_sync` 做成了一等子系统：加密 vault + WebDAV + **三方合并** +
导入日志可崩溃恢复。**若要，这是独立子系统，不是"配置文件放哪儿"的问题。**
（注意：那里有 API key，加密不是可选项。）

#### 12.4 本轮确立的事实（无需决策，直接采纳）

- **turn → step → message 三级生命周期，第四个独立确认**（Codex `StepContext`/`step_settings`；
  前三个：pi 命名、Claude Code 契约、DSH durable step 边界）。`docs/l0-events.md` 决策 1 证据链闭合。
- **`l0-events.md` 的 `{kind:"interrupted"}` 有了实施主体**：由**启动期对账任务**发出（Q2）。
- **三种判决词汇表并存是合理的**（Codex：命令 `Allow/Prompt/Forbidden`、补丁 `AutoApprove/AskUser/Reject`、
  审批答复 `ReviewDecision` 7 变体、判官裁决 `Allow/Deny`）。
  **此前"统一权限词汇表"的倾向应当撤回** —— 对象不同，类型就该不同。

#### 12.5 法律边界执行情况

- **`D:\下载\claude-code-source-mirror-main.zip` 本轮再次被点名要求阅读，未读、未解压、未引用。**
  理由：泄露的专有源码不存在"只看原理"的中间态；一旦接触，后续设计可能被追溯为衍生，
  对我方产品是净负。**合法最大值是 `refs/claude-official/mods/`（官方随插件发布的引擎类型声明）**，
  已读并记于 `docs/research/06-claude-code-official.md`。
- 本轮五仓许可复核：Codex Apache-2.0 / ZCode Apache-2.0 / kimi-code MIT / DSH MIT →
  **可参考实现，摘代码须留版权头 + 登记 `THIRD_PARTY.md`**；
  **pi-desktop LGPL-3.0 → 行为可学，代码不可整段抄入**（`15-pi-desktop.md` 已标注）。

---

### 13. 第六轮记录（主循环 / 压缩与持久化 / 执行层）

> 产出：`docs/research/11-codex.md`(320) / `13-kimi-code.md`(169) /
> `10-zcode.md`(213)。另 `07-permission.md`(272) 记于本轮前段。

#### 13.1 Codex 压缩与持久化（用户指定"最好用"）—— 新增 13 条

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| F14 | **压缩是生命周期**（开始/结束事件 + hook 可介入/中止），不是函数；换实现不影响观察者 | **P0** |
| F15 | **压缩有相位**：`StandaloneTurn/PreTurn/MidTurn/PostTurn`；**MidTurn 必须支持** | **P0** |
| F16 | **压缩后重建上下文用"压缩那一刻"的状态**，不用压缩前快照 | **P0** |
| F17 | **压缩须声明"哪些消息不可丢"**（客户/插件注入的 developer 消息），给独立预算 | **P0** |
| F19 | **换到更小上下文的模型时必须先压缩**（`ModelDownshift`） | **P0** |
| M10 | **预算是"要送达的事实"**：分级阈值 + 送达记账（写历史后才算送达，取消则重试）+ 换窗重置 | **P0** |
| F18 | **上下文窗口编号化**；压缩 = 开新窗口 + 持久化窗口元数据 | P1 |
| F20 | **压缩结果带指纹**（配置哈希），指纹变了重压 | P1 |
| F21 | 压缩策略具名（摘要式 / 前缀式） | P2 |
| L8 | 压缩作为结构化度量事件，6 维度：trigger/reason/implementation/phase/strategy/status | P1 |
| J24 | 输出 token 与非缓存输入 token **不同价**，预算按权重计 | P1 |
| **Q4** | **日志冷热分离 + 后台 zstd 压缩 + 表示形态对上层透明 + 原子替换保权限 + 运行标记防重叠** | **P1** |
| Q5 | 归档是独立一档（`ARCHIVED_SESSIONS_SUBDIR`），不是删除 | P2 |

#### 13.2 kimi-code 主循环 —— 新增 6 条

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **J25** | **重试按显式错误分类；未知错误不重试**；退避带 jitter；**尊重服务端 Retry-After** | **P0** |
| J26 | `retrying` 作为**一等事件**，带 `failedAttempt` | P1 |
| B20 | 每步上报 `timing` 与 `traceId` | P1 |
| A11 | **入队闸门三态**：放行 / 拦截（带理由）/ **改写消息** | P1 |
| A12 | 循环有两个**显式护栏参数**：`abortTimeoutMs` 与 `maxStepsPerTurn` | P1 |
| E20 | **回合结局与该回合产出的消息一起结算**（机器自报 `produced[]`），优于事后反推 | P1 |

**形态记录**：kimi 的循环是**三台状态图组合**（agent × turn × tool，自研 `xstate2`）。
这是五个仓里唯一的 statechart 方案。**记为形态参照，不作默认建议。**

#### 13.3 ZCode 执行层 —— 新增 7 条 + 1 条升级

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **F22** | **压缩抖动检测**：连续多次"极小工作量后又触发压缩"→ **硬失败**，错误带全部计数 | **P0** |
| **C63** | **限制性判定必须在执行点用"权威标识"重算**，不得依赖传递下来的元数据 | **P0** |
| A13 | **不同来源的输入在不同边界排空**（guide / queue / runtime commands 各一个点） | P1 |
| A14 | 输入排空后重置相关的启发式计数 | P2 |
| A15 | **协作式取消在每个 await 点后检查**，不只循环头 | P1 |
| B21 | **输出 token 上限应作为"可续跑事件"**，不是回合终态 → 重新考虑 `l0-events.md` 的 `max-tokens` | P1 |
| L9 | 循环内分段计时（mcp / tools 各自打点） | P2 |
| **F15** | ✅ **升级：三份独立证据** —— Codex 四相位 + ZCode `PreRequest/MidTurn` + pi-desktop ADR 0030（`1,077,172 vs 1,000,000` 事故） | **P0** |

#### 13.4 本轮新增的跨仓共性

**共性 #6：压缩有"相位"，且回合内部的压缩（MidTurn）是一等的。**
Codex `CompactionPhase` 四值 · ZCode `PreRequest/MidTurn` · pi-desktop ADR 0030（反例式证据）。
**三份独立，其中一个是用真实事故换来的。**

**共性 #7：限制性判定必须能从"持久标识"在执行点重算，不能信传递下来的元数据。**
ZCode `turn-loop.ts` 里那条修过 bug 的注释（automation 写工具按 `queryId` 重筛）
+ DSH `escalation.ts`（每次调用的约束不进全局 schema）。
**多端与恢复路径上丢失的元数据就是绕过口。**

#### 13.5 本轮唯一"只有一家有"的两个机制

1. **压缩抖动（rapid refill）的硬失败保护** —— 只有 ZCode。**我建议无条件采纳**（F22）：
   症状是"账单暴涨且看不到尽头"，没有保护就无法收敛。
2. **日志的 zstd 冷压缩 + 表示形态对上层透明** —— 只有 Codex。**建议整条采纳**（Q4）：
   这是事件源架构必然的债，且它**不影响热路径**，可以 P1 再上。

#### 13.6 诚实声明的汇总（两轮累计）

**六个仓（含 pi-desktop），以下区域两轮都没读：**

- **所有仓的测试，一个都没读。** `docs/review-prompt.md` 要的
  "怎么 mock LLM、怎么断言事件序列" —— **至今无答案**。最可惜的是
  `codex-rs/core/tests/suite/compact.rs`（**5,677 行**）与 `session/tests.rs`（**12,880 行**）。
- **Codex**：140 个 crate 里打开过的不超过 18 个；`compact.rs` 主体、
  `compact_remote_v2.rs`(1,273) 实现、`context_manager/history.rs`(1,225)、
  `rollout/recorder.rs`(2,249) 实现、`code-mode`(V8)、`app-server*`(6 crate)、`tui/`。
- **ZCode**：`methods/` 25,587 行里逐行读过的不超过 300 行；
  `steering.ts`(1,403) 与 `session-fork.ts`(1,487) 只读了函数表；
  `bootstrap/src/app/dynamic-workflow-run-*`（30+ 文件）**两轮都没读**。
- **kimi-code**：`loopService.ts` 2,285 行的**主体实现**仍未读；
  `human/agent/machine.ts`(949) 与 `turn.ts`(886) 的状态图定义只读了导出签名；
  `#human/xstate2`（自研状态图引擎）未读。
- **DSH**：`core/agent-loop` 本体、`core/tools`、`core/session`、`llm/`、`context/`、
  `client/` 全部未读。
- **pi-desktop**：`rpc/mod.rs`(**8,810，全仓最大**)、`sessions.rs`(6,779)、
  `tools/mod.rs`(4,435)、`config_sync/` 13 个文件只读了 `engine.rs` 的 import 区。

**上一轮 §12 与本节合计：需求文档新增 62 条、待定 11 条。**

---

### 14. 第七轮记录（测试基础设施 —— 补两轮点名的最大空白）

> 产出：`docs/research/20-testing.md`(259)。回答 `docs/review-prompt.md` §三C 的
> "怎么 mock LLM、怎么断言事件序列" —— **这两轮都没有答案的问题，本轮有了。**

#### 14.1 ★ 交叉结论：三个仓独立收敛到同一件事

> **不要在内部状态上断言，要断言"模型实际看到/产生的那个东西"，并归一化后做成快照。**

| 仓 | 快照什么 | 实现 |
| --- | --- | --- |
| Codex | **模型上下文**（请求体） | `core/tests/common/context_snapshot.rs`(806) + `insta` |
| kimi-code | 事件 / **模型输入** / RPC / wire | `test/harness/snapshots.ts`(388) |
| DSH | 会话日志 + **模型流** | `packages/test-support/session-snapshot/` + `llm-replay/` |

**Codex 与 kimi 各自独立地把"发给模型的输入"当作最该被快照的对象。**

#### 14.2 新增需求项（O 层，测试）—— 11 条，3 条 P0

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **O1** | **主断言面 = 归一化 + 差分后的"模型上下文"快照** | **P0** |
| **O2** | **在网络边界 mock**：假 HTTP 服务器 + 脚本化 SSE 序列（每次模型调用消费一个） | **P0** |
| **O4** | **易变值必须归一化**（路径/ID/时间戳/元数据），否则快照无法稳定 | **P0** |
| O3 | mock 记录全部请求 + "断言请求数量"的访问器 | P1 |
| O5 | **窗口内差分快照**：首条全量、后续只留新增后缀 | P1 |
| O6 | 长行截断（160 字符）+ 已知长指引替换成一行标签 | P2 |
| **O7** | **录制/回放**真实模型流（`llm-replay`），避免手写 mock 漂移 | **P1** |
| **O8** | **故障注入服务器**（`llm-mock-server`）——恢复类逻辑必须能注入故障才可测 | **P1** |
| O9 | 持久化可整体替换为内存实现 | P1 |
| O10 | keyless 快照层作为**写下来的测试政策**；测试基础设施自成包组且有升降级规则 | P2 |
| **O12** | **迁移断言**：旧字段不再被读 / 旧入口已退役 / 迁移后可恢复（ZCode 唯一的一类测试） | P1 |

#### 14.3 三条具体机制（可直接抄）

1. **Codex `mount_sse_sequence(server, Vec<String>)`** —— 按模型调用次数挂脚本 SSE；
   测试跑**真实 HTTP 路径、真实 SSE 解析、真实会话循环**，只有"对面的模型"是假的。
2. **Codex 上下文快照是差分式的** —— "首个请求在窗口内保留全部输入，后续请求只保留后缀索引"。
   这是它同时做到"可读"与"测试不爆炸"的原因。
3. **DSH `test-support` 是一个 7 包、22,817 行的包组**，含
   **`llm-replay`（录制/回放真实流）** 与 **`llm-mock-server`（故障服务器）**。
   **把"注入故障"当作一等测试能力** —— 我读过的其他仓都只 mock happy path。

#### 14.4 一个负面发现

**ZCode 全仓只有 4 个测试文件**（重查确认，排除 `node_modules`/`dist`；`test` 目录全仓仅 2 个），
且四个**全部是"迁移/退役"类**：`importedClaudeRecovery` / `nonCliAcpRetirement` /
`providerConfigMigration`。
**作为 122M、四种 surface 的产品仓，这是六个仓里测试覆盖最弱的。不作为正面示范。**
但其唯一一类测试本身有参考价值 → 已记为 **O12（迁移断言）**。

#### 14.5 诚实声明的补正

**本轮读的是"测试基础设施"，不是"测试"。**
具体到"某一条 `insta::assert_snapshot!` 里到底断言了什么字符串"——**我一条都没看**。
未读：`codex/tests/suite/compact.rs`(5,677) 与 `session/tests.rs`(12,880) 的本体、
190 个 suite 文件、kimi `harness/agent.ts`(2,909) 的实现、
DSH 7 个包的 22,817 行实现、pi-desktop 各 `tests.rs` 的内容。

---

### 15. 第八轮记录（测试断言深读 + 归一化实现）

> 产出：`docs/research/20-testing.md`(273)。补上一轮 §6 自己点名的
> "某一条 `insta::assert_snapshot!` 里到底断言了什么字符串——我一条都没看"。

#### 15.1 ★ Codex 快照的真实长相（已读到全文，39 行）

```
### Window 2 (after request 1: settings changed (parallel_tool_calls, tools))
-- request 2 (compaction) --
00:message/developer:     <PERMISSIONS_INSTRUCTIONS>
01:message/user:          <ENVIRONMENT_CONTEXT>
02:message/user:          function call limit push
03:function_call/test_tool:{}
04:function_call_output:  unsupported call: test_tool
05:message/user:          <SUMMARIZATION_PROMPT>
```

**五个要素**：①**窗口头写明"为何在此开新窗口"**（settings 变了 / 输入在第 N 条分叉）
②已知长段落折叠成一行标签 ③条目编号 `NN:kind` 且**窗口内连续**（故可用下标描述分叉点）
④`Scenario:` 一句自然语言把语义写在快照里（**快照本身即规格**）⑤测试名与快照名一致，
**每个压缩相位/原因各一条**（compact 共 8 条快照，全仓 43 条）。

#### 15.2 ★★ 事件序列的断言方式（此前两轮无答案，现已明确）

`compact.rs:450` `assert_compaction_uses_turn_lifecycle_id` —— **不断言事件列表**，
而是消费真实事件流并断言**身份不变量**：

```rust
while turn_completed_id.is_none() {
    let event = codex.next_event().await.expect("next event");
    match event.msg {
        EventMsg::TurnStarted(_)   => turn_started_id = Some(event.id.clone()),
        EventMsg::ItemStarted(ItemStartedEvent { item: TurnItem::ContextCompaction(_), .. })
                                   => compact_started_id = Some(event.id.clone()),
        EventMsg::Error(error)     => panic!("unexpected compaction error: {error:?}"),
        EventMsg::TurnComplete(_)  => turn_completed_id = Some(event.id.clone()),
        _ => {}
    }
}
assert_eq!(turn_completed_id, turn_started_id, "turn start and complete should use the same event id");
assert_eq!(compact_started_id, Some(turn_started_id.clone()), "compaction item start should use the turn event id");
```

**锁住的是"一个回合内所有条目都携带该回合的事件 id"** —— 这是客户端把 item 归到 turn 的**身份契约**。
不脆（新增事件类型不用改测试）、测真流、**模式匹配钉住类型与载荷形状（编译期即炸）**、
不期望的事件**直接 panic**。

#### 15.3 ★ 结构化断言与快照**配对**

```rust
assert_eq!(compact["model"].as_str(),   Some(previous_model));  // ★ 压缩用【旧】模型
assert_eq!(follow_up["model"].as_str(), Some(next_model));      // ★ 后续用【新】模型
assert!(body_contains_text(&compact_body, SUMMARIZATION_PROMPT), "…should include summarization prompt");
assert!(!compact_body.contains("<model_switch>"), "…should strip trailing model-switch update item");
```

**分工：少数关键语义用 `assert` + 一句人话（失败时可读）；其余全部交给快照（全覆盖）。**
且**先断言模型调用次数**（`assert_eq!(requests.len(), 3, "expected user, compact, and follow-up requests")`）。

#### 15.4 DSH 的归一化实现（`session-snapshot/src/normalize.ts`，625 行）

模块注释原文：
> They scrub **session ids, run cwd, RPC ids, timestamps, goal lifecycle clocks, and hook duration**
> while **preserving semantic payload values**.

**★ 关键决策：易变值换成"具名占位符"，不是通用 `<redacted>`：**
`{{sessionId}}` `{{messageId}}` `{{usedTokens}}` `{{cwd}}` `{{system}}` `{{tools}}` `{{eventTime}}`
`{{eventOmittedBytes}}` `{{sourceSessionFormatVersion}}`
—— **保留"这里曾有 session id"这个结构信息**，同时让两个不同会话归一化成同一文本。

**路径归一化是真正的工作量**（本文件最大部分）：处理 cwd 的**多种拼写**
（`cwdSpellings` / `isCwdMatch` / `replaceCwdSpelling`）、`<path>` 标签、`file:///` 前缀、
basename 匹配的**词边界**（`PATH_TEXT_BOUNDARY_RE`）、spill 文件路径规范化。
另有 `EVENT_OMITTED_BYTES_RE`（省略字节数）、`UUID_RE`、`PACKED_CHUNK_ROW_TYPES`
（text/reasoning/tool-call chunks 整类归一）、`omitFixtureEnvelope` 删 `seq/time/seq0/time0`
（**有 seq0/time0 ⇒ 存在增量编码的基准值**）。

**且归一化自己有 1,259 行测试**（`normalize.spec.ts`）—— **测试比实现多**。

#### 15.5 新增需求项 —— 8 条，4 条 P0

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **O13** | **事件序列断言 = 在真实事件流上断言不变量**（同回合共享 id / 成对事件成对 / 终态恰一个），**不写事件列表** | **P0** |
| **O14** | **快照窗口头必须记录"窗口为何在此结束"**（settings 变 / 输入在第 N 条分叉） | **P0** |
| **O15** | **结构化断言与快照配对**：关键语义用 `assert` + 一句人话，其余交给快照 | **P0** |
| **O20** | **易变值用"具名占位符"而非通用 `<redacted>`**，保留结构信息；**归一化自己要有测试** | **P0** |
| O16 | 先断言**模型调用次数**（带说明），结构错了给可读失败 | P1 |
| O17 | 快照里写 `Scenario:` 一句自然语言 —— **快照本身即规格** | P1 |
| O18 | **每个相位/每个原因各有一条快照** | P1 |
| O19 | 不期望的事件直接 panic，不静默流过 | P2 |
| **F23** | **换模压缩语义**：压缩请求跑在**旧**模型上、后续跑在**新**模型上；压缩时剥掉 model-switch 更新项、后续带上 | **P1** |

**O 层现有 10 条 P0**（O1/O2/O4/O13/O14/O15/O20 + 前述）。

#### 15.6 诚实声明

**本轮仍只读了 Codex + DSH 各一小块。** `compact.rs` 6,577 行里我读了约 120 行；
`session/tests.rs`(12,880) 与其余 188 个 suite 文件未读；
kimi / pi-desktop / ZCode 的**任何一条真实断言**未读。

---

### 16. 第九轮记录（三家测试实现深读）

> 产出：`docs/research/20-testing.md`(308)。补上一轮 §6 自己列的三个下一步。

#### 16.1 Codex `session/tests.rs`（12,880 行，全仓最大测试文件）

**修正一个预期：它不是"事件序列测试"**，而是混合体，415 个测试按主题成簇：
托管网络代理（8+）、配置热重载（7+）、度量遥测（5+）、MCP elicitation、流解析器、
网络策略修订、中断/生命周期。

**两条顺带发现的设计（此前不知道）**：
- **配置解析失败时保留上一份配置**，**不回退默认值** —— 回退可能变宽松（fail-safe 方向正确）。
- **配置分两类**：可热刷新字段 vs 会话内静态设置。

**★ 测试名就是完整的行为规格**，把安全边界写进名字：
`user_shell_commands_do_not_inherit_managed_network_proxy` /
`danger_full_access_tool_attempts_do_not_enforce_managed_network` /
`reload_user_config_layer_keeps_previous_config_for_malformed_shell_policy`

**★ 事件断言的第二种写法**（与 `compact.rs` 的身份不变量并列）：

```rust
let first = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await
    .expect("expected turn started event without waiting for startup prewarm")
    .expect("channel open");
assert!(matches!(
    first.msg,
    EventMsg::TurnStarted(TurnStartedEvent { turn_id, .. }) if turn_id == tc.sub_id));
```

**要点**：①会话把事件推进 channel，测试逐条 recv，**顺序由连续 recv 表达**
②**每次 recv 都套 timeout + 具名 expect**（事件驱动测试最坏的失败是"挂住"）
③`matches!` 匹配**变体 + 载荷形状 + 字段关系（`if` 守卫）**，改名在编译期就炸
④中断路径中途的 `EventMsg::RawResponseItem(_)` 标记事件也被钉住。

**两种风格各有强弱，都应保留**：身份不变量不脆但锁不住顺序；有序迁移锁得住顺序但事件多了会脆。

#### 16.2 kimi `snapshots.ts` —— 差分在**序列化时**算

- 用 **Symbol 标记 + `expect.addSnapshotSerializer`**：输出格式是 harness 的职责。
- **事件快照**：`[wire]`/`[emit]` 前缀 + 事件名 `padEnd` 列对齐 + **JSON 压成一行**；
  **domain 事件与 RPC 调用在同一条流里按序交错**。
- **模型输入快照**：`GenerateInputSnapshot { input, previous }` —— **快照结构自带前一次调用**，
  差分不需要测试作者手写。
- **★ 稳定标签**（`uuidLabels`/`msgLabels`/`interactionLabels`）：
  同一批快照内每个不同 UUID 映射到固定标签 —— **保留身份**，
  于是仍可断言"同一 id 出现在事件 1、5、9"。**比 DSH 的 `{{sessionId}}` 占位符更进一步。**

#### 16.3 pi-desktop —— 进程全局状态的测试隔离

```rust
/// The marketplace source is process-global, so two tests pointing it at different
/// catalogs — or one clearing it while another is mid-fetch — read each other's value.
static MARKET_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
```
配 `with_local_market(f)`：RAII 守卫围住"设变量 + 跑 + 清变量"，
`unwrap_or_else(|e| e.into_inner())` 处理中毒，`unsafe` 带 `// Safety:` 说明。
且用"指向不存在的 URL"**强制走离线回退**，让有网络行为的代码变成确定性单测。

#### 16.4 新增需求项 —— 10 条，3 条 P0

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **O21** | 事件 id 用**稳定标签**而非通用占位符（保留身份） | **P0** |
| **O22** | 快照**结构里自带 previous**，差分在**序列化时**算 | **P0** |
| **O23** | **每次 recv 都要超时 + 具名期望**（防"挂住"） | **P0** |
| O24 | 事件流快照**列对齐 + 单行 JSON**；domain 与 RPC/wire 事件同流交错 | P1 |
| O25 | system prompt / tools **只在变化时打印**；等于默认值折叠成标签（**使缓存前缀稳定性可测**） | P1 |
| O26 | **进程全局状态必须有隔离机制**，且注释写明故障机制 | P1 |
| O27 | **测试名写成完整行为规格**，把安全边界写进名字 | P1 |
| O28 | 断言跨组件因果（"装完必须出现在注册表"），不只断言字段值 | P2 |
| **F24** | **配置解析失败保留上一份配置**，不回退默认 | **P1** |
| **B22** | 配置分两类：**可热刷新字段** vs **会话内静态设置** | P1 |

#### 16.5 一个负面发现（建议不采纳 kimi 的做法）

**kimi 的 tools 快照只打印工具名，不打印 schema** ——
而工具 schema 恰是**缓存前缀稳定性**与**模型行为**的关键输入。
**Codex 的 `portable_tool_schema` 把 schema 纳入归一化后打印。建议采纳 Codex 的。**

#### 16.6 诚实声明（累计）

**六轮下来，测试这块我读的仍是"方法论与骨架"，不是"测试内容"：**

- `session/tests.rs` 12,880 行读了约 90 行（**415 个测试里 414 个未读**）
- `compact.rs` 6,577 行读了约 120 行
- kimi `snapshots.ts` 388 行读了约 200 行；`harness/agent.ts`(2,909) **仍未读**
- pi-desktop `plugins/tests.rs` 2,186 行读了约 60 行；其余 8 个 `tests.rs` 未读
- DSH 7 个测试包 22,817 行 **一行实现未读**；kimi/pi-desktop/ZCode 的任何一条真实断言未读
- 其余 188 个 Codex suite 文件未读
