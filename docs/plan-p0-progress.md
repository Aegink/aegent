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
| 2 | J9 | `plan-p1.md` T-P1-06 明文"换模进事件流 + 新增会话级元事件 model/switch"，但词汇表（落地记录 2 后）正式计数为 14，无换模落点 | 同先例 #1 的结构：不追加事件则换模/回滚状态变更无事件承载（J9 纪律"换模是持久事件、非静默改状态"落不了）；追加则词汇表 14→15 | 按计划卡执行：新增 `model/switch {from, to, reason: "user"\|"rollback"}`（会话级元事件，session/revert 同款：不要求 turn/step 上下文、turn 挂流内最后轮空流兜 0），词汇表 14→15，l0-events.md §8 记落地记录 3（含不追认的回退面），events.test 计数同步改 15 | ⏳ **待追认**（2026-09-25 立案） |

## 人工确认清单

| 需求ID | 为什么不能机验 | 人工要怎么确认 |
| --- | --- | --- |
| J2（部分） | ~~真实厂商连通性需要 API key~~ **已实测（2026-09-25，用户提供 OpenAI 兼容端点，deepseek-v4.1-flash）**：流式 192 块（reasoning-delta/text-delta/usage/done）、usage 落库（input 2196/output 191/total 2387/reasoningTokens 175）、L3 视图可查；真实模型 tool_call 流式分片拼接正确（arguments 完整 JSON）、审批挂起→超时→isError 回喂→模型自适应重试→诚实收尾，27 事件配平落库。系统提示生效（模型自称 aegent）。**剩：不同厂商 wire 差异的多端点复测**（同一端点已闭环） | 其他厂商端点可复跑同款命令：`node dist/src/cli/index.js --smoke --provider openai --db <库> --workspace <git 仓>` + 环境变量 AEGENT_API_KEY / AEGENT_BASE_URL / AEGENT_MODEL |
| T9 冷启动 | 「<500ms」依赖本机负载 | T-8-05 终验收已实测两形态：echo 模式 median 283.3ms、SQLite 模式 median 273ms，达标收口（T-3-06 基线 109.6ms 的上浮源于子进程装配扩容，见 T-8-05 偏离①） |
| D3 弱承诺 | 「网络策略只管工具层」是声明不是代码属性 | **已关闭（2026-09-25 用户目检裁决："可以"）**——`src/sandbox/README.md` 置顶加粗的弱承诺段（只拦工具层 fetch，不承诺 bash 子进程/模型接入层/OS 级，deny 档 ≠ 网络隔离）获用户认可 |
| T-6-01 符号链接逃逸 | 本机无创建符号链接特权（Windows 需开发者模式），逃逸用例自动跳过（LIMITATIONS #1） | 有特权环境跑 `npx vitest run src/sandbox/path-guard.test.ts` 应 22 全过（终验收实测 21 passed + 1 skipped）；realpath 归一逻辑已有"最近存在祖先"路径的确定性用例覆盖 |
| §6.2 常驻内存 | 任务管理器观察（需求原文如此） | **多会话并发实测完成（2026-09-25，用户要求的口径）**——agent-child 并发脚本（`scratch/_tmp_mem/concurrent.mjs`，WorkingSet64 每 250ms 采样）：① 8 会话×10 轮（~43 事件/进程）：单进程峰值 43.5–43.9MB，并发总 349.4MB；② 16 会话×10 轮：单进程 43.6–43.8MB，总 700.1MB；③ 8 会话×50 轮（~210 事件/进程，事件×5）：单进程 45.9–46.5MB（仅 +2.5MB）。**结论：单实例常驻稳定 43–47MB（<150MB 余量 3 倍+，含 node 运行时基线）；事件规模翻 5 倍内存仅微涨（大头是运行时基线，内核对象增长温和）；多会话 = N×单实例线性扩展（T9 每会话一进程的架构结果，16 会话总 700MB 超 150MB 是 16 个实例合计——单实例口径达标，进程级共享内核摊薄属 K5/P1 host 架构）**。任务管理器目测（需求原文方式）随时可做，数据在此可复核 |

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
