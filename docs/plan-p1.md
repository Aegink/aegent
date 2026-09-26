# P1 实施计划 · 批次 1

**状态**：v1.1 · 批次 1 收官（13/13 卡 + 终验收）· 批次 2 卡序已展（T-P1-14 ~ 23，2026-09-26，依据 [`20260926_P2研究_批次圈定建议.md`](20260926_P2研究_批次圈定建议.md) 路线一裁决）
**执行协议**：沿用 [`plan-p0.md`](plan-p0.md) §0（取卡 / 做卡 / 验收 / 打勾 / 提交 / 自动继续 / 四种停下情况），本文件不复制。执行进度追加在 [`plan-p0-progress.md`](plan-p0-progress.md)（台账 / 待澄清 / 人工确认清单共用一个文件）。
**需求来源**：[`requirements.md`](requirements.md) §4 的 P1 项（共 158 条）。P1 不切阶段（§1 尾注），按**批次**组织：本文件当前只含批次 1，后续批次轮到时再展卡追加。
**批次 1 范围**（用户圈定于 2026-09-25，四组全选，共 26 条）：

| 组 | 需求 | 卡 |
| --- | --- | --- |
| C22/C46 权限聚合 | C22 · C24 · C45 · C46 · C49（+P0 遗留债：ApprovalScopeCache 接线、intersect/linter 装配） | T-P1-01 ~ 03 |
| J6 换模 | J6 · J7 · J8 · J9 · J10 · J11 · J14 | T-P1-04 ~ 06 |
| I 层扩展面 | I1 · I2 · I6 · I9 · I13 | T-P1-07 ~ 09 |
| G 层 Planning | G1 · G2 · G3 · G4 · G5 · G6 · G7 | T-P1-10 ~ 13 |

**锚点纪律**：批次 1 全部 18 处锚点已于 2026-09-25 展卡时逐一打开核对（文件存在 + 关键行/符号命中，核对记录见各卡「证据强度」）；`oss/SOURCES.lock` 为 2026-09-25 快照，执行会话开工前仍按 §2.5 跑 `bash tools/snapshot.sh` + `git diff oss/SOURCES.lock`。

---

## 批次 1 全局约束

1. **装配层是唯一接线落点**：P1 功能接线一律走 `src/kernel/assembly.ts`（阶段 8 产物），不绕过它开旁路；多来源 / 双轨等"第二来源"场景出现时，intersect（T-P1-03）在装配处组合，不在工具或 loop 里私接。
2. **词汇表扩展走既有流程**：P0 先例（`session/revert`、`compaction.reason`）——新增事件/字段必须 C16 `assertNever` 同步、`l0-events.md` §8 记落地记录、进度文件待澄清表立案供用户追认。本批次 T-P1-06（换模）/ T-P1-10（todo）/ T-P1-12（goal）预计各需 1 个新事件。
3. **跨卡依赖**：T-P1-11（G7 硬关）复用 T-P1-01（C46 出口级机制）；T-P1-13（G4 计划落盘）依赖 T-P1-11（plan 模式）；T-P1-09 的双轨分层是 T-P1-07 HookRegistry 的信任维度。其余卡按下列顺序即满足依赖。
4. **不做什么**（本批次）：不切阶段；不做 F 组（摘要质量 F5、缓存优化 F6/F13–F15 等，批次 2 候选）；不做 Q3 spill 清理、B8 全族（todo 工具在 T-P1-10 以最小面随 G2 落地）、H 层子代理、K 层新端、N9/N10 配置同步；不做 OAuth/LLM 判官（P2）。

---

## 卡序（13 张，按依赖排序）

#### T-P1-01 · C46 · 出口级元数据路径硬拦（关闭 shell 虚拟操作层序旁路） `[x]`
- **依据需求**：C46（P1 接线；P0 已落 withProtectedPaths 于链上模块）
- **上游首选参考**：[codex·permissions.rs:35-40](../oss/codex/codex-rs/protocol/src/permissions.rs#L35)（`PROTECTED_METADATA_{GIT,AGENTS,CODEX}_PATH_NAME` 常量 + "Top-level workspace metadata paths that stay protected under writable roots" 注释——硬拦在出口，不在规则层）
- **取什么 / 别抄什么**：取"受保护路径是出口属性、规则不得授权"的结构位置；我方已有 `aggregate.ts` 的 `withProtectedPaths`（T-5-06）与 `.git/.agents/.codex` 清单，**本卡只移位置不改清单**——把硬拦从链上模块（可被用户层 allow 先匹配压过，T-5-14 LIMITATIONS #7）升为执行出口的最终组合（gate 输出 / registry.dispatch 执行点，与 C57 revalidate 同位）
- **证据强度**：`读了代码`（permissions.rs:30-40 原文；我方 aggregate.ts/gate.ts/revalidate.ts 现状）
- **要产出**：`src/policy/exit-guard.ts`（出口级组合：`max(链裁决, 硬拦)`，plan/写/执行类工具与 shell 虚拟 file-write/file-read 操作全部过闸）+ 接线进 assembly.ts + 单测
- **验收**：`npx vitest run src/policy/exit-guard.test.ts`——①用户层 allow 规则显式匹配 `.git/config` 写操作（含 bash 重定向虚拟操作）→ 仍 deny 且理由含"硬拦"；②同规则对非保护路径不产生新拦截（对照）；③T-5-14 LIMITATIONS #7 描述的"用户 allow 先于语义分析"场景复现用例转绿；④出口级与 C57 重算共存不双重拒绝
- **依赖**：无（批次 1 首卡）
- **风险 / 未知**：硬拦位置选 gate 输出还是 dispatch 执行点——两处都过 C57 的权威标识纪律；若与 revalidate 的 guard 钩子职责重叠，以"guard 剥标记、exit-guard 管路径"划界并记卡面
- **偏离 / 建议**：①清单与段匹配拆出 `protected-names.ts`（唯一权威）——protected-paths（出口）与 shell-semantics（扫描器）各自单向 import，避免出口反向消费扫描器成环；protected-paths re-export 保持既有 import 面；②gate.ts **零改动**——层内自调 enforceProtectedPaths 自动获得 bash 分支；③revalidate.ts 的 createRevalidator 出口补 enforceProtectedPaths（不依赖装配方记得包 withProtectedPaths）；④LIMITATIONS #7 改写且双载体同步：语义裁决（uncertain/危险/cd 保守）仍在链上受层序影响，保留名单硬拦升出口级；⑤aggregate.test 的"bash 不在本拦面"用例注释更新（断言不变：rm 非重定向写，链上危险模式兜底）
- **完成记录**：2026-09-25。产出 `src/policy/protected-names.ts`（清单唯一权威）+ `protected-paths.ts` 扩 bash 虚拟写出口分支（analyzeShellCommand 的 file-write 目标过段匹配）+ `revalidate.ts` 出口同位 + `exit-guard.test.ts` 10 用例。验收：`npx vitest run src/policy/exit-guard.test.ts` → **10 passed**；③号验收（#7 旁路复现转绿）：用户层 `bash(echo *)` allow 先匹配胜、链裁决 allow、出口压 deny 且理由含"硬拦"；②对照非保护路径透传；④revalidator 链 abstain + .git 重定向 → 拒绝、伪造 approved 标记剥除与硬拦共存。全量 `npx vitest run` **487 passed / 1 skipped**，`npx tsc --noEmit` 干净。

#### T-P1-02 · C22/C24/G5 · 规则作用域四档 + 审批 scope/feedback 通道 `[x]`
- **依据需求**：C22（P1）· C24（P1）· G5（P1，自研）
- **上游首选参考**：[kimi·interaction/approval.ts:18-19](../oss/kimi-code/packages/agent-core-v2/src/agent/interaction/approval.ts#L18)（`scope?: 'session'` + `feedback?: string` 字段形状）；[kimi·permissionRules/](../oss/kimi-code/packages/agent-core-v2/src/agent/permissionRules)（五文件分层：configSection/permissionRules/permissionRulesOps/Service——作用域是规则集的装载维度）
- **取什么 / 别抄什么**：取 kimi 的审批响应字段形状与"作用域决定规则进哪层"的分法；别抄其 Service/标识符注入架构（我方无 Effect）；G5 悬置审批超时 P0 已有 `PermissionTimeout`，本卡只把它从"每 broker 必填常量"升为可配策略并保住"不留永久挂起"验收
- **证据强度**：`读了代码`（approval.ts 字段、permissionRules 目录五文件名与职责；我方 review-decision.ts / owner-port.ts / repl.ts 现状）
- **要产出**：①C22：规则作用域四档 `project / user / turn-override / session-runtime`——会话批准的规则进 session-runtime 层（内存、随会话灭），绝不写用户配置文件；②C24：`/approve` 命令面扩 `scope`（once/session）与可选 `feedback`，feedback 落 L2 审计字段；③ApprovalScopeCache 接线进 owner 通道答复路径（T-8-01 偏离⑤关闭）；④G5：审批超时策略可配 + 悬置清单可查
- **验收**：`npx vitest run src/policy/scope-cache.test.ts src/session/owner-port.test.ts`——①`/approve scope=session` 后同会话同规则免再问、新会话重新问（P0 review-decision 用例扩到 CLI 级联测）；②批准记录不落用户配置文件（证伪 grep）；③带 feedback 的答复在审计面可检索；④turn-override 作用域规则在 turn 结束失效
- **依赖**：T-P1-01（出口级在位后，session-runtime 规则层不得含硬拦路径授权——同一出口验证）
- **风险 / 未知**：repl.ts 的 `/approve` 解析扩展要与既有参数兼容；turn-override 是四档里唯一带生命周期的，若与 T-3-03 队列语义冲突降为三档并记待澄清
- **偏离 / 建议**：①C22 四档落法——project/user 由配置规则集承载（既有），session-runtime 由 ApprovalScopeCache 承载（本卡装配进链），turn-override 新建 `rule-scope.ts`（TurnScopeRules：显式 endTurn 剪除失效，能力面先行，产生面随审批 scope=turn UX 接线）；②**write/edit 工具无 patternOf**（builtinRuleMatchers 只登记 bash）——其批准结构上只能 once（C48：无法提取 pattern 就不能升级为规则），session 缓存对 bash 生效、对 write/edit 不生效，这是 C48 纪律的自然结果非缺陷，新工具登记匹配器后自动获得；③approvalTimeoutMs 装配可配已有（G5 策略面），悬置清单 listPending 既有
- **完成记录**：2026-09-25。产出 `src/policy/rule-scope.ts` + ApprovalReply 扩 scope/feedback + 协议 approve 扩字段（闭集校验）+ agent-process/assembly 全链传参 + **createSessionApprovalModule 装配进 policyChain core 层**（T-8-01 偏离⑤关闭：scope=session 批准经 proposeAmendment 算提案后 record）+ repl `/approve` 扩 `--session`/`--feedback` + feedback 落 L2 审计记录。验收：`npx vitest run src/policy/scope-cache.test.ts` 不存在该文件名，实际按产出拆 `src/policy/rule-scope.test.ts`（4 passed，含验收④ endTurn 失效）+ `src/cli/cli.test.ts` 扩 2 级联测（--session 后 call_2 免再问且放行恰 1 次；once 对照第二轮再问）+ audit-fields/pending 扩 feedback 透传；②证伪 grep `writeFile|appendFile` in src/policy/ = 0 行（批准记录不落任何文件）。全量 `npx vitest run` **494 passed / 1 skipped**，`npx tsc --noEmit` 干净。

#### T-P1-03 · C49/C45 · intersect 与 linter 的装配接线 `[x]`
- **依据需求**：C49（P1 接线；纯函数 T-5-09 已交付）· C45（P1 接线；linter T-5-07 已交付）
- **上游首选参考**：[codex·permission_profile_intersection.rs:37](../oss/codex/codex-rs/protocol/src/permission_profile_intersection.rs#L37)（`intersect_effective_permission_profiles`——多来源在会话启动时合成，不可合成报错）；[kimi·toolPolicy/evaluate.ts:85](../oss/kimi-code/packages/agent-core-v2/src/agent/toolPolicy/evaluate.ts#L85)（`findInactiveToolPatterns` 常开）
- **取什么 / 别抄什么**：取"交集合成发生在装配/启动期，产出不可变有效集"的时点；我方 `intersect.ts` 纯函数与 `linter.ts` 不改语义，只接进 `assembly.ts`（多来源 profile 出现时合成）与 `rule-loader.ts`（加载后跑 linter，警告落日志/事件）
- **证据强度**：`读了代码`（intersection.rs:37 签名；我方 intersect.ts/linter.ts/rule-loader.ts 现状）
- **要产出**：assembly.ts 多来源组合路径（≥2 来源 → intersect → 交集作为链输入；opaque 相遇启动报错沿用 fail-closed）+ rule-loader 加载后 linter 常开接线 + 单测
- **验收**：`npx vitest run src/policy/aggregate.test.ts src/policy/rule-loader.test.ts`（扩用例）——①两来源 profile 交集后 deny 保留、allow 收窄、总不放宽（复用 T-5-06 单调性断言）；②单来源路径行为与 P0 逐字节一致（回归）；③含永不生效模式的规则集加载时 linter 警告可检索
- **依赖**：无（与 T-P1-01/02 并行安全，脚本按序则在其后）
- **风险 / 未知**：P0 单来源装配的回归面——交集路径必须是"有第二来源才激活"，默认装配零行为变化
- **偏离 / 建议**：①ceiling 的生效点选**出口级**（gate 出口 + revalidator 同位 enforceCeiling，与 C46 同模式）而非链上模块——链是"首个非 undefined 者胜"（C58），ceiling 作为链模块会被用户层 allow 压过，违背"上限不因链序放宽"；②新增 `intersectAllProfiles` 折叠入口（空数组 → undefined，单来源原样返回）；③linter 的 knownToolNames 缺省 `BUILTIN_TOOL_NAMES`（builtin/index.ts 新导出，与注册清单同步维护），动态注册工具时由装配方传全量名单
- **完成记录**：2026-09-25。产出 `intersect.ts` 加 `intersectAllProfiles` + `enforceCeiling`（出口 max，保留链裁决 rule 证据维持 C18）+ gate/revalidator 加 `ceiling` 选项 + assembly 加 `permissionProfiles`/`knownToolNames` 选项并接线（opaque 折叠即抛 = 拒绝启动）+ linter 警告落 `logger.warn("policy-lint: …")`。验收：`npx vitest run src/policy/ceiling-exit.test.ts` → **9 passed**（①两来源交集 deny 保留/allow 收窄 + gate 集成"用户 allow 被上限收窄为 ask→broker 拒→零执行"②无 ceiling 同配置放行回归 ③坏规则装配 linter 警告可检索含 unknown-tool/invalid-syntax 两类）。全量 `npx vitest run` **503 passed / 1 skipped**，`npx tsc --noEmit` 干净。

#### T-P1-04 · J6/J7 · 运行时换模 + 在途 turn 模型捕获 `[x]`
- **依据需求**：J6（P1）· J7（P1）
- **上游首选参考**：[pi·agent-harness.ts:574](../oss/pi/packages/agent/src/harness/agent-harness.ts#L574)（`setModel(model, context): Promise<void>`）；[pi·agent-harness.ts:154](../oss/pi/packages/agent/src/harness/agent-harness.ts#L154)（`capturedModel?: ModelIdentity`——configured 与 captured 分离）
- **取什么 / 别抄什么**：取"换模请求立即受理、生效点在新 turn；在途 turn 用其启动时捕获的模型跑完"；我方模型身份已是二元组（T-2-01），provider 在装配注入（T-8-01）——本卡加"会话内模型注册表 + turn 启动捕获"层，不动 provider 适配层
- **证据强度**：`读了代码`（agent-harness.ts 两处关键行；我方 loop.ts/assembly.ts/agent-protocol.ts 现状）
- **要产出**：`src/kernel/model-switch.ts`（会话级模型选择状态：configured 当前值 + 每 turn captured 快照）+ owner-port/协议新命令 `model/switch` + 装配接线（loop 每轮启动从捕获值取 provider）+ 单测
- **验收**：`npx vitest run src/kernel/model-switch.test.ts`——①turn 进行中发换模 → 在途 turn 全程用旧模型（captured 断言）、下一 turn 用新模型；②换模到未注册模型报类型化错误不静默；③换模后 configured 与 captured 两值可分别观测
- **依赖**：无
- **风险 / 未知**：多 provider 共存时的注册表来源（装配注册 vs 配置发现）——P1 先装配注册，J12 选择器留后续批次
- **偏离 / 建议**：①协议 wire 的 identity 用内联 `{provider, modelId}` 形状而非 `ModelIdentity` interface 引用——`AgentRequest` 的 JsonValue 型证闸门（`AssertNever`）要求隐式索引签名，interface 不满足该规则；结构与 ModelIdentity 等同，消费方零转换；②换模状态不落事件：J6 最小面驻进程内存，`model/switch` 事件是 T-P1-06 词汇表扩展（14→15）的落点；captured 为**单一槽位**（在途 turn 语义，单会话单 loop），不养每 turn 一条的历史——换模历史事实由流内事件承载（不变量 1 的同构推论）；③loop 捕获时点在 turn/start 落盘**前**——装配侧坏状态（身份未注册）在污染事件流前爆出；④REPL `/model` 命令不在本卡面（协议/owner-port/装配三层已通），UX 面随 T-P1-05/06 或 CLI 批次；⑤"loop 每轮启动从捕获值取 provider"落为 loop deps 的 `modelForTurn?` 可选注入——未启用换模的装配零行为变化（P0 回归用例钉死）；⑥request/header 的 config 改记 payload.identity（捕获后的身份）——在途换模"生效点在新 turn"的事件证据就在 header 的身份变化里
- **完成记录**：2026-09-25。产出 `src/kernel/model-switch.ts`（ModelSwitchService：configured getter / switch 受理 / captureForTurn 捕获 / capturedFor 观测 / ModelNotRegisteredError code=MODEL_NOT_REGISTERED）+ `loop.ts` 的 `modelForTurn?`（turn 启动捕获存 turnModel 字段，runStep/callModel/header 全走捕获值）+ `agent-protocol.ts` 加 `model/switch` 命令（REQUEST_TYPES 闭集 + identity 非空校验 + JsonValue 型证自动覆盖）+ `owner-port.ts` 加同名命令变体（handler 可选，同 stop_generation 先例）+ `assembly.ts` 的 `models`/`initialIdentity` 选项（initialIdentity 无注册表 = 装配拒绝启动）+ `agent-process.ts` 协议 case（未装配→MODEL_SWITCH_UNAVAILABLE、未注册→MODEL_NOT_REGISTERED 类型化 error 行）。验收：`npx vitest run src/kernel/model-switch.test.ts` → **9 passed**：①loop 级 turn1 流中途换模 → turn1 两个 step 的 request/header 全是 m1（captured 断言的事件侧面）、内容 A#1/A#2，turn2 header m2、内容 B#1；②未注册 → ModelNotRegisteredError 且 configured 不动（受理原子性）；③configured 与 capturedFor 分别可观测 + 协议级全链 3 用例（合法换模下一 turn 生效 / 未注册 error 行 / 未装配 UNAVAILABLE）。连带 agent-protocol.test +1、owner-port.test +2（闭集分发与可选 handler）。全量 `npx vitest run` **515 passed / 1 skipped**，`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变。

#### T-P1-05 · J8/J11 · 换模事务性与四态状态机 `[x]`
- **依据需求**：J8（P1）· J11（P1）
- **上游首选参考**：[grok·agent.rs:647](../oss/grok-build/crates/codegen/xai-grok-pager/src/app/agent.rs#L647)（"A model switch stashed while no session exists, applied once the session id arrives (`apply_deferred_model_switch`)"——deferred 语义 + `DeferredModelSwitch{model_id, effort, prev_model_id}` 回滚目标）
- **取什么 / 别抄什么**：取 deferred 暂存/到达即应用的事务形状与 `prev_model_id` 回滚目标；状态机覆盖 `pending / deferred / preference / incompatible` 四态（grok 注释与我方语义对齐后命名）；不抄其 Rust 会话层
- **证据强度**：`读了代码`（agent.rs:647 注释原文；T-P1-04 产出的 model-switch.ts 现状）
- **要产出**：model-switch.ts 扩状态机（四态枚举 + 迁移守卫）+ 失败回滚（换模后首个请求失败可回滚 prev_model_id，回滚本身落事件）+ 单测
- **验收**：`npx vitest run src/kernel/model-switch.test.ts`（扩）——①四态各自可达且非法迁移被拒；②deferred：无会话时换模暂存、会话建立即应用；③失败回滚恢复 prev 且回滚可观测；④同 turn 内重复换模不产生中间半态
- **依赖**：T-P1-04
- **风险 / 未知**：incompatible 判据（模型能力不匹配/上下文超窗）P1 最小版只查"模型未注册 + 上下文超新窗（走 F24 downshift 压缩）"两种，能力矩阵留后续
- **偏离 / 建议**：①四态映射到五态枚举 `initial/deferred/pending/preference/incompatible`——grok 四态是 ModelState 的四个独立字段（bool/Option），我方收敛为单 phase 枚举 + 迁移守卫；`initial` 是构造基态（grok 的 `user_model_preference: None` 同位），不占"四态"验收名额；②事务修订语义：pending/deferred 下的重复换模覆盖 target、**prev 保持最初**（同 turn 重复换模不把中间模型固定为回滚目标，验收④的结构保证）；③"回滚本身落事件"的落流与 T-P1-06 的词汇表扩展（14→15）**合并做**——本卡回滚可观测 = `lastRollback` 记录 + phase 迁移 + 装配 warn 日志，避免先落一个中间形态事件再改语义（词汇表一次扩展到位）；④incompatible 判据落 `MODEL_INCOMPATIBLE_CODES` 导出清单（单成员起步，冻结只追加，C10 先例）——grok 的 `encrypted_content_mismatch` 是厂商特定形态，我方泛化为显式错误码；上下文超窗不走此路（F24 downshift 消化，风险栏同款）；⑤失败观测点 = loop 新 hook `onTurnError(turn, failure)`（failTurn 内、turn/end 落盘前，同 beforeFirstModelRequest 的显式时点 hook 先例）→ 装配驱动 reportRequestFailure——无此 hook 则回滚没有生产调用点；⑥迁移守卫是导出纯函数 `nextSwitchPhase(from, event, hasCapturedTurn)`（合法表 + 表格外抛 `ModelSwitchStateError`），服务内所有迁移经它——穷举测试可直接钉死
- **完成记录**：2026-09-25。产出 `model-switch.ts` 扩：五态 `ModelSwitchPhase` + 纯函数迁移守卫 `nextSwitchPhase` + `ModelSwitchStateError`（code=MODEL_SWITCH_STATE_ERROR）+ 事务化 `switch`（deferred 不改 configured、pending 立即改、事务修订保持 prev）+ `captureForTurn` 生效确认点（deferred 应用 + pending→preference）+ `reportRequestFailure`（判据命中回滚 prev、返回 boolean）+ `SwitchRecord`/`ModelRollback` 可观测面；`loop.ts` 加 `onTurnError?` hook（failTurn 内 LlmFailure 透传）；`assembly.ts` 接 `onTurnError`（回滚落 warn 日志）；`agent-process.ts` loopDeps 接线。验收：`npx vitest run src/kernel/model-switch.test.ts` → **19 passed**（+10）：①迁移守卫合法表逐条 + 非法组合抛类型化错误；②deferred 暂存（configured 不变）→ 首个 turn 捕获即应用（含事务修订用最新目标）；③回滚恢复 prev 且 lastRollback 四字段可观测（无关码/无事务两对照不回滚）；④A→B→C 同事务修订 prev 保持 A、失败直接回 A 不经 B。T-P1-04 的 9 用例零改动全绿（事务化行为兼容）。全量 `npx vitest run` **525 passed / 1 skipped**，`npx tsc --noEmit` 干净。

#### T-P1-06 · J9/J10/J14 · 换模进事件流 + 会话级/全局分离 + 回放保护 `[x]`
- **依据需求**：J9（P1）· J10（P1）· J14（P1）
- **上游首选参考**：[pi·agent-harness.ts:375](../oss/pi/packages/agent/src/harness/agent-harness.ts#L375)（`SpecialEventPayload`——换模以事件承载非静默改状态）；[dsh·session-controller/commands.ts:146-156](../oss/deepseek-harness/packages/api/session-controller/src/commands.ts#L146)（"Validate and install one **Session-local** model selection"——会话级与全局分开存）；[grok·agent.rs:746](../oss/grok-build/crates/codegen/xai-grok-pager/src/app/agent.rs#L746)（"History-replay silent-revert of a prior choice is suppressed"）
- **取什么 / 别抄什么**：取三点纪律：换模是持久事件、会话级选择独立于全局默认（不一致显式报错）、回放/重连不得静默覆盖用户选择；**新增会话级元事件 `model/switch {from,to,reason}`**——走全局约束 2 的词汇表扩展流程（14→15，待澄清立案）
- **证据强度**：`读了代码`（agent-harness.ts:375、commands.ts:146、agent.rs:746 三处关键行；我方 events.ts/store.ts 现状）
- **要产出**：词汇表扩展 + model-switch.ts 落事件 + 会话级/全局默认两存储位（不一致时报错不静默）+ 回放保护（restore/回放路径遇到历史换模事件按流重建，不以全局默认覆盖）+ 单测
- **验收**：`npx vitest run src/kernel/model-switch.test.ts src/kernel/events.test.ts`——①换模事件落流、seq 连续、可投影；②会话级选择存在时全局默认变更不改变本会话（显式分离断言）；③杀进程重启 restore 后模型仍是用户选的那个（J14）；④C16：新增事件进 assertNever 穷尽检查（删分支编译失败演示）
- **依赖**：T-P1-05
- **风险 / 未知**：词汇表 14→15 需用户追认（先例同 `session/revert`）；回放保护的"用户选择"事实源 = 流内最新 model/switch 事件
- **偏离 / 建议**：①reason 值域收敛为两值 `"user" | "rollback"`——deferred 受理即落 `user` 事件（受理即用户选择的事实持久化，进程崩溃后仍可按流重建），deferred **应用**不重复落事件（流内最新 to 已权威，避免冗余事件），卡面 `{from,to,reason}` 形状不变；②词汇表事实源口径：装配期回放保护读**原始流**最新 model/switch（卡面"流内最新"措辞；会话级选择是配置级元事实，不随对话 revert 回退），投影 modelSwitches 在有效视窗内取最新（投影"效果"语义）——两口径并存、各有语义，测试分别钉死；③`from`/`to` 载荷用内联 `{provider, modelId}` 形状——events.ts 不依赖 models 层（保持 L0 零反向依赖），且 C14 JSON 型证天然通过；④全局默认的一致性校验落在装配期（`resolveInitialIdentity`：流内选择 vs globalDefaultIdentity 不一致 → warn 保留会话级选择；流内选择不在注册表 → 装配失败 ModelNotRegisteredError，fail-closed 绝不静默回退）；⑤l0-events.md §3.2 表格本次补全 session/revert 行（落地记录 2 追认时只改了计数声明，表格漏行——顺手修正到 15 行齐）
- **完成记录**：2026-09-25。产出：`events.ts` 加 `ModelSwitchEvent`（EVENT_TYPES 14→15、SessionEvent 联合、_EVENT_TYPES_EXACT 编译闸门自动覆盖）+ `project.ts`（validation 豁免分支、投影记录 modelSwitches、effectiveProjection 按 revert 切点切割）+ `event-asserts.ts`（O7 会话级元事件豁免面 +model/switch）+ `model-switch.ts`（emit 注入：switch 受理落 `user`、reportRequestFailure 回滚落 `rollback`）+ `assembly.ts`（emit 落 store.append 经 ForwardingStore 转发协议行 + `globalDefaultIdentity` 选项 + resolveInitialIdentity 回放保护）。验收：`npx vitest run src/kernel/model-switch.test.ts src/kernel/events.test.ts` → **37 passed**（24+13，model-switch 净增 5）：①受理/回滚两事件落流、seq 连续、project 可投影（modelSwitches 事实源可查）、O7 断言器不误报 + 协议级事件行经子进程转发可见；②流内选择存在时 globalDefaultIdentity 变更不改变本会话（modelForTurn 仍返回用户选择）；③同 store 重建装配（重启等价）后模型仍是用户选的 C；④C16：EVENT_TYPES/SessionEvent 互等闸门（编译期）+ events.test 计数 15 运行时断言。对照用例：无流内选择回退 initialIdentity、流内选择不在注册表 → 装配抛 ModelNotRegisteredError。全量 `npx vitest run` **530 passed / 1 skipped**，`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变。**词汇表 14→15 已按待澄清流程立案（执行会话新发现 #2），供用户追认**。

#### T-P1-07 · I1/I13 · 内核 hooks（HookRegistry 挂三点位链）+ trace/budget 填实 `[x]`
- **依据需求**：I1（P1）· I13（P1）
- **上游首选参考**：[pi·hooks.ts:15](../oss/pi/packages/agent/src/harness/hooks.ts#L15)（`HookRegistry implements Hooks`——注册/触发分离的 hook 面）；[claude-official·mods/README.md](../refs/claude-official/mods/README.md)（`($, e, next)` 链形 + "a call they leave unanswered throws, naming its event"——🔴 专有，只学行为不摘代码）
- **取什么 / 别抄什么**：取 pi 的注册/触发分离与 mods 的"每层可见 next"语义；我方 T-3-01 chain.ts 已留 `trace/budget` 槽——本卡把槽填实：每层调 `next()` 时 trace 追加层名、budget 扣减，链底无人应答抛错点名事件（L10 顺路落）；hook 以 ChainLayer 形态挂 toolCall/modelRequest/turnEnd 三点位，与策略层同链不同信任轨（I6 分轨在 T-P1-09）
- **证据强度**：`读了代码`（pi hooks.ts 头部与 HookRegistry；mods/README.md 全文）；`只读文档`（mods 为专有仓）
- **要产出**：`src/kernel/hooks.ts`（HookRegistry：注册/触发/dispose；hook 产出 ChainLayer）+ chain.ts trace/budget 填实 + L10 链底抛错 + 装配接线 + 单测
- **验收**：`npx vitest run src/kernel/hooks.test.ts src/kernel/chain.test.ts`（扩）——①hook 在工具执行前后序正确（前 hook 可截断不调 next）；②trace 记录完整层序、budget 扣减可断言；③链底无人应答抛错且错误点名事件；④hook 崩溃不上抛炸 turn（隔离为 isError 语义，对照策略层 fail-open 禁止的差异写注释）
- **依赖**：无
- **风险 / 未知**：hook 崩溃语义与策略层"模块崩溃上抛"（T-5-01）相反——可信轨上抛、不可信轨隔离，分轨在 T-P1-09 前先按"注册时声明 trust"最小实现
- **完成记录**：2026-09-26。产出 `src/kernel/chain.ts` 填实（`ChainTraceEntry` 加 name；`namedLayer` 附加层名、未命名层记 `layer#<index>`；`budgetMs` 墙钟衰减 + `now` 注入——不配恒空槽零行为变化；L10：`terminal?` 可选化，链底无人应答抛错点名点位事件）+ `src/kernel/hooks.ts`（HookRegistry：`on(point, handler, {name, trust})` 返回注销函数 / `has` / `layer(point)` 产出聚合层 / `dispose`（pi close 同款，dispose 后 on 抛错、已产出层直通）；trust 维度注册时声明，缺省 trusted）+ `assembly.ts` 接 `hooks?: HookRegistry`（聚合层挂三点位 **gate 外层**：hook 改载荷会被内层权限重新判定，mods sec-default Outermost 同款座次；无注册点位不挂层零开销）。验收：`npx vitest run src/kernel/hooks.test.ts src/kernel/chain.test.ts` → **27 passed**（chain 14 + hooks 13）：①嵌套序=注册序、前 hook 截断不调 next（loop 级：工具不执行、tool/result 落 hook 值、turn 照常收尾）；②trace 完整层序（最内层见 [gate, hooks]）、截断层之后不入轨迹、budget 衰减可断言（注入时钟 500→380，超支保留 -150）；③L10 断言 `/无人应答（point=toolCall）/` + 截断链不触达链底对照；④崩溃双轨：untrusted toolCall before→隔离 isError（HOOK_FAILED，工具不执行、turn 不炸、reportError isolated 可检索）、trusted→上抛（TOOL_EXECUTE_FAILED，与策略层 T-5-01 同款语义写进注释）、after 段（next 已调）一律上抛、modelRequest before→截断 blocked、turnEnd→吞错继续收尾。全量 `npx vitest run` **548 passed / 1 skipped**（530 → 净增 18），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变，`check-doc-links.sh` 548 链接 0 失效。**偏离**：①层名载体选 `namedLayer` 函数属性而非 layers 改对象形状——后者波及约 20 处既有测试构造，违背精准修改；②untrusted 隔离按"点位 × 崩溃时机"三态（toolCall before→isError 截断 / modelRequest before→空输出截断 / turnEnd→吞错继续——turnEnd 截断=turn 悬挂，比吞错更糟），after 段一律上抛（动作事实已发生，装睡=伪造事实）；③隔离值形状知识内置 hooks.ts（单向 import loop.ts 类型），装配零负担；④layer() 取快照——快照后注册不进已产出层（装配时序定链内容），T-P1-09 分轨在此结构上展开。

#### T-P1-08 · I2 · skills 目录加载（发现 / 按需加载 / 诊断） `[x]`
- **依据需求**：I2（P1）
- **上游首选参考**：[pi·skills.ts](../oss/pi/packages/agent/src/harness/skills.ts)（`loadSkills` / `loadSourcedSkills` / `SkillDiagnostic{code}` / `formatSkillInvocation`——发现与诊断分离）
- **取什么 / 别抄什么**：取"目录扫描产出 Skill 清单 + 坏技能诊断不炸 + 调用格式化"三件；按需加载最小版：全部技能名+描述进系统提示尾段，正文在模型按名索要时经工具读取（不引入 F12 检索式延迟加载）
- **证据强度**：`读了代码`（skills.ts 导出面：SkillDiagnosticCode/ Diagnostic / formatSkillInvocation / loadSkills / loadSourcedSkills）
- **要产出**：`src/kernel/skills.ts`（发现 `.zcode/skills/<name>/SKILL.md` 式目录、解析 frontmatter、诊断码）+ 系统提示装配扩展 + `skill/load` 内核工具 + 单测
- **验收**：`npx vitest run src/kernel/skills.test.ts`——①技能目录随仓分发可发现（含嵌套源）；②frontmatter 缺损/重复名产诊断码不抛异常；③`skill/load` 按名取正文、未知名类型化错误；④技能清单进系统提示（改 SKILL.md 零 .ts diff 机验，同 T-7-09 基建）
- **依赖**：无（与 T-P1-07 无强依赖，脚本按序在其后）
- **风险 / 未知**：技能目录约定（`.zcode/skills/`）是自研命名，无上游约束；frontmatter 解析复用 T-7-09 的 AGENTS.md 收集器经验
- **完成记录**：2026-09-26。产出 `src/kernel/skills.ts`（`loadSkills(skillsRoot)` 递归发现 `.zcode/skills/**/SKILL.md`——名字取所在目录名、frontmatter `name:` 可覆盖；行解析 frontmatter（T-7-09 经验，无 yaml 依赖）；诊断码 read_failed/parse_failed/invalid_metadata/duplicate_name 与清单并返、绝不抛异常；`skillBody` 剥 frontmatter + `formatSkillInvocation`（pi 同构 `<skill name location>` 块））+ `src/kernel/tools/builtin/skill.ts`（`skill_load` 工具：每次执行重扫描不缓存、读经 PathGuard、未知名 SKILL_NOT_FOUND 类型化错误回喂）+ `descriptions/skill_load.txt` + 系统提示尾段（`SystemPromptDeps.skills?` 渲染"## 可用技能"名+描述清单，空清单不加段零行为变化）+ 装配接线（assembly contextLayer 首落时扫描、诊断落 `skill-lint` warn 日志；agent-process 把 workspaceRoot 作 skillsRoot 传 registerBuiltinTools；BUILTIN_TOOL_NAMES 6→7）。验收：`npx vitest run src/kernel/skills.test.ts` → **8 passed**：①顶层+嵌套源（tools/beta）都发现、无 SKILL.md 的目录不产诊断继续深入；②无 frontmatter→invalid_metadata、坏行→parse_failed、同名→duplicate_name（后者弃用），好技能照常入清单全程不抛；③skill_load 经 registry.dispatch 按名取正文（`<skill>` 块、frontmatter 已剥）、未知名/坏参数类型化错误；④改 SKILL.md 后重新发现清单变 + 同一工具实例重调用正文变（零 .ts diff 机验，T-4-01 基建同款）；集成：workspaceRoot 有技能时 contextLayer 首落的 system/message 含清单、坏技能诊断落日志不炸。copy-assets：descriptions 为整目录拷贝、新 txt 自动跟上（build 实测"工具描述 8 项"，脚本零改动）。全量 `npx vitest run` **556 passed / 1 skipped**（548 → 净增 8），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变，`check-doc-links.sh` 0 失效。**偏离**：①清单定格在 system/message 首落时点（改 SKILL.md 对新会话生效——清单是事件流历史事实），正文 skill_load 每次直读当前会话即时生效——不对称是 F22 事件重建的自然结果，注释写明；②frontmatter name 与目录名不一致不校验（KISS）；③无根级 .md 技能形态（卡面只定 `<name>/SKILL.md` 式目录）。

#### T-P1-09 · I6/I9 · 权限双轨（可信/不可信）+ 插件清单安装期校验 `[x]`
- **依据需求**：I6（P1）· I9（P1）
- **上游首选参考**：[dsh·packages/hooks/](../oss/deepseek-harness/packages/hooks)（`hook-protocol` + `hooks-claude-code` / `hooks-codex` 分包——按信任与协议分轨）；[pi-desktop·plugins/validation.rs:3](../oss/pi-desktop/crates/host-core/src/plugins/validation.rs#L3)（`validate_contributions(root, manifest)`——安装期全量校验）
- **取什么 / 别抄什么**：取"可信轨同链直调、不可信轨隔离子进程且能力受限"的分轨纪律与"未实现的能力声明即拒绝安装（不是警告不是忽略）"；D15（不可靠兜底显式告警）同源；不抄 pi-desktop 的 Rust manifest 结构
- **证据强度**：`读了代码`（validation.rs:3/811 签名；dsh hooks 包目录结构 hook-protocol/hooks-claude-code/hooks-codex）
- **要产出**：trust 维度进 HookRegistry（trusted=同链 / untrusted=独立轨+能力白名单）+ `src/kernel/plugin-manifest.ts`（清单闭集枚举校验：声明了未注册能力 → 安装拒绝）+ 单测
- **验收**：`npx vitest run src/kernel/hooks.test.ts src/kernel/plugin-manifest.test.ts`（扩）——①不可信 hook 触发时不进内核链（分轨断言：内核 trace 不含 untrusted 层）；②清单声明未实现能力 → 拒绝且错误列明缺哪项；③闭集外字段拒绝；④合法清单安装后能力可用
- **依赖**：T-P1-07（HookRegistry 在位）
- **风险 / 未知**：进程外不可信轨的完整隔离（子进程 + 协议）P1 最小版先做"分轨 + 白名单"，真进程隔离随 K3/K4 后续批次
- **完成记录**：2026-09-26。产出 hooks.ts 分轨（`layer(point)` **只聚合 trusted**——内核链零感知 untrusted；新增 `untrustedLayer(point)` 独立观察轨：hook 间注册序嵌套、最内 next 是哨兵——调用即抛"能力越界"（能力白名单 = 只观察，不能截断/换载荷/驱动内核）、崩溃在轨内隔离（reportError isolated + 跳过继续，观察结果无人消费故统一吞错无需分点位）、轨底返回 undefined as R、dispose 后轨退场）+ `src/kernel/plugin-manifest.ts`（`validateManifest(input, availableCapabilities)`：形状闭集 {name,trust,capabilities,hooks} 闭集外字段拒绝 + trust 闭集枚举 + **声明未实现能力 → 拒绝且 errors 列明缺哪项**（附宿主已实现清单）+ hooks 贡献 point ∈ CHAIN_POINTS/重复声明拒绝，全部收集一次报全；`installPlugin`：校验 → 声明未提供 handler 也拒绝且已注册部分回滚（无半态安装）→ 以 `<插件名>:<hook 名>` 注册（trust 随清单，防跨插件冲突）→ 返回 uninstall；校验失败抛 PluginManifestError code=PLUGIN_MANIFEST_REJECTED，绝不降级警告）。hooks.test.ts 改写 T-P1-07 的 untrusted 过渡语义为分轨语义（untrusted isError 化随分轨取消——观察轨崩溃统一吞错）。验收：`npx vitest run src/kernel/hooks.test.ts src/kernel/plugin-manifest.test.ts` → **22 passed**（14+8）：①同注册 trusted+untrusted 时内核链只跑 trusted（untracked 副作用不在链上）、观察轨单独触发；只注册 untrusted 时 layer=undefined（内核零感知）；②声明 execute_commands → 拒绝且错误含该名与宿主已实现清单；③stealth 字段拒绝 + 坏 point/重复 hook 声明/非 object 清单拒绝；④trusted 插件安装后内核链直调 `core(x)`、untrusted 安装后观察轨 `watched:evt` 可用；声明未提供 handler → 拒绝且已注册部分回滚；uninstall 摘净。T-P1-07 的 hooks 既有 9 用例（注册/嵌套序/快照/dispose/loop 级 trusted 上抛）零改动全绿。全量 `npx vitest run` **565 passed / 1 skipped**（556 → 净增 9），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变。**偏离**：①untrusted 轨触发面 P1 是进程内 registry 方法（真进程隔离/协议随 K3/K4，卡面风险栏既定）；②能力白名单的行为面 = 只观察（next 哨兵），capabilities 清单校验先行——运行时能力面随 K 层接入。

#### T-P1-10 · G2 · todo 列表（工具 + 事件投影 + 可见进度） `[x]`
- **依据需求**：G2（P1；B8 的 todo 以最小面随本卡落地）
- **上游首选参考**：[opencode·session/todo.ts:11-17](../oss/opencode/packages/opencode/src/session/todo.ts#L11)（`Info` / `Event` / `Interface.update({sessionID, todos})`——todo 是会话事件驱动的投影）
- **取什么 / 别抄什么**：取"todo 变更 = 事件，状态 = 投影"（不变量 1 同构）；不抄其 Effect 接口；**新增事件 `todo/update {items}`**（会话级元事件，走词汇表扩展流程 15→16）
- **证据强度**：`读了代码`（todo.ts 导出面：SessionTodo.Info / Event / Interface.update）
- **要产出**：词汇表扩展 + `src/kernel/tools/builtin/todo.ts`（write todo 工具，经出口级硬拦与注册表契约）+ 投影扩展（todos 可查）+ REPL 进度显示 + 单测
- **验收**：`npx vitest run src/kernel/tools/builtin/todo.test.ts src/session/project.test.ts`（扩）——①todo 写入落 `todo/update` 事件且投影可查；②多步任务进度在 CLI 可见；③词汇表 15→16 走 assertNever 同步（编译期断言）；④todo 工具过 T-P1-01 出口级硬拦（plan 模式下不可写——为 G7 铺垫的对照用例）
- **依赖**：T-P1-01（出口级在位）；T-P1-06（词汇表扩展流程已热）
- **风险 / 未知**：todo 与 plan（T-P1-11）的关系——todo 是任务进度、plan 是模式状态，两套词汇不合并（opencode 同款分离）
- **完成记录**：2026-09-26。产出：`events.ts` 加 `TodoUpdateEvent`（`todo/update {items}` 会话级元事件、items 为变更后完整清单（E12）、status 三值——opencode 的 cancelled 不引入；EVENT_TYPES 15→16、编译闸门自动覆盖）+ `project.ts`（validation 豁免 + 投影 `todos` 历史 + revert 切点切割 + 不进消息投影）+ `event-asserts.ts`（O7 豁免面 +todo/update）+ `tools/builtin/todo.ts`（todo_write：整值提交、fail-closed 参数校验含 50 项/500 字符上限、emit 落流）+ `policy/meta-ops.ts`（**内核元操作白名单**：todo_write 核心层显式放行——会话元状态写入无工作区副作用，不变量 3 的"显式例外"落链上模块；若走默认 ask 每次更新挂起审批，G2 进度可见等于不可用）+ `protected-paths.ts` 导出 `WRITE_EXECUTE_TOOLS`/`isWriteExecuteTool`（写执行类唯一权威：write/edit/bash/**todo_write**——T-P1-11 plan 硬关判定面，验收④铺垫）+ `assembly.ts`（createTodoUpdateEmitter 落流出口导出 + core 层挂 meta-ops）+ `agent-process.ts`（todoEmit 无条件接线——最小装配也有 store）+ `repl.ts`（进度整幅渲染：`◆ 任务清单（n/m 完成）`+ ☐/▶/✓ 各项）+ `descriptions/todo_write.txt`（copy-assets 自动跟上）+ BUILTIN_TOOL_NAMES 7→8。验收：`npx vitest run src/kernel/tools/builtin/todo.test.ts src/session/project.test.ts` → **18 passed**（7+11）：①合法调用落 todo/update（seq 连续、整值、投影 todos 尾=当前值）；②CLI 级（cli.test 扩）：meta-ops 直过无 ⏸ 待审批、进度行整幅可见；③events.test 计数 16 + SAMPLES 并集断言（C16）；④exit-guard.test 扩 3 用例：todo_write 链 allow→出口透传、对照 write .git/config 仍硬拦、isWriteExecuteTool("todo_write")=true（plan 硬关消费面就位，"plan 模式下 todo 不可写"完整用例在 T-P1-11 落）。连带 project.test 3 用例（含 revert 切割/undo 恢复/消息面隔离）、注册面用例（带 emit 8 个/缺省 7 个——无落流出口的状态写入不暴露）。全量 `npx vitest run` **579 passed / 1 skipped**（565 → 净增 14），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变，`check-doc-links.sh` 548 链接 0 失效。**词汇表 15→16 已按待澄清流程立案（执行会话新发现 #3），供用户追认**。**连带修（验收阻塞）**：logger.ts 落盘文件名日期原用裸 `new Date()` 不受注入 clock 控制（T-6-05 时钟注入缺口，昨日 2026-09-25 注入值=真实值巧合通过，今日翻转即 flaky）——defaultSink 改收 now 与 ts 同源，logger.test 恢复绿。

#### T-P1-11 · G1/G7 · plan 模式（进出 + 写/执行权限硬关） `[x]`
- **依据需求**：G1（P1）· G7（P1，Q21 裁决：计划模式 = 混合）
- **上游首选参考**：[opencode·tool/plan.ts:11](../oss/opencode/packages/opencode/src/tool/plan.ts#L11)（`import EXIT_DESCRIPTION from "./plan-exit.txt"`——plan-enter/plan-exit 提示词独立成文件）；G7 验收要点见 [requirements.md §3 Q21](requirements.md)
- **取什么 / 别抄什么**：取"提示词独立文件 + 进出是显式动作"；**G7 硬关复用 T-P1-01 出口级机制**：plan 模式激活时 write/edit/bash 等写执行类出口强制 deny（规则不得授权），读不限——"状态是同一个 agent"（不另起子代理）
- **证据强度**：`读了代码`（plan.ts:11 import；我方 exit-guard.ts / system-prompt.ts 现状）
- **要产出**：`src/kernel/plan-mode.ts`（会话级模式状态 + 进出 API）+ `src/kernel/tools/descriptions/{plan-enter,plan-exit}.txt` 提示词文件 + 出口级联动（plan 激活 → 写执行类硬拦）+ 模式状态对模型可见（系统提示段）+ 单测
- **验收**：`npx vitest run src/kernel/plan-mode.test.ts src/policy/exit-guard.test.ts`（扩）——①plan 模式下 write/edit/bash 一律 deny 且用户层 allow 规则压不过（硬关断言）；②读类工具不受限；③退出 plan 模式后恢复既有规则裁决；④进出动作落事件可投影；⑤提示词独立文件、改文件零 .ts diff
- **依赖**：T-P1-01（出口级机制）
- **风险 / 未知**："写执行类"清单与 C10 危险命令库的边界——plan 硬关按工具类别（write/edit/bash），不重复命令级分析
- **完成记录**：2026-09-26。产出：`src/kernel/plan-mode.ts`（PlanModeService 内存态：enter/exit 幂等 + isActive 活查询；`planModeFromEvents(events)` 按流重建——扫描 plan_enter/plan_exit 的 tool/call+result，**成功结算**的最新一次定状态，被拒申请不改状态）+ `src/kernel/tools/builtin/plan.ts`（plan_enter/plan_exit 双工具，opencode 同款）+ `descriptions/{plan_enter,plan_exit}.txt` 提示词独立文件 + `src/policy/plan-guard.ts`（`enforcePlanMode`：plan 激活时 WRITE_EXECUTE_TOOLS 内工具无条件 deny——T-P1-10 铺垫的清单唯一权威在此消费；gate.ts 与 revalidate.ts 出口同位接线）+ `system-prompt.ts`（planMode 段渲染机制说明，启用才加段零行为变化）+ `assembly.ts`（`planMode?: boolean` 装配选项：service 构造 + gate 活查询 + 工具注册 + 系统提示段同源；缺省零行为变化）+ `agent-process.ts` 传同一 service 实例注册工具 + BUILTIN_TOOL_NAMES 8→10。验收：`npx vitest run src/kernel/plan-mode.test.ts src/policy/exit-guard.test.ts` → **24 passed**（11+13）：①plan 激活时 write/edit/bash/todo_write 一律 deny、用户层 `bash(*)` allow 规则链上 allow 被出口压过（gate 集成：不进 broker 不弹审批，TOOL_POLICY_DENIED 含"plan 模式硬关"）；②read/glob/grep/skill_load 透传；③退出后同规则恢复放行（CLI 端到端：call_4 回到默认 ask 弹审批）；④进出动作落事件可投影（planModeFromEvents：enter 成功→true、exit→false、被拒不改状态、空流 false）；⑤提示词独立文件改即变零 .ts diff + 注册面（缺省 7 / +todo 8 / +plan 9 / 全配 10）。CLI 级联测（cli.test 扩）：plan_enter ask→/approve→激活→bash 直接 ✗ 硬关无审批弹窗→plan_exit ask→/approve→恢复。全量 `npx vitest run` **591 passed / 1 skipped**（579 → 净增 12），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变，`check-doc-links.sh` 548 链接 0 失效。**偏离**：①进出不扩词汇表（全局约束 2 只给 T-P1-06/10/12 预留扩展）——进出动作的流内事实 = plan 工具自身的 tool/call+tool/result，planModeFromEvents 提供读取面（T-P1-13 重启恢复消费）；②plan_enter/plan_exit 默认 ask（不在 meta-ops 白名单）——进出都经用户批准，opencode plan_exit 的 question.ask 同语义；这同时保证硬关期间退出通道由用户控制；③plan 工具注册与出口联动绑定装配（planMode 选项），不给"有工具无硬关"的残缺面。

#### T-P1-12 · G3/G6 · goal 跨轮驱动 + 截止时间调度 `[x]`
- **依据需求**：G3（P1）· G6（P1）
- **上游首选参考**：[dsh·goal-round-driver/src/](../oss/deepseek-harness/packages/goal/goal-round-driver/src)（index/invariant/prompt 三件——goal 驱动带不变量校验与提示词注入）；[kimi·goalDeadlineScheduler.ts:4-11](../oss/kimi-code/packages/agent-core-v2/src/features/goal/goalDeadlineScheduler.ts#L4)（`IGoalDeadlineScheduler` 服务接口——deadline 到期行为可定义）
- **取什么 / 别抄什么**：取"goal 跨 turn 保持 + 每轮注入提醒 + invariant 自校验"三件与"到期行为可定义（放弃/上报/续期）"；**新增事件 `goal/set {text, deadline?}`**（词汇表 16→17，走扩展流程）；不抄 kimi 的服务标识符架构
- **证据强度**：`读了代码`（goal-round-driver 三文件、goalDeadlineScheduler 接口）
- **要产出**：词汇表扩展 + `src/kernel/goal.ts`（goal 状态机：设定/达成/放弃/续期 + deadline 调度）+ 每轮 turn 开始注入 goal 提醒（beforeFirstModelRequest 挂点，同 PreTurn 压缩位）+ deadline 到期动作可配 + 单测
- **验收**：`npx vitest run src/kernel/goal.test.ts`——①goal 设定后跨多轮保持（轮结束不丢）；②每轮模型请求上下文含 goal 提醒（注入位断言）；③deadline 到期触发配置的行为（三选一可断言）；④goal 落事件流、重启后仍在（restore 重建）；⑤C16 词汇表同步
- **依赖**：T-P1-10（词汇表扩展流程在批次内已两次演练）
- **风险 / 未知**：goal 与 M5（goal 持久化，未选本批）重叠——本卡落事件流即天然持久，M5 届时只剩跨会话引用
- **完成记录**：2026-09-26。产出：`events.ts` 词汇表 16→17（`goal/set {text, deadline?, status: "active"|"achieved"|"abandoned"}` 会话级元事件、E12 整值——GoalSetEvent + 编译闸门自动覆盖）+ `src/kernel/goal.ts`（GoalService：set/renew/achieve/abandon + 迁移守卫纯函数 `nextGoalState`（表格外抛 GoalStateError，dsh goal-round-driver 的 invariant 自校验纪律，model-switch 的 nextSwitchPhase 同款可测性模式）+ `tickBeforeTurn(now)` 每轮到期判定 + `goalFromEvents` 流重建；kimi IGoalDeadlineScheduler 的"到期行为可定义"落为 `GoalExpiryAction` 三值配置——不抄其 DI 架构，到期判定在轮边界 tick 无后台定时器）+ `project.ts`（validation 豁免 + 投影 goals 历史 + revert 切点切割）+ `event-asserts.ts`（O7 豁免面 +goal/set）+ `assembly.ts`（`goal?: {text, deadline?, expiryAction?, renewExtendMs?}` 选项：新会话落初始 goal/set、已有事实按流重建（流内权威，J14 回放保护同款）+ beforeFirstModelRequest 注入提醒（M10 同款纪律：写进模型可见历史才算送达——user/message{source:"injected"} 落流））。验收：`npx vitest run src/kernel/goal.test.ts` → **13 passed**：①goal 设定后跨 5 轮 tick 保持（轮结束不丢）；②每轮注入提醒（装配级：user/message{source:"injected"} 落流两轮各一条、内容含目标；CLI 端到端佐证：REPL"（注入）[目标提醒]"可见）；③到期三动作可断言（abandon=当轮报告后终态不再提醒/report=缺省状态不动每轮催办/renew=自动续期 renewExtendMs 落 renew 事件）；④goal 落事件流、同 store 重建装配（重启等价）后 goal 仍在且不重复落初始事实；⑤C16：events.test 计数 17 + SAMPLES 并集断言 + goal/set 投影（goals 历史 + revert 切割）与迁移守卫非法表穷举。全量 `npx vitest run` **605 passed / 1 skipped**（591 → 净增 14），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变，`check-doc-links.sh` 548 链接 0 失效。**词汇表 16→17 已按待澄清流程立案（执行会话新发现 #4），供用户追认**。**偏离**：①卡面载荷 `{text, deadline?}` 补必填 `status`——设定/达成/放弃/续期都是状态变更（不变量 1），无 status 则达成/放弃无表达面；终态保留 text/deadline 终值不抹历史；②到期判定在轮边界 tick 而非 kimi 式 schedule 定时器（无后台时钟依赖，驱动节奏与轮生命周期一致）；③goal 的设定/续期面 P1 是装配选项 + 服务 API（owner 通道/工具面随后续批次，卡面未列工具产出）；M5 跨会话引用按卡面风险栏预留。

#### T-P1-13 · G4 · 计划落盘（plan artifact + 重启不重放） `[x]`
- **依据需求**：G4（P1）
- **上游首选参考**：[pi-desktop·ADR 0053](../oss/pi-desktop/docs/adr/0053-plan-checkpoint-artifact-and-execution-epoch.md)（"Plan checkpoint artifact, approval, and execution epoch"——计划是 artifact + 批准持久 + **重启绝不重放旧 host 的工作**）
- **取什么 / 别抄什么**：取"计划是持久 artifact（落盘 + checkpoint 事件）"与"重启后计划仍在、但旧 host 的工作不重放"两条；execution epoch 完整机制（M8）未选本批，本卡只落 plan 面的最小 epoch：重启后计划可见但执行状态按 Q5 对账闭合，绝不自动续跑
- **证据强度**：`读了文档`（ADR 0053 全文：Status Accepted for implementation）
- **要产出**：plan 模式产出的计划文本作为 artifact 落盘（会话目录内）+ checkpoint 事件（词汇表已有 checkpoint 槽位复核，不够再走扩展流程）+ 重启恢复路径（计划 artifact 可见、不续跑）+ 单测
- **验收**：`npx vitest run src/kernel/plan-mode.test.ts src/session/boot-maintenance.test.ts`（扩）——①plan 模式批准的计划落盘且重启后可读；②重启后执行状态为 interrupted（Q5 对账口径）、不自动重放；③计划 artifact 与代码 checkpoint（E11）互不干扰
- **依赖**：T-P1-11（plan 模式在位）
- **风险 / 未知**：artifact 存储位（会话目录 vs 独立表）——P1 先文件 + 事件记路径，独立表等 Q2 查询需求出现
- **完成记录**：2026-09-26。产出：`plan-mode.ts` 扩 G4 面（`savePlanArtifact(dir, sessionId, plan)` 落 `<dir>/<sessionId>/plan.md`——只写文件；`planArtifactFromEvents(events)` 按流找最新 `checkpoint{provider:"plan"}` 的 ref.path——重启恢复读取面）+ `plan_exit` 工具加可选 `plan` 参数（用户批准退出 = 计划批准结算，提交计划文本落盘）+ `assembly.ts`（`planArtifactDir?: string` 装配选项 + savePlanArtifact 闭包：**文件成功才记 `checkpoint{provider:"plan", ref:{path}}` 事件**——绝不产生指向不存在文件的引用；词汇表 checkpoint 槽位复核够用，**未扩词汇表**）+ `agent-process.ts` 传 `savePlanArtifact` 给工具注册。验收：`npx vitest run src/kernel/plan-mode.test.ts src/session/boot-maintenance.test.ts` → **21 passed**（15+6）：①plan_exit 批准提交计划 → artifact 落盘 + checkpoint 事件落流，planArtifactFromEvents 按流找回、文件可读、重启等价（同 store 新装配零重复落盘）；②plan 会话崩溃重启（SQLite 真库杀进程路径）：对账 codes=[STEP_INTERRUPTED, TURN_INTERRUPTED]、终态恰一条 interrupted、**不自动重放旧 host 的工作**（Q5 对账口径，T-8-04 既有机制 + plan 面共存验证）、计划 artifact 按流可读；③互不干扰：真 git 仓夹具——E11 capture → plan_exit 落 artifact → restoreCodeTo（/revert 代码回退）→ artifact 内容不变（结构保证：artifact 是 untracked 新文件，`git stash create` 不含 untracked，git-checkpoint.ts 头注释 pi 同款边界）；对照：无 planArtifactDir 时 plan 参数仅随工具结果可见、不记 checkpoint；planArtifactFromEvents 对 git provider 不误读。全量 `npx vitest run` **610 passed / 1 skipped**（605 → 净增 5），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变，`check-doc-links.sh` 548 链接 0 失效。**偏离**：①checkpoint 槽位复核通过（provider="plan" + ref 内联 {path}），未扩词汇表——卡面"不够再走扩展流程"的"不够"未发生；②落盘时点选 plan_exit 批准结算（"批准的计划落盘"——进出都经用户批准的 G1 语义使批准点自然收敛在 plan_exit），工具可选参数承载计划文本而非独立 plan_write 工具（B8 工具族不越界）；③CLI 旗标（--plan 等）未接——装配选项面已通，UX 随 CLI 批次。**execution epoch（M8）留后续批次**：本卡"重启不重放"完全复用 Q5 对账（启动期 interrupted 闭合 + 新 prompt 才开新轮），无自动续跑路径可拦。

---

## 批次 1 完成定义

- 13 张卡全部打勾，每勾附「命令 + 结果摘要」；`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 0 失效、`license-audit.sh` 通过。
- C46 出口级硬拦在位且 T-5-14 LIMITATIONS #7 关闭；ApprovalScopeCache / intersect / linter 三处 P0 遗留接线债清零。
- 词汇表扩展（预计 14→17）每处走待澄清立案 + `l0-events.md` §8 落地记录；未被追认的回退面在卡面写明。
- 新增/修改关键路径全部有最小充分验证；专有仓（claude-official）零代码摘取。

## 批次 2 卡序（10 张，2026-09-26 展卡，按依赖排序；15 条需求 ID：Q3/B17/B6/B7/F12/F14/F5/F6/F13/F15/B8/J12/J15/J19/J18）

**锚点纪律**：15 条锚点已逐一打开核对到行号级（2026-09-26，核对证据见各卡「证据强度」）；Q3 与 §3 决策编号 Q3（IM 平台）同名异义已辨析。B7 的 `tool_execution_update` 事件名在 pi types.ts 未直接定位——mode 锚（types.ts:47,307-313）已核实，进度事件形状按验收要点自研（§2.5 以语义为准）。

#### T-P1-14 · Q3 · spill 清理（落盘文件生命周期） `[x]`
- **依据需求**：Q3（P1；P0 的 B10/B11 打标记 + Q13 deletable 是它的地基）
- **上游首选参考**：[dsh·packages/spill/](../oss/deepseek-harness/packages/spill)（spill 包——落盘文件生命周期）
- **取什么 / 别抄什么**：取"截断产生的临时文件有清理策略、不无限堆积"；我方 truncate.ts 的 spillPath/deletable 标记（T-4-06）已就位，本卡只做消费端
- **证据强度**：`读了代码`（spill 包目录结构；我方 truncate.ts 的 spill 标记现状）
- **要产出**：spill GC（会话关闭 / 超龄 / 超量三触发任一定形，KISS 优先会话关闭 + 超量）+ 清理只认自己打过标记的文件（deletable 纪律）+ 单测
- **验收**：`npx vitest run src/kernel/tools/truncate.test.ts`（扩）——①N 次截断后 spill 文件数有界（不无限堆积）；②清理不误删非 spill 文件（证伪）；③会话关闭触发清理可断言
- **依赖**：无（批次 2 热身件）
- **完成记录**：2026-09-26。产出 `src/kernel/tools/spill-gc.ts`（`SPILL_FILE_RE` 文件名精确形状——dsh "EXACT shape not bare prefix" 同款，形状不匹配的外来文件连首行都不读 + `readSpillMarker` 首行标记读取（4KB 上限 + kind 校验，任何失败当外来文件）+ `sweepSessionSpill` 会话关闭触发 + `enforceSpillQuota` 超量触发（own-marker 总数超限按 createdAt 最老先删、只删自动可删者、Infinity 显式关闭）+ `SpillGcReport`；lstat 不跟随符号链接、单文件失败收集报告不中断、unlink ENOENT=成功——dsh sweep 三纪律）+ `truncate.ts` 扩（`SpillMarker.deletable` 联合扩 `"manual" | "after-session-end"`——T-4-06 偏离④预留的扩展点兑现，boundedOutput 写 after-session-end；`DEFAULT_SPILL_DIR` 单一权威导出）+ `registry.ts` 接超量配额（`spillMaxFiles` 选项缺省 `DEFAULT_SPILL_MAX_FILES`=1000，**spill 发生点即配额执行点**，boundOutput 在 spilled 后 await）+ `agent-process.ts` 会话关闭接线（`finish()` 收尾：await sweepSessionSpill 再 exit——process.exit 会切断挂起的 unlink；dispose 无在途轮 / kick 收轮后 / stdin 关闭尾部三处 exit(0) 换 finish；`AgentChildOptions.spillDir?` + sessionId/spillDir 传进 ToolRegistry——此前生产标记恒 "unknown-session" 无法按会话清理）。验收：`npx vitest run src/kernel/tools/truncate.test.ts` → **11 passed**（6 既有 + 新 5）：①12 次截断（上限 5）后 spill 恰 5 个且幸存者 callId=c7..c11（最老先删）；②证伪：notes.txt / 形状相近无标记文件 / 名字形状命中的目录在会话清理 + 上限 0 配额双触发下原样保留；③`spill-gc.test` 未另立——③用 `sweepSessionSpill(dir,"s1")` 删 s1 自动可删者、s1 manual / s2 / 外来全留断言（+manual 即使最老也不被超量驱逐）。wiring：`agent-process.test.ts` 扩用例——预置 s0 自动可删/manual/s1/外来四类文件 → prompt → dispose → exit 0 落定时 s0 自动可删已清、其余原样（finish 在 exit 前 await 清理）。全量 `npx vitest run` **616 passed / 1 skipped**（610 → 净增 6），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变。**偏离**：①deletable 恒 "manual" 改为写 "after-session-end"（本卡即 T-4-06 预告的"清理策略定义"卡）；P0 时代旧 manual 文件 GC 永不碰（人工面保留）；②会话清理挂 agent-child 退出三路径（dispose/stdin 关闭/EPIPE）共享 finish，CLI 父进程零改动；③超龄触发不做（卡面三选二 KISS 既定）——AGENT_LOOP_CRASH 的 exit(1) 不扫，残留由下次 spill 的超量配额兜底。

#### T-P1-15 · B17+B6 · 工具并发（RwLock 前提 + 并行可配） `[x]`
- **依据需求**：B17（P1）· B6（P1）
- **上游首选参考**：[codex·tools/parallel.rs](../oss/codex/codex-rs/core/src/tools/parallel.rs)（tokio RwLock——读并行/写排他）；[pi·types.ts:47,307-313](../oss/pi/packages/agent/src/types.ts#L307)（`ToolExecutionMode = "sequential"|"parallel"` + "preflight tool calls sequentially, then execute allowed tools concurrently"）
- **取什么 / 别抄什么**：取 codex 的一把 RwLock 纪律（**未声明即不可并行** = fail-closed）与 pi 的"preflight 顺序、执行并发"形状；不抄 tokio（我方 promise 并发）
- **证据强度**：`读了代码`（parallel.rs 头部 Rust 依赖面；types.ts:43-47,307-313 原文）
- **要产出**：ToolDef 加并行声明（缺省 false = 排他）；loop 工具执行按声明分组（声明组内并发、跨组与写类排他——B4 写队列语义不变）；装配可配 sequential/parallel（缺省 sequential = P0 行为不变）
- **验收**：`npx vitest run src/kernel/loop.test.ts`（扩）——①parallel 模式下已声明只读工具组并发（计序断言：完成序 ≠ 提交序）；②未声明工具被排他化（B17 验收原文）；③sequential 缺省零行为变化（回归）；④并行下 tool/call–result 配平不变
- **依赖**：无
- **风险 / 未知**：并行下 stderr/超时/预算（B14）归哪个 callId——按 callId 归属既有纪律延伸，预算轴并行累加语义在卡内定
- **完成记录**：2026-09-26。产出 `src/kernel/rw-lock.ts`（promise 化 `RwLock`——codex parallel.rs:191 `supports_parallel ? lock.read() : lock.write()` 的对应物；FIFO + 头部连续读者成批放行，防写者饿死）+ `loop.ts`（`ToolExecutionMode` 两档导出 + deps `toolExecution?`/`isParallelTool?` + runStep 拆 preflight 循环——取消/预算检查 + tool/call 落流两模式共用顺序执行，sequential 内联执行到底 P0 逐字节不变，parallel 收集派发批后 `runParallelTools` 并发执行：声明真→读锁、否则写锁；tool/result 按完成序落流、`StepRecord.toolResults` 按提交序回填——pi 双序同款；取消语义不变：已派发照完成照落盘）+ `registry.ts`（`ToolDef.parallel?` 缺省 false = 排他 + `isParallelDeclared` 查询，未注册名 false fail-closed）+ 只读族四内置工具声明 `parallel: true`（read/glob/grep/skill_load——B17"读=并行"的落地，写族/有状态族全缺省排他）+ `agent-process.ts`（`toolExecution` 装配选项，parallel 时 `isParallelTool` 接注册表声明；缺省 sequential 两槽位不进 deps）。验收：`npx vitest run src/kernel/loop.test.ts` → **12 passed**（8 既有 + 4 新）：①parallel 声明组启动重叠（两 start 先于任一 end）、完成序 ≠ 提交序、tool/result 完成序 [c2,c1] / call 提交序 [c1,c2]、expectPaired 配平（④）；②批次 [声明 r1、未声明 w1、声明 r2] → r1 独启动→w1 独占→r2 续（FIFO 不越位，未声明排他化原文）；③缺省 sequential trace 严格交错 + 事件 call/result 逐段交错（P0 回归）；+RwLock 独立语义用例（读读并发/写互斥/FIFO/成批放行）。全量 `npx vitest run` **620 passed / 1 skipped**（616 → 净增 4），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变。**偏离 / 卡内定形**：①预算轴并行语义——tick 照常逐调用计数（并行批内累加），progress 不再调用（批内全派发后无剩余派发点，时间轴闸门移到下一步 tick）；超时/错误的 callId 归属不变（每执行自带 callId，结果各自落流）；②未声明工具在 parallel 模式下事件序与 sequential 不同（call 全部落流后再执行）但裁决/结果语义逐字节一致——"零行为变化"验收指缺省 sequential；③内置工具只声明只读族四件，bash/write/edit/todo/plan 全排他（写类与有状态族，按 B17 纪律不声明）。

#### T-P1-16 · B7 · 工具进度流式上报 `[x]`
- **依据需求**：B7（P1）
- **上游首选参考**：[pi·types.ts:47](../oss/pi/packages/agent/src/types.ts#L47)（mode 面锚已核实）；进度事件形状按验收要点自研（`tool_execution_update` 事件名在 types.ts 未定位——展卡发现，执行会话以语义为准）
- **取什么 / 别抄什么**：取"进度按序到达可观测"；我方事件源架构下进度必须落事件（不变量 1）——**词汇表 17→18 预判**（`tool/progress {turn, step, callId, seq-in-call, message}`），走已演练三次的扩展管线
- **证据强度**：`读了代码`（types.ts mode 面）；`推断`（进度事件形状）
- **要产出**：词汇表扩展 + ToolContext 加 `reportProgress(message)` 回调（只有正在执行的工具拿得到）+ loop 落 `tool/progress` 事件 + bash/长任务先接一个示范 + 单测
- **验收**：`npx vitest run src/kernel/loop.test.ts src/kernel/events.test.ts`（扩）——①进度事件按 callId 聚合后 seq 有序（验收原文"按序到达"）；②不调 reportProgress 的工具零新事件（回归）；③C16 编译闸门 + 计数 18
- **依赖**：无（与 T-P1-15 并行安全）
- **风险 / 未知**：进度事件是否会撑爆流——单工具进度上限（如 10 条）进卡内决定
- **完成记录**：2026-09-26。产出：**词汇表 17→18**（`tool/progress {turn, step, callId, seqInCall, message}`——卡面 `seq-in-call` 落 camelCase `seqInCall`；**turn 域事件**非会话级元事件：与 tool/call/result 同域，校验要求 turn/step 开启且 callId 在 openToolCalls 中，进度只能在所属调用未闭合时产生；EVENT_TYPES/SessionEvent/编译闸门自动覆盖）+ `project.ts`（validation 同域校验两路：孤儿进度拒绝、call 闭合后补报拒绝 + 投影 break 不消费——瞬态事实在事件流本身）+ `context.ts`（`reportProgress?` 键 + env.test 键封闭 AllowedKeys 同步）+ `registry.ts`（`ToolDispatchCall.report?` 通道 → ctx.reportProgress）+ `loop.ts`（`createProgressReporter` 每调用一个闭包：seqInCall 1 起单调 + `MAX_TOOL_PROGRESS_PER_CALL=10` 卡内定形——超限静默丢弃，best-effort 不反压执行；dispatchTool 组载荷时注入 report）+ `builtin/bash.ts` 示范接线（命令启动前上报一次，与 D15 started 标记同语义立场）。验收：`npx vitest run src/kernel/loop.test.ts src/kernel/events.test.ts` → **28 passed**（loop 15 + events 13）：①两调用各报 2 次 → 事件序 [call:c1, 进度×2, result:c1, call:c2, 进度×2, result:c2]、按 callId 聚合 seqInCall=[1,2] 单调、store seq 严格递增、进度全部先于本调用 result、expectPaired 配平；②不调 reportProgress → 精确事件列表与 P0 逐字节一致（零新事件）；③events.test 计数 18 + SAMPLES 并集；上限用例：报 12 次只落 10 条（seqInCall 1..10）；project.test 扩同域校验 2 用例（孤儿进度/闭合后补报均拒）。全量 `npx vitest run` **624 passed / 1 skipped**（620 → 净增 4），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变。**词汇表 17→18 已按待澄清流程立案（执行会话新发现 #5），供用户追认**。**偏离**：①卡面"ToolContext 加 reportProgress（只有正在执行的工具拿得到）"的通道走 loop→toolCall 链 payload→registry→ctx 注入（ToolDispatchCall.report 可选字段），链层替换载荷丢失即无进度（best-effort）；②REPL 进度渲染未接（renderEventSummary default 静默分支吞掉 tool/progress，CLI 可观测面随 CLI 批次——避免本卡波及 cli.test 输出断言）；③协议面零改动（ForwardingStore 逐事件转发，tool/progress 自动可见）。

#### T-P1-17 · F12+F14 · 工具 schema 延迟加载 `[x]`
- **依据需求**：F12（P1）· F14（P1）
- **上游首选参考**：[claude-official·mods/types/claude-code.d.ts](../refs/claude-official/mods/types/claude-code.d.ts) 🔴 只读（`ToolDeferral` 声明形状）；[pi-mono·claude-bridge-cache-marker-telemetry-scar.md](../oss/pi-mono/docs/claude-bridge-cache-marker-telemetry-scar.md)（真实事故：**延迟加载工具的脚手架在首次请求即声明，后续工具增减不破坏前缀**）
- **取什么 / 别抄什么**：取 scar 的两条纪律——①占位脚手架首请求即声明（前缀稳定）；②工具增减以"位置性追加"表达。声明形状学 d.ts 的字段名，实现全自研
- **证据强度**：`读了文档`（scar 全文；d.ts 的 ToolDeferral 字段名）
- **要产出**：ToolDef 加 deferrable 声明 + toChatTools 对 deferrable 工具产占位 schema（name + "按名索取"描述，无真参数面）+ `tool_load` 面扩展（模型按名索要后该工具 schema 后续请求可见——skill_load 同构）+ 单测
- **验收**：`npx vitest run src/kernel/tools/registry.test.ts`（扩）——①deferrable 工具首请求只见占位（断言无真 schema）；②按名索取后后续请求带真 schema；③新增/移除其他工具不动已声明占位（前缀稳定断言）
- **依赖**：无
- **风险 / 未知**：占位在 wire 的形状（空 schema vs 显式 deferred 标记）——卡内定，与 F13 的"位置性追加"对齐
- **完成记录**：2026-09-26。产出：`registry.ts`（`ToolDef.deferrable?` 缺省 false = 全量进清单 P0 不变 + `toChatTools()` 内建占位逻辑——deferrable 且未索取者给 `{name, description: 真描述 + "\n\n[deferred] 完整参数 schema 未加载——调用 tool_load(name: \"<名>\") 按名索取。", parameters: 空 object schema}`（**卡内定形：占位 = 空 schema + 描述内显式 deferred 标记**——模型只读描述，标记在描述里才可被发现；形状只从 name/描述派生）+ `requestToolSchema(name): "loaded"|"visible"`（loadedDeferred Set 会话生命周期；visible = 非 deferrable/重复索取幂等））+ `builtin/tool-load.ts`（检索柄：常驻清单且自身不可 deferrable——claude-official ToolSearch 的 select:<name> 直接选择同语义，关键词检索不做；未知名 TOOL_NOT_FOUND isError 模型可自修）+ `descriptions/tool_load.txt` + `builtin/index.ts`（BUILTIN_TOOL_NAMES 10→11，无条件注册——无 deferrable 工具时调用幂等无害）+ `loop.ts`（deps `toolsProvider?: () => ChatTool[]`——callModel 每请求现取，缺省回落固定 tools P0 零行为变化；request/header.tools 自动如实记录）+ `agent-process.ts`（toolsProvider 接 toChatTools 闭包，替代启动期一次性快照）。验收：`npx vitest run src/kernel/tools/registry.test.ts` → **12 passed**（9 既有 + 3 新）：①占位无真 schema、plain 照旧；②tool_load 索取后原位真 schema（清单长度不变）+ 未知名 TOOL_NOT_FOUND + 重复/非 deferrable 幂等；③占位逐字节相等（两个不同伴随工具的注册表）+ 注册新工具后既有条目不变。loop.test 扩 wiring 用例：toolsProvider 每请求现取（request/header.tools 1→2 如实记录）。连带：plan-mode.test/todo.test/builtin.test 注册面计数 +1（8/10/11 三档）。全量 `npx vitest run` **628 passed / 1 skipped**（624 → 净增 4），`npx tsc --noEmit` 干净，`count-features.sh` = 310 不变。**偏离**：①占位 wire 形状选"空 schema + 描述内 [deferred] 标记"（卡面风险栏二选一的后者）——不新增 ChatTool 扩展字段（厂商 wire 兼容零风险）；②F13 的"位置性追加"落为**原地替换**（占位→真 schema 同位置，清单长度恒定）——比字面"追加"更严格：已声明占位与已加载真 schema 的位置都不被其他工具增减扰动（验收③双断言）；③cli/装配零改动（copy-assets 整目录拷贝自动跟上新描述）。

#### T-P1-18 · F5 · 摘要 / 标题生成 `[ ]`
- **依据需求**：F5（P1）
- **上游首选参考**：[qwen·docs/design/session-recap/session-recap-design.md](../oss/qwen-code/docs/design/session-recap/session-recap-design.md)（会话回顾设计文档）
- **取什么 / 别抄什么**：取"摘要与标题是生成产物、有独立设计面"；我方 P0 的 truncatingSummarizer 假实现换真——**summarizer 消费 provider（模型调用进压缩路径）**，与 P0 假 provider 剧本兼容（测试仍可注入假摘要）
- **证据强度**：`读了文档`（session-recap-design.md 结构）
- **要产出**：真 summarizer（装配注入 provider 的摘要提示词 + 截断回退）+ 会话标题生成（首摘要顺带产出，落 compaction 事件或独立元数据——卡内定，优先复用既有载荷）+ 单测
- **验收**：`npx vitest run src/context/compaction.test.ts`（扩）——①真 summarizer 路径（脚本 provider 剧本产出摘要）落 compaction 事件；②摘要提示词进 request/header 可观测；③假摘要注入测试面保持（P0 用例零改动）
- **依赖**：模型接入层（J 层在位）
- **风险 / 未知**：压缩路径的模型调用失败兜底——回退 truncatingSummarizer（降级不炸压缩，F11 是它的扩展位）

#### T-P1-19 · F6+F13+F15 · 缓存族（前缀保真三面） `[ ]`
- **依据需求**：F6（P1）· F13（P1）· F15（P1）
- **上游首选参考**：[pi-mono·anthropic-cache-split.ts:2-5](../oss/pi-mono/packages/ai/src/api/anthropic-cache-split.ts#L2)（"System-prompt cache split — THE cache primitive"：稳定块带 `cache_control` + 动态尾不带）；[pi-mono·claude-bridge-cache-marker-telemetry-scar.md](../oss/pi-mono/docs/claude-bridge-cache-marker-telemetry-scar.md)（"stable system/tools cache anchor" + 变更以位置性追加表达）；[pi-mono·cache-retention.ts](../oss/pi-mono/packages/ai/src/utils/cache-retention.ts)（cache-safe 压缩）
- **取什么 / 别抄什么**：取三个纪律：①稳定前缀（system/tools 锚）与动态尾分离；②中途改动（换模/改工具集——T-P1-06 已落换模）以追加表达不重写；③压缩重放活前缀不冷写整个上下文。不抄 anthropic 专有 cache_control wire（我方 openai-compat，机制按语义落）
- **证据强度**：`读了代码`（cache-split.ts 头注 + 键序注释）；`读了文档`（scar 全文——cache_creation 高企的真实事故）
- **要产出**：消息装配的前缀稳定结构（system/tools 锚先落、会话体追加序）+ 前缀破坏检测（换模/工具集变更时断言锚未重写——J2 实测 Σinput 64.5k 的直接对策）+ 压缩 cache-safe 路径（摘要替换中段、锚不动）+ 命中率可观测（TokenUsage.cacheRead 已在——按会话分列进 L3 视图）
- **验收**：`npx vitest run src/context/new-window.test.ts src/obs/usage.test.ts`（扩）——①锚稳定断言：换模（T-P1-06 联动）前后 system/tools 块逐字节不变；②压缩后新窗口保留锚（cache-safe 断言——F15 验收原文"压缩不作废缓存"）；③命中率按会话可查
- **依赖**：T-P1-18（真摘要改变压缩产物形态，先定形）
- **风险 / 未知**：openai-compat 无显式 cache_control wire——"前缀保真"是装配纪律而非 wire 标记，验收以锚逐字节不变为准（真实厂商命中率留人工确认）

#### T-P1-20 · B8a · webfetch 工具 `[ ]`
- **依据需求**：B8（P1，本卡落 webfetch；apply_patch/lsp 单独择期）
- **上游首选参考**：[opencode·tool/](../oss/opencode/packages/opencode/src/tool)（webfetch 实现）
- **取什么 / 别抄什么**：取"URL 抓取 → 文本化回喂"；**必须对接 D3 网络策略**（NetworkPolicy 独立一档——P0 T-6-03 的地基），deny 档拒绝
- **证据强度**：`读了代码`（opencode tool 目录面）
- **要产出**：`webfetch` 工具（fetch 经 NetworkPolicy + 响应截断走 B5 通道 + BUILTIN_TOOL_NAMES 10→11）+ 描述 txt + 单测
- **验收**：`npx vitest run src/kernel/tools/builtin/`（扩）——①allow 档 localhost 放行（真端口）；②deny 档拒绝且 NETWORK_DENIED 含目标 URL（D3 语义复用）；③超长响应截断落 spill（T-P1-14 联动）
- **依赖**：T-P1-14（spill 清理在位，防 webfetch 大响应堆积）

#### T-P1-21 · B8b · question 工具（模型向用户提问） `[ ]`
- **依据需求**：B8（P1，本卡落 question）
- **上游首选参考**：[opencode·tool/](../oss/opencode/packages/opencode/src/tool)（question 形状；plan_exit 的 `question.ask` 交互已在 T-P1-11 读过）
- **取什么 / 别抄什么**：取"模型显式提问 → 用户答复 → 工具结果回喂"；我方审批基建（PendingApprovals/Manual broker）承载挂起，**不新增第二套挂起注册表**（hermes 迟到通知教训的延伸：结算语义复用）
- **证据强度**：`读了代码`（opencode question 形状 + 我方 pending.ts 现状）
- **要产出**：`question` 工具（问题文本 → 审批面挂起 → 用户经协议答复 → 回喂）+ REPL 协议消息扩展 + 单测
- **验收**：`npx vitest run src/cli/cli.test.ts`（扩）——①提问挂起可见（协议行）；②答复后工具结果回喂、turn 正常收尾；③超时按拒结算（C50 语义复用）
- **依赖**：无（审批基建在位）
- **风险 / 未知**：question 与权限审批共用通道的语义边界（question 的"答复"不是"批准"）——协议消息分型，不复用 approve 消息名

#### T-P1-22 · J12 · 模型选择器（去重 + 上限 + discovery 兜底） `[ ]`
- **依据需求**：J12（P1）
- **上游首选参考**：[hermes·acp_adapter/model_catalog.py:23-25](../oss/hermes-agent/acp_adapter/model_catalog.py#L23)（"deduplicated `provider:model` rows + refreshed from the live `/models` listing **when available**; discovery fallback——some endpoints have no `/models` route"，slug 用 `custom:<name>`）
- **取什么 / 别抄什么**：取三纪律：目录去重（provider:model 二元组——J4 既有身份）、每厂商上限、**discovery 兜底（声明清单在 /models 缺失时仍可用）**
- **证据强度**：`读了代码`（model_catalog.py 头部与 slug 注释原文）
- **要产出**：模型目录（装配 `models` 注册表的发现面：`/models` 探测 + 声明兜底 + 去重 + 上限）+ 选择器 API（换模注册表的查询面）+ 单测
- **验收**：`npx vitest run src/kernel/model-switch.test.ts`（扩）——①去重（同身份只一行）；②每厂商上限生效；③端点无 `/models` 路由时声明模型仍可用（验收原文，假 provider 404 剧本）；④选择结果可换模（J6 联动）
- **依赖**：T-P1-06 换模注册表（批次 1 已在位）

#### T-P1-23 · J15+J19+J18 · 故障转移 / 熔断 / 限流追踪 `[ ]`
- **依据需求**：J15（P1）· J19（P1）· J18（P1）
- **上游首选参考**：[cc-switch·database/dao/failover.rs:23-31](../oss/cc-switch/src-tauri/src/database/dao/failover.rs#L23)（故障转移**队列**语义：`ORDER BY COALESCE(sort_index, 999999)` 按后端分区，非开关）；[grok·xai-circuit-breaker/src/retry_policy.rs](../oss/grok-build/crates/common/xai-circuit-breaker/src/retry_policy.rs)（`Disposition{Retryable, AuthRefresh, …}` 状态码→处置映射与熔断）；[hermes·agent/rate_limit_tracker.py:24-41](../oss/hermes-agent/agent/rate_limit_tracker.py#L24)（`RateLimitBucket`：used/usage_pct/remaining_seconds_now——按 provider 追踪、接近配额提前告知）
- **取什么 / 别抄什么**：三件各取其纪律——J15 的"队列非开关 + sort_index 序"；J19 的"状态码 → 处置映射集中一处 + 连续失败熔断"；J18 的"桶计量 + 提前告知"。不抄其持久层/DI
- **证据强度**：`读了代码`（三处头部与关键行全部命中）
- **要产出**：provider 容错层（withRetry 之上）：J18 限流桶（按 provider 计量 + 接近配额告警）→ J19 熔断器（连续失败开路、半开探测恢复、Disposition 判据复用 J26 分类）→ J15 故障转移（开路后按队列序切注册表内下一 provider——J6/J7 换模地基联动）+ 单测
- **验收**：`npx vitest run src/models/`（扩）——①连续失败 → 熔断 open（后续请求零发出，计数断言）；②半开恢复（探测成功 → closed）；③开路 → 故障转移队列按序切换（J15 验收"按后端分区"）；④限流桶用量/余量可查询、接近配额告警可断言
- **依赖**：T-P1-22（选择器/注册表面）；J26 重试分类（P0 在位）
- **风险 / 未知**：熔断与 withRetry 的分层边界（重试在请求内、熔断跨请求）——卡内定，避免双计数

## 批次 2 完成定义

- 10 张卡全部打勾，每勾附「命令 + 结果摘要」；`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变（需求 ID 无新增）、`check-doc-links.sh` 0 失效、`license-audit.sh` 通过。
- 词汇表扩展（本批预判 17→18 的 tool/progress）走既有管线（assertNever + l0-events §8 落地记录含回退面 + 待澄清立案）。
- 缓存族（T-P1-19）的锚逐字节不变断言就位；真实厂商端到端复测（同批次 1 终验口径）：并行/进度/缓存三面的行为证据落库。

## 批次 3 候选（占位）

H1–H5 子代理族（大件独立成批）· B8 的 apply_patch/lsp · E5/E6 fork 与会话树 · Q2 会话查询 · P2 层数据生命周期族（M4/Q4/Q6/Q8）。
