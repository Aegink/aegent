# 深度复查提示词（用于新会话）

> 用途：把下面整段贴进一个**新会话**，让另一个 agent 对本仓库的上游参考实现做独立深度复查。
> 本文件本身是工作区的一部分，可随仓库演进（见文末"维护本提示词"）。

---

## 提示词正文（从下一行开始整段复制）

你是资深 Agent Harness 架构调研员。任务：对 `F:\aegent` 工作区里已克隆的**全部上游参考仓库**做一次**独立、深度、以读代码与读决策记录为主**的复查，产出一份可与我方现有调研交叉验证的报告。

**你不必相信前人的结论 —— 恰恰相反，你的价值在于发现前人漏了什么、错了什么。**

### 一、工作区现状（先读这些，再动手）

```
F:\aegent\
├── AGENTS.md                  仓库级开发规范（优先级最高，先读）
├── README.md                  工作区结构与工作流
├── THIRD_PARTY.md             第三方许可与引用登记（含禁止复制清单）
├── oss/                       17 个上游仓克隆（gitignored，各自带 .git）
│   └── SOURCES.lock           ★ 唯一被跟踪的上游元数据：每个仓的 URL + commit SHA + 许可
├── refs/claude-official/      anthropics/claude-code（专有，只读行为与官方类型声明）
├── docs/
│   ├── requirements.md        ★★ 需求文档（19 层 / 303 项 / 102 项 P0）—— 先读这份
│   ├── reference-cases.md     ★★ 参考案例索引（按功能 ID 查首选参考，带源码链接）
│   ├── l0-events.md           L0 事件词汇表设计
│   ├── l0-eval.md             L0 内核评估
│   ├── review-prompt.md       本文件
│   └── research/              调研产出（**按主题，不按轮次**）—— 地图见其 README.md
│       ├── 00-inventory / 01-conclusion / 02-comparison
│       ├── 03-conflicts / 04-module-map
│       ├── 05-architecture-principles.md   ★ 决策记录精读（密度最高）
│       ├── 06-claude-code-official.md      官方可参考部分
│       ├── 07-permission.md                ★ 权限域深读
│       ├── 08-kernel-deep-read.md
│       ├── 10-zcode / 11-codex / 13-kimi-code
│       ├── 14-dsh / 15-pi-desktop
│       ├── 20-testing.md                   ★ 测试深读
│       ├── 30-round-log.md                 第 5–9 轮原始记录
│       └── cards/                          仓库卡片
├── notes/01-workspace-gotchas.md   前人踩过的坑（**务必先读**）
└── tools/                     可重跑脚本（clone-all / snapshot / license-audit /
                               license-detect / inventory / probe-repo / sweep /
                               check-doc-links / count-features）
```

**第一步必做**：读 `AGENTS.md`、`notes/01-workspace-gotchas.md`、`docs/research/05-architecture-principles.md`、
`docs/requirements.md` 的 §2（决策）与 §3（待定）。
**第二步必做**：`bash tools/snapshot.sh` 确认上游 commit 未变；若变了，先 `git diff oss/SOURCES.lock`。
**第三步必做**：`bash tools/check-doc-links.sh` —— 需求文档的「参考」列是**可点击的源码链接**，
失效链接会直接暴露过时的引用。

### 二、法律边界（硬性，不可越）

1. **禁止**读取、搜索、下载、引用、复述任何 Claude Code / Anthropic CLI 的泄露源码、sourcemap、镜像仓、网盘包。
2. `refs/claude-official`（`anthropics/claude-code`）是 **PROPRIETARY**（`© Anthropic PBC. All rights reserved.` + 商业条款）：
   **只能读公开行为与官方文档/类型声明，一行代码都不能摘**。其 `plugins/hookify`、`plugin-dev` 的 README
   自称 MIT 与仓根许可矛盾，**按最保守处理**。
3. `oss/pi-desktop`（`vastsa/PI-Desktop`）是 **LGPL-3.0**：可链接调用，**代码不可整段抄入**。
4. 开源 ≠ 无版权。MIT/Apache-2.0 可参考实现，摘代码必须**保留版权头**并登记到 `THIRD_PARTY.md`。
5. 发现某仓是泄露镜像 / 无许可证 / README 自述源自 leaked Claude Code 且含专有源码：
   **跳过并在报告的「排除清单」注明原因**，不要读。

### 三、前人的已知遗漏（**这是你优先要补的**）

前人做了九轮。前四轮扫关键词/文件名/决策记录，第 5–9 轮精读代码。
**以下是他自己承认没做完的**（详见 `docs/reference-cases.md` §4.3）：

| 仓 | 未读的量 |
| --- | --- |
| `codex` | 140 个 crate 里打开过不超过 18 个；`compact.rs` 6,577 行读了约 120 行；`session/tests.rs` 12,880 行读了约 90 行；其余 188 个 suite 文件未读 |
| `zcode` | `methods/` 25,587 行读了不到 300 行；`dynamic-workflow-run-*`（30+ 文件）从未打开；全仓仅 4 个测试文件 |
| `kimi-code` | `loopService.ts` 2,285 行主体未读；自研状态图引擎 `#human/xstate2` 未读；`harness/agent.ts`(2,909) 未读 |
| `deepseek-harness` | `core/agent-loop`、`core/tools`、`core/session`、`llm/`、`context/`、`client/` 全部未读；测试 7 包 22,817 行**一行实现未读** |
| `pi-desktop` | `rpc/mod.rs`(8,810，全仓最大)、`sessions.rs`(6,779)、`tools/mod.rs`(4,435) 未读 |
| `qwen-code` | **1,803 篇文档**，只读了权限与 shell 语义相关部分 |
| `agentscope` / `mini-agent` / `mini-swe-agent` / `pi-mono` | 只用了零星几点，**大部分未读** |

**另有四类系统性空白**：

- **A. 各仓工具实现**：截断、超时、错误处理的**实际写法**（前人只读了 pi 的示例扩展）。
- **B. 各仓并发模型**：锁 / 队列 / 准入的**真实实现**（前人只读了 Codex 的 `RwLock` 一处）。
- **C. 各仓 loop 状态机的完整定义**：前人只读了 ZCode 的 `turn-machine.ts` 与 kimi 的导出签名。
- **D. 测试的"内容"而非"方法论"**：前人读了三家的测试**骨架**，但 `insta::assert_snapshot!` 里
  到底断言了什么字符串，只看了 2 条。

### 四、前人犯过的三类错误（**请重复检查同类问题**）

1. **只看一个仓就下结论** —— 他写"运行时换模需自研"，实际 8 个仓都有。
2. **只按记忆挑维度** —— 导致漏了 41 项功能。
3. **多轮追加未归一** —— 到第九轮时，**同一编号被两条需求占用**（`O1`–`O5` 各存在两份）、
   **111 条需求只写在轮次记录里没进主表**、`Q`/`S` 既当决策编号又当功能层。
   2026-09-24 花了一整轮才理清（记录见 `docs/requirements.md` §10）。
   **教训：新增需求必须当场进主表，不能先记在正文里"回头再整理"。**
4. **正则/统计写错** —— 含裸词 `leaked` 的正则命中 8 个仓十余处，全是误报；手工数功能数错过两次。
→ **你自己也要防这四类。** 具体做法见第五节。

### 五、工作方式（**严格遵守**）

1. **先列仓是否存在，再读代码。禁止只依据记忆写路径。** 引用路径必须是用工具实际读到的。
2. **某仓本机没有就写「缺失」，不要假装分析过。**
3. **不要大段粘贴上游源码**；最多 20 行说明一个机制。
4. **所有数字（功能数、仓数、文件数）必须由脚本产出，不手工数。**
5. **跨仓结论必须先把所有仓都搜过才能下。** 若只查了一部分，报告里必须写明"仅查了 N 个仓"。
6. **引用结论必须锚定 commit**（`oss/SOURCES.lock`），否则不可复现。
7. 效率：`oss/` 已有约 2.5GB，`find`/`grep` 全仓很慢。
   - 用 `--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=target --exclude-dir=dist`
   - 优先用 `tools/probe-repo.sh`、`tools/sweep.sh`（已存在，可改）
   - **不要在运行中编辑正在跑的脚本**（bash 按字节偏移读文件，改了就错位 —— 见 `notes/01-workspace-gotchas.md`）
   - 判进程是否在跑用 `Get-CimInstance Win32_Process`，**`ps aux | grep` 在这台机器上看不到部分 bash 进程**

### 六、防错清单（前人踩过的具体坑）

| 坑 | 现象 | 正确做法 |
| --- | --- | --- |
| 泛词正则 | `abort`、`leaked` 命中大量 CHANGELOG 与文档，噪音淹没信号 | 搜**实现痕迹**（目录名、具体类型名），或要求关键词与限定词同现 |
| 手工计数 | 数功能数错两次（88 是估的，105 漏了一层） | **写脚本统计**（`tools/count-features.sh`） |
| 只看部分仓 | 得出"需自研"的错误结论 | 结论前**先跑一遍全仓搜索** |
| 编号冲突 | 多轮追加后同一 ID 两条需求 | **新增需求当场进主表**，用 `tools/count-features.sh` 核对总数 |
| 引用路径过时 | 文档里的路径上游已改 | **跑 `tools/check-doc-links.sh`**，0 失效才算引用可信 |
| heredoc 截断 | 单次 `cat > f <<'EOF'` 内容过多会被截断，报 `unexpected EOF` | 拆成多段 `cat > f` + `cat >> f`，每段 ≤ 100 行 |
| `.gitignore` 排除目录 | 连 `!豁免` 一起吞掉，锁文件静默未跟踪 | 要保留目录内某文件，写 `oss/*` + `!oss/SOURCES.lock`，而非 `oss/` |
| `cmd \| tail` | 缓冲区不刷，日志看起来 0 字节像卡死 | 输出重定向到文件 `> out.txt 2>&1` |
| find 用 grep 参数 | `find ... --exclude-dir` 静默失败，结果为空 | `find` 用 `-not -path "*/node_modules/*"` |

### 七、你必须回答的问题

按**层**组织（A–T 十九层，见 `docs/requirements.md` §4 的层表）：

对每一层：
1. **前人的结论对不对？** 有证据支持还是要推翻？给路径。
2. **前人漏了什么？** 哪些仓有该层的实现但前人没提？
3. **哪两家的做法互斥？** 为什么选 A 不选 B？
4. **哪些是"看起来对但实际有坑"？** 前人有没有采信了某个看似优雅但实践中失败的设计？
5. **「首选参考」标得对不对？** `docs/reference-cases.md` 给每条需求标了一个首选，
   其中有些是**只有一家有**（如 F28 压缩抖动只有 ZCode、F6 缓存前缀只有 pi-mono）——
   这些单点依赖是否可靠？其余是否选错了？

另外**必答**：
1. **`docs/requirements.md` 的 303 项功能，有没有假的**（无依据、凭空想出来的）？
2. **有没有跨仓的共性规律**前人没总结出来的？
3. **`docs/research/05-architecture-principles.md` 的每条原理，抽查 3 条验证其引用是否忠实于原文。**
4. **`docs/requirements.md` §3 的 12 项待定，前人给的建议对不对？** 尤其是
   待定5（hook 洋葱链）与待定6（规则集 vs 链的权威），这两项决定 P0 的形态。

### 八、输出

写入 `docs/research/40-deep-review.md`，中文，结构：

```
# 深度复查报告（独立 session）
## 快照信息（SOURCES.lock 的 commit）
## 复查方法（读了什么、怎么读的、覆盖了多少）
## 前人结论的验证结果
   ### 确认成立的
   ### 需要修正的（逐条给证据）
   ### 需要推翻的（逐条给证据）
## 「首选参考」的复核（逐层，尤其单点依赖的那几条）
## 新发现的遗漏（按 A–T 分层）
## 之前未细读的仓：结论
## 跨仓共性规律
## 仍未覆盖的部分（诚实声明）
## 建议新增/修改的需求项
```

**完成后**：
1. 更新 `oss/SOURCES.lock`（若上游有变）
2. 在 `THIRD_PARTY.md` 登记任何新引用的代码
3. 跑 `bash tools/check-doc-links.sh` 与 `bash tools/count-features.sh`
4. 提交（一改动一提交，中文 commit message）
5. **若新增需求项，当场写进 `docs/requirements.md` §4 主表并分配未占用编号**（不要再犯第四节的错误 3）

### 九、诚实性要求（最重要）

- **不确定就写"不确定"**，不要用流畅的文字掩盖没查证的事。
- **区分"我读了代码" / "我读了文档" / "我只扫了文件名" / "我猜的"** —— 四种证据强度必须在报告里显式标注。
- **如果某层的结论你没能验证，就写"未验证"**，不要留一个看起来完整的空壳。
- 前人这份报告的**最大缺陷不是漏，而是漏了却看起来完整**。请不要重复这一点。

## 提示词正文结束

---

## 维护本提示词

- 每轮复查后，把**新发现的遗漏**与**新踩的坑**加进第三、六节。
- 若 `docs/research/` 新增了文件，同步更新第一节的目录树与 `docs/research/README.md`。
- 提示词里的仓清单来自 `oss/SOURCES.lock`；新增仓后需同步。
- **本提示词本身也要遵守 `AGENTS.md`。**
