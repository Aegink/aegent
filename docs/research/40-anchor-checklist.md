# 锚点抽样核对（第 0 次：2026-09-25，写计划文档前的自检）

> 靶子：`docs/requirements.md` §4 全表 **310 条**的「参考」列。
> 抽样：`bash tools/sample-anchors.sh 35 20260925`（分层 P0 60% / P1 30% / P2 10%）。
> **这不是独立复核**（同一会话自查），但它先于计划文档跑，目的是**别让错锚点被复制进 104 张任务卡**。
> 判定：**✅** 对得上 ｜ **⚠️** 语义对但引用形式有问题 ｜ **❌** 指错文件/语义不符

## 一、结论

| 判定 | 条数 | 占比 |
| --- | ---: | ---: |
| ✅ 对得上 | 24 | 69% |
| ⚠️ 引用形式有问题（不可点） | 6 | 17% |
| ❌ 指错文件 | 5 | 14% |

**14% 的错锚点率**验证了先跑这一步是对的 —— 若直接写计划，这 5 条会带着
"证据强度：读了代码"的标签进任务卡。

## 二、❌ 五条（已修正）

| ID | 原指向 | 问题 | 改为 |
| --- | --- | --- | --- |
| **A4** | `codex/core/src/compact_token_budget.rs` | 该文件**通篇没有 overflow 字样** —— 它是"token 预算式压缩"的实现，不是溢出检测。原指向支持的是"压缩有多种实现"，不是"溢出先于压缩" | `codex/core/src/compact.rs:315`（`CodexErrorDetails::ContextWindowExceeded` 的处理处） |
| **F4** | 同上 | 同 A4（两条共用同一锚点） | 同上 |
| **D4** | `pi/packages/agent/src/types.ts` | 该文件**没有 `ToolContext`**（真名是 `ExecutionToolContext`，在 `harness/tools/tool-context.ts`）。更要紧的是：**`pi` 确实 `import { spawn } from "node:child_process"`** —— 在 `harness/env/nodejs.ts:1`。原断言"工具拿不到裸进程 API"的字面表述与证据不符 | `pi/harness/tools/tool-context.ts`，并把断言改写为准确形状：**工具经 `ExecutionEnv` 抽象拿能力，`spawn` 只在 env 实现层；实测 `harness/tools/` 0 处 `child_process` 引用** |
| **L3** | `cc-switch/.../dao/stream_check.rs` | 该文件是**流健康检查**，grep `token` 零命中 —— 不做 token 统计 | `cc-switch/.../dao/usage_rollup.rs`（`input/output/cache_read/cache_creation_tokens` + `total_cost_usd`） |
| **N4** | `zcode/services/src/session/sessionRealtimePort.ts` | 该文件有 `TaskRunLease*` / `TaskOwnerCommand*`（N6 ✅），但**没有事件序号/epoch 概念** —— ZCode 的会话契约里根本没有 seq | `pi/harness/session/types.ts:68`（`NewEntry = Omit<Entry,"seq"\|"timestamp">`）。**并注明跨端 epoch 无上游参考、需自研** |

## 三、⚠️ 一条（已改写断言）

**O29**「不期望的事件直接 panic，不静默流过」—— 原断言**过强**。
`compact.rs` 那个测试对 `EventMsg::Error` 是 `panic!`，但对其余未识别事件走 **`_ => {}` 显式忽略**。
改写为：「**期望外的错误直接 panic**；其余未识别事件走显式忽略臂 —— 忽略是写出来的决定，不是遗漏」。

## 四、⚠️ 六条不可点（表级缺陷，已全表修复）

抽样中 **6 条的「参考」列没有可点链接**（`同上` 或纯文本）。顺势全表扫了一遍：
**310 条里有 59 条（19%）不可点**，其中 **18 条是 P0**（B11 · C3 · C4 · C5 · C16 · C28 · C29 · C32 · C35 · C38 · C48 · C49 · D9 · F4 · J2 · O4 · O10 · Q5）。

这直接废掉"点开看"的工作方式 —— `同上` 渲染出来是死文字。
**已全部补齐**（其中 5 条确属自研，标为 `**自研**（无上游参考）`）。
现在全表 547 个链接、0 失效。

## 五、✅ 二十四条中的几条值得记的

| ID | 指向 | 该处原文/形状 |
| --- | --- | --- |
| **B20** | `zcode/turn-output-token-continuation.ts` | 比需求描述更具体：`OUTPUT_TOKEN_CONTINUE_PROMPT = "Output token limit hit. Resume directly — no apology, no recap…"` + `MAX_OUTPUT_TOKEN_CONTINUATIONS = 3` |
| **B16** | `codex/core/src/tools/parallel.rs:46` | 原文注释即结论："Tool calls may run later, so retain the step whose tool list advertised them." |
| **M10** | `codex/core/src/rollout_budget.rs:27` | 原文注释："Last reminder delivered to each thread, so every thread observes crossed thresholds." |
| **F28** | `zcode/runtime/methods/compact.ts:230` | `context.rapidRefill.shouldBlock` + `consecutiveRapidRefills` + `toolTurnsSinceCompact` |
| **J7** | `pi/agent-harness.ts:154` | `capturedModel?: ModelIdentity` —— configured/captured 分离的实证 |
| **D15** | `pi-desktop/ADR 0041:19` | 原文行："…backoff; **started commands are never automatically retried**. Timed-out children…" |

## 六、诚实声明

- 本轮是**同一会话自查**，不是独立复核 —— 我可能用同样的思路漏掉同样的错。
  真正独立的核对仍需新会话（`docs/review-prompt.md`）。
- 35 条是抽样，**其余 275 条未验**。错锚点率 14% 是抽样估计，不是全表事实。
- 行号核对基于 `oss/SOURCES.lock` 的 commit；上游一旦刷新，行号需重验。
