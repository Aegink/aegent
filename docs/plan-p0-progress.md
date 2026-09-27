# P0 执行进度（**已定格**——P1 执行进度见 [`plan-p1-progress.md`](plan-p1-progress.md)、P2 见 [`plan-p2-progress.md`](plan-p2-progress.md)）

> 本文件由**执行会话**反复重写；计划本体在 [`plan-p0.md`](plan-p0.md)（执行会话只改任务卡的勾选框、「偏离 / 建议」「完成记录」三个字段）。
> **〔状态 2026-09-27〕本文件定格于 P1 批次 10 收官**（P0 全程 + P1 批次 1-10；全量基线 1081 passed / 1 skipped，词汇表 23 事件，#1~#15 全部追认转正）——**批次 11 起的执行进度（批次报告 / 待澄清 / 人工确认清单）记入 [`plan-p1-progress.md`](plan-p1-progress.md)**，本文件只读留档。

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
| 2026-09-25 | T-5-01 | C58/C20/C2 | `5ffd997` | `npx vitest run src/policy/chain.test.ts` | 10 passed；同两条规则托管/核心换位结果翻转（层序即权威）；[Bash(*)允许, Bash(git*)询问] → git status 落允许、反转落 ask（首匹配胜）；POLICY_LAYERS 唯一层序常量导出断言；模块崩溃上抛不跳过（fail-open 禁止）；rules.ts 泛型化只管顺序语义，通配匹配归 T-5-02 |
| 2026-09-25 | T-5-02 | C1/C3/C4 | `6209b5a` | `npx vitest run src/policy/evaluate.test.ts` | 17 passed；allow/ask/deny 三动作各一例；无规则与不命中均落 ask（§8 第 2 条）；Bash(git status) 精确放行不放过 git push；方言钉死：大小写敏感、反斜杠不归一（opencode 差异点）；首匹配胜双向对照（findLast 语义下宽前规则会是 ask） |
| 2026-09-25 | T-5-03 | C32/C18 | `fd154c3` | `npx vitest run src/policy/decision.test.ts` | 7 passed；链上无匹配返回 abstain 而非 ask（与显式 ask 分开）；verdict 带 rule 原文与 reason（模块缺省以模块名合成）；chain.evaluate 出口从 undefined 升级为 abstain 裁决（chain.test 同步改写）；全量 222 passed |
| 2026-09-25 | T-5-04 | C5/C50/C31 | `b4fb030` | `npx vitest run src/policy/pending.test.ts` | 10 passed；ask 挂起→reply 唤醒（并发互不串扰、同 id 防重）；超时 reject 类型化 PermissionTimeout（非 resolve 非泛 Error）且 timed-out 宣告不静默；迟到 reply 命中墓碑抛 Stale（区分 timeout/reply 结算方式，hermes 迟到通知教训）；dispose 按超时语义拒绝不悬挂 |
| 2026-09-25 | T-5-05 | C21/C38/C44 | `968752f` | `npx vitest run src/policy/rule-loader.test.ts` | 12 passed；样例矛盾加载即报错全量列行号（正例未命中/反例命中/无从校验三类）；畸形规则 invalid never-match 原文保留；C21 委托 bash 匹配器、未登记工具带参规则永不命中（fail-closed）；raw 原文进 verdict.rule；连带 pending.test 固定 sleep 改轮询消竞态；全量 244 passed×3 稳定 |
| 2026-09-25 | T-5-06 | C43/C46 | `15597d4` | `npx vitest run src/policy/aggregate.test.ts` | 11 passed；穷举 16 子集×4 追加=64 组合单调性恒成立（加规则不可能放宽，C35 结构解）；abstain 单位元；.git/.agents/.codex 硬拦出口压过 allow/ask（规则不得授权）、read 不拦、大小写不敏感与嵌套 .git 保守方言；withProtectedPaths 组合交付给 T-5-12 |
| 2026-09-25 | T-5-07 | C35/C45 | `7bdd8fe` | `npx vitest run src/policy/self-guard.test.ts` | 10 passed；agent 写 permissions.json/AGENTS.md 拒绝且理由含"用户可手动修改"提示、agentInitiated=false 透传（防线在发起判定）；linter 三类警告（invalid/unknown-tool/no-matcher-for-args）只警不拒；**连带修 matchers 注册键大写 Bash→小写 bash 方言 bug**（注册名对齐，rule-loader.test 随迁） |
| 2026-09-25 | T-5-08 | C47/C48 | `0651ef9` | `npx vitest run src/policy/review-decision.test.ts` | 9 passed；模型捎带规则提案字段被剥除（大小写变体同剥）且警告含 C48 纪律原文；会话作用域批准后同规则免再问、新会话重新问、once/project/user/managed P0 均不缓存；提案由引擎经 patternOf 计算（bash=完整命令原文）；批准历史落链上模块（kimi 同位） |
| 2026-09-25 | T-5-09 | C49 | `5db9d68` | `npx vitest run src/policy/intersect.test.ts` | 5 passed；可合成 CeilingProfile 逐工具 maxDecision 交集（复用 T-5-06 全序，3×3 穷举不放宽）；opaque 来源相遇抛 PermissionIntersectionError 含两来源名与原因（fail-closed）；纯函数交付，接线等 P1 多端 |
| 2026-09-25 | T-5-10 | C51 | `3d125b6` | `npx vitest run src/policy/broker.test.ts` | 5 passed；缺省 DenyPermissionBroker 对任意 ask resolve deny 且 code=PERMISSION_BROKER_DENIED（deny 是合法结果非异常）；Manual 骨架复用 PendingApprovals（挂起/超时/宣告不重造）、timeoutMs 必填、dispose 透传 |
| 2026-09-25 | T-5-11 | C57 | `bc667a4` | `npx vitest run src/policy/revalidate.test.ts` | 7 passed；伪造 approved/verdict/approvedBy 标记的调用执行点重算仍被拦（deny 与 abstain 都放不过）；链收到当前 sessionId+source 权威标识；registry.dispatch 增 guard 钩子（拒绝 isError TOOL_PERMISSION_DENIED 不执行不产生输出，放行传剥标记参数）；PolicyCall 扩权威标识字段 |
| 2026-09-25 | T-5-12 | C9 | `86cef45` | `npx vitest run src/policy/gate.test.ts` | 10 passed；场景⑦ loop 级：注入文本经模型成为 bash 参数 → 危险库 stub 升 ask → 缺省 Deny broker 拒 → 工具零执行、tool/result isError、注入文本只在 user/assistant message 与 tool/call 数据位；gate=toolCall 点位 ChainLayer（loop 零改动），deny 不调 next 截断；abstain 按不变量 3 默认 ask；C46/C35/C48 全部过闸；verdictFromOutcome 并入规则原文增强可解释性 |
| 2026-09-25 | T-5-13 | C10 | `429783a` | `npx vitest run src/policy/dangerous-commands.test.ts` | 8 passed；三组起步模式（pi 原文正则）rm -rf/sudo/777 各升 ask 带模式名、大小写不敏感、ls 与普通 rm 不命中；清单冻结只追加（装配处加 fork-bomb 即生效）；gate 集成 rm -rf 拒绝且原询问理由透传到 tool/result；gate 改进：broker 拒绝保留原询问理由 |
| 2026-09-25 | T-5-14 | C27/C28/C29 | `3cfb85b` | `npx vitest run src/policy/shell-semantics.test.ts` | 11 passed；B 档扫描器（&&/;/管道/重定向/cd 五种）拆虚拟操作，rm -rf 段命中危险库拒绝；cd $VAR → cwdUnknown 保守 ask、eval/$() 判不确定；重定向写 .git 直接 deny（C46 bash 旁路关闭）；LIMITATIONS 8 条注释+文档双载体逐字一致 |
| 2026-09-25 | T-5-15 | N6 | `4131a10` | `npx vitest run src/session/owner-port.test.ts` | 6 passed；审批请求经通道 → respond_permission 回传 → C5 Deferred 唤醒（T-5-04 联测）；lease 最小版（重复 acquire LeaseBusy、旧句柄按 leaseId 令牌失效、非持有者 NotLeaseHolder）；命令闭集 assertNever 穷尽 + 结果回传原样上抛 |
| 2026-09-25 | T-5-16 | L2 | `428bd03` | `npx vitest run src/policy/audit-fields.test.ts` | 5 passed；完整审批流后可检索 {surface:"cli", approver:"user"}（带 requestId/tool）；超时流 approver=timeout；T-5-15 通道回复走同一审计面；两字段闭集无默认值、缺字段构造即编译失败；pending 宣告 settled/timed-out 增量补 tool |
| 2026-09-25 | T-6-01 | C7/D1 | `c5bf3eb` | `npx vitest run src/sandbox/path-guard.test.ts` + grep 证伪 | 21 passed/1 skipped（符号链接用例无特权跳过）；场景④越界写拒且报错含目标路径不落盘；白名单/孪生目录不误放/受限读面/MSYS+大小写归一；bash 越界重定向拒且命令未启动、cd 后相对目标 fail-closed；builtin/ 裸 fs 写字面量 0 行（无旁路）；全量 356 passed |
| 2026-09-25 | T-6-02 | D2 | `57e109d` | `npx vitest run src/sandbox/templates.test.ts` + `npm run build` | 5 passed；两档模板（on_request/never）可渲染且含命令分段说明（对齐 T-5-14 B 档实际行为）、切档内容互异；{{WRITABLE_ROOTS}} 全量替换且与 PathGuard.describeWritableRoots 联测；未知档位即抛；copy-assets 泛化后模板 md 进 dist（build 实测 4 项） |
| 2026-09-25 | T-6-03 | D3 | `51abfc1` | `npx vitest run src/sandbox/network.test.ts` | 5 passed；deny 档字符串/URL/Request 全拒且真实请求零发生（NETWORK_DENIED 含目标 URL）；allow 档对 localhost 真端口放行 + 透传语义；deny 网络 × PathGuard 允许写组合验证独立一档；README 弱承诺声明机验在位（人工确认清单 D3 行仍待用户目检） |
| 2026-09-25 | T-6-04 | D8 | `f53465a` | `npx vitest run src/sandbox/dpapi.test.ts` + config grep | 4 passed（真实 PowerShell 5.1 子进程）；protect→unprotect 往返一致（含中文载荷 base64 通道）；SecureKeyStore setKey→落盘 JSON 无明文 key（sk- 证伪）→getKey 往返；损坏 blob DPAPI_UNPROTECT_FAILED；config/ 不存在 → grep \|\| echo CLEAN；路线裁定 PowerShell（卡内偏离，未摘 dpapi.rs 代码故 THIRD_PARTY 无登记） |
| 2026-09-25 | T-6-05 | D9 | `c5717dc` | `npx vitest run src/kernel/logger.test.ts` + logs grep | 6 passed；sk- 与 sk-proj- 变体整段掩码（data 深层同掩、恒开）；userContent 约定字段缺省掩码（开关可关、密钥恒掩）；按日文件每行 JSON、写失败降级不带崩；logs/ 不存在 → grep \|\| echo CLEAN |
| 2026-09-25 | T-6-06 | D15 | `5ddc455` | `npx vitest run src/kernel/tools/bash-retry-guard.test.ts` | 8 passed；超时 bash 调用重试层不发起第二次重发（计数断言：初始+重试层首次=2、绝无第 3 次）且拒绝信息含"命令已启动，不自动重试"；started 标记四态（成功/非零/超时/未知失败）+ spawn 失败（ENOENT/EAGAIN）无标记可重试对照；builtin bash meta 断言同步 started |
| 2026-09-25 | T-7-01 | A4/F4 | `e97d040` | `npx vitest run src/context/overflow.test.ts` | 14 passed；溢出与压缩两个模块（OverflowVerdict→CompactionRequest 类型接缝）；本地估算保守方向机验（0.9 除在密度=放大 11%，注释写明"宁可早压不可漏判"）；超限错误识别 code 优先/body 短语兜底、message 刻意不认（Q10）；调用次序断言 ["overflow-identified","compaction-entry"]、无关错误原路径上抛对照 |
| 2026-09-25 | T-7-02 | F3/F20/F21 | `d73afe7` | `npx vitest run src/context/compaction.test.ts` | 9 passed；pre hook 可中止（abort 后零 compaction 事件、summarizer 未调）→摘要→事件落盘→post hook 观察；Q13 两相位 phaseForCompletedSteps(0)=PreTurn/(≥1)=MidTurn、MidTurn 于 step 边界可断言；compaction 载荷对齐词汇表（tokensBefore 缺 usage 退本地估算）；revert 有效视窗内压缩；O7 断言器连带修（compaction/checkpoint/header 不要求轮开启）；全量 407 passed |
| 2026-09-25 | T-7-03 | F22/F23 | `c585f96` | `npx vitest run src/context/new-window.test.ts` | 9 passed；消息集逐条断言 [system]→[摘要]→[developer 注入(预算从新到旧,至少保一条)]→[retainedTail 后原文]；system 原文逐字不被摘要改写；压缩后追加事件自然进新窗口、只认最新压缩、revert 掉 compaction 即全量重建 |
| 2026-09-25 | T-7-04 | F9/F10 | `6be4531` | `npx vitest run src/context/pressure.test.ts` | 8 passed；三信号统一压力记录（usage 权威/无 usage 本地兜底仍产生记录/provider 拒绝=压力证据,无关错误 null）；OverflowRecoveryError.cause === provider 原始错误对象（abort 与压缩抛错两路径）；turnEnd 链压缩层次序断言 compaction.seq < turn/end.seq；阈值默认 0.8（dsh 同款） |
| 2026-09-25 | T-7-05 | F17 | `567e196` | `npx vitest run src/context/tool-pairing.test.ts` | 7 passed；增量配平状态机（纯函数 advancePairing,断档/corrupt 抛 ToolPairingError 带 seq）；流尾悬挂 call → retainedTail 自动回退到 call 之前（切点前子流过 expectPaired）；伪造 step 标记（result 谎称 step 42）切点仍按 callId 内容现算——对 step 标记免疫 |
| 2026-09-25 | T-7-06 | F24 | `37954f0` | `npx vitest run src/context/downshift.test.ts` | 4 passed；超限投影 → maybeDownshift 内压缩 await 完成先于"切换"（日志次序 ["compaction-entry","switch"]）；compaction 事件 reason="model_downshift"（词汇表加可选 reason 字段,codex CompactionReason 词表）；装得下/恰好等于不压、无 usage 本地估算兜底 |
| 2026-09-25 | T-7-07 | F28 | `0c3316b` | `npx vitest run src/context/rapid-refill.test.ts` | 7 passed；零进展连续压缩 evaluate 拟算 1→2→3 → 引擎入口第 0 段抛 RapidRefillError 且 err.consecutiveRapidRefills=3/toolTurnsSinceCompact=0（全计数）、该次压缩未落盘；干活 3 步骤解锁归 0；熔断路径状态冻结不虚增；可配阈值 |
| 2026-09-25 | T-7-08 | M10 | `363bd02` | `npx vitest run src/context/budget.test.ts` | 8 passed；越档提醒→markDelivered 后同档不再发；未 mark（取消）→ 同档重发；换 windowId 送达记账失效重发；加权公式 output×2+input×1=250、cacheRead 折减 230（J25 同款）；耗尽后 recordUsage 恒 true |
| 2026-09-25 | T-7-09 | F1/F2 | `eb34efe` | `npx vitest run src/context/system-prompt.test.ts` | 8 passed；a/b/c 假 fs：a 与 a/b 同时生效且 b 的"测试规范"覆盖 a、收集序列 [远→近] 含 root 层且 root 是边界；不注入 basePrompt 时输出含真 base.md（改文件零 .ts diff 机验）；权限段真模板两档互异 + {{WRITABLE_ROOTS}} 替换；`npm run build` 基础提示 1 项进 dist；opencode 加载器锚点（instruction.ts findUp 就近取一个不叠加）已回填 requirements F2 并注明与本方自研语义的差异；全量 458 passed |
| 2026-09-25 | T-8-01 | K1 | `bfd6756` | `npx vitest run src/cli/` + smoke 实测 | 5 passed；审批全链路（write ask 挂起→/approve allow→文件落盘）、/revert 事件可见、越界类型化错误、echo 会话完整事件流；smoke（--db）SQLite 9 事件 seq 连续、system 提示 2264 字实测；阶段 5/7 模块接线进装配（gate/压缩/压力/抖动/预算/系统提示 + runFlushPoint 首接）；全量 463 passed |
| 2026-09-25 | T-8-02 | E11 | `cb1d43c` | `npx vitest run src/session/git-checkpoint.test.ts` | 6 passed（真 git 仓夹具）；场景① CLI 级联测：审批放行 write 改文件 → /revert 到改前事件点 → baseline.txt 回"改前"+ reverted 回执；空 stash 落 ref:null（偏离 pi 的跳过）；非 git 目录首次 warn 静默；无检查点/apply 冲突抛明确错误；全量 469 passed |
| 2026-09-25 | T-8-03 | L1/L3 | `ccc3370` | `npx vitest run src/obs/usage.test.ts && ls logs/ \|\| echo NO_LOG_DIR` | 3 passed；1002 事件喂入按会话/按轮分列可查（Σinput=1,402,800 逐列断言）、usage 缺失不算 0、totalTokens 显式优先、多会话不串扰；logs/ NO_LOG_DIR（L1 否定性面）；全量 472 passed |
| 2026-09-25 | T-8-04 | Q5 | `b95fa8b` | `npx vitest run src/session/boot-maintenance.test.ts` | 5 passed；崩溃态对账全闭合、codes=[STEP_INTERRUPTED, TURN_INTERRUPTED] 细分、turn/end{interrupted} append-only 落流；干净 no-op；幂等；杀进程重启 restore→对账→新 prompt 开 turn 2 不续跑（事件流 interrupted/completed 共存）；全量 477 passed |
| 2026-09-25 | T-8-05 | （汇编卡，§8 十条） | （本次 commit） | 十条逐项执行（见「P0 终验收记录」） | 十条全过：①11 passed+smoke SQLite 复证 ②45 passed ③21 passed/1 skipped（符号链接→人工确认）④8 passed ⑤4 passed+config CLEAN ⑥10.1ms<200ms ⑦冷启动 283.3/273ms、RSS 47.1MB、Token 省 94.3% ⑧17/17 exit 0 ⑨548 链接 0 失效 ⑩310 与 §5 一致 |
| 2026-09-25 | T-P1-01 | C46 | `b747dc9` | `npx vitest run src/policy/exit-guard.test.ts` | 10 passed；LIMITATIONS #7 旁路复现转绿（用户层 allow 先匹配压过链裁决→出口级仍 deny）；bash 虚拟写通道（>/>>/大小写/$VAR 段命中/cd 相对目标）+ write/edit 回归 + revalidator 出口同位（C46×C57 共存）；protected-names 拆分防循环依赖；全量 487 passed，tsc 干净（P1 批次 1 首卡，卡在 docs/plan-p1.md） |
| 2026-09-25 | T-P1-02 | C22/C24/G5 | `2fcf0e4` | `npx vitest run src/policy/rule-scope.test.ts src/cli/cli.test.ts` | rule-scope 4 passed（turn-override endTurn 失效）+ CLI 级联 2 用例（--session 同规则免再问/once 对照再问）+ feedback 落 L2 审计；createSessionApprovalModule 装配接线（T-8-01 偏离⑤关闭）；证伪 grep 写文件 0 行；全量 494 passed，tsc 干净 |
| 2026-09-25 | T-P1-03 | C49/C45 | `cd6c29c` | `npx vitest run src/policy/ceiling-exit.test.ts` | 9 passed；enforceCeiling 出口级（gate/revalidator 同位，用户 allow 被上限收窄→零执行）+ intersectAllProfiles 折叠（opaque 即抛拒启动）+ linter 装配常开（policy-lint 警告可检索）；无 profiles 默认装配零行为变化；全量 503 passed，tsc 干净——**C22/C46 权限聚合组（3 卡）收官** |
| 2026-09-25 | T-P1-04 | J6/J7 | `ca3bba5` | `npx vitest run src/kernel/model-switch.test.ts` | 9 passed；①turn1 流中途换模→在途两 step request/header 全旧身份、turn2 新模型（captured 事件侧面断言）；②未注册 MODEL_NOT_REGISTERED 类型化错误且 configured 不动；③configured/captured 分别观测；协议级全链 3 用例（合法换模下一 turn 生效/未注册 error 行/未装配 UNAVAILABLE）+ 闭集型证；全量 515 passed，tsc 干净——**J6 换模组首卡** |
| 2026-09-25 | T-P1-05 | J8/J11 | `be30e4a` | `npx vitest run src/kernel/model-switch.test.ts` | 19 passed（+10）；①迁移守卫纯函数合法表逐条+非法组合 ModelSwitchStateError；②deferred 暂存 configured 不变→首个 turn 捕获即应用；③回滚恢复 prev 且 lastRollback 可观测（无关码/无事务对照不回滚）；④A→B→C 同事务修订 prev 保持 A；loop 新 hook onTurnError 接装配（failTurn 透传 LlmFailure）；T-P1-04 用例零改动全绿；全量 525 passed，tsc 干净 |
| 2026-09-25 | T-P1-06 | J9/J10/J14 | `3e37f14` | `npx vitest run src/kernel/model-switch.test.ts src/kernel/events.test.ts` | 37 passed（24+13）；①换模/回滚落 model/switch 事件 seq 连续可投影（modelSwitches 事实源）+协议行转发可见；②globalDefault 变更不改变已有会话级选择；③重启重建装配后模型仍是用户选的（J14）；④C16 编译闸门+计数 15；对照：流内选择不在注册表装配失败不静默；**词汇表 14→15 已立案待追认**（执行会话新发现 #2）；全量 530 passed，tsc 干净——**J6 换模组（3 卡）收官** |
| 2026-09-26 | T-P1-07 | I1/I13 | `11a8d33` | `npx vitest run src/kernel/hooks.test.ts src/kernel/chain.test.ts` | 27 passed（chain 14 + hooks 13）；①hook 嵌套序=注册序、前 hook 截断不调 next（loop 级工具不执行、tool/result 落 hook 值）；②trace 完整层序（namedLayer）+budget 墙钟衰减可断言（500→380/超支 -150）；③L10 链底无人应答抛错点名事件；④崩溃双轨：untrusted before→隔离 isError（HOOK_FAILED）、trusted→上抛（T-5-01 同款）、after 段一律上抛、modelRequest→blocked、turnEnd→吞错继续；hook 层挂 gate 外层；全量 548 passed，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-08 | I2 | `219af6d` | `npx vitest run src/kernel/skills.test.ts` | 8 passed；①递归发现含嵌套源；②缺损/坏行/重复名产诊断码不抛（invalid_metadata/parse_failed/duplicate_name）；③skill_load 按名取正文、未知名 SKILL_NOT_FOUND；④改 SKILL.md 零 .ts diff 机验（清单+正文跟文件走）；集成：system/message 首落带清单、诊断落 skill-lint 日志；copy-assets 整目录拷贝自动跟上（工具描述 7→8）；BUILTIN_TOOL_NAMES 6→7；全量 556 passed，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-09 | I6/I9 | `8ec9cbb` | `npx vitest run src/kernel/hooks.test.ts src/kernel/plugin-manifest.test.ts` | 22 passed（14+8）；①分轨：layer 只含 trusted（内核 trace 零 untracked 感知）、untrustedLayer 独立观察轨（next 哨兵=能力越界抛错、崩溃轨内隔离+报告可检索）；②未实现能力拒绝且列明缺哪项；③闭集外字段/坏 point/重复声明拒绝；④trusted 安装后内核链直调、untrusted 观察轨可用、声明未实现 handler 拒绝且回滚无半态、uninstall 摘净；全量 565 passed，tsc 干净，count-features 310——**I 层扩展面组（3 卡）收官** |
| 2026-09-26 | T-P1-10 | G2 | `7f6893c` | `npx vitest run src/kernel/tools/builtin/todo.test.ts src/session/project.test.ts` | 18 passed（7+11）；①todo_write 落 todo/update（会话级元事件、整值、投影 todos 可查）；②CLI 级 meta-ops 白名单直过无审批、进度行整幅可见（cli.test 扩）；③词汇表 15→16 编译闸门+计数；④todo_write 过出口级硬拦透传 + WRITE_EXECUTE_TOOLS 归类（plan 硬关铺垫，exit-guard.test 扩 3）；连带 logger.ts 时钟注入缺口修复（跨日 flaky）；全量 579 passed，tsc 干净，count-features 310——**词汇表 15→16 已立案待追认（新发现 #3）** |
| 2026-09-26 | T-P1-11 | G1/G7 | `ff56b82` | `npx vitest run src/kernel/plan-mode.test.ts src/policy/exit-guard.test.ts` | 24 passed（11+13）；①plan 激活写/执行类出口硬关、用户 allow 规则压不过（gate 集成不进 broker 直接拒）；②读类透传；③退出后恢复（CLI 端到端：进出经审批、硬关无审批弹窗、退出后 bash 回到 ask）；④planModeFromEvents 流重建（被拒申请不改状态）；⑤提示词独立文件零 .ts diff + 注册面 7/8/9/10 四档；plan-guard 消费 T-P1-10 的 WRITE_EXECUTE_TOOLS 唯一权威；全量 591 passed，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-12 | G3/G6 | `d0a162f` | `npx vitest run src/kernel/goal.test.ts` | 13 passed；①goal 跨 5 轮 tick 保持；②每轮注入提醒（装配级 injected 落流 + CLI"（注入）[目标提醒]"可见）；③到期三动作可断言（abandon 终态/report 持续催办/renew 自动续期）；④goal/set 落流、同 store 重建装配后 goal 仍在且不重复落初始事实；⑤词汇表 16→17 编译闸门+投影 goals+revert 切割+迁移守卫非法表穷举；全量 605 passed，tsc 干净，count-features 310——**词汇表 16→17 已立案待追认（新发现 #4）** |
| 2026-09-26 | T-P1-13 | G4 | `d41239a` | `npx vitest run src/kernel/plan-mode.test.ts src/session/boot-maintenance.test.ts` | 21 passed（15+6）；①plan_exit 批准提交计划 → artifact 落盘 + checkpoint{provider:"plan"} 事件、planArtifactFromEvents 按流找回重启可读；②plan 会话崩溃重启：对账 interrupted、不自动重放（Q5 口径）、artifact 可读；③真 git 仓验证与 E11 互不干扰（untracked 不入 stash，/revert 代码回退不动 artifact）；checkpoint 槽位复核够用未扩词汇表；全量 610 passed，tsc 干净，count-features 310——**G 层 Planning 组（4 卡）收官，P1 批次 1 全部 13 卡完成** |
| 2026-09-26 | T-P1-14 | Q3 | `e9800f2` | `npx vitest run src/kernel/tools/truncate.test.ts` | 11 passed（6 既有+5 新）；①12 次截断（spillMaxFiles=5）后 spill 恰 5 个且幸存者是最老先删的 c7..c11；②证伪：外来文件/形状相近无标记/名字形状命中的目录在会话清理+上限 0 双触发下原样保留；③会话关闭 sweep 按 sessionId 删自动可删者、manual/他话/外来全留；wiring：agent-child 退出三路径 finish()（await 清理再 exit）+ sessionId 首次传入 ToolRegistry（生产标记不再 unknown-session）；agent-process.test 扩 dispose 清理用例；deletable 扩 after-session-end（T-4-06 预留点兑现）；全量 616 passed / 1 skipped，tsc 干净，count-features 310——**P1 批次 2 首卡** |
| 2026-09-26 | T-P1-15 | B17/B6 | `51ec8ed` | `npx vitest run src/kernel/loop.test.ts` | 12 passed（8 既有+4 新）；①parallel 声明组启动重叠+完成序≠提交序+result 完成序/call 提交序双序+expectPaired 配平；②批次 [r1,w1,r2] 未声明 w1 排他化（FIFO 不越位）；③缺省 sequential 逐段交错 P0 回归；+RwLock 独立语义（读读并发/写互斥/FIFO/头部读者成批放行）；只读族 read/glob/grep/skill_load 声明 parallel:true、写族全排他；agent-process 接 toolExecution 装配选项；全量 620 passed / 1 skipped，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-16 | B7 | `c7f4d51` | `npx vitest run src/kernel/loop.test.ts src/kernel/events.test.ts` | 28 passed（loop 15+events 13）；①进度按 callId 聚合 seqInCall 单调、store seq 严格递增、先于本调用 result、配平不受影响；②不调 reportProgress 零新事件（P0 事件列表逐字节回归）；③词汇表 17→18 编译闸门+计数+SAMPLES 并集+条数上限 10（报 12 落 10）；project.test 扩同域校验（孤儿进度/闭合后补报均拒）；bash 示范接线；**待澄清 #5 立案待追认**；全量 624 passed / 1 skipped，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-17 | F12/F14 | `ceed4c6` | `npx vitest run src/kernel/tools/registry.test.ts` | 12 passed（9 既有+3 新）；①deferrable 占位（空 schema+[deferred] 描述标记）非 deferrable 照旧；②tool_load 索取后原位真 schema+TOOL_NOT_FOUND+幂等；③占位逐字节跨注册表相等+新增工具不扰动既有条目（F14 前缀稳定）；loop.toolsProvider 每请求现取 wiring；BUILTIN_TOOL_NAMES 10→11；全量 628 passed / 1 skipped，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-18 | F5 | `cf207d3` | `npx vitest run src/context/compaction.test.ts` | 14 passed（9 既有+5 新）；①真 summarizer（脚本 provider 剧本）落 compaction 事件含 title；②request/header{reason:"compaction"} 副调用头落流+提示词进请求 system 消息可断言；③P0 假摘要注入零改动全绿；+首摘要定名/截断回退（provider 失败降级不炸压缩+告警可检索）/解析回退档；truncatingSummarizer 移入 context 层防环；**待澄清 #6 立案（reason 扩值+CompactionEvent.title）**；全量 633 passed / 1 skipped，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-19 | F6/F13/F15 | `2f2d608` | `npx vitest run src/context/new-window.test.ts src/obs/usage.test.ts` | 15 passed（new-window 11+usage 4）；①换模锚零通知+wire 级 system/tools 逐字节相等（T-P1-06 联动）；②压缩前后锚逐字节相等+新窗口 [system 原文,摘要,…]（F15"压缩不作废缓存"）；③命中率会话行 10/300、轮行分列、input=0 缺席；loop 扩 appended/rewritten 形态检测；prefix-anchor 新模块（computeCacheAnchor/describeAnchorChange）；rewritten 落 warn（换模+rewritten=违背 F13 告警）；全量 637 passed / 1 skipped，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-20 | B8a | `fbe81dd` | `npx vitest run src/kernel/tools/builtin/` | 35 passed（31 既有+4 新）；①allow 真端口放行（content+meta）；②deny 零 I/O 拒绝 NETWORK_DENIED 含 URL；③2500 行响应经 registry 出口截断落 spill（Q13 标记+全文+提示）；+URL/404/无守卫不注册对照；webfetch fetch 经 NetworkGuard（D3 唯一入口）+networkPolicy 装配选项+--network 参数；BUILTIN_TOOL_NAMES 11→12；全量 642 passed / 1 skipped，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-21 | B8b | `9de6b86` | `npx vitest run src/cli/cli.test.ts` | 13 passed（10 既有+3 新）；①question_asked 分型行可见（零 ⏸ 审批面冒用）；②/answer 后答复回喂+turn completed；③400ms 超时 isError 回喂（C50）+turn completed；+plan 模式可提问（meta-ops 白名单放行，出口硬关不误伤）；同一 PendingApprovals 挂起（协议分型 question/answer+question_asked）；REPL /answer 命令；BUILTIN_TOOL_NAMES 12→13；全量 645 passed / 1 skipped，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-22 | J12 | `fbb7815` | `npx vitest run src/kernel/model-switch.test.ts` | 28 passed（24 既有+4 新）；①去重（声明优先于发现）；②每厂商上限 200+当前模型豁免；③http-mock 404 剧本兜底声明行 + 200 剧本增量并入；④listSwitchableModels 查询+声明条目 switch 受理（deferred 语义）+discovered-only 拒绝（fail-closed）；catalog 新模块+openai-compat /models 发现函数；全量 649 passed / 1 skipped，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-23 | J15/J19/J18 | （本次 commit） | `npx vitest run src/models/` | 31 passed（25 既有+6 新）；①阈值 3 三败开路+第 4 请求零发出+双计数证明（maxAttempts=3 单请求 3 调用只计 1 失败）；②冷却后半开探测成功 closed/再败 open 重计时；③[a,b,c] 队列序转移+开路跳过+粘住+ALL_BACKENDS_FAILED；④terminal 不计数但换家；⑤限流桶 70%→85% 上穿告警恰一次+resetInSeconds 随钟衰减；fault-tolerance 新模块（classifyProviderFailure 复用 J26+CircuitBreaker+RateLimitTracker+createFailoverProvider）；全量 655 passed / 1 skipped，tsc 干净，count-features 310——**批次 2 全部 10 卡（T-P1-14~23）完成** |
| 2026-09-26 | T-P1-24 | D5 | `b7a22a8` | `npx vitest run src/sandbox/backend.test.ts` | 5 passed；①danger-full-access 真命令跑通（echo/cat 真 cwd/exit 3 如实）；②read-only/workspace-write 双档拒绝且 env 调用计数 0（"instead of running unconfined"）；③假后端多态注入（接口不被 local 实现绑死）；④supportedModes 能力自述；SandboxBackend 接口+createLocalBackend+SANDBOX_UNAVAILABLE fail-closed 语义；全量 661 passed / 1 skipped，tsc 干净，count-features 310——**P1 批次 3 首卡** |
| 2026-09-26 | T-P1-25 | D6/D10 | `87c11a1` | `npx vitest run src/sandbox/workspace-sid.test.ts src/sandbox/win32-backend.test.ts` | 11 passed（SID 4+backend 7 含真机集成 5）；Rust helper crate（main/grant/token/spawn/err 五模块，windows-sys 0.48）；受限令牌 WRITE_RESTRICTED+restricting 清单按 mode+默认 DACL grant+Low integrity；grant 三件套（capability SID 写 ACE+Everyone FILE_DELETE_CHILD deny+Low 标签）exact-ACE 幂等；真机写隔离 4 场景全过（workspace-write 写内成功/写外拒、read-only 写内拒/读内 ok）；TOKEN_GROUPS offset 8 padding 首版被真机抓出修正；**msys bash 与受限令牌结构性不兼容（NtCreateDirectoryObject 0xC0000022）记 LIMITATIONS——PowerShell 是 Windows 沙箱态宿主正路**；全量 672 passed，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-26 | D13/D14 | `cc9aa02` | `npx vitest run src/sandbox/containment.test.ts src/sandbox/win32-backend.test.ts` | 13 passed（containment 4+backend 9）+cargo test 1 passed；helper 升级 Job 管辖（suspended 创建→AssignProcessToJobObject→resume 无逃逸窗口、结算=目标退出&&Job 活动数归 0、超时 TerminateJobObject 全树回收→等清空才报 TIMEOUT）；真机：后代活过宿主结算 4.2s（等范围空）、超时全树回收 2.6s（不等 30s 后代）；D14 createContainedBackend 工厂——helper 缺席降级 warn 恰一次（provider 生命周期）+弱兜底受限 mode 报 SANDBOX_UNAVAILABLE；LimitFlags 机制 cargo test 钉死；**target/ 误入库发现后移除并 gitignore**；全量 678 passed，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-27 | D16 | `230430c` | `npx vitest run src/sandbox/offline-network.test.ts` | 7 passed（身份联动 3+账户名闭集 2+未 provision 类型化失败真机 1+probe 非特权可读 1）+cargo test 1 passed；helper 扩 wfp.rs（WFP persistent 三件套我方 GUID 命名空间+ALE_USER_ID 出站 BLOCK（FWP_SECURITY_DESCRIPTOR_TYPE 条件值=账户 SD，BuildSecurityDescriptorW 构造 codex 同构）+delete-then-add 幂等+probe 按 key）+account.rs（NetUserAdd aegent-sbx-<6hex>+LsaAddAccountRights SeBatchLogonRight+幂等）+run-offline（**CreateProcessWithLogonW seclogon 路径无需 SE_TCB**、密码 stdin 传明文不进命令行）；resolveNetworkIdentity（codex from_permissions 同构）；三动作错误路径真机冒烟全对（probe 无特权可读 provisioned=false、provision 非 admin net code 5、run-offline NETWORK_SANDBOX_NOT_PROVISIONED）；elevated provision+offline 联网被拒 → 人工确认清单；全量 685 passed，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-28 | D11 | `b430fd4` | `npx vitest run src/kernel/tools/pwsh.test.ts` | 9 passed（pwsh 真命令 1.3s+bash 缺省/显式零变化回归+cwd 透传+dispatch 面 started 标记+sandbox 态经 env 抽象多态+出口硬拦外拒内放+plan 硬关清单含 pwsh）；env.ts 扩 ShellKind（pwsh 宿主优先 pwsh Core 缺失回落 powershell.exe 进程级缓存；本机无 Core 实测回落）；builtin/pwsh.ts 平行 bash（重定向字面解析跨方言有效过 PathGuard+D15 started+TOOL_TIMEOUT+进度示范+PwshError 分型）；BUILTIN_TOOL_NAMES 13→14+WRITE_EXECUTE_TOOLS +pwsh+descriptions/pwsh.txt；LIMITATIONS 双载体扩 pwsh 方言边界节 #9-12（参数式写 cmdlet 边界/只误报不误放行/**退出码宿主语义**（dsh 同款决策，卡面"一致"预期记偏离）/**msys bash 受限令牌不兼容**）；注册面三处计数更新（14/11/9）；全量 694 passed，tsc 干净，count-features 310 |
| 2026-09-26 | T-P1-29 | D7 | `7c8fd4e` | `npx vitest run src/sandbox/doctor.test.ts` | 7 passed（真机四行报告与 helper 在场性一致、helper 缺席 error+remediation 指 build:sandbox-helper、未 provision warn+弱承诺+D3 现值、已 provision ok、probe 不可得/抛异常→warn"未知"、渲染含标记与汇总计数）；doctor.ts（runDoctorChecks 依赖全注入判定面无 I/O+formatDoctorReport codex 风格）+cli/doctor.ts 独立入口（不起 agent 循环，退出码 0/1）+cli/provision.ts（密码打印一次提示 DPAPI 落盘）+npm scripts doctor/sandbox:provision；**真机独立运行 npm run doctor → 0 error / 1 warning / 3 ok**（helper 三行 ok+D16 未 provision warn+弱承诺文案与修复提示在位）；全量 701 passed / 1 skipped，tsc 干净，count-features 310——**批次 3 全部 6 卡（T-P1-24~29）完成，P1 批次 3 收官** |
| 2026-09-26 | T-P1-30 | O12 | `6578459` | `npx vitest run src/kernel/invariants.test.ts src/test-support/event-asserts.test.ts` | 15 passed（invariants 7+event-asserts 8 零改动）；InvariantRegistry（register 重复名拒绝/check 逐不变量独立收集——fail 收集/throw 断言器 adaptThrowing/编程错误三路都进失败清单不吞错）+createDefaultRegistry 内建四件（turn-scoped/paired-steps/paired-tool-calls/single-terminal-per-turn 新按轮形态）+装配 invariants 选项缺省关（启用时装配期跑一轮失败落 warn）；三断言器实现迁入 kernel 域+event-asserts re-export 保 import 面；E11 checkpoint 无误报核对；全量 710 passed，tsc 干净——**P1 批次 4 首卡** |
| 2026-09-26 | T-P1-31 | O13/O20 | `65ca3cf` | `npx vitest run src/test-support/http-mock.test.ts` | http-mock 扩四访问器 expectCalls(n,why)/singleRequest(why)/lastRequest(why)/requestAt(i,why)（数量不符 Error 含「why」+expected/got codex 双载体）+ScriptedProvider.requestAt+迁移示范 provider.test 裸下标改 requestAt；卡内定形：requestAt 只管索引越界、总量归 expectCalls（首版"恰 i+1 次"语义被测试抓出修正）；O20 核对结论=部分覆盖（T-2-03 计数纪律已在用、带说明访问器本卡补齐）；全量 713 passed，tsc 干净 |
| 2026-09-26 | T-P1-32 | O14/O24 | `8794355` | `npx vitest run src/test-support/render.test.ts` | 9 passed；render.ts：formatGenerateInput（system/tools 深等→[unchanged] 折叠、消息前缀延伸只渲染 +K 后缀、分叉全量渲染标分叉点、tool_calls/tool 身份渲染）+formatRequestWindow（codex 判据四路开窗：identity/system/tools 变更或输入分叉，窗头记原因；首请求全量后续 suffix）；卡内定形：前缀判断逐条 JSON 深等（引用相等被测试抓出）；F13 联动消费留 T-P1-37 |
| 2026-09-26 | T-P1-33 | O23 | `5a90344` | `npx vitest run src/test-support/render.test.ts` | 14 passed（9+5）；renderEventStream（[emit]/[wire] 前缀+padEnd 全流最长名定列+JSON.stringify 单行结构性转义+normalize 注入+maxLineChars 可选截断+空流占位）；列对齐/单行/保序交错/截断标记/归一化注入五断言 |
| 2026-09-26 | T-P1-34 | O15/O16 | `867966c` | `npx vitest run src/test-support/llm-replay.test.ts src/test-support/fault-server.test.ts` | 12 passed；llm-replay.ts（RecordingProvider wrap 任意 provider 透传+逐调用记 {request,chunks} JSONL fixture 无时间戳；ReplayProvider first-call 序回放+耗尽可读失败+ReplayOverride{atCall,chunks/error} 注入面；serializeCalls/parseCalls roundtrip）+fault-server.ts 六具名故障行为闭集（reset/stall/malformed-chunk/rate-limit/server-error/partial-then-success，未知值抛错 fail-closed）+http-mock 扩 ResetScript/StallScript(unref 定时恢复)/SseScript.truncateAfter（**flush 回调后才 destroy 防缓冲丢弃**）+cli/mock-llm.ts 库面+mock-llm-run.ts 独立入口+npm script mock:llm+HttpMock.start 可选 port；**录制→回放等价**（同 loop 跑录制与回放，归一化 seq/ts/stream[].time 后逐字节相等）+六行为 wire 各自可断言；**真机 CLI 冒烟**：mock-llm-run --port 18923 → ready 行 → curl 429/503 → stdout 请求记录 JSONL；全量 739 passed，tsc 干净 |
| 2026-09-26 | T-P1-35 | O18 | `7ffab32` | `npx vitest run src/diagnostics/doctor.test.ts` | 5 passed；diagnostics/doctor.ts（runRuntimeDoctorChecks 依赖全注入四行：environment ok/workspace 缺失 warn/config 模型身份结构性无凭证/storage dbPath 未配置 warn·目录不可写 error·损坏 error+计数）+collectRuntimeDoctorFacts+cli/doctor.ts 聚合两域+--json 导出（脱敏证伪 sk-/api-key/authorization/Bearer 零命中）+db.ts 导出 CURRENT_SCHEMA_VERSION；**真机 npm run doctor → 8 行报告 0 error/3 warning/5 ok exit 0**；Windows db 句柄 EBUSY 竞态 finally 容忍记录；全量 744 passed，tsc 干净 |
| 2026-09-26 | T-P1-36 | O19 | `b55b935` | `npx vitest run src/test-support/migration-asserts.test.ts` | 5 passed；migration-asserts.ts（legacyShapeStream 旧形状流夹具——当前词汇表全部可选字段缺席清单化+新字段补进纪律；assertForwardCompatibleStream restore+投影全跑 async 签名；assertSchemaVersionGate 构造 user_version=CURRENT+1 断言类型化拒绝含"拒绝用旧代码打开新库"文案；assertMigrationAtomic 注入失败→恢复断言+模板误用自检）；消费用例：旧流经桩 storage restore+project 语义完整/goalFromEvents 不依赖 deadline/PK 冲突整批回滚无半写（T-1-02 单事务消费）；真实 v0→vN 迁移链批次 10 Q1 落地（既定消费方）；全量 749 passed，tsc 干净 |
| 2026-09-26 | T-P1-37 | O21/O22 | `5892c8d` | `npx vitest run src/context/compaction.snapshot.test.ts` | 5 passed；SnapshotHeader 扩 scenario?（缺省提醒同 whyEnded，既有快照零改动）+snapshotToString 首行渲染 Scenario+compaction.snapshot.test 四相位快照（local-overflow/provider-overflow/model-downshift 三 reason compacted+pre-hook aborted，Scenario 头行+[emit] 单行 JSON 事件流+摘要行）+派生断言（事件面 reason 全集 {context_limit,model_downshift,pre-hook-aborted} 与覆盖清单相等，新形态缺位即红）；卡内定形：事件面两溢出源共用 context_limit（compactionReasonOf 词表），人话区分由 Scenario 承担；全量 754 passed，tsc 干净 |
| 2026-09-26 | T-P1-38 | O25 | `302fa54` | `npx vitest run src/test-support/isolation.test.ts src/kernel/tools/env.test.ts` | isolation 7 passed+env 回归全绿；isolation.ts（**故障机制头注释**——同文件内测试串行共享进程：A 改 env/触热缓存→B 读残留顺序耦合；四件隔离 pi-desktop 同构：serializeGlobal promise 链 prev.then(fn,fn) 中毒不扩散/withEnv RAII finally 快照恢复/withEnvSerialized 组合/模块级缓存显式重置面）+env.ts resetPwshHostCacheForTests；**盘点结论**：pwshHostCache 是唯一模块级可变全局（logger warned 闭包内/registry·guard 全构造注入/env 消费启动期）——单进程假设无冲突（agent 本就多进程，子进程天然隔离）；全量 761 passed，tsc 干净 |
| 2026-09-26 | T-P1-39 | O26 | `7d647df` | `npx vitest run`（全量回归，本卡零代码变更） | 全量 761 passed / 1 skipped；**758 个测试名盘点**=行为规格 552+验收前缀行为句 77+启发式弱名命中 129（逐条人工核查零改名——省略主语句由 describe 承载/紧凑行为句 deny-pass 成对/括号内边界注解三理由）；安全边界抽查三处合格（exit-guard 13 名 10+ 带硬拦语义+bash-retry-guard fail-closed 语义+plan-mode 硬关压过）；**弱名数量 0**；命名纪律落批次完成定义——**批次 4 全部 10 卡（T-P1-30~39）完成，P1 批次 4 收官** |
| 2026-09-27 | T-P1-46 | A17 | `13a0129` | `npx vitest run src/kernel/loop.cancel.test.ts` | 8 passed（+2）；decideTurn 后+beforeFirstModelRequest 后两处显式取消检查（end 分支不再吞 completed）；11 点 await 盘点清单落卡；全量 793 passed / 1 skipped——**批次 6 首卡** |
| 2026-09-27 | T-P1-47 | A10/A11/A15 | `a1d3e86` | `npx vitest run src/kernel/agent-protocol.test.ts src/kernel/agent-process.test.ts src/kernel/loop.test.ts src/cli/cli.test.ts` | 53 passed（+4）；协议 steer 请求 + TURN_NOT_ACTIVE 准入 + CLI /steer（expectedTurn 自动跟踪）；A11 消费时点双层钉死；用例抓到 turn/end 转发先于清位的窗口（steer 误受理开轮 2）→ activeTurn 清位提前到 closeTurn 开头；A15 记档关闭（三排空点结构成立）；全量 797 passed / 1 skipped |
| 2026-09-27 | T-P1-48 | A13/M9 | `1240cbd` | `npx vitest run src/kernel/prompt-gate.test.ts src/kernel/queue.test.ts src/kernel/loop.test.ts src/kernel/agent-process.test.ts` | 36 passed（+9）；prompt-gate 三态（kimi PromptGateVerdict 同构：拦截不落流 warn 留痕/改写落改写文/放行原样）+ PromptQueue maxSize 缺省 64 超限 QueueFullError + 进程级 QUEUE_FULL error 行无收执；gate 抛错 failTurn 收轮；词汇表零扩展兑现；全量 806 passed / 1 skipped（首跑 1 flaky 未复现记档） |
| 2026-09-27 | T-P1-49 | J20/M9 | `a4685a7` | `npx vitest run src/kernel/admission.test.ts src/kernel/agent-process.test.ts` | 13 passed（+7）；TurnAdmission（admit/Permit 幂等 release/beginDrain/SERVER_DRAINING）+ ToolClassLimiter（类独立 FIFO 排队、名额转交、缺省 Infinity）+ dispose 收尾闭闸双请求拒绝；用例抓到 kick 里 draining 后 admit 抛错打断 kick 链致进程不退 → draining 跳过 admit（拒绝面只在 handleRequest）；全量 813 passed / 1 skipped |
| 2026-09-27 | T-P1-50 | A14 | `d31b341` | `npx vitest run src/kernel/loop.test.ts src/kernel/loop.cancel.test.ts` | 33 passed（+4）；maxStepsPerTurn（缺省 0 不限，超限 blocked+warn）+ abortTimeoutMs 看门狗（强制收轮补 step/end+turn/end{aborted}+迟到结果闸门防 double terminal）+ 正常路径 disarm；B14×A14 三轴边界记档；全量 817 passed / 1 skipped |
| 2026-09-27 | T-P1-51 | A5 | `8d55224` | `npx vitest run src/models/retry.test.ts` | 12 passed（+2）；withRetry onRetry 钩子（attempt/delayMs/retryErrorFields 同构三字段）+ agent-child openai 装配缺省 warn 留痕；429×2 留痕恰 2 次 attempt 递增 delay 一致、400 零留痕；零事件扩展兑现；全量 819 passed / 1 skipped |
| 2026-09-27 | T-P1-52 | A8 | `6a3e87b` | `npx vitest run src/kernel/agent-process.test.ts src/cli/cli.test.ts src/kernel/queue.test.ts src/kernel/agent-protocol.test.ts` | 41 passed（+2）；aborted 轮后队列未消费输入经 prompt_returned 全量退回（drainAll）不自动续跑（pi-desktop Stop 同构）+ REPL ⮐ 回显；completed 续开不变；审批挂起不响应 cancel 的边界记档（C50 既有语义）；全量 821 passed / 1 skipped |
| 2026-09-27 | T-P1-53 | A12 | `5befd74` | `npx vitest run src/kernel/loop.test.ts src/session/project.test.ts src/test-support/migration-asserts.test.ts src/kernel/events.test.ts` | 54 passed（+4）；user/message 载荷扩可选 promptId（loop 分配 p<序数>、恢复从流重建基线、关联区间按流推导、A9 复证）；project 校验空串拒/缺省兼容；落地记录 9 + **待澄清 #8 立案供追认**（19 计数不变）；全量 825 passed / 1 skipped（偶发 flaky 二次记档，3 连跑全绿） |
| 2026-09-27 | T-P1-54 | （收口，无独立 ID） | （本次 commit） | `npx vitest run`（全量） | 827 passed / 1 skipped（+2）；六面盘点（one-at-a-time×gate 拦截不补位测试钉死 + 四套上限清单 + admission×Q5 无交互 + PromptGate×C9 分域 + 双 id 分工复核 + steer 全链快照）；count-features 310、check-doc-links 548 链接 0 失效、license-audit exit 0——**批次 6 全部 9 卡完成，P1 批次 6 收官** |

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
| 2 | J9 | `plan-p1.md` T-P1-06 明文"换模进事件流 + 新增会话级元事件 model/switch"，但词汇表（落地记录 2 后）正式计数为 14，无换模落点 | 同先例 #1 的结构：不追加事件则换模/回滚状态变更无事件承载（J9 纪律"换模是持久事件、非静默改状态"落不了）；追加则词汇表 14→15 | 按计划卡执行：新增 `model/switch {from, to, reason: "user"\|"rollback"}`（会话级元事件，session/revert 同款：不要求 turn/step 上下文、turn 挂流内最后轮空流兜 0），词汇表 14→15，l0-events.md §8 记落地记录 3（含不追认的回退面），events.test 计数同步改 15 | ✅ **已追认（2026-09-25 用户："可以"）**——案关，§3.2 正式计数为 15 事件 |
| 3 | G2 | `plan-p1.md` T-P1-10 明文"新增事件 todo/update {items}（会话级元事件，走词汇表扩展流程 15→16）"，但词汇表（落地记录 3 后）正式计数为 15，无 todo 落点 | 同先例 #1/#2 的结构：不追加事件则 todo 状态变更无事件承载（G2"todo 变更 = 事件、状态 = 投影"落不了，违反不变量 1）；追加则词汇表 15→16 | 按计划卡执行：新增 `todo/update {items: Array<{content, status: "pending"\|"in_progress"\|"completed"}>}`（会话级元事件，session/revert / model/switch 同款：不要求 turn/step 上下文、turn 挂流内最后轮空流兜 0；items 为变更后完整清单——E12 整值），词汇表 15→16，l0-events.md §8 记落地记录 4（含不追认的回退面），events.test 计数同步改 16 | ✅ **已追认（2026-09-26 用户："全部认可"）**——案关，词汇表 15→16 转正 |
| 4 | G3 | `plan-p1.md` T-P1-12 明文"新增事件 goal/set {text, deadline?}（词汇表 16→17，走扩展流程）"，但词汇表（落地记录 4 后）正式计数为 16，无 goal 落点 | 同先例 #1/#2/#3 的结构：goal 跨轮保持与重启恢复（验收④）需流内事实承载（不变量 1）；追加则词汇表 16→17。另：卡面载荷形状无 status，但状态机四动作（设定/达成/放弃/续期）都是状态变更，无 status 则达成/放弃无表达面 | 按计划卡执行：新增 `goal/set {text, deadline?, status: "active"\|"achieved"\|"abandoned"}`（会话级元事件，同款纪律；载荷补必填 status——E12 整值，终态保留 text/deadline 终值），词汇表 16→17，l0-events.md §8 记落地记录 5（含不追认的回退面），events.test 计数同步改 17 | ✅ **已追认（2026-09-26 用户："全部认可"）**——案关，词汇表 16→17 转正，§3.2 正式计数 17 事件 |
| 5 | B7 | `plan-p1.md` T-P1-16 明文"词汇表 17→18 预判（`tool/progress {turn, step, callId, seq-in-call, message}`）"，但词汇表（落地记录 5 后）正式计数为 17，无进度落点 | 同先例 #1~#4 的结构：进度在事件源架构下必须落事件（不变量 1），无落点则 B7"按序到达可观测"落不了；追加则词汇表 17→18。与先例两点差异：①它是 **turn 域事件**非会话级元事件（与 tool/call 同域，校验要求所属调用未闭合）；②卡面 `seq-in-call` 落为 camelCase `seqInCall`（代码库标识符风格一致） | 按计划卡执行：新增 `tool/progress {turn, step, callId, seqInCall, message}`（turn 域事件；seqInCall 调用内 1 起单调；单调用条数上限 10 卡内定形——超限静默丢弃不反压执行），词汇表 17→18，l0-events.md §8 记落地记录 6（含不追认的回退面），events.test 计数同步改 18 | ✅ **已追认（2026-09-26 用户："两件事都按照你的建议来"）**——案关，词汇表 17→18 转正，§3.2 正式计数 18 事件 |
| 6 | F5 | `plan-p1.md` T-P1-18 验收②"摘要提示词进 request/header 可观测"：压缩摘要的模型副调用落 request/header 时，`RequestHeaderReason` 现有四值（initial/resume/change/series，DSH 同款）无一语义匹配——用任何一个都是流内谎言 | 词汇表**载荷枚举**扩展（事件计数不变）：RequestHeaderReason 四值→五值（+`"compaction"`）；另 `CompactionEvent` 加可选 `title?`（首摘要定名，卡面"优先复用既有载荷"，T-7-06 加可选 reason 字段同款先例） | 按验收要求执行：reason 扩 `"compaction"`（副调用头可区分主轮）+ compaction 载荷加可选 title；l0-events.md §8 记落地记录 7（含不追认的回退面） | ✅ **已追认（2026-09-26 用户："两件事都按照你的建议来"）**——案关，reason 扩值与 CompactionEvent.title 转正 |

| 7 | E5 | `plan-p1.md` T-P1-40 明文"词汇表扩展 session/fork {parentSessionId, position, cutSeq} 会话级元事件（落子流头部，log-only 不进模型历史——走待澄清立案 18→19）"，但词汇表（落地记录 7 后）正式计数为 18，无 fork lineage 落点 | 同先例 #1~#4 的结构：分叉出的新会话必须有自己的流内事实承载父子关系（不变量 1：重启后 lineage 仍可按流重建；内存元数据随进程消失）；追加则词汇表 18→19。词形采用 requirements 的 before/after（pi 当前版本为 `position?: "before"\|"at"`，语义等价——切点是否包含选中条目，展卡记录已注明） | 按计划卡执行：新增 `session/fork {parentSessionId, position: "before"\|"after", cutSeq}`（会话级元事件，session/revert 同款：不要求 turn/step 上下文；**落子流头部**、**log-only 不进模型历史**——dsh descriptor 同构先例；cutSeq = 父流复制到的最后一条 seq，0 即空分支），词汇表 18→19，l0-events.md §3.2 表格 + §8 记落地记录 8（含不追认的回退面），events.test 计数同步改 19 | ✅ **已追认（2026-09-26 用户："认可"）**——案关，词汇表 18→19 转正，§3.2 正式计数 19 事件 |
| 8 | A12 | `plan-p1.md` T-P1-53 明文"user/message 事件载荷加可选 promptId"（A12 关联 id），但词汇表（落地记录 8 后）19 事件的 user/message 载荷为 `{message, source}`，无关联 id 落点 | 同 T-P1-18（#6）载荷扩展先例的结构：A12 的关联键必须落流内事实（不变量 1——重启后仍可按流推导关联区间）；追加则 user/message 载荷扩一处（事件计数 19 不变）。**零新事件**；关联区间由流顺序天然定义（仅扩起点一处，不逐事件打 id）；promptId 是关联键非完成句柄（A9 复证） | 按计划卡执行：`user/message` 载荷加**可选 `promptId?: string`**（loop 分配 p<序数> 会话内单调、恢复路径从流重建基线；project validation present 时非空、缺省放行=前向兼容），l0-events.md §3.2 行 + §8 记落地记录 9（含不追认的回退面） | ✅ **已追认（2026-09-27 用户："认可"）**——案关，promptId 载荷扩展转正（事件计数 19 不变） |
| 9 | B19+J27 | `plan-p1.md` T-P1-61 明文：B19 step 可观测（timing/traceId 载荷）+ J27 retrying 一等事件（新事件）——卡序头词汇表预判①③走立案。我方词汇表（落地记录 9 后）19 事件无 retrying 事件、step/end 载荷无 timing/traceId 落点 | J27 的"重试在事件流里可见"需要新事件（kimi retrying 同构：attempt/delayMs/error 三字段——provider 层中间失败尝试 assistant/attempt 不落盘，事件流完全不可见是真实缺口）；B19 需 step/end 载荷扩展（ModelRequestTiming 最小面 timing + traceId 关联键）。**一处新事件（19→20）+ 一处载荷扩展**；retrying 保持 log-only 兼容面（T-P1-51 warn 不撤） | 按计划卡执行：新事件 `assistant/retrying {turn, step, attempt, delayMs, error}` + `step/end` 可选 `timing?/traceId?`（有模型请求的 step 才带），l0-events.md §3.2 行 + §8 记落地记录 10（含不追认的回退面） | ✅ **已追认关闭（2026-09-27 用户："待澄清表认可"）**——案关，词汇表 19→20 转正，§3.2 正式计数 20 事件 |
| 10 | B20 | `plan-p1.md` T-P1-62 明文：输出 token 触顶可续跑（zcode classify 同构），卡序头词汇表预判②走立案。我方 StreamChunk 的 done 变体无 finishReason（mapWireChunk 丢弃 wire 的 finish_reason），触顶信号无从感知 | 触顶判定需要厂商 finish_reason 进入流词汇（done 变体可选字段）；续跑落 user/message source="injected"（注入上下文既有语义，零新事件——事件计数 20 不变）；zcode 三值决策 + 上限 3 + 固定 CONTINUE prompt 全部对齐 | 按计划卡执行：StreamChunk.done 加可选 `finishReason?: string`（openai-compat 捕获 wire 值），loop 触顶集闭集判定 + 续跑计数上限 3，l0-events.md §8 记落地记录 11（含不追认的回退面） | ✅ **已追认关闭（2026-09-27 用户："待澄清表认可"）**——案关，finishReason 载荷扩展转正（事件计数 20 不变） |
| 11 | C17 | `plan-p1.md` T-P1-72 明文：插件事件泛型逃生舱（词汇表 20→21 走立案）。我方词汇表（落地记录 11 后）20 事件无插件落点 | C17 的"唯一泛型逃生舱"需要流内承载（不变量 1：插件事实落流才可按流重建）；追加则词汇表 20→21。词形 `plugin {namespace, payload?}`（pi CustomEntry 同构：namespace 非空必填 + payload 可选 JsonValue；log-only 会话级元事件）；C15 双向钉死——唯一开放槽位，其他未知类型恒拒 | 按计划卡执行：新事件 `plugin {namespace, payload?}`，l0-events.md §3.2 行 + §8 记落地记录 12（含不追认的回退面） | ✅ **已追认关闭（2026-09-27 两步确认：开工表态"待澄清表认可然后继续"先行解读转正 → 会话末用户"认可转正"复核确认）**——案关，词汇表 20→21 转正，§3.2 正式计数 21 事件 |
| 12 | L8 | `plan-p1.md` T-P1-92 明文：compaction 载荷扩六维（codex facts.rs 对位）。我方 compaction 载荷现状 {turn, summary, retainedTail, tokensBefore, usage?, reason?, title?}，无 trigger/phase/implementation/strategy/status | 同 T-P1-18 载荷扩展先例的结构：L8 的"可统计、可归因"需要六维流内事实；追加则 compaction 载荷扩五可选字段（事件计数 21 不变）。tokensAfter 卡面候选未落——引擎无精确来源，宁可少字段不落流内谎言 | 按计划卡执行：CompactionEvent 加 trigger?/phase?/implementation?/strategy?/status? 五可选字段（status 缺省读作 completed；started/failed 随 T-P1-93），project 校验值域闭集 + obs 统计面，l0-events.md §8 记落地记录 13 | ✅ **已追认（2026-09-27 用户："认可"）**——案关 |
| 13 | E17 | `plan-p1.md` T-P1-93 明文：原子操作中间态进事件流。我方现状：压缩只在完成时落单事件（进行中/失败对投影不可见）；zcode 锚点用独立中间态事件 | 中间态需流内事实承载；落法裁定 = 复用 compaction 事件 status 值（started 前置/failed 结算），**零新事件零新字段**（status 字段已在 #12 立案），E17 落行为面 + new-window/投影切换权威口径 | 按计划卡执行：两段化落流 + 失败升流内事实 + 只认 completed 切换，l0-events.md §8 记落地记录 14 | ✅ **已追认（2026-09-27 用户："认可"）**——案关 |
| 14 | E18 | `plan-p1.md` T-P1-94 明文：turn/end 载荷扩 produced。我方 turn/end 载荷 {turn, reason, aborted?, cause?}，无产出集合 | 同 T-P1-18 载荷扩展先例：机器自报产出集合需流内承载；追加则 turn/end 载荷扩可选 produced?: number[]（事件计数 21 不变）；tool 结果不进 produced（自带 turn 归属，无反推成本——卡面记档） | 按计划卡执行：loop 收轮自报（turnEndChain 终端 + 看门狗路径）+ abort 部分产出照报，l0-events.md §8 记落地记录 15 | ✅ **已追认（2026-09-27 用户："认可"）**——案关 |
| 15 | L7 | `plan-p1.md` T-P1-95 明文：命令调用与裁决持久化（dsh command/run+done 同构）。我方词汇表 21 事件无命令落点，REPL 斜杠命令调用不落流 | dsh 的"这条命令执行过"需要流内承载（刷新/换端/fork 后可查）；追加则词汇表 21→23（command/run + command/done 两新事件，log-only 会话级元事件）；与 L2 审计分域记档 | 按计划卡执行：CLI 接线（run 前置/done 结算/未知命令 error）+ 子进程落流 case，l0-events.md §8 记落地记录 16 | ✅ **已追认（2026-09-27 用户："认可"）**——案关 |

## 人工确认清单

| 需求ID | 为什么不能机验 | 人工要怎么确认 |
| --- | --- | --- |
| 批次 2 三面（B6/B7/F6） | ~~需要真实网关~~ **已实测（2026-09-26，用户提供网关 cline-pass/deepseek-v4.1-flash，key 不落盘）**：三场景真实会话（tmp 驱动脚本不入库，toolExecution=parallel 装配 + 审批自动放行 + question 自动答复）——**B7 进度**：2 条 `tool/progress`（bash「命令已启动」，seqInCall=1、落流有序）；**B8b question 全链**：真实模型自发调 question（args 恰为指定问题）→ 自动答复「写总结」→ tool/result「用户答复：写总结」→ 模型确认并继续；**B6 并行**：parallel 装配全 session 无异常；**F6 缓存**：网关回 `cached_tokens`——cacheRead 逐轮增长（1024→2048→2176→2176→2304→2432），Σinput=14,272 / ΣcacheRead=12,160 → **cacheHitRate≈85.2%**（远超 F6「省 ≥30%」口径；未缓存增量输入 6 请求合计仅 2,112）。42 事件 seq 连续、3/3 轮 completed、3 tool/call = 3 tool/result 配平 | **已关闭（2026-09-26）** |
| J15 多端点容错 | 熔断开路切第二家需要第二真实端点 | **已实测（2026-09-26，用户提供第二端点 <redacted-endpoint-2> / deepseek-v4.1-flash-free，key 不落盘）**：队列 [primary=死端口（模拟主端点宕机，retryable）, backup=第二端点（真实模型）]——**sanity 即换家并粘住**（primary 拒连 → backup 真实出话「深度求索的服务」→ current=backup），后续请求 primary 零发出（不再重复探测死端点）；req2 备端点也抖动（免费端点 ECONNRESET）→ **ALL_BACKENDS_FAILED 类型化错误**列明两家失败原因且 primary 熔断 open；恢复后 req3/req4 backup 真实出话（「我是助手，由深度」）。**实测发现并修复一个真实缺陷（本次 commit）**：消费方在 done 即 break 会中止 failover 生成器，recordSuccess 与"粘住"簿记全部丢失（每次请求都重新探测死端点）——簿记移入 finally（增量已交付 = 接管成功照样记账），回归测试钉死；该缺陷在批次 2 验收时未暴露（单测自然流终 + loop 不提前 break），真实消费方提前收尾场景才触发 |
| 批次 3 三面（D16/D10/D8） | **D16 elevated provision**：NetUserAdd+SeBatchLogonRight+WFP persistent 出站 BLOCK 需要**管理员权限**（本环境非管理员已核实 net session）——自动化面已过（probe 非特权可读 provisioned=false、provision 非 admin net code 5、run-offline NETWORK_SANDBOX_NOT_PROVISIONED）。**人工确认方式**：管理员 shell 跑 `npm run sandbox:provision`（记下打印的账户与密码并立即加密落盘）→ `npm run doctor` 应报 network-isolation ok → 以沙箱账户跑 `powershell -Command "Invoke-WebRequest github.com"` 应联网被拒。**D10 grant 完整行为**：deny delete ACE 挡"跨 grant 根删除"未单独断言（Low integrity + 写隔离主语义已真机验证：workspace-write 写内成功/写外拒、read-only 写内拒/读内 ok、Job 后代管辖/超时全树回收）。**D8 机器级扩展**：沙箱账户密码 DPAPI 加密落盘未接线（协议面已通，随 CLI 批次 SecureKeyStore） | 待人工实测（有管理员权限时） |
| J2（部分） | ~~真实厂商连通性需要 API key~~ **已实测（2026-09-25，用户提供 OpenAI 兼容端点，deepseek-v4.1-flash）**：流式 192 块（reasoning-delta/text-delta/usage/done）、usage 落库（input 2196/output 191/total 2387/reasoningTokens 175）、L3 视图可查；真实模型 tool_call 流式分片拼接正确（arguments 完整 JSON）、审批挂起→超时→isError 回喂→模型自适应重试→诚实收尾，27 事件配平落库。系统提示生效（模型自称 aegent）。**剩：不同厂商 wire 差异的多端点复测**（同一端点已闭环） | **复测已关闭（2026-09-26，P1 批次 1 终验）**：不同接入路径实测通过（用户网关 <redacted-endpoint>，模型 cline-pass/deepseek-v4.1-flash，OpenAI Chat Completions 协议）——五场景审批放行全链路 + 128 事件 seq 连续 + 15/15 配平 + reasoningTokens 映射有效（见下方「批次 1 终验收记录」） |
| T9 冷启动 | 「<500ms」依赖本机负载 | T-8-05 终验收已实测两形态：echo 模式 median 283.3ms、SQLite 模式 median 273ms，达标收口（T-3-06 基线 109.6ms 的上浮源于子进程装配扩容，见 T-8-05 偏离①） |
| D3 弱承诺 | 「网络策略只管工具层」是声明不是代码属性 | **已关闭（2026-09-25 用户目检裁决："可以"）**——`src/sandbox/README.md` 置顶加粗的弱承诺段（只拦工具层 fetch，不承诺 bash 子进程/模型接入层/OS 级，deny 档 ≠ 网络隔离）获用户认可 |
| T-6-01 符号链接逃逸 | 本机无创建符号链接特权（Windows 需开发者模式），逃逸用例自动跳过（LIMITATIONS #1） | 有特权环境跑 `npx vitest run src/sandbox/path-guard.test.ts` 应 22 全过（终验收实测 21 passed + 1 skipped）；realpath 归一逻辑已有"最近存在祖先"路径的确定性用例覆盖 |
| §6.2 常驻内存 | 任务管理器观察（需求原文如此） | **多会话并发实测完成（2026-09-25，用户要求的口径）**——agent-child 并发脚本（`scratch/_tmp_mem/concurrent.mjs`，WorkingSet64 每 250ms 采样）：① 8 会话×10 轮（~43 事件/进程）：单进程峰值 43.5–43.9MB，并发总 349.4MB；② 16 会话×10 轮：单进程 43.6–43.8MB，总 700.1MB；③ 8 会话×50 轮（~210 事件/进程，事件×5）：单进程 45.9–46.5MB（仅 +2.5MB）。**结论：单实例常驻稳定 43–47MB（<150MB 余量 3 倍+，含 node 运行时基线）；事件规模翻 5 倍内存仅微涨（大头是运行时基线，内核对象增长温和）；多会话 = N×单实例线性扩展（T9 每会话一进程的架构结果，16 会话总 700MB 超 150MB 是 16 个实例合计——单实例口径达标，进程级共享内核摊薄属 K5/P1 host 架构）**。任务管理器目测（需求原文方式）随时可做，数据在此可复核 |
| 批次 10 遗留（随批记档项） | ~~**词汇表四案待追认（#12~#15）**~~ **已闭环（2026-09-27 用户"认可"，四案转正，正式计数 23 事件）**：compaction 六维载荷（#12）/ 压缩中间态 started/failed 行为（#13）/ turn/end produced（#14）/ command/run+done 新事件 21→23（#15）——回退面各案齐备。**非缺陷记档项**：M1/M2 job 面无 BUILTIN 工具与 CLI 露出（无发起方，S 组批次消费）；Q7 压缩对象偏离（logs 族而非 rollout——单库 SQLite 架构使然）；zstd 探测缺省 gzip 降级（Node 22.19 实测 zstd 在位——降级路仅兜旧运行时）；L7 done 判定落 CLI 受理时点（子进程拒绝经 error 行可见——多端时随 N7 复核）；E14 独立 JSONL 与事件流 stream 字段双载体（stream 是事实源，JSONL 是运维检索面）；llm-summarizer 内部降级不抛（failed 只在降级兜不住时发生）| 无待用户裁决项；四案追认照待澄清管线 |
| 批次 8 遗留（C34/C8/C12 随批记档项） | ~~#11 转正的解读待复核~~ **已闭环（2026-09-27 用户"认可转正"复核确认，21 事件正式计数）**；**trustGated 打标来源缺位**（cache.record {trustGated} 机制在位、仓库配置加载器未落）；**sandboxMode 观测 knob**（store 值可改、消费面动态读随接线批次）——后两者非缺陷，随后续批次收口 | 无待用户裁决项；遗留随仓库规则加载批次与消费面接线批次 |

### J2 实测记录（2026-09-25，真实 OpenAI 兼容端点）

- **端点**：用户提供的第三方网关（deepseek-v4.1-flash，reasoning 模型；地址/key 不落盘，见会话记录）。
- **会话一（纯对话）**：CLI 真进程 `--provider openai --db` → 模型回复正确且自称 aegent（**系统提示装配生效**）；流 192 块全类型到达；usage 落库含 reasoningTokens（适配层 toTokenUsage 映射 `delta.reasoning` 变体实测有效——T-2-02 预判的两个变体之一）；L3 视图按会话分列可查。
- **会话二（工具调用）**：模型自发产 write 调用 → **流式分片拼接正确**（arguments 完整 JSON，T-2-02 风险栏的"真实厂商 index 对齐"实测闭环）→ 无规则 ask → 审批挂起 → 12s 超时 isError 回喂 → 模型自适应改试 bash/read → 连续被拦 → **诚实收尾**报告失败。27 事件 seq 连续、三对 call/result 配平、turn/end{completed}。
- **实测发现并修复一个真实缺陷（commit 本次）**：父进程意外死亡（如输出被 head 截断）→ 子进程往断开的 stdout 写 → 无监听器的 EPIPE 直接杀死子进程 → write-behind buffer 丢失（j2tool.db 只剩 schema、0 事件）。修复：agent-process 给 output 挂 error 监听，EPIPE 走与 stdin 关闭相同的优雅收尾（cancel 在途轮 → 等轮收尾 flush 落库 → exit）。
- **观察（记录不阻塞）**：toChatTools 缺省空 JSON schema（T-4-01 既定形状）下真实模型会猜参数名（read 传了 `{file_text}` 而非 `{path}`，description txt 里有说明但模型未遵循）——P1 给真实厂商装配带上参数 schema 可解。

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

## 阶段 5 报告（完成于 2026-09-25）

- **打勾情况**：16 / 16（T-5-01 ~ T-5-16 全部完成，无未完成项）
- **产出的文件**：
  - `src/policy/chain.ts` + `rules.ts` + `chain.test.ts`——权限链（POLICY_LAYERS 层序、首个非 undefined 者胜）与泛型首匹配规则集模块（T-5-01）
  - `src/policy/evaluate.ts` + 测试——双维通配 + 默认 ask 兜底 + 首匹配求值（T-5-02）
  - `src/policy/decision.ts` + 测试——四值决策（链级 abstain 出口）+ Verdict{action,rule?,reason}（T-5-03）
  - `src/policy/pending.ts` + 测试——待审批挂起注册表（Deferred+Map、PermissionTimeout、迟到 reply stale 墓碑、三事实宣告）（T-5-04）
  - `src/policy/matchers.ts` + `rule-loader.ts` + 测试——C21 参数匹配委托（bash 匹配器 + sampleCall 样例校验路径）+ C38 raw 保留 + C44 加载期样例校验（T-5-05）
  - `src/policy/aggregate.ts` + `protected-paths.ts` + 测试——max() 单调聚合（穷举性质测试）+ .git/.agents/.codex 硬拦出口（T-5-06）
  - `src/policy/self-guard.ts` + `linter.ts` + 测试——C35 自我修改防线（agentInitiated 判定）+ C45 linter 三类永不生效警告（T-5-07）
  - `src/policy/review-decision.ts` + 测试——C47 五档作用域（P0 落 once+session）+ C48 引擎算提案 + 模型捎带提案剥除 + 会话批准链上模块（T-5-08）
  - `src/policy/intersect.ts` + 测试——C49 多来源交集（opaque 相遇 fail-closed）（T-5-09）
  - `src/policy/broker.ts` + 测试——C51 审批出口端口（Deny 缺省 + Manual 骨架）（T-5-10）
  - `src/policy/revalidate.ts` + 测试——C57 执行点重算（剥决策标记 + 权威标识重跑链）；registry.dispatch 增 guard 钩子（T-5-11）
  - `src/policy/gate.ts` + 测试——C9 策略闸门挂 toolCall 点位（loop 零改动的 ChainLayer），场景⑦注入测试（T-5-12）
  - `src/policy/dangerous-commands.ts` + 测试——C10 危险命令模式库（pi 三组起步、只追加）（T-5-13）
  - `src/policy/shell-semantics.ts` + `docs/shell-semantics-limitations.md` + 测试——C27/C28/C29 B 档扫描器 + LIMITATIONS 8 条双载体（T-5-14）
  - `src/session/owner-port.ts` + 测试——N6 owner 命令通道（闭集 + lease + 结果回传）（T-5-15）
  - `src/policy/audit-fields.ts` + 测试——L2 surface/approver 审计字段（T-5-16）
- **验收台账**：16 卡 16 命令全部通过（见台账表）；全量 `npx vitest run` **331 passed / 0 failed**（阶段 4 收尾 188 → 净增 143），`npx tsc --noEmit` 全程干净；`check-doc-links.sh` 对新文档 0 失效
- **阶段完成定义核对**：注入文本不能改变求值时机 ✓（gate.test 场景⑦：注入文本只在 user/assistant message 与 tool/call 数据位，求值先于执行、工具零执行）；无规则危险命令默认询问 ✓（gate abstain→ask→缺省 Deny broker + dangerous-commands 升 ask）；规则加载期校验拒绝坏规则 ✓（rule-loader 样例矛盾整批拒 + linter 三类警告）；审批超时带类型失败 ✓（PermissionTimeout code 化 + 宣告）
- **偏离计划的地方**：
  1. **rules.ts 泛型化**（T-5-01）：规则集模块只管首匹配顺序语义、match 注入——规则形状与通配归 T-5-02/05，避免写一遍就扔的匹配器
  2. **abstain 落为链级出口**（T-5-03）：chain.evaluate 全链无人应答返回 abstain 裁决替代 undefined；模块级"没意见"仍是 undefined（kimi 语义），ask/abstain 两层分开
  3. **registry guard 与 gate 的部署边界**（T-5-11/12）：gate 是 P0 规范执行面；registry guard（C57 重算）留给无 gate 的旁路装配——两者同时启用时 once 批准无法过第二次重算，头注释已声明
  4. **matchers 注册键方言 bug 本修**（T-5-07 连带）：键从大写 "Bash" 改小写 "bash" 对齐注册表名——**PolicyCall.tool 用注册表小写名，规则文本必须按注册名写**（大写 Bash 是上游显示习惯）
  5. **gate 拒绝理由保留原询问**（T-5-13 连带）+ verdictFromOutcome 并入规则原文（T-5-12 连带）：C18 可解释性不因 broker 兜底而丢失
  6. **pending 宣告 settled/timed-out 增量补 tool**（T-5-16 连带）：审计"审批了什么"需要工具名
- **新发现的约束或坑**：
  - **SessionStore.load(sessionId) 必须显式传会话 id**——无参调用返回空数组（keys 按会话分桶），gate.test 曾因此误判"事件流为空"
  - 固定 sleep 等待计时器在 vitest 并行下会竞态（pending.test 30ms 等 10ms 定时器偶发不过）——统一改轮询等待（连跑 3 轮验证稳定）
  - 测试直调 ChainLayer 时 next 必须构造带 point/trace/budget 槽位的完整 ChainNext（T-3-01 形状），裸函数过不了类型
  - "首匹配胜 + 层序"的组合语义：用户层 allow 规则会压过核心层模块（危险库/语义分析）——这是 C2 的既定语义（显式规则优先），但意味着用户手滑写宽规则会静默关掉危险提示，linter（C45）与提示词模板（T-6-02）是配套防线
- **遗留风险与未知**：
  - shell 虚拟操作的裁决在链上受首匹配层序影响，非出口级硬拦（LIMITATIONS #7）——用户层 allow 规则可能先于语义分析模块裁决，C46 出口级组合留 P1
  - scope=session 的批准缓存记录接线在 T-8（owner 通道转达答复时调 ApprovalScopeCache）；P0 gate 的 broker 放行仅 once 语义
  - bash 参数式写文件（tee/dd/cp）不识别为写操作（LIMITATIONS #6）；fd 重定向不抽取（#5）——C29 清单已声明
  - intersect / linter 的装配接线等 T-8（P0 单来源单链在跑）；人工确认清单不变（J2 真实厂商连通性、D3、§6.2 常驻内存）
- **下一阶段提示词**：

```
继续 aegent 内核的实施。读 docs/plan-p0.md 的 §0 执行协议，然后从「阶段 6」
的第一张 [ ] 任务卡开始。上一阶段报告在 docs/plan-p0-progress.md。
本阶段特有的注意：1) T-6-01 路径守卫是唯一入口：read/write/edit 经
args.path 接入，bash 经 T-5-14 的虚拟文件操作（file-write/file-read）接入，
验收的 grep 证伪按字面匹配——注释里写 writeFile 也会命中，写"裸 fs 写"；
2) T-6-04 DPAPI 是第一个跨语言组件（Rust helper 或 PowerShell 二选一在卡
内定并记偏离），摘 codex dpapi.rs 须保留版权头并登记 THIRD_PARTY.md，跨
进程只传可序列化值（T9）；3) D3 网络策略的弱承诺声明（只拦工具层 fetch，
不承诺管住任意子进程）必须写进产出 README，gate 的 broker 放行目前是
once 语义、scope=session 缓存记录的接线在 T-8——阶段 6 不用补。不要问
要不要继续。
```

---

## 阶段 6 报告（完成于 2026-09-25）

- **打勾情况**：6 / 6（T-6-01 ~ T-6-06 全部完成，无未完成项）
- **产出的文件**：
  - `src/sandbox/path-guard.ts` + `path-guard.test.ts` + `docs/sandbox-path-limitations.md`（LIMITATIONS 双载体）——工作区边界唯一入口（T-6-01）
  - `src/test-support/tmp-fs.ts`（夹具落盘助手）+ `src/kernel/tools/builtin/{read,write,edit,bash,index}.ts` 守卫接线——T-6-01
  - `src/sandbox/templates.ts` + `templates/permissions/approval_policy/{on_request,never}.md` + `templates.test.ts`——D2 提示词模板（T-6-02）
  - `src/sandbox/network.ts` + `src/sandbox/README.md`（弱承诺声明置顶）+ `network.test.ts`——D3 网络独立一档（T-6-03）
  - `src/sandbox/dpapi/{dpapi.ps1,index.ts,secure-config.ts}` + `dpapi.test.ts`——D8 DPAPI（T-6-04）
  - `src/kernel/logger.ts` + `logger.test.ts`——D9 日志脱敏（T-6-05）
  - `src/kernel/tools/bash-retry-guard.ts` + `bash-retry-guard.test.ts`——D15 重试幂等边界（T-6-06）
  - `scripts/copy-assets.mjs` 泛化为资产清单（描述 txt/模板 md/DPAPI ps1 三项）
- **验收台账**：6 卡 6 命令全部通过（见台账表）；全量 `npx vitest run` **384 passed / 1 skipped**（阶段 5 收尾 331 → 净增 53），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变，`check-doc-links.sh` 0 失效；三个 grep 证伪全过（builtin/ 裸 fs 写 0 行、config/ CLEAN、logs/ CLEAN）
- **阶段完成定义核对**：越界写被拒且报错明确 ✓（场景④：报错含目标路径与允许范围、不落盘）；配置文件无明文 key ✓（SecureKeyStore 落盘 JSON 的 sk- 证伪）；单独禁网可测 ✓（NetworkPolicy allow/deny 与路径/权限两轴独立）
- **偏离计划的地方**：
  1. **fs 写能力收进 PathGuard**（T-6-01）：工具本体零裸 fs 写 + 工厂类型必收守卫——无旁路由构造保证，同时是 grep 证伪的达成方式；T-4-05 env.ts 头注释预告的"阶段 6 把 fs 收进接口"实际落点改为沙箱守卫（进程执行归 env、文件 I/O 归守卫，能力面不混在一处）
  2. **T-6-04 路线裁定 PowerShell**（卡内二选一）：D8 冷路径 + PS 5.1 系统自带零构建面；**未摘 dpapi.rs 任何代码**（用户域 DPAPI vs codex 机器域），THIRD_PARTY.md 无登记；跨进程协议 = argv 动作名 + stdin/stdout base64（明文不进命令行，T9）
  3. **bash 工具引入 policy/shell-semantics 纯函数 import**（T-6-01）：内核工具 → 策略层唯一一处反向依赖（analyzeShellCommand 无状态、无模块环）
  4. **cd 追踪在 assertShellFileOps 内按 op 序重建**（T-6-01）：字面 cd 后相对目标 fail-closed——最初实现错解析到进程 cwd 造成假放行，被测试抓出后修正
  5. **D3 弱承诺 README 落 `src/sandbox/README.md`**（弱承诺置顶加粗）；**D2 模板内容按我方语义重写**（codex 的 sandbox_permissions/prefix_rule 机制在我方不存在）
- **新发现的约束或坑**：
  - **PowerShell 5.1 读无 BOM 的 .ps1 用系统 ANSI 代码页（本机 GBK）**：UTF-8 中文注释按字节错位可破坏解析（探针文件靠对齐运气通过、正式文件实爆 ParserError）——.ps1 强制纯 ASCII 注释；与"块注释写 glob 序列提前闭合"同级别进 notes
  - **grep 证伪按字面匹配：`writeFileSync` 含 `writeFile` 子串**——测试夹具也算命中，夹具落盘助手移到 `src/test-support/tmp-fs.ts` 后 builtin/ 才 0 命中
  - **.mjs 是纯 JS**：copy-assets 曾误写 TS 类型标注直接 SyntaxError
  - **T-5-14 扫描器对 Windows 风格绝对路径（`C:\x` 不以 `/` 开头）也打 pathMayDependOnCwd** → 策略面会多 ask（保守方向无害）；守卫不依赖该标志（以 path.isAbsolute 判定），T-5-14 产物未动
- **遗留风险与未知**：
  - T-6-01 符号链接逃逸用例本机无创建特权自动跳过（人工确认清单新增行：有特权环境应 22 全过）
  - D3 弱承诺 README 待用户目检（人工确认清单既有行）
  - 守卫只覆盖工具入口：bash 不经重定向的写手段（tee/dd/cp，C29 #6）与命令替换/eval 内重定向守卫不可见——后者走 C28 的 ask 面（用户批准即担责）；第三方子进程自发行为不承诺管住（D3/D16 弱承诺）
  - glob/grep 未接守卫（只读 + P0 读面不限，显式记录）；P0 读边界仅显式配置 readRoots 时存在
  - logger / SecureKeyStore 的运行时接线在 T-8（L1/L3 与装配）；logs/、config/ 目录由装配决定
  - 人工确认清单：J2 真实厂商连通性、D3 弱承诺目检、§6.2 常驻内存、T-6-01 符号链接（新增）
- **下一阶段提示词**：

```
继续 aegent 内核的实施。读 docs/plan-p0.md 的 §0 执行协议，然后从「阶段 7」
的第一张 [ ] 任务卡开始。上一阶段报告在 docs/plan-p0-progress.md。
本阶段特有的注意：1) T-7-01 溢出检测与压缩是两个模块（overflow 的输出是
compaction 的输入，别写成一个函数），本地 token 估算用保守系数 0.9，误
差方向记注释；2) T-7-05 系统提示装配直接消费阶段 6 的
renderPermissionsPrompt(tier, {writableRoots}) + PathGuard.describeWritable
Roots()（模板 md 已在 copy-assets 清单），权限档位来源由装配决定；3) F9/F17
压缩发生在 turn 边界（T-3-01 的 turnEnd 点位已预留），F21 按 Q13 只做
PreTurn/MidTurn 两相位，切点工具配平复用 expectPaired(tool/call)。不要问
要不要继续。
```

---

## 阶段 7 报告（完成于 2026-09-25）

- **打勾情况**：9 / 9（T-7-01 ~ T-7-09 全部完成，无未完成项）
- **产出的文件**（新目录 `src/context/`）：
  - `src/context/overflow.ts` + `overflow.test.ts`——溢出检测（本地估算保守系数 0.9 + provider 超限错误识别）（T-7-01）
  - `src/context/compaction.ts` + `compaction.test.ts`——CompactionRequest 消费接口 + 压缩生命周期引擎（pre hook 可中止→摘要→compaction 事件→post hook）+ Q13 两相位 + 切点选择（T-7-01/02/05）
  - `src/context/new-window.ts` + `new-window.test.ts`——压缩后新窗口重建（F22 现算 + F23 developer 预算）（T-7-03）
  - `src/context/pressure.ts` + `pressure.test.ts`——调用后压力测量（三信号）+ OverflowRecoveryError + turnEnd 链压缩层次序断言（T-7-04）
  - `src/context/tool-pairing.ts` + `tool-pairing.test.ts`——增量配平状态机（T-7-05）
  - `src/context/downshift.ts` + `downshift.test.ts`——ModelDownshift 换模先压缩（T-7-06）
  - `src/context/rapid-refill.ts` + `rapid-refill.test.ts`——压缩抖动断路器（T-7-07）
  - `src/context/budget.ts` + `budget.test.ts`——预算送达记账 + 加权计算（T-7-08）
  - `src/context/system-prompt.ts` + `system-prompt.test.ts` + `prompt/base.md`——系统提示装配 + AGENTS.md 加载（T-7-09）
  - `src/session/messages.ts`——buildChatMessages + effectiveEvents 公共 helper（压缩/新窗口消费）
  - `scripts/copy-assets.mjs`（基础提示清单 +1）、`src/kernel/events.ts`（CompactionEvent 加可选 reason）、`src/test-support/event-asserts.ts`（O7 对齐词汇表）、`docs/requirements.md`（F2 锚点回填）
- **验收台账**：9 卡 9 命令全部通过（见台账表）；全量 `npx vitest run` **458 passed / 1 skipped**（阶段 6 收尾 384 → 净增 74），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 716 链接 0 失效；`npm run build` 实测基础提示 1 项进 dist
- **阶段完成定义核对**：超长上下文先触发 overflow 判定而非直接压 ✓（overflow.test 次序断言：识别分支先于压缩入口、错误不抛用户）；压缩后 token 显著下降且 developer 消息保留 ✓（new-window.test：消息集逐条断言 + downshift.test 旁证压缩后新窗口收缩）；抖动保护可触发 ✓（rapid-refill.test：第 3 次零进展压缩熔断，错误带全计数）
- **偏离计划的地方**：
  1. **词汇表 CompactionEvent 加可选 `reason?: string` 字段**（T-7-06）：验收要求 compaction 事件带 reason（F24），而 T-1 定稿载荷无此位——最小兼容扩展（旧流缺省读作 context_limit；C14 JSON 安全），值域取 codex CompactionReason 序列化词表；先例与理由写在卡面与词汇表注释。**若用户不认可，回退面 = events.ts 一处字段 + compaction.ts 映射函数（约 20 行）**
  2. **O7 断言器连带修**（T-7-02）：expectTurnScoped 原把所有非 revert 事件当轮作用域，压缩是第一个合法落盘在轮外的消费方（PreTurn 压缩在 turn/end 之后）——对齐投影器既有语义：compaction/checkpoint/request/header 只带 turn 归属不要求轮开启
  3. **压缩切点是"组合"而非"替换"**（T-7-05）：user/system 消息边界策略（T-7-02）仍是候选来源，配平状态机做验证/回退——候选不配平（悬挂 call 崩溃残留）时退到最近配平点，保守方向
  4. **F2 锚点回填**（T-7-09）：opencode 加载器已在源码定位（session/instruction.ts），语义是"findUp 就近取一个不叠加"，与我方自研裁决"收集全部 + 小节就近覆盖"不同——requirements.md 已回填并注明差异，自研语义维持
  5. 消息重建抽公共 helper `src/session/messages.ts`（三处消费：压缩覆盖区间/新窗口重建/将来 loop 接线）；loop.buildMessages 内嵌版换用 helper 留 T-8 接线时顺路
- **新发现的约束或坑**：
  - **压缩的时点语义**：retainedFromEnd=1 保留"最后一个 user 起"——真实 PreTurn 时点下下一轮 prompt 已入流（zcode PreRequest 同款判定），摘要覆盖旧轮；压缩发生在 turn 刚收尾、下一轮未开始时（PostTurn 形态），保留尾就是刚完成的轮，摘要区间为空（压缩无效但无损）——T-8 装配时应把 PreTurn 压缩挂在"新 prompt 入流后、首次模型请求前"的点位
  - **expectTurnScoped 与投影器的轮作用域口径**是两套维护面：投影器按事件类型分支，断言器按同一口径——新增"合法轮外落盘"事件类型时两处要同步（本次 compaction 落了 checkpoint/request/header 的既有豁免面）
  - **测试构造事件流时 system/message 必须落在开启的 step 内**（投影 requireOpenTurn+Step），turn/end 不可重复落——假流夹具最常踩的两处
  - vitest 下 `import.meta.url` 指向 src——模板/提示文件用真文件路径测试可行（dist 由 copy-assets 保障），无需 mock fs
- **遗留风险与未知**：
  - **压缩/预算/抖动的 loop 接线在 T-8 装配**：本阶段全部为模块级交付（overflow→compaction→new-window 的类型接缝、pressure/recoverFromOverflow 原语、rapidRefillGuard 引擎入口）——loop 的 turnEnd 链挂压缩层、step 收尾调 recordCompletedToolStep、提示词进 request/header，都在装配处完成，T-8 验收场景①前必须就位
  - 摘要质量属 F5（P1）：当前 summarizer 由装配注入假实现，真实摘要提示词未实现
  - 词汇表 reason 字段扩展待用户默认追认（偏离 1；不追认回退面小）
  - 递归摘要（第二次压缩的摘要不含第一次摘要文本）是已知简化，F5/P1 处理
  - 人工确认清单不变（J2 真实厂商连通性、D3 弱承诺目检、§6.2 常驻内存、T-6-01 符号链接）
- **下一阶段提示词**：

```
继续 aegent 内核的实施。读 docs/plan-p0.md 的 §0 执行协议，然后从「阶段 8」
的第一张 [ ] 任务卡开始。上一阶段报告在 docs/plan-p0-progress.md。
本阶段特有的注意：1) 阶段 7 的压缩/预算/抖动全部是模块级交付，T-8 装配时
把 turnEnd 链挂压缩层（T-7-04 的次序断言已钉 compaction 先于 turn/end）、
PreTurn 压缩挂"新 prompt 入流后首次模型请求前"（zcode PreRequest 同款）、
step 收尾调 RapidRefillGuard.recordCompletedToolStep——接线改 loop 时顺路
把 buildMessages 换成 src/session/messages.ts 的公共 helper；2) T-8-02 代码
状态检查点消费 E4 的 revert 标记与 checkpoint 事件（词汇表已留位），杀进程
重启路径走 store.restore（seq 断层即抛）；3) T-8-05 全量验收跑需求 §8 十条
前先核对人工确认清单（J2/D3/§6.2/符号链接四项），无法机验的写明人工确认
方式。不要问要不要继续。
```

---

## P0 终验收记录（T-8-05，2026-09-25）

> §8 十条逐项执行，全部通过。人工确认清单（J2/D3/§6.2/符号链接四项）在执行前核对，
> 无法机验的方式已写明（见上方清单更新）。

| # | 验收条目 | 命令 | 结果摘要 |
| --- | --- | --- | --- |
| 1 | 场景①端到端 + 事件落 SQL + revert 任意点 | `npx vitest run src/session/git-checkpoint.test.ts src/session/revert.test.ts`；smoke `printf '写点东西\n' \| node dist/src/cli/index.js --smoke --db <tmp> --workspace <git 仓>` | **11 passed**（CLI 级联测：审批放行 write 改文件 → /revert 到改前事件点 → baseline.txt 回"改前" + reverted 回执；revert/unrevert 5 用例）；smoke 实测 SQLite 9 事件 seq 连续、checkpoint 事件（ref=null）落库 |
| 2 | 危险命令默认询问 + 规则可覆盖 | `npx vitest run src/policy/dangerous-commands.test.ts src/policy/gate.test.ts src/policy/evaluate.test.ts src/policy/chain.test.ts` | **45 passed**（rm -rf/sudo/777 升 ask、场景⑦注入不改求值时机、无规则 abstain→ask、用户层 allow 规则压过核心层=可覆盖、层序权威） |
| 3 | 越界写拒绝（场景④） | `npx vitest run src/sandbox/path-guard.test.ts` | **21 passed / 1 skipped**（符号链接逃逸用例需特权，跳过→人工确认清单；越界报错含目标路径不落盘、bash 重定向越界拒、cd 相对 fail-closed） |
| 4 | 假 provider loop 两路径 | `npx vitest run src/kernel/loop.test.ts` | **8 passed**（continue 直到空手由 DecideTurn 显式 end / 首轮即 end；A1 反向钉死） |
| 5 | API Key DPAPI 加密、配置无明文 | `npx vitest run src/sandbox/dpapi.test.ts`；`grep -r "sk-" config/ \|\| echo CLEAN` | **4 passed**（真实 PowerShell 5.1 子进程 protect→unprotect 往返、损坏 blob 拒）+ **CLEAN** |
| 6 | 1 万事件投影 <200ms | `npx vitest run src/session/project.test.ts` | **8 passed**；实测 project(10k) = **10.1ms**（阈值 200ms 余量 20 倍） |
| 7a | §6.2 冷启动 <500ms | `node scripts/cold-start.mjs`；SQLite 模式辅测脚本 | echo 模式 **median 283.3ms**（best 280.8，3 轮）；**SQLite 模式 median 273ms**（--db 动态加载原生模块仍达标）——两形态均 <500ms |
| 7b | §6.2 常驻内存 <150MB | node WorkingSet64 辅测 + 任务管理器目测（人工） | agent-child 空闲 **RSS 47.1MB**（辅测）；任务管理器目测为需求原文方式，留人工确认 |
| 7c | §6.2 Token 消耗省 ≥30% | `node scratch/_tmp_accept/token-compare.mjs`（40 轮长会话 compaction 前后对比） | 压缩前 4951 tokens → 压缩后（新窗口重建）281 tokens，**节省 94.3%** ≥30% |
| 7d | §6.2 会话加载 <200ms | 同第 6 条 | **10.1ms** <200ms |
| 8 | license-audit 17/17 | `bash tools/license-audit.sh` | exit 0，**17 个仓**（oss 16 + refs 1）逐仓通过、泄露关键词命中 0、无 "!!" 报警 |
| 9 | check-doc-links 0 失效 | `bash tools/check-doc-links.sh` | **548 链接 0 失效** |
| 10 | count-features 与 §5 一致 | `bash tools/count-features.sh` | 层数 19，**P0=104 / P1=158 / P2=48 / 总计=310**，与 §5 表逐层一致 |

---

## 阶段 8 报告（完成于 2026-09-25）

- **打勾情况**：5 / 5（T-8-01 ~ T-8-05 全部完成，无未完成项）——**P0 全部 62 卡完成**
- **产出的文件**：
  - `src/cli/{index,repl}.ts` + `cli.test.ts`——CLI 薄壳（REPL/管道 + 事件流摘要 + /revert /cancel /approve）与 bin 入口（T-8-01）
  - `src/kernel/assembly.ts`——生产装配（权限 gate / 上下文装配层 / turnEnd 压缩层 / PreTurn 挂点 / 抖动记账 / M10 预算 / 系统提示 / PathGuard）（T-8-01）
  - `src/kernel/loop.ts` 接线（buildMessages 换 messages.ts helper、beforeFirstModelRequest / onToolStepCompleted 挂点、closeTurn 首接 runFlushPoint）、`agent-protocol.ts` 协议扩展（revert/approve/审批宣告/reverted/idle）、`agent-process.ts`（装配接入 + kick 前打点 + revert 双回退）、`agent-child.ts`（CLI 参数与环境变量装配 + openai 厂商装配）（T-8-01/02）
  - `src/session/git-checkpoint.ts` + 测试——E11 代码检查点（T-8-02）
  - `src/obs/usage.ts` + 测试——L3 token 统计 SQL 视图（T-8-03）
  - `src/session/boot-maintenance.ts` + 测试——Q5 启动期对账（T-8-04）
  - `scripts/copy-assets.mjs`（+schema.sql）、`package.json`（bin）
- **验收台账**：5 卡 5 命令全部通过（见台账表）；全量 `npx vitest run` **477 passed / 1 skipped**（阶段 7 收尾 458 → 净增 19），`npx tsc --noEmit` 全程干净；§8 十条终验收全过（见「P0 终验收记录」）；`count-features.sh` = 310 不变、`check-doc-links.sh` = 548 链接 0 失效、license-audit 17/17
- **阶段完成定义核对**：场景①全流程闭环 ✓（CLI → 过策略 → 改文件 → revert 对话与代码双回退，事件落 SQL）；杀进程重启无"快照说做了/事件说没做" ✓（store.restore seq 校验 + 对账闭合 + 新轮不续跑）
- **偏离计划的地方**：
  1. **阶段 5/7 模块在本阶段接线进装配**（用户开工提示兑现）：PreTurn 压缩走 loop 新 hook `beforeFirstModelRequest`（T-3-01 排除"压缩不挂 modelRequest"——hook 是 loop 在 try 内的显式时点，不是新链点位）；buildMessages 换公共 helper；runFlushPoint 首接（E13 检查点）
  2. **协议扩展**：revert/approve 请求 + approval_requested/settled/reverted/idle 消息；CLI 的 EOF 语义 = 等子进程 idle 再 dispose（修"EOF 即取消在途轮"）
  3. **E11 打点时点是 turn 开始前而非卡面"turn 末"**（卡面与场景①验收矛盾——turn 末 stash 捕获"改后"回不到"改前"；pi turn_start "before LLM makes changes" 同款）；空 stash 落 ref:null（偏离 pi 的跳过，保留"改前恰好干净"的恢复能力）
  4. **对账从 UPDATE 改为追加事件**（事件源 append-only，无可 UPDATE 的 status 列；turn/end{interrupted} 用词汇表预留的崩溃孤儿闭合变体）
  5. **scope=session 批准缓存未接线**（ApprovalScopeCache 留 P1）：CLI /approve 是一次性放行（once），会话级缓存需要规则审批面提供 scope 输入
  6. 验收命令产物路径实际为 `dist/src/cli/index.js`（卡面 dist/cli/index.js，T-3-06 同款路径偏差）；冷启动实测上浮至 283.3/273ms（装配扩容），仍达标无需待澄清
- **新发现的约束或坑**：
  - **脚本化会话的 EOF 语义**：管道 EOF 即 dispose 会取消在途轮——新增 idle 协议消息，CLI 等 idle 再 dispose（/exit 保持立即退出）；idle 状态必须由"发 prompt 时作废 + 子进程空闲宣告"双向维护，否则初始 idle 会污染等待
  - **视图查的是 storage**：store.append 后必须 flush 才能被 SQL 视图查到（write-behind 纪律在消费面实爆）；better-sqlite3 连接不 close → Windows EBUSY（T-1-03 坑两度复发，afterEach 加容错）
  - **测试 provider 每轮产同名 callId 会让审批走 DuplicateApprovalError 无限循环**（decideTurn continue + isError 回喂）——脚本 provider 必须两轮剧本
  - execFile 回调的 error 参数成功时是 **null** 不是 undefined（`error !== undefined` 判定会在成功路径取 null.code 抛 TypeError）
  - snapshot.sh 在后台跑会被中断截断 SOURCES.lock（大目录 du 慢）——必须同步跑并 `git diff oss/SOURCES.lock` 复核
- **遗留风险与未知**：
  - J2 真实厂商连通性（人工确认清单；openai 装配已就位，等用户提供 key）
  - D3 弱承诺目检、§6.2 常驻内存任务管理器复核、T-6-01 符号链接逃逸（有特权环境）——四项人工确认方式已写明
  - 摘要质量（F5）、递归摘要、Q3 spill 清理策略、rg 提速、canonical path 归一、ContractResult 泛型化等 P1 项不变
  - cold-start 基线 283ms 与 109ms 的差异源于装配扩容（参数解析 + 策略链 + 检查点），未优化——P0 阈值内，P1 若有需要可再压
- **下一阶段提示词**：

```
P0 已全部完成（62/62 卡，§8 十条验收全过）。下一步是 P1：读 docs/plan-p0.md
的 §0 执行协议与 §1 尾注（P1 不切阶段、轮到时展开成任务卡），从
docs/requirements.md §4 索引的 P1 项里与用户一起圈定第一批范围并展开成
任务卡（P1 共 158 条，建议按依赖成组：G 层 Planning、I 层 hooks/skills、
J6 换模、C22/C46 出口级聚合、Q3 spill 清理等），再按 §0 协议执行。
上一阶段报告在 docs/plan-p0-progress.md。本阶段特有的注意：1) P0 的
人工确认清单（J2/D3/§6.2/符号链接）若有用户复核结论先回填；2) P1 展开卡
时沿用 P0 卡格式（依据需求/参考锚点/取什么别抄什么/验收），锚点先核对
oss/SOURCES.lock 的 commit；3) 阶段 8 的装配层（src/kernel/assembly.ts）
是 P1 功能接线的主要落点，别绕过它开旁路。不要问要不要继续。
```

---

## 批次 1 · 第一组报告（C22/C46 权限聚合，完成于 2026-09-25）

> P1 启动会话：批次 1 圈定为四组 26 条（用户全选：C22/C46 聚合、G 层 Planning、J6 换模、I 层扩展面），展卡 13 张于 `docs/plan-p1.md`（锚点 18 处逐一核对、snapshot 无漂移、commit `55697d6`）。本组为第一批次的第一组。

- **打勾情况**：3 / 3（T-P1-01 ~ T-P1-03 全部完成，无未完成项）——**C22/C46 权限聚合组收官**
- **产出的文件**：
  - `src/policy/protected-names.ts`（C46 清单唯一权威，拆分防循环依赖）+ `protected-paths.ts` 扩 bash 虚拟写出口分支（T-P1-01）
  - `src/policy/exit-guard.test.ts`——出口级硬拦 10 用例（T-P1-01）
  - `src/policy/rule-scope.ts`（C22 turn-override 载荷）+ 测试；`revalidate.ts` 出口同位（T-P1-01/02）
  - ApprovalReply 扩 scope/feedback（C24）+ 协议 approve 扩字段 + assembly/agent-process/repl 全链传参 + feedback 落 L2 审计（T-P1-02）
  - **createSessionApprovalModule 装配进 policyChain**（T-8-01 偏离⑤关闭）+ repl `/approve --session/--feedback`（T-P1-02）
  - `intersect.ts` 加 `intersectAllProfiles`/`enforceCeiling` + gate/revalidator `ceiling` 选项 + assembly `permissionProfiles`/`knownToolNames` 接线 + linter 常开落 `policy-lint` 日志（T-P1-03）+ `ceiling-exit.test.ts` 9 用例
- **验收台账**：3 卡 3 命令全过（见台账表）；全量 `npx vitest run` **503 passed / 1 skipped**（P0 收官 477 → 净增 26），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变
- **偏离计划的地方**：
  1. **C46 出口落法**：gate 零改动（层内自调 enforceProtectedPaths 自动获得 bash 分支）；revalidate 出口补硬拦与上限——执行点不依赖装配方记得包 withProtectedPaths
  2. **write/edit 无 patternOf**（builtinRuleMatchers 只登记 bash）：其批准结构上只能 once——C48 纪律的自然结果非缺陷；session 缓存对 bash 生效
  3. **C49 ceiling 选出口级**而非链上模块：链是首匹配胜（C58），ceiling 进链会被用户层 allow 压过，违背"上限不因链序放宽"
  4. turn-override 能力面先行（显式 endTurn 剪除失效），产生面（审批 scope=turn UX）随后续批次
- **新发现的约束或坑**：
  - protected-paths ↔ shell-semantics 潜在循环 import（出口反向消费扫描器）——拆 `protected-names.ts` 解决；同模式（清单/出口/扫描器三职责）可供后续硬拦类功能参考
  - Verdict 的 reason 必填（abstain 也带）——构造测试裁决时不能写 `{action:"abstain"}` 裸形状
  - PermissionBrokerPort 有必填 `name` 字段，stub broker 必须带
- **遗留风险与未知**：
  - C46 bash 硬拦复用 B 档扫描器，B 档 LIMITATIONS（tee/dd/cp 参数式写不识别等）原样继承——rm -rf 类由链上危险模式 ask 兜底，出口级不拦
  - linter 警告目前只落日志；进事件流（可观测面）等词汇表扩展时一并考虑
  - ApprovalScopeCache 每子进程装配一个（会话绑定）；跨进程恢复的缓存重建随恢复路径后续批次
- **下一组**：T-P1-04 ~ 06（J6 换模组 3 卡），再后 T-P1-07 ~ 09（I 层扩展面）、T-P1-10 ~ 13（G 层 Planning）
- **下一阶段提示词**：

```
继续 aegent P1 批次 1 的实施。读 docs/plan-p1.md 的卡序（执行协议沿用
docs/plan-p0.md §0），从「T-P1-04」的第一张 [ ] 任务卡开始。上一组报告在
docs/plan-p0-progress.md（批次 1 · 第一组报告）。本组特有的注意：1) T-P1-04
起是 J6 换模组——换模状态/捕获/事务都落 src/kernel/model-switch.ts，装配
走 assembly.ts（sessionId 绑定的模型注册表 + gate 同款出口纪律），协议新
命令经 agent-protocol.ts 闭集（漏分支 assertNever 编译失败是特性）；
2) T-P1-06 新增 model/switch 事件走词汇表扩展流程（14→15，l0-events.md §8
落地记录 + 待澄清表立案供追认，session/revert 先例）；3) 卡面验收若与实际
模块名不符（如 scope-cache.test.ts），按产出实际拆分文件并在完成记录注明
（T-P1-02 先例）。不要问要不要继续。
```

---

## 批次 1 · 第二组报告（J6 换模，完成于 2026-09-25）

> **追记（2026-09-25）**：用户裁决「1.可以」→ 词汇表 14→15（`model/switch`）已追认，待澄清表 #2 关闭，l0-events.md §8 落地记录 3 与 §3.2 正式计数同步转正。
>
> **追记 2（2026-09-26，快照超时原因调查，用户质询"全量快照怎么会超时"）**：实测定位——瓶颈是快照脚本第 29 行的 `du -sh "$d"` 逐仓全树 stat 扫描（git 命令毫秒级、license-detect 只读单文件，均排除）。**冷缓存下每仓 du 30s~142s**（hermes-agent 1.5 万文件实测 142s；real 142s vs sys 4s——CPU 几乎为零，时间全花在文件系统元数据往返与 Defender 实时扫描首检），17 仓全冷总耗时实测 **4 分 36 秒**；**同一仓二次 du 仅 2.2s**（快 65 倍，OS 缓存/Defender 缓存已热）。截断机制：脚本 `{...} > "$OUT"` 流式重写 lock，中途被打断即留半截文件。P0 期未爆是因为展卡与执行同日、缓存已热；隔日冷启动（26 号）必超任何 120~180s 工具超时。**处置**：本次重跑已完成、lock 无漂移（唯一 diff 为生成日期）；后续重跑快照给足 600s 超时一次跑完，或先 `du -sh oss/* >/dev/null` 预热再跑脚本；脚本内 du 并行化可压时长但 Defender 串行化下收益有限，暂不改脚本。

- **打勾情况**：3 / 3（T-P1-04 ~ T-P1-06 全部完成，无未完成项）——**J6 换模组收官**
- **产出的文件**：
  - `src/kernel/model-switch.ts`——ModelSwitchService：configured/captured 分离（J6/J7，pi·agent-harness 同款）+ 五态状态机（initial/deferred/pending/preference/incompatible，grok·agent.rs ModelState 同名语义映射）+ 纯函数迁移守卫 `nextSwitchPhase`（表格外抛 ModelSwitchStateError）+ 事务化 switch（deferred 暂存不改 configured、事务修订 prev 保持最初）+ `reportRequestFailure` 回滚（MODEL_INCOMPATIBLE_CODES 判据）+ emit 落流注入（T-P1-04/05/06 三卡递进）
  - `src/kernel/loop.ts`——`modelForTurn?`（turn 启动捕获、全程不变，request/header 记捕获身份=事件证据）+ `onTurnError?`（failTurn 内 LlmFailure 透传，J11 失败观测点）
  - `src/kernel/agent-protocol.ts`——协议新命令 `model/switch`（REQUEST_TYPES 闭集 + identity 非空校验 + JsonValue 型证自动覆盖）
  - `src/session/owner-port.ts`——命令闭集加同名变体（handler 可选，stop_generation 先例）
  - `src/kernel/assembly.ts`——`models`/`initialIdentity`/`globalDefaultIdentity` 装配选项 + handleModelSwitch/modelForTurn/onTurnError 暴露 + `resolveInitialIdentity`（J14 回放保护：流内 model/switch 权威 > initialIdentity > 注册表首项；与全局默认不一致 warn 保留会话级选择；不在注册表 → 装配失败 fail-closed）+ emit 落 store.append
  - `src/kernel/events.ts`——词汇表 14→15：`model/switch {from, to, reason: "user"|"rollback"}`（⏳ 待追认，执行会话新发现 #2）
  - `src/session/project.ts`——投影 validation 豁免 + modelSwitches 记录（revert 切点切割）；`src/test-support/event-asserts.ts`——O7 会话级元事件豁免面 +model/switch
  - `docs/l0-events.md`——§3.2 表格补全至 15 行（session/revert 行为落地记录 2 漏项，顺手修正）+ §8 落地记录 3（含不追认回退面）
  - 测试：`src/kernel/model-switch.test.ts` 24 用例（服务/迁移守卫/事务/落流/分离/重启/协议全链）+ agent-protocol.test +1 + owner-port.test +2 + events.test 计数 15
- **验收台账**：3 卡 3 命令全过（见台账表）；全量 `npx vitest run` **530 passed / 1 skipped**（第一组收官 503 → 净增 27），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 548 链接 0 失效
- **偏离计划的地方**：
  1. **协议/事件载荷的 identity 用内联 `{provider, modelId}` 形状**而非引用 ModelIdentity interface——`AgentRequest` 的 JsonValue 型证（AssertNever）要求隐式索引签名、interface 不满足；events.ts 加内联载荷同时保持 L0 零反向依赖（不 import models 层）
  2. **"回滚本身落事件"与词汇表扩展合并做**（T-P1-05 偏离③ → T-P1-06 兑现）：T-P1-05 先以 lastRollback/phase/warn 日志可观测，T-P1-06 的 model/switch 事件 reason="rollback" 落流——词汇表一次扩展到位，不落中间形态
  3. **deferred 应用不重复落事件**：受理即落 `user` 事件（用户选择事实持久化），应用时最新 to 已权威——reason 值域收敛为 "user"|"rollback" 两值（卡面只定形状，值域为执行决定）
  4. **换模状态演进三步走**：T-P1-04 进程内存 → T-P1-05 事务化 → T-P1-06 落流——captured 保持单一槽位（在途 turn 语义），换模历史唯一事实源是流内事件（不变量 1 同构）
  5. **request/header 改记捕获后身份**（payload.identity）——在途换模"生效点在新 turn"的事件证据就在 header 的身份变化里
- **新发现的约束或坑**：
  - **JsonValue 型证闸门对 interface 不友好**：TS 的隐式索引签名只给 type alias/匿名对象类型，interface 不给——wire/事件载荷引用 interface 类型会炸 `AssertNever<Exclude<_, JsonValue>>`。新事件/wire 载荷一律内联形状（本组三处同坑）
  - **snapshot.sh 同步跑也会超时截断 SOURCES.lock**（本组开工实测 >3 分钟被工具超时打断，lock 尾部 13 行被删）——`git checkout -- oss/SOURCES.lock` 恢复；大目录 du 慢是根因。后续开工建议：不再全量重跑快照，改 `git status oss/` 确认 lock 干净 + 依赖展卡时的当日核对结论（或给脚本加超时保护——未改脚本，不顺手改无关代码）
  - 装配级测试的 createChildAssembly 需要完整选项面（workspaceRoot 临时目录 + contextWindow + approvalTimeoutMs）——mkdir 临时目录归 tmpRoots 数组统一 afterEach 清理
  - 状态机纯函数 `nextSwitchPhase(from, event, hasCapturedTurn)` 导出后穷举测试直接钉合法表——迁移守卫类功能的可测性模式（供 T-P1-09 trust 维度等参考）
- **遗留风险与未知**：
  - **词汇表 14→15 待用户追认**（待澄清表 #2 已立案；不追认回退面 = l0-events.md §8 落地记录 3 所列约 1-2 小时）
  - REPL `/model` 命令未做：协议/owner-port/装配三层已通，CLI UX 面随后续批次（agent-child.ts 也未接 models 注册表——CLI 单模型，换模能力在装配面就绪）
  - 换模回滚的用户可见面只有 warn 日志 + 流内 rollback 事件；CLI 展示面未做
  - incompatible 判据单成员起步（MODEL_INCOMPATIBLE），能力矩阵/上下文超窗按卡面风险留后续
  - 快照重验：本组未全量重跑 snapshot.sh（超时截断恢复，见坑 2）——下一组开工若距展卡日较远建议重验锚点
- **下一组**：T-P1-07 ~ 09（I 层扩展面 3 卡：hooks/skills/双轨），再后 T-P1-10 ~ 13（G 层 Planning）
- **下一组提示词**：

```
继续 aegent P1 批次 1 的实施。读 docs/plan-p1.md 的卡序（执行协议沿用
docs/plan-p0.md §0），从「T-P1-07」的第一张 [ ] 任务卡开始。上一组报告在
docs/plan-p0-progress.md（批次 1 · 第二组报告）。本组特有的注意：1) T-P1-07
hook 崩溃语义与策略层相反——可信轨上抛（T-5-01 fail-open 禁止）、不可信轨
隔离为 isError，trust 维度注册时声明，分轨断言留给 T-P1-09；2) T-P1-08
skills 目录约定 .zcode/skills/ 是自研命名无上游约束，frontmatter 解析复用
T-7-09 收集器经验，"改 SKILL.md 零 .ts diff"机验同 T-4-01 描述文件基建，
copy-assets 清单要跟上；3) 词汇表现 15（model/switch 待追认，落地记录 3
含回退面），T-P1-10 todo 扩 15→16 时流程同款（assertNever + §8 记录 +
待澄清立案）。不要问要不要继续。
```

---

## 批次 1 · 第三组报告（I 层扩展面，完成于 2026-09-26）

- **打勾情况**：3 / 3（T-P1-07 ~ T-P1-09 全部完成，无未完成项）——**I 层扩展面组收官**（批次 1 已完成 9 / 13 卡，剩 G 层 T-P1-10 ~ 13）
- **产出的文件**：
  - `src/kernel/chain.ts`——I13 填实（`ChainTraceEntry` 加 name + `namedLayer` 附加层名、未命名记 `layer#<index>`；`budgetMs` 墙钟衰减 + `now` 时钟注入，不配恒空槽零行为变化）+ L10（`terminal?` 可选化，链底无人应答抛错点名点位事件）
  - `src/kernel/hooks.ts`——HookRegistry（on 返回注销函数 / has / layer / untrustedLayer / dispose；T-P1-07 聚合层起步、T-P1-09 分轨定型：layer 只含 trusted，untrustedLayer 独立观察轨——next 哨兵 = 能力越界抛错、崩溃轨内隔离 + reportError 可检索）
  - `src/kernel/skills.ts`——`.zcode/skills/**/SKILL.md` 递归发现（名字取目录名、frontmatter name 可覆盖）+ 行解析 frontmatter（无 yaml 依赖）+ 四类诊断码与清单并返不抛异常 + skillBody/formatSkillInvocation
  - `src/kernel/tools/builtin/skill.ts` + `descriptions/skill_load.txt`——skill_load 工具（重扫描不缓存、读经 PathGuard、SKILL_NOT_FOUND 类型化错误）；BUILTIN_TOOL_NAMES 6→7
  - `src/kernel/plugin-manifest.ts`——validateManifest（形状闭集 + trust 闭集 + 未实现能力列明缺哪项 + hooks point 闭集/重复拒绝，错误全量收集）+ installPlugin（声明未实现 handler 拒绝且回滚无半态、`<插件>:<hook>` 前缀注册、uninstall）
  - `src/context/system-prompt.ts`——`skills?` 尾段渲染（"## 可用技能"，空清单不加段零行为变化）
  - `src/kernel/assembly.ts`——`hooks?: HookRegistry` 装配选项（聚合层挂三点位 gate 外层）+ contextLayer 技能扫描（诊断落 skill-lint warn）+ 清单进系统提示
  - `src/kernel/agent-process.ts`——workspaceRoot 作 skillsRoot 传 registerBuiltinTools
  - 测试：hooks.test 14 用例、skills.test 8、plugin-manifest.test 8、chain.test 9→14；builtin.test 工具清单断言 6→7
- **验收台账**：3 卡 3 命令全过（见台账表）；全量 `npx vitest run` **565 passed / 1 skipped**（J6 组收官 530 → 净增 35），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 548 链接 0 失效；`npm run build` 实测 copy-assets 工具描述 7→8 项自动跟上（脚本零改动）
- **偏离计划的地方**：
  1. **I13 层名载体**：`namedLayer` 函数属性（defineProperty）而非 layers 改对象形状——后者波及约 20 处既有测试构造，违背精准修改
  2. **T-P1-07 的 untrusted "隔离为 isError" 过渡语义在 T-P1-09 分轨后取消**：untrusted 不再进内核链（无 isError 化场景），观察轨崩溃统一吞错 + 报告；hooks.test 对应用例随分轨改写，T-P1-07 卡面验收④的完成记录已注明演进
  3. **untrusted 轨触发面 P1 是进程内 registry 方法**：真进程隔离/协议随 K3/K4（卡面风险栏既定）；能力白名单行为面 = 只观察（next 哨兵），capabilities 清单校验先行、运行时能力面随 K 层接入
  4. **技能清单定格与正文即时的不对称**：清单定格在 system/message 首落时点（改 SKILL.md 对新会话生效——清单是事件流历史事实），skill_load 正文每次直读当前会话即时生效（F22 事件重建的自然结果）
- **新发现的约束或坑**：
  - **函数泛型收窄**：`typeof x === "string"` 存进布尔变量后再用不收窄 unknown（TS 局限）——守卫要内联或先提局部常量再判断（plugin-manifest.ts hooks 段踩过）
  - 装配级手动跑链时 system/message 落流要求已开启的 turn+step（词汇表校验）——测试需先 append turn/start + step/start
  - registry 快照语义（layer()/untrustedLayer() 取注册快照）让"装配时序定轨内容"可测，但意味着快照后注册要重新取层——分轨断言测试依赖这一点
- **遗留风险与未知**：
  - untrusted 观察轨目前无生产触发方（宿主/进程外协议消费随 K3/K4）——registry 面就绪、装配未接线
  - skill 工具每次 dispatch 全量重扫技能目录——技能面大时的性能未测（技能数量小，暂不优化）
  - chain budget 只有可见性（remaining 衰减可断言），超预算执行面（截断/超时）无验收点，留后续
  - REPL `/model` 命令仍欠（J6 组遗留，随 CLI 批次）
- **下一组**：T-P1-10 ~ 13（G 层 Planning 4 卡：todo/plan 模式/goal/计划落盘），其中 T-P1-10、T-P1-12 各需一次词汇表扩展（15→16、16→17）
- **下一组提示词**：

```
继续 aegent P1 批次 1 的实施。读 docs/plan-p1.md 的卡序（执行协议沿用
docs/plan-p0.md §0），从「T-P1-10」的第一张 [ ] 任务卡开始。上一组报告在
docs/plan-p0-progress.md（批次 1 · 第三组报告）。本组特有的注意：1) T-P1-10
todo 扩词汇表 15→16、T-P1-12 goal 扩 16→17，流程同 model/switch 先例
（events.ts 闭集 + project 豁免 + event-asserts O7 豁免面 + l0-events.md §8
落地记录含回退面 + 待澄清表立案供追认；事件载荷一律内联形状——JsonValue
型证对 interface 不友好）；2) T-P1-10 todo 工具过 T-P1-01 出口级硬拦的
plan 模式对照用例为 T-P1-11 铺垫，T-P1-11 硬关复用 exit-guard（protected-
names 唯一权威同款结构），提示词独立文件进 copy-assets 的 descriptions
清单；3) T-P1-13 依赖 T-P1-11 plan 模式与 E11 checkpoint（装配
checkpointRepoRoot 先例），"重启不重放"按 Q5 对账口径。不要问要不要继续。
```

---

## 批次 1 · 第四组报告（G 层 Planning，完成于 2026-09-26）

- **打勾情况**：4 / 4（T-P1-10 ~ T-P1-13 全部完成，无未完成项）——**G 层 Planning 组收官，P1 批次 1 全部 13 卡完成**（C22/C46 聚合 3 卡 + J6 换模 3 卡 + I 层扩展面 3 卡 + G 层 Planning 4 卡）
- **产出的文件**：
  - `src/kernel/events.ts`——词汇表 15→17 两连扩：`todo/update {items}`（T-P1-10）与 `goal/set {text, deadline?, status}`（T-P1-12），均会话级元事件 + E12 整值；⏳ 两案待用户追认（待澄清 #3/#4，落地记录 4/5 含回退面）
  - `src/kernel/tools/builtin/todo.ts` + `descriptions/todo_write.txt`——todo_write 工具（整值提交、fail-closed 校验 50 项/500 字符上限、emit 落流）；BUILTIN_TOOL_NAMES 7→8（T-P1-10）
  - `src/policy/meta-ops.ts`——内核元操作白名单（todo_write 核心层显式放行；不变量 3 的"显式例外"落链上模块，冻结只追加）（T-P1-10）
  - `src/policy/protected-paths.ts`——`WRITE_EXECUTE_TOOLS`/`isWriteExecuteTool` 写执行类唯一权威（write/edit/bash/todo_write，plan 硬关判定面）（T-P1-10 铺垫）
  - `src/kernel/plan-mode.ts`——PlanModeService（进出幂等 + isActive 活查询）+ `planModeFromEvents` 流重建 + G4 的 `savePlanArtifact`/`planArtifactFromEvents`（T-P1-11/13）
  - `src/kernel/tools/builtin/plan.ts` + `descriptions/{plan_enter,plan_exit}.txt`——plan 双工具（默认 ask 用户批准）；plan_exit 加可选 plan 参数（批准结算落盘）（T-P1-11/13）
  - `src/policy/plan-guard.ts`——`enforcePlanMode` 出口级硬关（gate.ts / revalidate.ts 同位接线，规则不得授权）（T-P1-11）
  - `src/kernel/goal.ts`——GoalService（set/renew/achieve/abandon + 迁移守卫 `nextGoalState` 纯函数 + `tickBeforeTurn` 轮边界到期判定 + `goalFromEvents` 流重建 + 到期动作 abandon/report/renew 可配）（T-P1-12）
  - `src/kernel/assembly.ts`——createTodoUpdateEmitter 落流出口 + core 层挂 meta-ops + `planMode`/`planArtifactDir`/`goal` 装配选项（缺省全零行为变化）+ beforeFirstModelRequest 注入 goal 提醒 + plan_checkpoint 落流
  - `src/cli/repl.ts`——todo/update 进度整幅渲染（`◆ 任务清单（n/m 完成）`+ ☐/▶/✓）
  - `src/kernel/logger.ts`——连带修：落盘文件名日期改用注入时钟（与 ts 同源）
  - 测试：todo.test 7、plan-mode.test 15、goal.test 13；project.test +3、exit-guard.test +3、events.test 计数 17、cli.test +3（todo 进度 / plan 端到端 / goal 提醒）、boot-maintenance.test +1（plan 崩溃重启）
- **验收台账**：4 卡 4 命令全过（见台账表）；全量 `npx vitest run` **610 passed / 1 skipped**（第三组收官 565 → 净增 45），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 548 链接 0 失效
- **偏离计划的地方**：
  1. **todo_write 走 meta-ops 白名单直过**（卡面未写）：内核元状态写入对工作区零副作用，走默认 ask 则每次清单更新挂起审批、G2 进度可见等于不可用；白名单是链上显式模块（C18 证据可解释），plan 硬关在出口级压过它——"plan 模式下 todo 不可写"不依赖链上收口
  2. **plan 进出/重启均不扩词汇表**（全局约束 2 只给 T-P1-06/10/12 预留）：进出事实 = plan 工具自身的 tool/call+result；计划落盘 = `checkpoint{provider:"plan", ref:{path}}`（词汇表 checkpoint 槽位复核够用，卡面"不够再走扩展流程"的"不够"未发生）
  3. **goal/set 载荷补必填 status**（卡面形状 `{text, deadline?}`）：设定/达成/放弃/续期都是状态变更（不变量 1），无 status 则达成/放弃无表达面；终态保留 text/deadline 终值
  4. **plan_enter/plan_exit 默认 ask**：进出都经用户批准（opencode plan_exit 的 question.ask 同语义）——退出通道由用户控制，硬关不可被模型单方面解除
  5. **goal 到期判定在轮边界 tick** 而非 kimi 式 schedule 定时器：无后台时钟依赖，驱动节奏与轮生命周期一致
- **新发现的约束或坑**：
  - **logger 落盘文件名跨日 flaky（已修）**：T-6-05 的 clock 注入只覆盖 ts 字段、文件名日期用裸 `new Date()`——注入值=真实值时巧合通过，跨日（26 号跑 25 号写的测试）即翻车。修复 = defaultSink 收同一时钟。教训：凡"注入时钟"的组件，所有时间面必须同源
  - **vitest 全量跑 SQLite 子进程用例时 cli.test 的 plan 端到端 ~1.4s**：脚本 provider 四轮剧本 + 审批往返，测试面变厚后注意 timeout 配置（当前 5s 审批上限够用）
  - **meta-ops 白名单与 WRITE_EXECUTE_TOOLS 的张力是结构性的**：链上放行（体验）与出口硬关（安全）分层工作——后者永远压过前者，新增"默认放行但 plan 下要关"的工具照此双清单落
- **遗留风险与未知**：
  - **词汇表 15→16（todo/update）与 16→17（goal/set）待用户追认**（待澄清 #3/#4 已立案；不追认回退面各约 2 小时，均为新增面）
  - plan_exit 的 plan 参数是自由文本（无结构化计划 schema）——G4 的 artifact 是"计划文本存档"，结构化计划（分步骤/可勾选）属 B8/M8 后续
  - goal 的设定/续期面 P1 是装配选项 + 服务 API；owner 通道协议命令与 CLI UX（/goal）未接
  - execution epoch 完整机制（M8）未做："重启不重放"完全复用 Q5 对账，无自动续跑路径可拦
  - REPL `/model` 命令仍欠（J6 组遗留）；untrusted 观察轨无生产触发方（K3/K4）
- **下一批**：批次 1 全部收官（13/13 卡）。待用户追认词汇表两案后进批次 2：候选 = F5 摘要质量 + 递归摘要 · Q3 spill 清理 · B6/B7（并行/进度）· B8 其余扩展工具 · F6/F13/F14/F15 缓存族 · J12/J15/J16/J18/J19 模型运维族 · H1–H5 子代理族
- **下一组提示词**：

```
继续 aegent P1 的实施。批次 1 已全部完成（13/13 卡，610 passed）。用户对
待澄清 #3/#4 的追认结论已给出：<在此回填"允许"/"不允许"结论>——若允许，
先把 docs/l0-events.md §3.2 计数与 §8 落地记录 4/5、进度文件待澄清表 #3/#4
按"已追认"转正（§3.2 正式计数 17 事件），再与用户一起圈定批次 2 范围并
按 docs/plan-p0.md §0 协议展卡执行（展卡格式照 docs/plan-p1.md，锚点逐一
核对 oss/SOURCES.lock）；若不允许，先按落地记录 4/5 的回退面回修再圈定。
上一组报告在 docs/plan-p0-progress.md（批次 1 · 第四组报告）。不要问要不要
继续。
```

---

## 批次 1 终验收记录（2026-09-26，用户"全部认可 + 像 P0 一样测试一遍"）

### A. 自动化机验（无需用户提供，全部通过）

| # | 项 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | 全量测试 | `npx tsc --noEmit && npx vitest run` | **610 passed / 1 skipped**，tsc 干净 |
| 2 | 需求计数 | `bash tools/count-features.sh` | **310** 不变（P0=104/P1=158/P2=48） |
| 3 | 文档链接 | `bash tools/check-doc-links.sh` | 548 链接 **0 失效** |
| 4 | 许可审计 | `bash tools/license-audit.sh` | exit 0，17 仓通过 |
| 5 | 构建+资产 | `npm run build` | 成功；copy-assets 工具描述 10 工具齐进 dist |
| 6 | 冷启动 | `node scripts/cold-start.mjs` | median **179.6ms** < 500ms（P1 装配扩容后无回退） |
| 7 | smoke 端到端（echo+SQLite） | `--smoke --db` | REPL 完整；库 9 事件 seq 连续；restore 重启路径复核正常 |
| 8 | 常驻内存 | WorkingSet64 采样 | agent-child 空闲 **38.7MB** < 150MB |
| 9 | 词汇表追认转正 | 待澄清 #3/#4 | 用户"全部认可"→ 案关，§3.2 正式计数 **17 事件** |

### B. 真实厂商实测（用户提供 OpenAI 兼容网关，key 不落盘）

**端点形态**：网关 `<redacted-endpoint>`，模型 `cline-pass/deepseek-v4.1-flash`，OpenAI Chat Completions 协议（与 P0 J2 的直连端点不同接入路径——wire 兼容性复测通过，人工确认清单 J2 行关闭）。

**四段 smoke（管道模式）**：
1. **S1 纯对话**：模型自称 aegent（系统提示装配生效）、流式完整、turn 收尾正常。
2. **S2 todo 面**：真实模型自发产 `todo_write`（参数 JSON 分片拼接正确）→ **meta-ops 白名单直过（零审批弹窗）** → todo/update 落流 → REPL 进度整幅可见 → 模型确认回喂——G2 全链闭环。
3. **S3 审批流（P0 J2 复测口径）**：write ask 挂起 → 15s 超时 isError 回喂 → 模型自适应（glob 探查 → bash ls → 绝对路径 write 重试，连续被拦）→ **诚实收尾**（报告"任务未完成"+ 已尝试操作表）→ notes.txt 未落盘（零未授权写入）。另见 isError 自修真实案例：模型首次 write 漏 path 参数 → INVALID_ARGUMENTS 回喂 → 自修重试成功。
4. **S4 plan/goal 真实行为**：AEGENT_PLAN=1 + AEGENT_GOAL=... → goal 提醒注入可见（"（注入）[目标提醒]…"）→ 系统提示"计划模式"段引导**真实模型自发调 plan_enter**（"I'll start by entering plan mode"）→ 审批挂起超时 → 模型重试后转只读策略——被拒申请不改 plan 状态（planModeFromEvents 语义）在真实流下成立。

**驱动脚本全场景（真实子进程 + 自动放行审批，`scratch` 面 /tmp/j2p1/approve.mjs，不入库）**——补上 P0 当时只能测到"超时拒绝"的**放行面**：

| 场景 | 验证 | 结果 |
| --- | --- | --- |
| A | write 审批放行 → 真实落盘 | bash/write/read 放行 → hello.txt 落盘 19 字节，模型回读确认 |
| B | plan_enter 放行 → 激活 | 模型复述硬关语义（写/执行硬关、只读可用） |
| C | plan 激活下 write/bash | **出口硬关直接拒**（"plan 模式硬关…不可被规则授权"），不弹审批；模型诚实报告被拒 |
| D | plan_exit + plan 参数 → artifact | checkpoint{provider:"plan"} 落流，plan.md 落盘 `.aegent/sessions/s0/plan.md` |
| E | 退出后 write 恢复 | 恢复正常 ask → 放行 → restored.txt 落盘 |

**库内证据（j2p1b.db，128 事件）**：seq 连续；19 条 assistant 带 usage（Σinput=64,503 / Σoutput=2,560 / **Σreasoning=680——reasoning 映射 `delta.reasoning` 变体再次实测有效**）；tool/call 15 = tool/result 15 按 callId 配平；5 轮全 completed；plan checkpoint 1 条路径正确。

**实测发现并修复一个真实缺陷（本次 commit）**：agent-child 的 `planArtifactDir` 拼了 sessionId、savePlanArtifact 内部再拼一次 → artifact 落 `.aegent/sessions/s0/s0/plan.md` 双层目录。修复 = agent-child 只传父目录 `.aegent/sessions`（savePlanArtifact 的 `<dir>/<sessionId>/plan.md` 契约不动），复跑验证单层路径。

**成本口径（供批次 2 参考）**：五场景真实会话 Σinput≈64.5k / Σoutput≈2.6k 加权 token——工具密集会话的 input 占比高（系统提示 + 历史重建），F6/F13 缓存族（批次 2 候选）的优化空间真实存在。

---

## 批次 2 展卡记录（2026-09-26，编写会话产出）

> 用户裁决：①批次 2 走**路线一**（P1 剩余圈定，研究报告 [`20260926_P2研究_批次圈定建议.md`](20260926_P2研究_批次圈定建议.md)）；②顺带覆盖的 J25/L10/M5 **全部关闭**（requirements.md §4 已标注）。
> 展卡 10 张（T-P1-14 ~ 23）于 `plan-p1.md`，15 条需求 ID；锚点逐一核对到行号级（48/48 的 P2 层核对与 15/15 的批次 2 核对均零勘误）。B7 的 `tool_execution_update` 事件名在 pi types.ts 未定位（mode 锚已核实）——展卡发现记卡面，非勘误。

---

## 批次 2 报告（完成于 2026-09-26）

- **打勾情况**：10 / 10（T-P1-14 ~ T-P1-23 全部完成，无未完成项）——**P1 批次 2 全部收官**（15 条需求 ID：Q3/B17/B6/B7/F12/F14/F5/F6/F13/F15/B8a/B8b/J12/J15/J19/J18）
- **产出的文件**：
  - `src/kernel/tools/spill-gc.ts` + truncate.ts 扩（deletable 联合 + DEFAULT_SPILL_DIR）+ registry 接超量配额 + agent-process 会话关闭 finish()——Q3 spill 清理（T-P1-14）
  - `src/kernel/rw-lock.ts` + loop `ToolExecutionMode`/`isParallelTool`/`runParallelTools` + ToolDef.parallel + 只读族四工具声明——B17/B6 工具并发（T-P1-15）
  - `tool/progress` 事件（词汇表 17→18）+ ToolContext.reportProgress 通道 + loop 进度发射器（上限 10）+ bash 示范——B7 进度上报（T-P1-16）
  - ToolDef.deferrable + toChatTools 占位 + `tool_load` 检索柄 + loop toolsProvider——F12/F14 延迟加载（T-P1-17）
  - `src/context/llm-summarizer.ts`（createLlmSummarizer + truncatingSummarizer 移入）+ compaction.title 首摘要定名 + request/header reason 扩 "compaction"——F5 摘要/标题（T-P1-18）
  - `src/context/prefix-anchor.ts`（computeCacheAnchor/describeAnchorChange）+ loop 逐请求锚检测 + 压缩 cache-safe 断言 + UsageRow.cacheHitRate——F6/F13/F15 缓存族（T-P1-19）
  - `builtin/webfetch.ts` + NetworkGuard 唯一入口对接 + networkPolicy 装配选项 + `--network` 参数——B8a（T-P1-20）
  - `builtin/question.ts` + 协议分型（question/answer + question_asked）+ meta-ops 放行 + REPL `/answer`——B8b（T-P1-21）
  - `src/models/catalog.ts`（buildModelCatalog）+ openai-compat /models 发现 + listSwitchableModels——J12 选择器（T-P1-22）
  - `src/models/fault-tolerance.ts`（classifyProviderFailure + CircuitBreaker + RateLimitTracker + createFailoverProvider）——J15/J19/J18 容错层（T-P1-23）
- **验收台账**：10 卡 10 命令全部通过（见台账表）；全量 `npx vitest run` **655 passed / 1 skipped**（批次 1 收官 610 → 净增 45），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh`（显式传参 plan-p1/plan-p0-progress/l0-events）44 链接 0 失效、`license-audit.sh` exit 0；`npm run build` 工具描述 14 项进 dist（tool_load/question/webfetch 三个新 txt 自动跟上）
- **词汇表扩展**：`tool/progress`（17→18，**turn 域事件**——非会话级元事件，校验要求所属调用未闭合；落地记录 6 + 待澄清 #5）与 T-P1-18 的载荷扩展（RequestHeaderReason 扩 "compaction" + CompactionEvent.title，落地记录 7 + 待澄清 #6）**两案均待用户追认**；不追认回退面各约 2 小时（落地记录内详列）
- **偏离计划的地方**（逐卡详见卡面完成记录）：
  1. **T-P1-14**：deletable 恒 "manual" 改写 "after-session-end"（T-4-06 预留扩展点兑现——本卡即清理策略定义卡）；会话清理挂 agent-child 退出三路径共享 finish()；超龄触发不做（三选二 KISS）
  2. **T-P1-15**：预算轴并行语义卡内定形（tick 批内累加、progress 不再调用）；parallel 模式下未声明工具事件序与 sequential 不同但裁决语义一致
  3. **T-P1-16**：进度上限 10 条卡内定形；REPL 渲染未接（避免波及 cli.test 输出断言，CLI 可观测随 CLI 批次）；卡面 `seq-in-call` 落 camelCase `seqInCall`
  4. **T-P1-17**：占位 wire 形状选"空 schema + 描述内 [deferred] 标记"（不新增 ChatTool 扩展字段，厂商 wire 兼容零风险）；F13"位置性追加"落为原地替换（更严格：占位与真 schema 位置都不被扰动）
  5. **T-P1-18**："摘要提示词进 request/header 可观测"落为副调用头（reason="compaction"）+ 提示词作为请求 system 消息两件；标题只在首摘要记录
  6. **T-P1-19**：锚变化检测是运行时观测非硬失败（rewritten 落 warn 不阻断——作废是成本问题非正确性问题）
  7. **T-P1-20**：BUILTIN_TOOL_NAMES 实为 11→12（卡面写 10→11 时 tool_load 尚未展卡）；HTML→markdown 转换不做（turndown 依赖违反最小面）
  8. **T-P1-21**：opencode questions[]（多问题+选项）不取（单问题自由文本最小面）；owner-port 命令面未加（随 K 层批次）
  9. **T-P1-22**：目录是查询面库函数（装配不接线——/models 探测有启动延迟与失败面）；discovered-only 条目不可换模（无装配绑定 provider，fail-closed）
  10. **T-P1-23**：容错层是 loop 之下透明路由（不发 model/switch 事件、不改会话身份）；限流桶是库面（适配层响应头透传未做，扩展位）
- **新发现的约束或坑**：
  - **prefix-anchor.ts 首版内嵌字面控制字符**（NUL/SOH 作分隔符设想未转义）——`file` 判 data、Edit 工具拒改；重写为换行分隔。教训：**代码/注释里的分隔符永远用可打印字符**（不可见字符进 Write 载荷就是数据损坏）
  - `toChatTools` 等返回对象字面量带 meta 的工具需显式 ToolExecutionResult 标注（TS 联合收窄对 `declined?: undefined` 类形状过不了 JsonValue 闸门）——webfetch/question 各踩一次，helper（webfetchOk/questionOk）是解法
  - registerBuiltinTools 的 BUILTIN_TOOL_NAMES 是"**可注册**清单"而非"缺省注册清单"（webfetch/question 条件注册）——全集等价断言必须带齐各能力面装配件（plan-mode.test 两轮适配）
  - makeLoop 测试 harness 的 opts 面随 loop deps 增长（本批加 toolExecution/isParallelTool/toolsProvider/onCacheAnchorChange/modelForTurn 五槽位）——loop 测试基建的维护成本信号，暂不重构
- **遗留风险与未知**：
  - **词汇表两案已追认转正**（待澄清 #5/#6 案关，§3.2 正式计数 18 事件——2026-09-26 用户裁决）
  - ~~真实厂商端到端复测未做~~ **已完成（2026-09-26）**：三面证据见人工确认清单批次 2 行（B7 进度 2 条落流 / B8b question 真实模型全链 / F6 cacheHitRate≈85.2% 远超 30% 口径）；**仅 J15 多端点容错开放**（需第二端点）
  - spill 默认目录（系统 tmp aegent-tool-spill）在多版本共存时旧 manual 文件不被 GC（人工面保留——设计如此）
  - cli.test 的 question 用例 ~1.4s（审批/问答往返），测试面继续变厚后注意超时配置
- **批次完成定义核对**：10 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 0 失效 ✓；license-audit 通过 ✓；词汇表扩展走既有管线 ✓；缓存族锚逐字节断言就位 ✓；真实厂商复测 → 人工确认清单（下项）
- **下一批**：批次 2 收官。P1 剩余 = H1–H5 子代理族（大件独立成批）· B8 的 apply_patch/lsp · E5/E6 fork 与会话树 · Q2 会话查询 · P2 层数据生命周期族（M4/Q4/Q6/Q8）等（见批次 3 候选占位与 P2 研究报告路线）
- **下一批提示词**：

```
继续 aegent P1 批次 3 的实施（沙箱 Windows 深化）。批次 3 尚未展卡：先按
docs/20260926_P1剩余批次全量圈定研究.md 批次 3 条目（D5 D6 D7 D10 D11 D13
D14 D16）逐条锚点核对 requirements.md §4，照 plan-p1.md 批次 2 展卡先例
把卡序追加进 plan-p1.md，然后按 docs/plan-p0.md §0 协议执行。上一批报告
在 docs/plan-p0-progress.md（批次 2 报告）。本批特有的注意：1) D6/D13/D16
是 Rust 子进程件（T9：跨 TS↔Rust 一律子进程、只传可序列化值）；2) D11
PowerShell 一等 shell 动 ExecutionEnv，注意 bash-retry-guard 等 bash 语义
依赖面；3) D14 在疑似顺带覆盖清单（T-6-06/D15 相邻语义），展卡时先核对
证据可提请关闭。全量基线 656 passed / 1 skipped。不要问要不要继续。
```

## 批次 3 展卡记录（2026-09-26，执行会话自展）

> 用户提示词指示：先按圈定研究批次 3 条目（D5/D6/D7/D10/D11/D13/D14/D16）逐条锚点核对 requirements.md §4，照批次 2 先例展卡，再按 plan-p0 §0 执行。**8 条锚点逐一开文件核实，零勘误**（dsh packages/sandbox 契约 + sandbox-windows-acl 含 workspace-sid.ts 派生公式、codex setup.rs:740 SandboxNetworkIdentity + token.rs/acl.rs/wfp.rs、codex doctor sandbox.rs/network.rs、dsh containment 文档）。**两项展卡裁决**：①**D14 疑似顺带覆盖核对结论：不等价，实卡**——T-6-06/bash-retry-guard 是 D15 重试幂等边界（started 标记），D14 是"强管辖不可用时 provider 生命周期一次性告警"，相邻不同义且我方现状无管辖告警面；②**D10 裁决并入 D6 卡**——取 codex Rust helper 路线（T9 纪律），dsh 的 Koffi TS 进程内 FFI 不取，D10 的 grant 三件套语义并入验收。预估 5 卡实展 6 张（批次 1 有 13 vs 14 的弹性先例）：D16（OS 账户+WFP provision）与 D11（四象限）各自独立成卡比硬塞清晰。

---

## 批次 3 报告（完成于 2026-09-26）

- **打勾情况**：6 / 6（T-P1-24 ~ T-P1-29 全部完成，无未完成项）——**P1 批次 3 全部收官**（8 条需求 ID：D5/D6/D7/D10/D11/D13/D14/D16）
- **产出的文件**：
  - `src/sandbox/backend.ts`（SandboxBackend 接口 + SandboxMode 三值 + SANDBOX_UNAVAILABLE fail-closed + createLocalBackend）——D5 可插后端（T-P1-24）
  - **`src/sandbox/win32-helper/` Rust crate**（main/grant/token/spawn/err/wfp/account/mechanism_tests 八模块，windows-sys 0.48 + serde；动作闭集 run/provision-network/probe-network/run-offline）——D6/D10/D13/D16 的全部 Win32 面（T-P1-25/26/27）
  - `src/sandbox/workspace-sid.ts`（S-1-4-x-y sha256 派生 + temp 域分离 + canonicalize）+ `src/sandbox/win32-backend.ts`（Win32SandboxBackend：helper 协议、SANDBOX_UNAVAILABLE、TOOL_TIMEOUT 透传、powershell 缺省宿主）——D6/D10 TS 面（T-P1-25）
  - `src/sandbox/containment.ts`（createContainedBackend 装配工厂 + D14 一次性告警）——D13 兜底面 + D14（T-P1-26）
  - `src/sandbox/offline-network.ts`（resolveNetworkIdentity + OfflineNetworkExecutor + probeNetworkProvisioned + 账户名闭集）——D16 TS 面（T-P1-27）
  - `env.ts` 扩 ShellKind（pwsh/bash 两态，缺省零变化）+ `builtin/pwsh.ts`（平行 bash 工具）+ `descriptions/pwsh.txt` + WRITE_EXECUTE_TOOLS +pwsh + `docs/shell-semantics-limitations.md` 扩 pwsh 方言边界节（#9-12）——D11（T-P1-28）
  - `src/sandbox/doctor.ts`（runDoctorChecks 注入面 + formatDoctorReport）+ `src/cli/doctor.ts`（独立入口）+ `src/cli/provision.ts`（D16 provision 入口）+ npm scripts `doctor`/`sandbox:provision`/`build:sandbox-helper`——D7（T-P1-29）
- **验收台账**：6 卡 6 命令全部通过（见台账表）；全量 `npx vitest run` **701 passed / 1 skipped**（批次 2 收官 656 → 净增 45），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 0 失效、`license-audit.sh` 通过；Rust `cargo test` 1 passed（Job LimitFlags 机制）
- **词汇表扩展**：**零**（研究文档预判"低"命中）——D14 告警走 logger.warn（D3 弱承诺先例），未新增事件
- **T9 纪律**：helper 协议全部 stdin/stdout JSON 可序列化值；TS 侧证伪 `grep -rn child_process src/kernel/tools/`（除 env.ts）0 行、tools/+policy/ 零 windows-sys/koffi/CreateRestrictedToken 词汇
- **偏离计划的地方**（逐卡详见卡面完成记录）：
  1. **T-P1-25**：TOKEN_GROUPS 数组 offset 8（GroupCount 后 4 字节 padding）首版写 offset 4 被真机测试抓出修正；CreateProcessAsUserW 用 applicationName=null（按命令行解析+PATH 搜索，对齐 execFile 语义）；**真机发现 msys bash 与 WRITE_RESTRICTED 受限令牌结构性不兼容**（NtCreateDirectoryObject 0xC0000022）——cmd/powershell 正常，Windows 沙箱态宿主正路是 PowerShell（dsh 同款决策），LIMITATIONS #12 落档
  2. **T-P1-26**：后代存活期间无额外超时（宿主退出后等 Job 清空无预算——后代自然跑完，硬回收只由 timeoutMs 触发）；**cargo target/ 误入库发现后 git rm --cached + gitignore + amend**（P1 构建产物不入库）
  3. **T-P1-27**：LogonUser 路线不取（需 SE_TCB）——**CreateProcessWithLogonW 的 seclogon 路径**是普通进程可用的账户 spawn 通道；windows-sys 0.48 缺失的 WFP/LSA 符号（FWP_ACTION_BLOCK/FWP_E_*/UNICODE_STRING 位置等）自定义常量/换位补齐；密码 DPAPI 加密落盘由 provision 调用方执行（D8 机器级扩展位随 CLI 批次装配）
  4. **T-P1-28**：卡面"pwsh 退出码语义与 bash 一致"记偏离——实际为**宿主语义**（对齐需尾包装 `exit $LASTEXITCODE`，cmdlet 场景引入残留值误报，比差异更糟，dsh 同款决策，LIMITATIONS #11）；pwsh 语义分析器完整版不做（YAGNI：重定向字面解析跨方言有效 + 危险库误报方向保守）
  5. **T-P1-29**：helper 路径缺省为仓库相对路径（非仓库根运行会 miss——路径在报告可见，绝对路径解析随 CLI 批次装配）
- **新发现的约束或坑**：
  - **windows-sys 0.48 的 feature 门控极碎**（FwpmEngineOpen0 需 Win32_System_Rpc、LSA 常量在 Authentication_Identity、OBJECT_ATTRIBUTES 在 WindowsProgramming）且 WFP 常量不全（0.49+ 才生成）——缺失的微软固定值以 const 自定义并注明出处
  - **msys2 运行时是受限令牌的死穴**（NtCreateDirectoryObject 命名空间对象在 pass-2 被拒）——Git Bash 的 bin/bash.exe wrapper 与 usr/bin/bash.exe 双路径实测复现
  - TOKEN_GROUPS 的 Groups 数组 offset 是 8 不是 4（GroupCount 后 4 字节 padding 对齐 PSID）——Win32 结构体 padding 在指针成员前的教训
  - gitignore 之前没有 cargo target 规则——**新语言工具链入库前先补构建产物排除**
- **遗留风险与未知**（→ 人工确认清单批次 3 行）：
  - **D16 elevated provision + offline 进程联网被拒的真机验证**（本环境非管理员，net session 已核实；probe 非特权可读已实测 provisioned=false）
  - **Low integrity label + deny delete ACE 的完整行为**（本卡实现且主语义验证过，但"跨 grant 根删除被 deny 挡住"未单独断言）
  - 密码 DPAPI 机器级加密落盘未接线（协议面已通，随 CLI 批次 SecureKeyStore 装配）
  - T-6-01 符号链接用例沿用（本机无特权，skipIf 先例）
- **批次完成定义核对**：6 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 0 失效 ✓；license-audit 通过 ✓；词汇表零扩展 ✓；T9 证伪 ✓；cargo test + 构建脚本 ✓；D14/D10 裁决落档 ✓
- **下一批**：批次 4 = 测试与诊断基建（O12–O26，15 条，预估 9 卡；O15/O16 真实厂商回归基建反哺后续批次）
- **下一批提示词**：

```
继续 aegent P1 批次 4 的实施（测试与诊断基建）。批次 4 尚未展卡：先按
docs/20260926_P1剩余批次全量圈定研究.md 批次 4 条目（O12–O26）逐条锚点
核对 requirements.md §4，照 plan-p1.md 批次 3 展卡先例把卡序追加进
plan-p1.md，然后按 docs/plan-p0.md §0 协议执行。上一批报告在
docs/plan-p0-progress.md（批次 3 报告）。本批特有的注意：1) O15/O16 是
真实厂商回归可持续性的基建（批次 1/2 的真实网关实测剧本可复用）；2)
O20 在疑似顺带覆盖清单（T-2-03 mock.calls 计数断言），展卡先核对证据可
提请关闭；3) O25 进程全局状态隔离注意与现有单进程假设的冲突面。全量
基线 701 passed / 1 skipped。不要问要不要继续。
```

---

## 批次 4 展卡记录（2026-09-26，执行会话自展）

> 用户提示词指示：先按圈定研究批次 4 条目（O12–O26）逐条锚点核对 requirements.md §4，照 plan-p1 批次 3 展卡先例把卡序追加进 plan-p1.md，再按 plan-p0 §0 执行。**15 条锚点逐一开文件核实，零内容勘误**（dsh invariant.ts/llm-replay/llm-mock-server/test-support 包组、codex responses.rs/context_snapshot.rs/compact.rs+8 快照文件/doctor 目录/session/tests.rs 具名测试、kimi snapshots.ts:119-198/migration-legacy、pi-desktop plugins/tests.rs:10-27；**行号漂移注明**：compact.rs:423 实际断言在 2361/3342/3466，文件演进漂移、断言原文逐字命中）。**三项展卡核对结论（J25/L10/M5 先例；①②✅ 已于 2026-09-26 经用户追认关闭）**：①**O17 已覆盖提请关闭不占卡**——EventStorage 接口 + InMemory/Sqlite(:memory:) 双实现 P0 E2 已落，单测全走内存或 mkdtemp 夹具（boot-maintenance 的"杀进程"是真 WAL 语义非生产磁盘）；②**O20 部分覆盖与 O13 并卡**——T-2-03 计数断言纪律已在用（expect(a.calls()).toBe(3) 等），但"带说明"访问器形态缺失，T-P1-31 实卡补齐；③预估 9 卡实展 10 张（O17 关闭后 15 条 → 10 卡 = 1.5 条/卡，批次 2 密度），O13+O20/O14+O24/O15+O16/O21+O22 四组合并。

---

## 批次 4 报告（完成于 2026-09-26）

- **打勾情况**：10 / 10（T-P1-30 ~ T-P1-39 全部完成，无未完成项）——**P1 批次 4 全部收官**（15 条需求 ID：O12–O26，O17 核对关闭 / O20 并卡后实占 10 卡）
- **产出的文件**：
  - `src/kernel/invariants.ts`（InvariantRegistry + 内建四件流不变量 + createDefaultRegistry；三断言器从 event-asserts 迁入，re-export 保 import 面）——O12（T-P1-30）
  - `src/test-support/http-mock.ts` 扩四访问器（expectCalls/singleRequest/lastRequest/requestAt 带 why 可读失败）+ ScriptedProvider.requestAt——O13/O20（T-P1-31）
  - `src/test-support/render.ts`（formatGenerateInput 单请求差分 + formatRequestWindow 窗口分组 + renderEventStream 事件流列对齐单行交错）——O14/O24/O23（T-P1-32/33）
  - `src/test-support/llm-replay.ts`（RecordingProvider/ReplayProvider/ReplayOverride + JSONL fixture）+ `fault-server.ts`（六具名故障行为闭集）+ `cli/mock-llm.ts` 库面 + `cli/mock-llm-run.ts` 独立入口 + npm script `mock:llm` + http-mock 扩 Reset/Stall/truncateAfter——O15/O16（T-P1-34）
  - `src/diagnostics/doctor.ts`（运行时四行检查）+ `cli/doctor.ts` 聚合两域 + `--json` 导出 + db.ts 导出 CURRENT_SCHEMA_VERSION——O18（T-P1-35）
  - `src/test-support/migration-asserts.ts`（前向兼容流断言 + schema 版本闸门 + 原子性模板）——O19（T-P1-36）
  - snapshots.ts 扩 `scenario` 头字段 + 首行渲染 + `src/context/compaction.snapshot.test.ts` 四相位快照 + 派生断言——O21/O22（T-P1-37）
  - `src/test-support/isolation.ts`（serializeGlobal promise 链锁 + withEnv RAII + 中毒不扩散）+ env.ts `resetPwshHostCacheForTests`——O25（T-P1-38）
  - 全仓 758 测试名盘点 + 安全边界三处抽查 + 命名纪律落档——O26（T-P1-39）
- **验收台账**：10 卡 10 命令全部通过（见台账表）；全量 `npx vitest run` **761 passed / 1 skipped**（批次 3 收官 701 → 净增 60），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 385 链接 0 失效、`license-audit.sh` 通过（LEAK 未命中/CLEAN-ROOM/SOURCEMAP 无）
- **词汇表扩展**：**零**（研究文档预判"低"命中）——18 事件自批次 2 后无变化
- **测试基建零运行时泄漏** ✓：全部新增面落 test-support/ 与 diagnostics/；两个声明例外 = O12 不变量服务（kernel，装配 invariants 选项缺省关）与 O18 doctor（diagnostics + cli 聚合）
- **偏离计划的地方**（逐卡详见卡面完成记录）：
  1. **T-P1-30**：三断言器实现从 event-asserts 迁入 kernel 域（不变量属于拥有流的域）+ event-asserts re-export——kernel→test-support 反向依赖不健康；`single-terminal-per-turn` 新增按轮形态（expectSingleTerminal 的全流形态在多轮流会误报）；E11 git checkpoint turn/start 前落流核对无误报
  2. **T-P1-31**：requestAt 语义分层（只管索引越界，总量断言归 expectCalls）——首版"恰 i+1 次"绑进取值访问器被测试当场抓出修正
  3. **T-P1-32/33**：前缀判断逐条 JSON 深等（kimi isDeepEqual 同语义，引用相等首版被测试抓出）；padEnd 列对齐的补位数三处 off-by-one 被测试抓出
  4. **T-P1-34**：HttpMock 扩 wire 词汇三件（ResetScript/StallScript/SseScript.truncateAfter）——恢复类故障必须能在 wire 表达；**truncateAfter 必须 flush 回调后才 destroy**（立即 destroy 丢缓冲被测试抓出）；HttpMock.start 加可选 port（CLI --port 透传）；partial 测试与 reset 分 mock（undici 连接池复用被断连接会污染后续请求）
  5. **T-P1-35**：db.ts 导出 CURRENT_SCHEMA_VERSION（doctor 存储行消费）；Windows db 句柄刚 close 就 rmSync 偶发 EBUSY（WAL 短暂锁定）——测试 finally 容忍
  6. **T-P1-37**：事件面两种溢出源共用 `context_limit`（compactionReasonOf 词表纪律）——快照人话区分由 Scenario 行承担，断言按词表值
  7. **T-P1-39**：零改名（129 启发式命中逐条核查全有行为语义——三类不改理由落卡面）
- **新发现的约束或坑**：
  - **undici 连接池复用被 destroy 的连接**——同 origin 的 reset 故障会污染后续请求（故障注入测试要分 mock 或新连接）
  - **Node res.write 是异步缓冲**——writeHead+write 后立即 socket.destroy() 会丢未 flush 数据（半流交付要等 write 回调）
  - **Windows WAL 文件句柄释放竞态**——better-sqlite3 close 后立即 rmSync 偶发 EBUSY（测试 finally 容忍，临时目录系统回收）
  - vitest 全文件并行（85 worker）下 712→739→761 的回归稳定性依赖测试夹具 mkdtemp 唯一化（P0 纪律持续有效）
- **遗留风险与未知**（→ 人工确认清单批次 4 行）：
  - ~~O17 关闭与 O20 部分覆盖结论待用户追认~~ ✅ **已追认关闭**（2026-09-26，requirements §4 行内标注落档）
  - O15 录制回放对真实厂商 provider 的端到端演练（RecordingProvider 可 wrap openai-compat provider 先录后测）——批次 5 起的真实厂商回归实跑时确认
  - `npm run mock:llm` CLI 的 SIGINT 优雅停只验了库面 stop（信号路径未真机断链）
- **批次完成定义核对**：10 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 0 失效 ✓；license-audit 通过 ✓；词汇表零扩展 ✓；测试基建零运行时泄漏 ✓；O17/O20 核对结论落档 ✓；真机 doctor/mock:llm 冒烟 ✓
- **下一批**：批次 5 = 子代理与 fork（大件，E5 + H1–H5，预估 6-7 卡；P2 报告预警"内核起子循环 + 权限面重构"的最大件，展卡时允许裂为 7-8 卡；词汇表高影响预判——task 派发/结算事件、fork 元事件）
- **下一批提示词**：

```
继续 aegent P1 批次 5 的实施（子代理与 fork 大件）。批次 5 尚未展卡：先按
docs/20260926_P1剩余批次全量圈定研究.md 批次 5 条目（E5 + H1–H5）逐条锚点
核对 requirements.md §4，照 plan-p1.md 批次 4 展卡先例把卡序追加进
plan-p1.md，然后按 docs/plan-p0.md §0 协议执行。上一批报告在
docs/plan-p0-progress.md（批次 4 报告）。本批特有的注意：1) H1 task 工具
先定形"子 agent 进程还是进程内隔离"（研究文档 §三批次 5 要点）；2) H3/H5
权限降级只继承 deny 与 external_directory、绝不继承授权；3) 词汇表高影响
预判（task 派发/结算、fork 元事件）——每处走待澄清立案管线；O15 录制回放
基建可反哺本批真实厂商回归。全量基线 761 passed / 1 skipped。不要问要不要
继续。
```

---

## 批次 5 报告（完成于 2026-09-26）

- **打勾情况**：6 / 6（T-P1-40 ~ T-P1-45 全部完成，无未完成项）——**P1 批次 5 全部收官**（6 条需求 ID：E5 + H1–H5 全关；预估 6-7 卡实展 6 卡，H1+H4 并卡）
- **产出的文件**：
  - `src/session/store.ts` 扩 `SessionStore.fork`（切点复制 + seq 重编号 + ts 保留 + ForkError 五码类型化拒绝 + idle 前置检查）+ `ForkError/ForkOptions` 导出——E5（T-P1-40）
  - `src/kernel/events.ts` 词汇表 18→19：`session/fork {parentSessionId, position, cutSeq}` 会话级元事件（落子流头部、log-only）——E5（T-P1-40，待澄清 #7 供追认）
  - `src/policy/subagent-rules.ts`（deriveSubagentRules：动作维度过滤只留 deny + SUBAGENT_DEFAULT_DENIED_TOOLS 默认禁用清单 + allowTools 放开不复活授权）——H5（T-P1-41）
  - `src/kernel/subagent.ts`（createSubagentRunner：深度检查入口 + 独立子会话 + 子装配参数化 + Deny broker + settleFromTurnEnd 三值结算 + signal 取消联动）——H1/H4（T-P1-42）+ H2（T-P1-43）
  - `src/kernel/tools/builtin/task.ts` + `descriptions/task.txt`（task 工具：task_result/task_error 渲染 + meta.lineage + SUBAGENT_DEPTH_EXCEEDED 类型化拒绝 + BUILTIN_TOOL_NAMES 14→15）——H1/H4（T-P1-42）
  - `src/kernel/loop.ts`（per-turn cancelController + cancel() abort + dispatchTool 载荷带 signal——A7 信号接线）+ `registry.ts`（ToolDispatchCall.signal → ToolContext.signal，P0 形状先行的槽位真接线）——H2（T-P1-43）
  - `src/context/system-prompt.ts`（delegation 声明段，dsh SUBAGENT_DELEGATION_CONTEXT 同构中文化）+ assembly.ts（broker 覆盖 + delegation 透传）——H3（T-P1-44）
  - 协议面：agent-protocol.ts（session/fork 请求 + forked 回执）/ agent-process.ts（fork case + subagent 选项接线）/ owner-port.ts（sessionFork handler）/ repl.ts（/fork 命令 + ⑂ 渲染）——E5（T-P1-40）
  - 收口盘点六面 + task 全链快照（O21/O22 反哺）——T-P1-45
- **验收台账**：6 卡 6 命令全部通过（见各卡完成记录）；全量 `npx vitest run` **791 passed / 1 skipped**（批次 4 收官 761 → 净增 30），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 798 链接 0 失效、`license-audit.sh` 通过（LEAK 未命中/CLEAN-ROOM/SOURCEMAP 无）
- **词汇表扩展**：**18→19 一处**（`session/fork`，待澄清 #7 立案供追认）——研究文档"高影响"预判收敛为最小面：task 派发/结算零扩展（tool/call+result 承载，stopReason 在 result.meta.subagent）、delegation 零扩展（装配参数 + 系统提示段重建）
- **偏离计划的地方**（逐卡详见卡面完成记录）：
  1. **T-P1-40**：fork 复制保留原 ts（复制历史事实非新事件，绕过 append 的 ts 分配）；E5 position 词形采用 requirements 的 before/after（pi 当前为 before|at，语义等价，展卡记录注明）
  2. **T-P1-42**：task 在子代理注册表**可见但执行被拦**（deny 规则/ask+Deny broker 双道——H5"默认禁用"落法；卡面验收④"无 task"字面调整为可观测的拒绝语义，opencode task.ts:106-117 深度检查同款）；**P1 子代理 = 纯推理代理**（C3 默认 ask + Deny broker 的 H3 红线字面必然——allow 不继承 + 无子代理规则配置面 ⇒ 零默认可用工具）；maxDepth>1 时按深度放开 task 默认 deny（deny 规则是 maxDepth=1 的快路径，深度检查是权威）
  3. **T-P1-43**：A7 信号真接线（per-turn AbortController → ToolContext.signal）——P0 形状先行槽位兑现；CancelCause "parent" 槽位真用（events.ts 注释"P1 真用上"兑现）
  4. **T-P1-44**：delegation 声明以 system-prompt 段 + 装配参数重建（词汇表零扩展优先兑现）；C46 硬拦子代理同效（核心层出口与子链同构复用）
- **新发现的约束或坑**：
  - **H3 红线下的子代理能力边界**：C3 默认 ask（不变量 3）× DenyPermissionBroker = 子代理内一切无规则操作确定性拒绝——这是"不得拥有高于父会话的权限"的字面必然，不是缺陷；子代理价值面 = 无工作区副作用的推理/整理任务；工具能力面要等 P2 的子代理权限配置面（H6 后端时代）或 C42 判官
  - **makeLoop 不支持外部 store**——父子两流栅栏断言需要共享 store，端到端测试直接构造 AgentLoop（loop.test-utils 的 harness 局限，未改它——YAGNI）
  - **超长子代理不受父 B14 时间轴中断**（budget.progress 只在工具执行完回环时查）——LIMITATIONS 记档，人工中断通道 = 取消联动（T-P1-43）
- **遗留风险与未知**（→ 人工确认清单批次 5 行）：
  - ~~session/fork 词汇表 18→19 待追认~~ ⏳ **待澄清 #7 立案中**（2026-09-26；不追认的回退面已落 l0-events.md 落地记录 8）
  - 真实厂商端到端的 task 派发/子代理回归（O15 录制回放基建可反哺：RecordingProvider 可 wrap 父与子代理的请求面先录后测）——批次终验人工确认清单
  - plan 模式下 task 派发经父审批后子代理写文件被 Deny broker 拒的行为链（防绕过）已单测钉死；真实模型对 delegation 声明的遵守度未实测
- **批次完成定义核对**：6 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 0 失效 ✓；license-audit 通过 ✓；两项展卡定形照执行 ✓；词汇表一处扩展走立案 ✓；H3/H5 降级红线每处测试钉死 ✓；六面盘点结论落卡 ✓
- **下一批**：批次 6 = loop 治理与准入（A5 A8 A10 A11 A12 A13 A14 A15 A17 + J20 + M9，预估 7-8 卡；A10/A11 steer 准入成对、A13 闸门 ↔ M9 有界准入合并看待、A17 疑似被 T-3-04 部分覆盖展卡先核对）
- **下一批提示词**：

```
继续 aegent P1 批次 6 的实施（loop 治理与准入）。批次 6 尚未展卡：先按
docs/20260926_P1剩余批次全量圈定研究.md 批次 6 条目（A5 A8 A10–A15 A17 +
J20 + M9）逐条锚点核对 requirements.md §4，照 plan-p1.md 批次 5 展卡先例
把卡序追加进 plan-p1.md，然后按 docs/plan-p0.md §0 协议执行。上一批报告
在 docs/plan-p0-progress.md（批次 5 报告）。本批特有的注意：1) A17 疑似被
T-3-04 部分覆盖（取消槽 + await 边界检查已落）——展卡先核对再定卡面；
2) A13 闸门与 M9 有界准入合并看待（"准不准入"与"准入多少"）；3) 词汇表
预判低影响（A12 关联 id 或扩 user/message 载荷）——有扩展走待澄清立案。
上批遗留：session/fork 词汇表 18→19 待澄清 #7 仍待追认。全量基线
791 passed / 1 skipped。不要问要不要继续。
```

---

## 批次 6 展卡记录（2026-09-27，执行会话自展）

> 用户提示词指示：先按圈定研究批次 6 条目（A5 A8 A10–A15 A17 + J20 + M9）逐条锚点核对 requirements.md §4，照 plan-p1 批次 5 展卡先例把卡序追加进 plan-p1.md，再按 plan-p0 §0 执行。**11 条锚点逐一开文件核实，零内容勘误**（kimi retry.ts 全文 75 行 + machine.ts:57 PromptGateVerdict 及消费点/改写测试用例 + engine.ts abortTimeoutMs + configSection.ts maxStepsPerTurn、pi-desktop active-turn-steering ADR 全文 45 行、grok agent.rs:758 in_flight_prompt/do_cancel_turn rewind、claude-official claude-code.d.ts prompt_id、zcode turn-loop.ts 三排空点与 throwIfTurnAborted 四点位、codex turn_admission.rs 全文 87 行、pi-desktop ADR 0041 全文 55 行；**唯一漂移 = A14 的行号**：requirements 写 engine.ts:303、abortTimeoutMs 实际在 :125，文件演进、参数名逐字命中）。**四项展卡核对结论**（研究文档疑似顺带覆盖清单 + 批次 6 要点指令）：①A17 部分覆盖 + decideTurn→closeTurn 窗口真实缺口（取消被 completed 吞）→ 实卡 T-P1-46；②A11 半边结构成立（drainQueue step 边界注入）→ 并入 T-P1-47 断言钉死；③A8 队列保留结构成立、缺"退回输入框"可见面 → 实卡 T-P1-52；④A13+M9 合并拆两面（队列面 T-P1-48 / 并发面 T-P1-49）。预估 7-8 卡实展 9 张（A10+A11 成对、A13+M9 拆两面、收口盘点照批次 4/5 先例单列）。

---

## 批次 6 报告（完成于 2026-09-27）

- **打勾情况**：9 / 9（T-P1-46 ~ T-P1-54 全部完成，无未完成项）——**P1 批次 6 全部收官**（11 条需求 ID：A5/A8/A10/A11/A12/A13/A14/A15/A17/J20/M9 全关；A15 记档关闭于 T-P1-47——三类输入三排空点在 loop 结构成立）
- **产出的文件**：
  - `src/kernel/loop.ts` 扩——A17 两处显式取消检查（decideTurn 后 + beforeFirstModelRequest 后，11 点 await 盘点清单落卡）+ `activeTurn` 只读权威面（closeTurn 开头清位）+ drainQueue 异步化 × promptGate 三态裁决 × promptId 分配（nextPromptId + 流重建基线）+ 两个护栏（maxStepsPerTurn 循环头检查 / abortTimeoutMs 看门狗 + forcedClosed 闸门 + forceCloseTurn）——T-P1-46/47/48/50/53
  - `src/kernel/agent-protocol.ts` 扩——steer 请求（expectedTurn 正整数必填 + content 非空）+ prompt_returned 回执——T-P1-47/52
  - `src/kernel/agent-process.ts` 扩——steer case（TURN_NOT_ACTIVE 准入校验）+ prompt/steer 的 QUEUE_FULL 与 SERVER_DRAINING 类型化 error 行 + kick 的 TurnAdmission 接线与 aborted 退回（prompt_returned）+ executeTool 的 ToolClassLimiter 包装 + 收尾路径 beginDrain——T-P1-47/48/49/52
  - `src/kernel/prompt-gate.ts` + 测试——A13 三态类型（kimi PromptGateVerdict 同构）+ normalizePromptVerdict 归一化——T-P1-48
  - `src/kernel/admission.ts` + 测试——TurnAdmission（admit/Permit 幂等 release/beginDrain/SERVER_DRAINING）+ ToolClassLimiter（类独立 FIFO 排队、名额转交、缺省 Infinity）——T-P1-49
  - `src/kernel/queue.ts` 扩——maxSize 有限队列（缺省 64）+ QueueFullError + drainAll——T-P1-48/52
  - `src/kernel/events.ts` 扩——UserMessageEvent.promptId 可选载荷（A12 关联区间语义注释）——T-P1-53
  - `src/models/retry.ts` 扩——RetryOptions.onRetry（RetryObservation：attempt/delayMs/retryErrorFields 同构三字段）+ agent-child openai 装配缺省 warn 留痕——T-P1-51
  - `src/cli/repl.ts` 扩——/steer 命令（expectedTurn 从事件流自动跟踪）+ prompt_returned ⮐ 回显 + lastTurn 跟踪——T-P1-47/52
  - `src/session/project.ts` 扩——user/message 的 promptId validation（空串拒/缺省放行）——T-P1-53
  - `src/kernel/steer.snapshot.test.ts`——steer 全链规格快照一条（O21/O22 反哺）——T-P1-54
  - `docs/l0-events.md`——§3.2 user/message 行 + §8 落地记录 9（含不追认回退面）——T-P1-53
- **验收台账**：9 卡 9 命令全部通过（见台账表）；全量 `npx vitest run` **827 passed / 1 skipped**（批次 5 收官 791 → 净增 36），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 548 链接 0 失效、`license-audit.sh` exit 0
- **词汇表扩展**：**一处载荷扩展**（user/message.promptId，事件计数 19 不变——落地记录 9 + 待澄清 #8 立案供追认）；研究文档"低影响"预判命中——A13 拦截面 logger、A5 重试面 logger、A14 护栏面 TurnEndReason 既有槽位、J20/M9 拒绝面类型化错误，四处预判零扩展全部兑现
- **三个真实缺陷在测试中被抓出并修复**（本批质量亮点）：
  1. **T-P1-47**：turn/end 事件转发（append 即发）先于 activeTurn 清位（flush/turnEnd 链还在跑）——窗口内 steer 被误受理并入队，轮收尾后 kick 开了轮 2 → 修复 = 清位提前到 closeTurn 开头（收轮开始即无可重定向的在途工作）
  2. **T-P1-49**：kick 里 admission.admit() 在 draining 后抛 ServerDrainingError 无人接 → unhandled rejection 且 kick 链断裂、进程不退 → 修复 = draining 时 kick 跳过 admit（admit 的拒绝面只在 handleRequest 的新请求；存量队列照常跑完 = EOF 语义）
  3. **T-P1-50**：看门狗强制收轮与自然收尾路径的 double terminal 风险 → forcedClosed 闸门（closeTurn 直接返回 + 迟到的工具结果不落盘 + warn 记档）——协作式纪律"不弃在途 promise"保持，强制的只是事件流终态与状态归位
- **偏离计划的地方**（逐卡详见卡面完成记录）：
  1. **T-P1-47**：CLI /steer 的 expectedTurn 由 REPL 从 turn/start 事件流自动跟踪（turn 级定位是 UI 层职责，用户不手输轮号——卡面风险栏"切点换算属 UI 层"同款决策）
  2. **T-P1-48**：PromptQueue 缺省 maxSize 64（"宽松但有限"卡内定形；超限 fail-closed 不静默丢）
  3. **T-P1-49**：ToolClassLimiter 的工具类判定函数构造注入（kernel 不开第二处 → policy 反向依赖；agent-process 已依赖 protected-names 故顺路注入）
  4. **T-P1-52**：A8 的"未发出 prompt"落法 = aborted 轮后队列未消费输入全量退回 + 不自动续跑（pi-desktop·Stop "retains accepted input without independently replaying" 同构）——completed 路径续开行为不变
- **新发现的约束或坑**：
  - **事件转发时序与内存权威面的窗口**：turn/end 事件转发 ≠ 轮收尾完成——任何"以事件到达为信号立即发请求"的准入判定都要与 loop 内存权威面（activeTurn）对齐时点（修复①的教训，K3 多端时会再遇到）
  - **审批挂起不响应 cancel 信号**：C5 Deferred 只认答复/超时（C50 既有语义）——取消在审批挂起时的收轮要等 approvalTimeoutMs 结算 isError 后由派发循环取消检查接管（T-P1-52 测试记档，非缺陷）
  - **vitest 全量偶发 flaky**：批次 6 执行期间出现两次"首跑 1 failed 未复现"（T-P1-48/T-P1-53 各一次，连跑 3 次全绿）——93 worker 并行下既有环境偶发（WAL/文件句柄竞态先例），非批次 6 引入面；后续批次的收口卡建议连跑 2 次确认
- **遗留风险与未知**（→ 人工确认清单批次 6 行）：
  - ~~待澄清 #8（A12 promptId 载荷扩展）~~ ✅ **已追认关闭（2026-09-27 用户："认可"）**（落地记录 9 转正，事件计数 19 不变）
  - 真实厂商端到端的 steer/取消退回回归（/steer 在真实模型的在途轮中重定向、TURN_NOT_ACTIVE 自修）——下一批真实网关实测时顺带确认
  - abortTimeoutMs 缺省 10s 是装配层决策值（kimi 同款）——CLI 参数面暴露随 CLI 批次
  - M9 的全局/会话两级上限结构、J20 的多会话 host 级准入 → K3（批次 12）
- **批次完成定义核对**：9 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 0 失效 ✓；license-audit 通过 ✓；四项展卡定形照执行 ✓；词汇表一处载荷扩展走立案 ✓；三个真实缺陷修复各有测试钉死 ✓；六面盘点结论落卡 ✓
- **下一批**：**批次 7-11 连续推进（2026-09-27 用户授权：一次做 7-11，不逐批停下确认，但必须逐批走完整流程）**——7 工具纪律与超时（13 条）→ 8 权限·规则语义与信任（12 条）→ 9 权限·审批与运行模式（9 条）→ 10 调度与会话数据工程（15 条）→ 11 上下文与模型运维收尾（11 条），合计 60 条预估 42 卡
- **下一批提示词**：

```
> **〔模式更新 2026-09-27：用户改为一会话一批次——下文原[连续推进 7-11]提示词作废，现行提示词见批次 7 报告末尾与下方批次 8 提示词〕**
继续 aegent P1 的实施。用户已授权连续推进批次 7-11（一次接续做完，不逐批
停下等确认），但跨度大不是并批的理由——仍必须逐批走完整流程、不得乱做：
1. 每批开工：先按 docs/20260926_P1剩余批次全量圈定研究.md 该批条目逐条
   锚点核对 requirements.md §4，照 plan-p1.md 批次 6 展卡先例把该批卡序
   追加进 plan-p1.md（疑似顺带覆盖先核对再定卡面），然后按 docs/plan-p0.md
   §0 协议逐卡执行：取第一个 [ ] 卡、只做该卡、验收后才打勾、一卡一 commit。
2. 每批收官：照批次 6 先例出组报告（打勾情况/产出文件/台账/词汇表/缺陷/
   偏离/坑/遗留），更新 plan-p0-progress.md 的下一批提示词与全量基线，
   然后立即进下一批——不要问要不要继续。
3. 批次顺序与各批特有注意：
   - 批次 7 工具纪律与超时（B8 残余 apply_patch/lsp + B13 B15 B16 B18 B19
     B20 B21 + I3 + M6 + J23 J24 J27）：B18 参数三档合并 + M6 工具超时 +
     J23 三种超时是同主题三面，一张卡统一定形；B20 可续跑事件与 J27
     retrying 一等事件是词汇表高风险点，每处走待澄清立案；apply_patch 与
     lsp 独立小件，lsp 依赖 workspace 语义展卡时评估是否拆期。
   - 批次 8 权限·规则语义与信任（C8 C11 C12 C13 C17 C23 C26 C34 C36 C39
     C41 C53）：C26 Tool(args) 语法是 C39 分型匹配前置；C11 项目信任 ←
     C34 trustGated 同批；C12 与 write/edit（在位）联动；C23 与 C41 疑似
     被 T-5-05/T-5-07 部分覆盖（linter 已报 never-match）——展卡先核对。
   - 批次 9 权限·审批与运行模式（C6 C19 C25 C30 C33 C37 C52 C54 C56）：
     C6 ← N6 通道（在位）；C30 ← C57（在位）；C33 ← C3 默认 ask（在位）；
     C37 IMDS 拒绝 × D3 网络策略（在位）联动小卡；C56 判官四件套不做
     判官本体先行——P2 的 C42/C55 接口面预留。
   - 批次 10 调度与会话数据工程（M1 M2 M3 M8 + E7 E8 E14 E15 E17 E18 +
     Q1 Q7 + N4 + L7 L8）：M1/M2 job 底座 → M3 崩溃续跑；M8 execution
     epoch 是 G4 遗留收口；E17/L8/N4 动事件载荷——词汇表影响最集中的批，
     展卡时逐条走立案；Q7 冷热分离注意"不影响热路径"验收口径。
   - 批次 11 上下文与模型运维收尾（F7 F8 F11 F18 F25 F26 F29 F30 + J5
     J13 J16）：F25 与 M10 windowId 概念核对（疑似部分覆盖）；F29 ←
     J6/J7+F24（在位）；J16 ← J19 熔断（在位）；J5 第二厂商选型（开放
     问题）——展卡时先在待澄清表立案建议 Anthropic（pi-mono 锚点最厚）
     供追认，用户未回前该卡保持未展、其余卡照常。
4. 上下文将满时照 plan-p0.md §0.3：出当前批次的阶段/组报告 + 更新接力
   提示词（剩余批次、基线、注意事项），不要为赶进度跳过验收或压缩流程。
5. 上批遗留已清：A12 promptId 载荷扩展已追认转正（#8 案关，19 事件）。
   全量基线 827 passed / 1 skipped。
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

| 批次 5 三件（E5/H2/H3） | **session/fork 词汇表 18→19**：事件词汇表扩展属用户裁决面（先例 13→14~17→18 五案流程）——已在待澄清 #7 立案。**真实厂商 task 回归**：task 派发/子代理行为对真实模型的遵守度（delegation 声明遵守、SUBAGENT_DEPTH_EXCEEDED 自修）未实测——O15 录制回放基建可反哺（RecordingProvider wrap 父与子代理请求面先录后测）。**plan×task 防绕过**：单测钉死（子代理写文件被 Deny broker 拒），plan 模式真机全链未实测 | **①~~session/fork 待用户追认~~ ✅ 已追认关闭（2026-09-26 用户："认可"，待澄清 #7 案关）**；②真实厂商回归在下一批真实网关实测时顺带确认 |

## 批次 5 展卡记录（2026-09-26，执行会话自展）

> 用户提示词指示：先按圈定研究批次 5 条目（E5 + H1–H5）逐条锚点核对 requirements.md §4，照 plan-p1 批次 4 展卡先例把卡序追加进 plan-p1.md，再按 plan-p0 §0 执行。**6 条锚点逐一开文件核实，零内容勘误**（pi fork-policy.ts:8-37 + session/types.ts:562-583、opencode tool/task.ts 全文 371 行、opencode agent/subagent-permissions.ts:14-27 全文、dsh subagent 包 README + run-settlement.ts + child-agent.ts；**唯一漂移 = E5 的 position 词形**：requirements 写 "before/after"、pi 当前版本为 `position?: "before" | "at"`——语义等价（切点是否包含选中条目：before=父级不含选中、at/after=含选中），我方采用 before/after 词形贴 requirements）。**两项展卡定形（研究文档 §三批次 5 要点指令）**：①**H1 = 进程内隔离 + 独立子会话**（opencode 同款——task 在同内核进程起子循环、子会话是同一 SessionStore 的新 sessionId；H6 五后端是 P2 再插进程外形态）；②**H4 = 独立新会话，E5 fork 是独立的会话分支功能**（opencode task 就是 sessions.create({parentID}) 全新会话不继承父历史；pi fork 是用户级分支操作——两者不混，E5 落数据面+元事件+协议面、H4 落 task 工具创建面）。**词汇表高影响预判**：session/fork 一处扩展（18→19）走立案；task 派发/结算与 delegation 预判零扩展（tool/call+result 承载结算、lineage 放 meta；delegation 以装配参数+系统提示重建）。**external_directory 维度**：C 族无此条目（grep 证伪），我方由 PathGuard 结构性覆盖——降级算法落"只继承 deny"，该维度注释记档不发明对应物。预估 6-7 卡实展 6 张（H1+H4 并卡、H2/H3 各一张、E5/H5 各一张、收口盘点一张）。
---

## 批次 7 展卡记录（2026-09-27，执行会话自展）

> 用户提示词指示（连续推进 7-11 的第一批）：先按圈定研究批次 7 条目（B8 残余 + B13 B15 B16 B18 B19 B20 B21 + I3 + M6 + J23 J24 J27）逐条锚点核对 requirements.md §4，照 plan-p1 批次 6 展卡先例把卡序追加进 plan-p1.md，再按 plan-p0 §0 执行。**13 条锚点逐一开文件核实，一处弱锚点勘误**（dsh timeout/index.ts 全文 190 行承载 B18/J23/J24 三条 + guard/timeout-policy 全文 81 行 M6、pi-desktop ADR 0207 全文、dsh escalation.ts 全文 186 行、codex parallel.rs:44-50、kimi engine.ts:65-88 + model-requester.ts:23-31、zcode turn-output-token-continuation.ts 全文、codex session/tests.rs:2056-2109、opencode apply_patch.ts 全文 313 行 + lsp.ts 全文 113 行 + mcp/index.ts 1004 行；**勘误 = I3**：requirements 写 app/src/context/mcp.ts 是 UI toggle hook（19 行），客户端本体在 packages/opencode/src/mcp/index.ts）。**三项展卡定形**：①超时四面（B18/J23/J24/M6）一张卡统一定形（dsh 一文件承载三条）；②J27/B20 是词汇表高风险点各走立案；③**B8b lsp 不拆期**（最小 stdio LSP 客户端单卡可落，多 server/诊断流记 LIMITATIONS）。预估 8 卡实展 11 张（超时四面合一、apply_patch/B13 相邻、B16 在 I3 前落快照安全网、收口照先例）。

---

## 批次 7 报告（完成于 2026-09-27）

- **打勾情况**：11 / 11（T-P1-55 ~ T-P1-65 全部完成，无未完成项）——**P1 批次 7 全部收官**（13 条需求 ID：B8 残余（apply_patch/lsp）/B13/B15/B16/B18/B19/B20/B21/I3/M6/J23/J24/J27 全关；**B8 五工具族就此收官**）
- **产出的文件**：
  - `src/kernel/timeout.ts` 扩库——MAX_TIMER_DELAY_MS + assertTimerDelayMs（J24 武装点过闸）+ clampTimeout 三档合并（B18）+ IdleWatchdog（J23 空闲/可重臂，arm/disarm/touch/pulse/dispose）——T-P1-55
  - `src/kernel/tools/registry.ts` 扩——ToolDef.timeoutMs（M6 dispatch 层武装，J22 code 判据不误捕）+ ToolDef.descriptionText（MCP 内联描述）+ runtimeMeta 快照源 + ToolDispatchCall.runtimeMeta——T-P1-55/59/64
  - `src/kernel/tools/builtin/apply-patch.ts` + 描述文件 + 测试/快照——V4A 解析器 + deriveUpdatedLines 纯函数 + 两阶段执行（验证先行零半态）——T-P1-56/65
  - `src/kernel/tools/mutation-budget.ts` + 测试——MutationRetryBudget（promptId×path 双键、per-code 宽限、成功清空、3 次 terminate）——T-P1-57
  - `src/sandbox/escalation.ts` + 测试——WIDER_MODES 阶梯表 + ESCALATION_TARGETS 封闭词汇 + 配对校验 + 严格更宽校验——T-P1-58
  - `src/policy/protected-paths.ts` + `self-guard.ts` 扩——extractPatchWritePaths 前缀扫描器（apply_patch 通道）+ 两出口各加分支 + WRITE_EXECUTE_TOOLS +apply_patch——T-P1-56
  - `src/sandbox/path-guard.ts` 扩——remove()（delete/move 的守卫唯一入口）——T-P1-56
  - `src/kernel/loop.ts` 扩——mutationBudget 接线（reportMutationOutcome + 收尾 blocked 收轮）+ stepToolMeta 快照（parallel/timeoutMs 固化）+ callModel 计时与 traceId 分配器 + OUTPUT_TOKEN_LIMIT_FINISH_REASONS 触顶续跑（runStep continue kind）——T-P1-57/59/61/62
  - `src/kernel/tools/builtin/lsp.ts` + `src/lsp/client.ts` + 测试——9 操作闭集 + 最小 LSP 客户端（Content-Length 分帧/握手/id 配对/LSP_TIMEOUT）——T-P1-60
  - `src/kernel/events.ts` 扩——AssistantRetryingEvent（19→20）+ StepEndEvent.timing/traceId + StreamChunk done.finishReason——T-P1-61/62
  - `src/kernel/agent-child.ts` + `agent-process.ts` 扩——onRetry 桥接观察者（registerRetryObserver hooks + 落流 idle 守卫）——T-P1-61
  - `src/models/openai-compat.ts` 扩——finishState 捕获 wire finish_reason → done 携带——T-P1-62
  - `src/kernel/session-config.ts` + 测试——SessionConfigStore（白名单热刷新/静态整包拒绝）——T-P1-63
  - `src/mcp/client.ts` + `registry-bridge.ts` + 测试——最小 stdio JSON-RPC MCP 客户端（握手/能力检测/分页/调用）+ 命名空间化注册桥——T-P1-64
  - `src/kernel/tools/builtin/index.ts` 扩——BUILTIN_TOOL_NAMES 15→17（apply_patch/lsp）+ bash 三档与沙箱选项 + lspClientFor 选项——T-P1-55/56/58/60
  - `docs/l0-events.md`——§3.2 assistant/retrying 行 + §8 落地记录 10/11（含不追认回退面）——T-P1-61/62
- **验收台账**：11 卡 11 命令全部通过（见台账表）；全量 `npx vitest run` **906 passed / 1 skipped**（批次 6 收官 827 → 净增 79），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 548 链接 0 失效、`license-audit.sh` exit 0
- **词汇表扩展**：**三处全部走立案**——①新事件 assistant/retrying（19→20，落地记录 10 + 待澄清 #9）；②step/end 载荷扩展 timing/traceId（并入 #9）；③StreamChunk done.finishReason（落地记录 11 + 待澄清 #10）。**两案待用户追认，追认前正式口径按"已落流、未转正"（20 事件）**。研究文档"中影响"预判命中。
- **两个真实缺口在实现/测试中被抓出并修复**（本批质量亮点）：
  1. **T-P1-56**：C46 出口硬拦与 C35 自我修改防线只看 write/edit 的 args.path——**apply_patch 的目标路径藏在 patchText 里可绕过 .git/AGENTS.md 保护** → policy 侧新增 extractPatchWritePaths 前缀扫描器（与 bash 虚拟写目标扫描同位，不 import 工具层解析器避免 policy→kernel 反向依赖），enforceProtectedPaths 与 enforceSelfGuard 各加分支，扫描器与解析器前缀集对齐由测试钉死
  2. **T-P1-57**：B13 的"成功清空该路径失败历史"依赖**成功结果也携带 mutationPaths**（初版只有失败带）——工具层成对补齐（edit 成败都带、apply_patch 成功汇总带全部涉及路径）
- **偏离计划的地方**（逐卡详见卡面完成记录）：
  1. **T-P1-55**：bash"无默认档且无提示 = 不武装"语义保持（不把上限值展开传 env——2^31-1 秒换毫秒顶到 setTimeout 可靠上限即 J24 陷阱）；参数校验面保持 isError 分层（T-4-03 验收不破坏，clampTimeout 的 throw 用于装配级编程错误）
  2. **T-P1-56**：匹配容错落三级（exact/rstrip/trim，Unicode 归一化级不落——中文误伤风险）；update 区段非 @@ 变更行构成**隐式 chunk**（V4A 宽松语义；opencode 把无 @@ 行静默丢弃是缺陷不取）；PathGuard 加 remove()（删除面守卫唯一入口）
  3. **T-P1-58**：现状核对发现批次 3 的 SandboxBackend 未接入 bash 执行路径——本卡顺势补接线（bashSandbox 装配选项 + backend.spawn 替代 env）；PathGuard 红线不破（升级放宽的是沙箱模式非工作区边界）；CLI 装配默认不启用（零行为变化）
  4. **T-P1-60**：工具内按需自动 initialize（装配面不需要先行握手）；传输抽象分离帧读写与进程管理（测试注入内存桩）
  5. **T-P1-62**：触顶续跑不经 decideTurn（内核护栏行为——默认"无工具即 end"正是 B20 要防的"结束回合"）
  6. **T-P1-64**：MCP stdio 是 newline 分帧（与 LSP Content-Length 不同）独立实现；ToolDef 加 descriptionText（MCP 描述内联，builtin 走 txt 不变）；CLI --mcp 装配接线留多端批次
- **新发现的约束或坑**：
  - **批次 3 遗留接线缺口**：SandboxBackend（D5）一直未接入 bash 执行路径（env 直通）——T-P1-58 顺势补上，CLI 默认不启用；后续 K3/多端批次暴露 CLI 参数面时需复查
  - **MCP/LSP 的协议面手写最小闭环**：MCP sampling/resources/prompts/HTTP transport、LSP 多 server/诊断流/watch 同步都记 LIMITATIONS——真语言 server E2E 依赖环境，桩 server 钉协议面
  - **vitest 全量偶发 flaky 持续**：本批又现 3 次"首跑 1-2 failed 未复现"（http-mock/llm-replay 各形态），复跑全绿——延续批次 6 记档，收口卡连跑确认
- **遗留风险与未知**（→ 人工确认清单批次 7 行）：
  - ~~待澄清 #9（assistant/retrying 19→20 + step/end timing/traceId）~~ ✅ **已追认关闭（2026-09-27 用户："待澄清表认可"）**（落地记录 10 转正，正式计数 20 事件）
  - ~~待澄清 #10（StreamChunk done.finishReason）~~ ✅ **已追认关闭（2026-09-27 用户："待澄清表认可"）**（落地记录 11 转正）
  - J23 IdleWatchdog 的生产消费面暂缺（流式模型请求空闲检测是原生场景，provider 层无此消费点——库就位等消费者）
  - B21 消费面接线（ManualPermissionBroker/question 的 timeoutMs 动态读 configStore）留白名单扩展批次（T-P1-63 偏离③）
  - bashSandbox/registerMcpServers 的 CLI 装配选项暴露随 CLI/多端批次
  - MCP/LSP 真实 server 的环境级 E2E（TS server 等）未实测——桩 server 钉协议面
- **批次完成定义核对**：11 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 0 失效 ✓；license-audit 通过 ✓；超时四面一张卡 ✓；词汇表三处扩展走立案 ✓；两个真实缺口修复各有测试钉死 ✓；六面盘点 + apply_patch 快照 ✓；B8 五工具族收官 ✓
- **下一批**：**批次 8 权限·规则语义与信任（12 条：C8 C11 C12 C13 C17 C23 C26 C34 C36 C39 C41 C53）**——立即开工（用户授权连续推进 7-11）
- **下一批提示词**：

```
继续 aegent P1 批次 8 的实施（权限·规则语义与信任）。推进模式已改：
**一会话一批次**——本会话只做批次 8，做完收官即停，批次 9 由下一会话
接力。批次 8 已展卡（2026-09-27 本会话完成锚点核对与卡序落卡）：读
docs/plan-p1.md 的批次 8 卡序（9 张 T-P1-66 ~ 74，执行协议沿用
docs/plan-p0.md §0），从第一张 [ ] 任务卡开始。上一批（批次 7）报告在
docs/plan-p0-progress.md。本批特有的注意：
1. 展卡核对结论已落卡序头：C41 已被 T-5-05 覆盖关闭（不占卡，12 条中
   11 条实卡）；C23 补两类（wildcard-tool-name / incomplete-namespace）；
   C26 是 P0 形状正式化（qwen parseRule 同构）；C36 注释纪律升冻结机制；
   C11+C34 成对（信任降权出口级 + trustGated 每次读当前信任）；C12+C13
   成对（ReadGate 可选装配）；C8 落 SessionConfigStore 预设目录。
2. 词汇表一处扩展（C17 泛型逃生舱 plugin 事件 20→21）走待澄清 #11 立案；
   #9/#10/#11 三案待用户一并追认——继续[已落流、未转正]口径，不改正式
   计数语义。
3. 权限出口族红线：C11 信任降权在出口级（规则不可授权）；C36 清单只追加；
   C13 ReadGate 可整体丢弃（不装 = 工具照常）；C39 path 分型是 gitignore
   风格 glob（手写不引 picomatch，wildcardMatch 不动）。
4. 批次 7 遗留两处既有待追认（#9/#10）——若用户已追认，先在 progress 的
   待澄清表标关闭再开工。
5. 收官照批次 7 先例出组报告（打勾情况/产出文件/台账/词汇表/缺陷/偏离/
   坑/遗留），更新本文件的批次 9 提示词与全量基线后停止——不要开始批次 9。
全量基线 906 passed / 1 skipped。
```

---

## 批次 8 展卡记录（2026-09-27，执行会话自展——本会话只展卡，执行留下一会话）

> 用户在批次 7 收官后改为**一会话一批次**模式。本会话完成了批次 8 的展卡（锚点核对 + 卡序落卡 + 提交），未执行任何批次 8 任务卡——执行从下一会话开始（提示词见上方批次 7 报告末尾）。**12 条锚点逐一开文件核实，零内容勘误**（qwen rule-parser.ts parseRule/getSpecifierKind/types.ts 四值 + permission-manager.ts trustGated 过滤段 + trusted-user-answers.ts 有界常量、pi project-trust.ts 全文 + session/types.ts CustomEntry、dsh permission-presets/index.ts + file-context-as-event-gate.md 全文、kimi evaluate.ts:85-106、codex execpolicy/parser.rs:455-461）。**展卡核对结论（我方现状 × 12 条，详见 plan-p1.md 卡序头）**：C41 已被 T-5-05 覆盖关闭不占卡；C23 补两类；C26 P0 形状已在正式化；C36 注释升机制；C12/C13 配对（ReadGate 可选装配）；C11+C34 成对；C8 落 SessionConfigStore。**词汇表预判**：C17 泛型逃生舱一处（plugin 事件 20→21 走 #11 立案），其余零扩展。9 张：T-P1-66（C23）→ 67（C26）→ 68（C39+C53）→ 69（C11+C34）→ 70（C36）→ 71（C12+C13）→ 72（C17）→ 73（C8）→ 74（收口）。

---

## 批次 8 报告（完成于 2026-09-27）

- **打勾情况**：9 / 9（T-P1-66 ~ T-P1-74 全部完成，无未完成项）——**P1 批次 8 全部收官**（12 条需求 ID：C41 展卡核对关闭不占卡 + C8/C11/C12/C13/C17/C23/C26/C34/C36/C39/C53 共 11 条实卡全关）
- **产出的文件**：
  - `src/policy/linter.ts` 扩——wildcard-tool-name / incomplete-namespace-name / empty-value-pattern / basename-unanchored 四类 + findInactiveRuleToolName(s) 导出（C23/C53/C26）——T-P1-66/67/68
  - `src/policy/linter.test.ts` 新建——五类判据 + C53 用例（T-P1-66/68）
  - `src/policy/rule-loader.ts` 升——C26 正式解析器（三态/legacy `:*` 展开/literal key:value/plainSpecifier/raw 原文权威）+ loadedRuleMatch 分型路由（MCP 带 specifier 拒配）——T-P1-67/68
  - `src/policy/specifier-kinds.ts` 新建 + 测试——SpecifierKind 四值闭集 + getSpecifierKind + matchGitignorePath（手写 gitignore 风格）+ matchDomainPattern（host 后缀）+ matchLiteralSpecifier + 三 matcher——T-P1-68
  - `src/policy/matchers.ts` 扩——builtinRuleMatchers 注册 path/domain（C44 样例校验面）——T-P1-68
  - `src/policy/project-trust.ts` + 测试 + 快照新建——TrustState 三值 + ProjectTrustService（isTrusted 每次读当前状态）+ enforceTrustGate 出口（C11/C34）——T-P1-69/74
  - `src/policy/review-decision.ts` 扩——ApprovalScopeCache trustGated 维度 + session-approval trustState 活查询——T-P1-69
  - `src/policy/protected-names.ts` / `self-guard.ts` 扩——两清单 Object.freeze + extendProtectedNames 唯一追加入口（C36）——T-P1-70
  - `src/kernel/tools/builtin/question.ts` 扩——MAX_USER_HINT_LENGTH=200 截断 + onWarn + meta 留痕——T-P1-70
  - `src/policy/read-gate.ts` + 测试新建——ReadGateService（recordRead/forget/requireRead + EDIT_WITHOUT_READ/EDIT_STALE_READ）——T-P1-71
  - `src/kernel/tools/context.ts` / `registry.ts` / `builtin/{read,write,edit,apply-patch}.ts` 扩——ToolContext +readGate 键（env.test 键封闭同步）+ 四工具记账/校验接线（C12/C13 可选装配）——T-P1-71
  - `src/kernel/events.ts` / `session/project.ts` / `kernel/invariants.ts` 扩——词汇表 20→21：`plugin {namespace, payload?}`（C17 泛型逃生舱，log-only 会话级元事件）+ C16 闸门同步——T-P1-72
  - `src/kernel/session-config.ts` 扩——PERMISSION_PRESETS 闭集（readonly/workspace/yolo）+ applyPreset（经 refresh 通道）+ UnknownPresetError + sandboxMode 观测 knob（C8）——T-P1-73
  - `src/cli/repl.ts` 扩——/preset 命令（config/refresh 通道）+ config_refreshed 回执渲染——T-P1-73
  - `src/kernel/assembly.ts` / `agent-process.ts` 扩——trustService/readGate 装配选项接线——T-P1-69/71
  - `docs/l0-events.md`——§3.2 计数 21 + 第 21 行 + 落地记录 10/11/12 转正落款——T-P1-72 + #9/#10 追认
- **验收台账**：9 卡 9 命令全部通过（见台账表）；全量 `npx vitest run` **957 passed / 1 skipped**（批次 7 收官 906 → 净增 51），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 838 链接 0 失效、`license-audit.sh` exit 0
- **词汇表扩展**：**一处**（`plugin` 泛型逃生舱 20→21，落地记录 12 + 待澄清 #11）。#11 的口径已闭环（2026-09-27）：执行会话按用户开工表态"待澄清表认可然后继续"解读为三案一并追认并先行转正，**会话末用户"认可转正"复核确认**——解读获得追认，21 事件为正式计数（#9/#10 落地记录 10/11 同批转正）。
- **六面盘点零真冲突**（T-P1-74 完成记录全文）：①出口族次序终局清单（C46→C49→C35→G7→C11，全"最严压过一切"、语义域正交）；②ReadGate/B13/D15 失败三源分域（ReadGate 失败计预算——防"反复不读先改"循环的定形）；③解析器与匹配器职责边界（纯函数管道）；④trustGated 与轮级生命周期正交（工具粒度生效）；⑤C17×C15 双向钉死（唯一槽位 + ghost 恒拒 + C16 闸门）；⑥项目信任降权全链快照一条。
- **新发现的约束或坑**：
  - **块注释里的 `*/` 字面量**：specifier-kinds.ts 头注释写 `` `**/` `` 触发 TS 块注释提前终结（语法雪崩）——文档注释描述 glob 语法时避免 `*/` 序列。
  - **policy 纯函数纪律的兑现**：ReadGateService/matchGitignorePath 全部零 I/O（哈希由工具传入、路径纯字符串形状）——"策略层不做 I/O"（dsh 关键决策）在落地时显著降低了接线成本。
  - **既有 fail-closed 语义的收窄是行为变化**：分型路由后已知工具的带参规则从"永不命中"变"按分型语义命中"（write/read 等不再 fail-closed）——write 可样例校验/可提案为功能增强，相关既有测试同步更新（rule-loader/review-decision/self-guard 三处）。
- **偏离计划的地方**：逐卡详见卡面完成记录（T-P1-67 偏离①完整四分型预置防盘符误解析、③纯 key:value 的 argPattern 保留原文形防 fail-closed 旁路；T-P1-68 路由键用 call.tool；T-P1-69 warn 走 onWarning 通道；T-P1-71 子代理不传 readGate、move 目标不校验；T-P1-73 预设目录单 knob——dsh approvalPolicy 无对应执行面不发明）。
- **遗留风险与未知**（→ 人工确认清单批次 8 行）：
  - trustGated 批准的**打标来源**缺位：机制在位（cache.record {trustGated}），但当前无"仓库自带配置"加载器来打标——随仓库规则加载批次落位
  - sandboxMode 观测 knob 的**消费面接线**（bash bashSandbox.defaultMode 动态读）随消费面批次（T-P1-63 偏离③同款）
  - readGate/trustService 的 **CLI 装配选项暴露**随 CLI/多端批次；子代理 subRegistry 不传 readGate（可选装配不含子代理，已记档）
  - #11 转正的解读（上文 ⚠️）待用户复核——回退面 1.5 小时可执行
- **批次完成定义核对**：9 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 0 失效 ✓；license-audit 通过 ✓；C41 核对关闭 ✓；词汇表 21 事件（三案转正）✓；出口族红线三条 ✓；六面盘点落报告 ✓
- **下一批**：**批次 9 权限·审批与运行模式（9 条：C6 C19 C25 C30 C33 C37 C52 C54 C56）**——未展卡，下一会话先展卡（锚点核对 + 卡序落 plan-p1.md）再执行，做完收官即停
- **下一批提示词**：

```
继续 aegent P1 批次 9 的实施（权限·审批与运行模式；9 条需求 ID：C6 C19
C25 C30 C33 C37 C52 C54 C56）。推进模式已改：一会话一批次——本会话只做
批次 9，做完收官即停，批次 10 由下一会话接力。批次 9 尚未展卡：先照批次
7/8 展卡先例逐条锚点核对 requirements.md §4（把卡序追加进 docs/plan-p1.md，
展卡核对结论落卡序头），再从第一张 [ ] 任务卡开始执行（执行协议沿用
docs/plan-p0.md §0）。上一批（批次 8）报告在 docs/plan-p0-progress.md。
本批特有的注意：
1. 展卡核对预判（批次 8 报告遗留）：C6 ← N6 审批通道（在位）；C30 ←
   C57（在位）；C33 ← C3 默认 ask（在位）；C37 IMDS 拒绝 × D3 网络策略
   （在位）联动小卡；C56 判官四件套不做判官本体先行——P2 的 C42/C55
   接口面预留。展卡时先核对再定卡。
2. 词汇表预判低影响——每处新增事件/载荷扩展仍走待澄清立案管线；词汇表现为
   21 事件（#9/#10/#11 三案 2026-09-27 全部转正，其中 #11 经用户"认可转正"
   复核确认），新案照旧立案供追认。
3. 权限红线延续：出口级语义（C46/C35/G7/C11）已终局（批次 8 盘点①），
   新出口面须并入该清单；ReadGate 失败计 B13 预算的定形延续。
4. 全量基线 957 passed / 1 skipped。收官照批次 8 先例出组报告，更新
   本文件的批次 10 提示词与全量基线后停止——不要开始批次 10。
```


## 批次 9 报告（完成于 2026-09-27）

- **打勾情况**：10 / 10（T-P1-75 ~ T-P1-84 全部完成，无未完成项）——**P1 批次 9 全部收官**（9 条需求 ID：C6/C19/C25/C30/C33/C37/C52/C54/C56 全实卡 + 收口卡；本会话自展卡——9 条锚点逐一开文件核实**零内容勘误**——再执行，一会话一批次模式兑现）。逐卡验收命令与结果见 `plan-p1.md` 各卡「完成记录」。
- **展卡结论**：批次 8 报告遗留的 5 条预判全部成立——C6 ← N6 通道在位（owner-port respond_permission 闭集）；C30 守卫重跑 ← C57 在位（revalidate）；C33 ← C3 默认 ask 在位（不变量 3）；C37 × D3 网络策略联动（NetworkGuard 唯一入口在位）；C56 判官四件套不做本体先行（C42/C55 接口面已备，假判官测试承载验收）。
- **产出的文件**：
  - `src/policy/gate.ts` 扩——evaluateToolPolicy 独立求值函数（C19 dry-run 面）+ enforceExitFamily 出口族唯一实现位（三处消费：执行/dry-run/modifiedInput 重跑）+ 激活检查首步（C25）+ unattended 转换（C33）+ 判官复核（C56）+ modifiedInput 应用（C52）+ category 打标（C54）——T-P1-75/76/77/78/79/80
  - `src/policy/tool-activation.ts` + 测试新建——四层 {enabled?, disabled?} AND 激活层 + isToolActiveComposed（kimi 同名意图）——T-P1-76
  - `src/policy/judge-port.ts` + 测试新建——JudgePort 三值闭集（abstain 显式）+ JUDGE_INPUT_BUDGET_CHARS/JUDGE_REQUESTS_PER_SESSION 双面预算 + JudgeBudgetTracker + JUDGE_REVIEW_TIMEOUT_MS=90s（刻意宽松理由注释）+ JudgeUnavailableError——T-P1-80
  - `src/policy/pending.ts` 扩——ApprovalCategory 五类闭集（tool/question/task/elicitation/hook-review）+ category 必填 + 关类自动拒绝（APPROVAL_CATEGORY_CLOSED，settled 宣告+墓碑）+ ApprovalReply +modifiedInput/source + ApprovalAnswer 类型（Verdict & modifiedInput）+ ApprovalReplyMalformedError——T-P1-78/79/82
  - `src/policy/audit-fields.ts` 扩——ApprovalAuditRecord +replySource（C6 答复端审计）——T-P1-82
  - `src/sandbox/network.ts` 扩——IMDS_HOSTS 四主机闭集 + isImdsTarget（IPv6 方括号 + 链路本地前缀）+ NetworkImdsDeniedError + guard.fetch 黑名单面（独立于档位，URL 解析失败 fail-closed）——T-P1-83
  - `src/kernel/tools/builtin/webfetch.ts` 扩——NetworkImdsDeniedError instanceof 分支透传类型化 code——T-P1-83
  - `src/kernel/agent-protocol.ts` 扩——AgentRequest +policy/check、+approve modifiedInput/source；AgentMessage +policy_verdict、+approval_requested category——T-P1-75/79/82
  - `src/kernel/agent-process.ts` 扩——policy/check 分支（dry-run 裁决回执不落流）+ approve 透传 + unattended 活查询接 configStore（configStore 构造前移）——T-P1-75/77/79/82
  - `src/kernel/assembly.ts` 扩——policyEvalOptions 产物（C19 同链保证）+ activation/unattended 装配选项 + handleApprove 尾参 modifiedInput/source——T-P1-75/76/77/79/82
  - `src/kernel/session-config.ts` 扩——REFRESHABLE_CONFIG_KEYS +unattended（布尔 knob）+ getter——T-P1-77
  - `src/session/owner-port.ts` 扩——OwnerCommand +respond_permission_batch（C30 批量闭集扩展）+ BatchDecisionResult 逐项结果 + requestOwnerCommand 返回 Promise<unknown>——T-P1-81
  - `src/cli/repl.ts` 扩——/check（dry-run 端到端）+ /unattended on|off（config/refresh knob）+ /approve --args（modifiedInput）+ policy_verdict 渲染 + approval_requested 帮助行同步——T-P1-75/77/79
  - `src/policy/approval-cross-surface.snapshot.test.ts` 新建——场景③跨端回转全链快照 + 反例——T-P1-84
- **验收台账**：10 卡 10 命令全部通过（plan-p1.md 卡面完成记录）；全量 `npx vitest run` **1019 passed / 1 skipped**（批次 8 收官 957 → 净增 62），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 1061 链接 0 失效（显式传参全量）、`license-audit.sh` exit 0
- **词汇表扩展**：**零**（21 事件不变——审批/问答面全部经 PendingApprovals 宣告回调与协议消息承载，不进事件流；协议面载荷扩展（policy/check、policy_verdict、approval_requested+category、approve+modifiedInput/source）属协议消息形状，随卡同步 decode 校验并记档）。展卡预判兑现。
- **七面盘点零真冲突**（T-P1-84 完成记录全文）：①dry-run × C57（同函数不同调用点——查询面 vs 执行面）；②激活失败/拒绝/无人值守三档语义分域与终局检查次序（激活首步→求值→出口族→unattended→判官→broker，四类错误码正交可路由）；③关类 × C3（配置面覆盖 ask 结局，关的是"问"不是"允许"，不变量 3 保持）；④modifiedInput × 五出口族（**出口族清单演进：串联提取 enforceExitFamily 唯一实现位，今后任何出口级硬拦必须进该函数**——结构性防止新出口面漏接重跑）；⑤判官 × unattended 组合次序定形（无人值守时判官复核不发生——判官 allow 会绕过无人值守语义）；⑥C37 黑名单 × D3 档位（防护面独立于策略面，双层网络语义）；⑦场景③跨端回转全链快照一条。
- **新发现的约束或坑**：
  - **heredoc 中文内容经 bash cat 追加大段文档会被截断**（Git Bash 环境）：卡序落盘时 heredoc 警告"delimited by end-of-file"且只写入一半——改用 Write 工具写临时文件再 cat 拼接可靠；同理测试代码含模板字符串/反引号时 heredoc 有转义风险，python 注入或 Edit 工具更稳。
  - **类型必填字段演进的编译器驱动面**：ApprovalRequest.category 落必填后 tsc 一次性列出全部发起面（含 bash.ts 沙箱升级审批这一非显性调用方）——"必填 + 编译器枚举"比"可选字段 + 文档约定"更能防漏打标。
  - **协议回执的专用变体纪律**：dry-run 裁决不落事件流（不是状态变更）——config_refreshed 同款专用回执变体（policy_verdict）是正确落法，复用 event 通道会在历史里留下从未发生过的裁决。
  - **门面重复声明笔误**：agent-protocol.ts 的 `reverted` 变体存在相邻重复声明（历史笔误，联合类型允许不报错）——已文字记档（T-P1-75 偏离④），不在功能卡顺手改（AGENTS.md §4），待后续清理批次。
- **偏离计划的地方**：逐卡详见卡面完成记录（T-P1-75 协议双变体扩展 + abstain≠ask 回执口径统一映射"ask"；T-P1-76 wildcardMatch 替代 picomatch + 激活/dry-run 两面分离；T-P1-77 unattended 走 config/refresh knob 不新增协议命令；T-P1-78 category 必填 + 关类留墓碑；T-P1-79 ApprovalAnswer 不污染 Verdict + deny 携带类型化拒绝；T-P1-80 race 超时按 abstain 语义；T-P1-81 requestOwnerCommand 放宽返回 + fallback 双通道；T-P1-82 source 自由文本不进 surface 闭集；T-P1-83 collaborator 不可枚举记档 + 解析失败 fail-closed）。
- **遗留风险与未知**（→ 人工确认清单批次 9 行）：
  - C54 分类开关的**配置面暴露**：PendingApprovals 构造参数已备（categoryConfig），assembly/CLI 的用户配置接线随真实配置需求（YAGNI 记档）；elicitation/hook-review 两类预留无发起方
  - C56 判官预算的**装配级持久记账**：judgeBudget 缺省每次调用新建临时记账（无跨调用累积）——会话级持久记账随 C42 本体批次（P2）
  - C37 的 **bash/curl 面**与 **DNS 重绑定**不在本卡（OS 层 D16 在位 / 无 DNS 管线，卡内记档为已知边界）；collaborator 式回调服务不可枚举
  - C30 的**协议批量变体**（approve_batch）未落——N6 进程内闭集已备，CLI 批量 UI 随真实需求
  - C6 的**多端并发 holder**（N7 roster）与 lease 移交间隙的审批可见性——批次 12 多端架构承载
  - agent-protocol.ts **reverted 变体重复声明**笔误（待清理批次顺手修）
- **批次完成定义核对**：10 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 1061 链接 0 失效 ✓；license-audit 通过 ✓；词汇表零扩展（21 事件不变）✓；出口族红线（C52 重跑 + enforceExitFamily 唯一实现位纪律）✓；审批语义分域落报告 ✓；七面盘点零真冲突 ✓
- **下一批**：**批次 10 调度与会话数据工程（15 条：M1 M2 M3 M8 + E7 E8 E14 E15 E17 E18 + Q1 Q7 + N4 + L7 L8）**——未展卡，下一会话先展卡（锚点核对 + 卡序落 plan-p1.md）再执行，做完收官即停
- **下一批提示词**：

```
继续 aegent P1 批次 10 的实施（调度与会话数据工程；15 条需求 ID：M1 M2
M3 M8 + E7 E8 E14 E15 E17 E18 + Q1 Q7 + N4 + L7 L8）。推进模式已改：
一会话一批次——本会话只做批次 10，做完收官即停，批次 11 由下一会话
接力。批次 10 尚未展卡：先照批次 7/8/9 展卡先例逐条锚点核对
requirements.md §4（把卡序追加进 docs/plan-p1.md，展卡核对结论落卡序
头），再从第一张 [ ] 任务卡开始执行（执行协议沿用 docs/plan-p0.md §0）。
上一批（批次 9）报告在 docs/plan-p0-progress.md。
本批特有的注意：
1. 依赖预判（圈定研究）：M1/M2 job 底座 → M3 崩溃续跑（同批内依赖
   序）；M8 epoch ← G4 遗留收口（T-P1-13 的 plan artifact 重启不重放）；
   E15 合并器 ← E3（在位）；Q1 迁移链 ← E2 在位 + O19 迁移断言基建
   （T-P1-36 已落"真实 v0→vN 迁移链批次 10 Q1 落地"的消费方记档）；
   N4 epoch 为批次 12 多端打底。
2. 词汇表影响预判"中"——E17 中间态事件、L8 compaction 载荷扩 6 维、
   N4 epoch 载荷三处候选；每处新增事件/载荷扩展仍走待澄清立案管线
   （词汇表现为 21 事件，#9/#10/#11 三案已全部转正），新案照旧立案供
   追认；批次 9 零扩展（协议面载荷扩展不进事件流的先例可参考）。
3. 展卡注意：M8/G4 遗留与 Q1/O19 消费记档是本批两条"接旧账"线——
   展卡时先核对 plan-p1.md 对应卡的遗留记档再定卡。
4. 全量基线 1019 passed / 1 skipped。收官照批次 8/9 先例出组报告，
   更新本文件的批次 11 提示词与全量基线后停止——不要开始批次 11。
```

---

## 批次 10 报告（完成于 2026-09-27）

- **打勾情况**：14 / 14（T-P1-85 ~ T-P1-98 全部完成，无未完成项）——**P1 批次 10 全部收官**（15 条需求 ID：14 条实卡承载 + N4 展卡核对关闭不占卡；本会话自展卡——15 条锚点逐一开文件核实**零内容勘误**——再执行，一会话一批次模式兑现）。逐卡验收命令与结果见 `plan-p1.md` 各卡「完成记录」。
- **展卡结论**：15 条锚点全部命中（dsh jobs JobRegistry/codex daemon_recovery/pi-desktop ADR 0041+0053/kimi transcript+sessionIndex+sessionExport+engine/zcode coalescer+session.events/dsh event-sourced+command-log+session-format chain/codex compression+facts/pi types/dsh migrate 链）。**N4 展卡核对关闭**（C41/L10/M5 先例）："seq 由 store 分配、调用方不提供"已由 `NewSessionEvent = DistributiveOmit<SessionEvent, "seq"|"ts">`（events.ts:570）+ store 分配 + T-1-02 断言 100% 承载（pi NewEntry Omit 同构）；epoch 自研面由 T-P1-87（M8）落地。两条接旧账线核对成立：M8 ← T-P1-13"epoch 留后续批次"记档；Q1 ← T-P1-36"真实迁移批次 10 落地"消费记档——均兑现关闭。
- **产出的文件**：
  - `src/kernel/jobs.ts` + 测试——JobRegistry（M1/M2：start 即返回零阻塞、JobStatus 五值含 stopping 中间态、ring 游标读 lossy、kill 二值回执、wait/onSettled）
  - `src/session/epoch.ts` + 测试——ExecutionEpoch（M8：boot fresh 8-hex、不序列化 grep 证伪、分代句柄编码、JOB_EPOCH_STALE 过期代五入口拒绝）
  - `src/session/boot-maintenance.ts` 扩——findInterruptedTurn（M3：最新 interrupted 轮定位 + 原输入含 promptId）
  - `src/agent-protocol/agent-process` 扩——session/resume 请求 + resumed 回执 + startTurn 提取（M3）；command/run、command/done 落流 case（L7）
  - `src/cli/repl.ts` 扩——/resume 命令 + resumed 渲染（M3）；命令生命周期记录面（L7：run 前置/done 结算/未知命令 error）
  - `src/session/coalescer.ts` + 测试——coalesceEvents 纯函数 + PROGRESS_RULE + foldCoalesced（E15）；messages.ts buildChatMessages 接线
  - `src/session/migrate.ts` + 测试——相邻迁移注册表 + planMigrationChain fail-closed + 真实 v1→v2（Q1）；db.ts 链式迁移 + session_index 表 + 随写维护 + readSessionIndex
  - `src/kernel/raw-chunk-log.ts` + 测试——RawChunkLog JSONL 诊断面（E14；D9 掩码；正常/异常两路落盘；loop/agent-child 接线）
  - `src/session/log-archive.ts` + 测试——compressColdLogs + 运行标记防重叠 + readMaybeCompressed 透明读 + spawn worker（Q7；zstd 内置探测零依赖）
  - `src/kernel/events.ts` 扩——CompactionEvent 六维（L8）+ TurnEndEvent.produced（E18）+ CommandRun/CommandDoneEvent（L7，词汇表 21→23）
  - `src/context/compaction.ts` 扩——六维填充 + started/failed 两段化（E17）+ eventPhaseOf
  - `src/context/new-window.ts` 扩——切换权威只认 completed（E17）
  - `src/session/project.ts` 扩——compaction 六维值域闭集 + command 事件校验 + 投影 status/status 记录
  - `src/obs/compaction-stats.ts` + 测试——六维分列统计 + failures 归因（L8）
  - `src/session/transcript.ts` + 测试——结构化检视面纯函数（E7；入边证伪）
  - `src/session/export.ts`、`src/session/session-index.ts` + 测试——自包含导出 + 索引读面/重建恒等（E8）
  - `src/context/compaction.snapshot.test.ts` 扩——压缩三态全链快照两条（T-P1-98 收口⑦）
- **验收台账**：14 卡 14 命令全部通过（plan-p1.md 卡面完成记录）；全量 `npx vitest run` **1081 passed / 1 skipped**（批次 9 收官 1019 → 净增 62），`npx tsc --noEmit` 全程干净；`count-features.sh` = 310 不变、`check-doc-links.sh` 865 链接 0 失效（显式传参全量）、`license-audit.sh` exit 0（du 大仓扫描慢——环境性非脚本变化）
- **词汇表扩展**：**21→23**（command/run、command/done 两新事件——L7）+ 三处载荷扩展（compaction 六维 trigger/phase/implementation/strategy/status、turn/end produced——事件计数内）。四案全部立案并经用户 2026-09-27"认可"追认转正（#12~#15），回退面齐备；展卡预判"中"兑现（四案 vs 预判 E17/L8/N4/L8——N4 零扩展关闭、E17 复用 status 零新事件低于预判）。
- **七面盘点零真冲突**（T-P1-98 完成记录全文）：①M3 显式 resume × M8 重启不重放（显式动作 ≠ 自动重放）；②M8 epoch × N4 seq（进程代与流内序作用域互斥）；③E17 started/failed × 新窗口切换（事实记录与消费裁决分层）；④L7 command × L2 审计 × session/revert（一条命令三类事实互补）；⑤Q7 压缩 worker × E13 热路径（冷文件族白名单 + 标记防重叠）；⑥Q1 迁移链 × restore 闸门（版本闸门与类型闸门方向性正交）；⑦压缩三态全链快照两条即规格。
- **新发现的约束或坑**：
  - **compaction 两段化的事件数语义**：1 次压缩 = started + completed 两条事件——所有"取第一条 compaction"的既有断言需换 settledCompaction 口径（completed/缺省）；E16 seq 连续性校验拒绝折叠流——foldCoalesced 视图内重编号（seq 位移是位置序非事实序）。
  - **联合 Omit 陷阱重现**：`Omit<SessionEvent, "seq"|"ts">` 丢判别字段——测试夹具一律用 `NewSessionEvent`（DistributiveOmit）。
  - **better-sqlite3 INSERT...SELECT...ON CONFLICT**：upsertIndex 曾疑似解析问题，实测 SQL 本身正确——问题在 write-behind（appendBatch 在 flush 时点才跑，测试忘 flush）——"索引 stale"排查先查 flush 时点。
  - **SessionStore.flush 时点纪律**：涉及落库后断言（索引/行数）的测试必须 await flush——内存序与库序的时间差是 E13 契约不是 bug。
  - **Windows 实测两则**：Node 22.19 内置 zstd（22.15+ API）——零新依赖；renameSync 覆盖已存在文件 OK（MoveFileEx REPLACE_EXISTING）——Q7 原子替换无需 unlink-first 窗口。
  - **heredoc 中文/转义坑复现**：批次 9 记档的 heredoc 截断/转义问题在代码追加时再现（
 被吃）——python 单行内联修文件仍最稳，双反斜杠转义在 zcode Bash 工具下不可靠，含转义的批量编辑用 Edit 工具。
- **偏离计划的地方**：逐卡详见卡面完成记录（T-P1-85 stopping 中间态归执行体退出路径 + drive 内 abort 判定；T-P1-86 resume 新轮新 promptId + restore 前置于 resume + resumed 回执先于闭合事件序的测试适配；T-P1-87 epoch hex 形状约束；T-P1-88 fold 校验权威不折叠 + foldCoalesced 视图重编号 + 消息重建读取面消费；T-P1-89 doctor 版本断言动态化（CURRENT=2 连带）；T-P1-90 **E14 预判修正**（stream 字段已在事件流承载分片——模块定位运维检索面）；T-P1-91 压缩对象偏离（logs 族）+ zstd 内置；T-P1-92 tokensAfter 不落（无精确来源，不落流内谎言）；T-P1-93 既有断言 settled 口径批量适配；T-P1-94 收轮时点从流收集（非逐 step 累积）；T-P1-95 done 落 CLI 受理时点（子进程拒绝经 error 行）+ /exit /quit 不记）。
- **遗留风险与未知**（→ 人工确认清单批次 10 行）：
  - ~~**四案词汇表待追认**~~ **已闭环（2026-09-27 用户"认可"——#12~#15 转正，正式计数 23 事件）**
  - M1/M2 job 面无 BUILTIN 工具与 CLI 露出（无发起方——S 组闲时任务批次 15 消费底座）；epoch 的多端通知面与流内载荷化随批次 12 N7/N8
  - Q7 压缩对象偏离（logs 族非 rollout——单库架构使然）；zstd 缺失时 gzip 降级路仅兜旧 Node
  - L7 done 判定落 CLI 受理时点（多端 host 的真实裁决回执随 N7）；resume 的多端授权语义（谁能 resume）随批次 12
  - E14 独立 JSONL 与事件流 stream 字段双载体（stream 是事实源）——JSONL 落盘量级随用量增长（Q7 冷压缩兜底）
  - session-index 全量重建面暂无自动触发（兜底工具——表损坏时人工调用）
- **批次完成定义核对**：14 卡打勾附验收 ✓；tsc 干净 ✓；count-features 310 ✓；check-doc-links 865 链接 0 失效 ✓；license-audit exit 0 ✓；词汇表扩展四案立案 + 落地记录 13~16 ✓；Q5 红线不破 ✓；两条接旧账线关闭 ✓；七面盘点落报告 ✓
- **下一批**：**批次 11 上下文与模型运维收尾（12 条：F7 F8 F11 F18 F25 F26 F29 F30 + J5 J13 J16）**——未展卡，下一会话先展卡（锚点核对 + 卡序落 plan-p1.md）再执行，做完收官即停
- **下一批提示词**：见 [`plan-p1-progress.md`](plan-p1-progress.md) 头部「批次 11 提示词（当前活跃）」——2026-09-27 进度文档拆分：批次 11 起的进度、报告与提示词均记入新文件（本文件定格防膨胀）。
