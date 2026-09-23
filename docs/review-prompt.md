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
├── refs/claude-official/      anthropics/claude-code（专有许可，只读行为）
├── docs/
│   ├── requirements.md        需求文档（166 项功能，18 层）
│   └── research/              前几轮调研产出
│       ├── 00-inventory.md    盘点
│       ├── 01-conclusion.md   结论 + 排除清单 + 验证命令
│       ├── 02-comparison.md   A–N 分层对比总表
│       ├── 03-conflicts.md    9 处冲突与决策
│       ├── 04-module-map.md   P0 模块与接口草稿
│       ├── 05-architecture-principles.md   ★ 第三轮：精读决策记录所得（最重要）
│       └── cards/             12+ 仓的仓库卡片
├── notes/01-workspace-gotchas.md   前人踩过的坑（**务必先读**）
└── tools/                     可重跑脚本（clone-all / snapshot / license-audit /
                               license-detect / inventory / probe-repo / sweep / count-features）
```

**第一步必做**：读 `AGENTS.md`、`notes/01-workspace-gotchas.md`、`docs/research/05-architecture-principles.md`、`docs/requirements.md` 的 §1 与 §5。
**第二步必做**：`bash tools/snapshot.sh` 确认上游 commit 未变；若变了，先 `git diff oss/SOURCES.lock`。

### 二、法律边界（硬性，不可越）

1. **禁止**读取、搜索、下载、引用、复述任何 Claude Code / Anthropic CLI 的泄露源码、sourcemap、镜像仓、网盘包。
2. `refs/claude-official`（`anthropics/claude-code`）是 **PROPRIETARY**（`© Anthropic PBC. All rights reserved.` + 商业条款）：
   **只能读公开行为与官方文档，一行代码都不能摘**。其 `plugins/hookify`、`plugin-dev` 的 README 自称 MIT 与仓根许可矛盾，**按最保守处理**。
3. `oss/pi-desktop`（`vastsa/PI-Desktop`）是 **LGPL-3.0**：可链接调用，**代码不可整段抄入**。
4. 开源 ≠ 无版权。MIT/Apache-2.0 可参考实现，摘代码必须**保留版权头**并登记到 `THIRD_PARTY.md`。
5. 发现某仓是泄露镜像 / 无许可证 / README 自述源自 leaked Claude Code 且含专有源码：
   **跳过并在报告的「排除清单」注明原因**，不要读。

### 三、前人的已知遗漏（**这是你优先要补的**）

前人做了三轮。第一轮扫关键词，第二轮全仓扫文件名，第三轮精读决策记录。**以下是他自己承认没做完的**：

**A. 完全没细读的仓（4 个）**
- `oss/agentscope`（modelscope/agentscope，Python，多智能体编排）
- `oss/mini-agent`（MiniMax-AI，16M，最小实现）
- `oss/mini-swe-agent`（SWE-agent，2.9M，极简 loop）
- `oss/pi-mono`（lue-labs，与 pi 同作者 Mario Zechner）
→ 这四个**只验证了存在性，没有任何优点断言**。请补上（或明确说明为何不值得读）。

**B. 文档量巨大但没读的**
- `oss/qwen-code`：**1803 篇**文档（`docs/`、`docs/design/`、`.qwen/specs/`）
- `oss/pi-desktop`：**835 篇**（`docs/`、`docs/adr/` 321 篇、`docs/superpowers/specs/`）
- `oss/hermes-agent`：436 篇
- `oss/cc-switch`：200 篇
- `oss/pi`：88 篇（含 `packages/durable/docs`）
- `oss/kimi-code`：63 篇；`oss/grok-build`：39 篇；`oss/opencode`：31 篇（含 `specs/`）；`oss/codex`：20 篇
→ 前人只读了 DSH 的 1177 篇 note 与 pi-desktop ADR 的一部分。**其余基本没碰。**

**C. 读文档多、读代码少**
前人主要在读文档与决策记录。**实际实现代码读得很少**。请补：
- 各仓 loop 入口文件的**真实状态机**（前人只列了文件名）
- 各仓**工具实现**（截断、超时、错误处理的实际写法）
- 各仓**并发模型**（锁/队列/准入的真实实现）
- 各仓**测试**（怎么 mock LLM、怎么断言事件序列）

**D. 前人犯过的三类错误（**请重复检查同类问题**）**
1. **只看一个仓就下结论** —— 他写"运行时换模需自研"，实际 8 个仓都有。
2. **只按记忆挑维度** —— 导致漏了 41 项功能。
3. **正则/统计写错** —— 含裸词 `leaked` 的正则命中 8 个仓十余处，全是误报（`leaked loop variables`、`avoid leaked processes` 之类）；手工数功能数错过两次。
→ **你自己也要防这三类。** 具体做法见第五节。

### 四、工作方式（**严格遵守**）

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

### 五、防错清单（前人踩过的具体坑）

| 坑 | 现象 | 正确做法 |
| --- | --- | --- |
| 泛词正则 | `abort`、`leaked` 命中大量 CHANGELOG 与文档，噪音淹没信号 | 搜**实现痕迹**（目录名、具体类型名），或要求关键词与限定词同现 |
| 手工计数 | 数功能数错两次（88 是估的，105 漏了一层） | **写脚本统计**（参考 `tools/count-features.sh`） |
| 只看部分仓 | 得出"需自研"的错误结论 | 结论前**先跑一遍全仓搜索** |
| `.gitignore` 排除目录 | 连 `!豁免` 一起吞掉，锁文件静默未跟踪 | 要保留目录内某文件，写 `oss/*` + `!oss/SOURCES.lock`，而非 `oss/` |
| `cmd \| tail` | 缓冲区不刷，日志看起来 0 字节像卡死 | 输出重定向到文件 `> out.txt 2>&1` |
| find 用 grep 参数 | `find ... --exclude-dir` 静默失败，结果为空 | `find` 用 `-not -path "*/node_modules/*"` |

### 六、你必须回答的问题

按**层**组织（沿用前人 A–S 十八层：A Loop / B Tools / C Policy / D Sandbox / E Session / F Context / G Planning / H Subagents / I 扩展 / J Models / K Surfaces / L Observability / M 长任务 / N 多端同步 / O 测试与诊断 / P 多模态附件 / Q 会话数据运维 / S 调度与集成）：

对每一层：
1. **前人的结论对不对？** 有证据支持还是要推翻？给路径。
2. **前人漏了什么？** 哪些仓有该层的实现但前人没提？
3. **哪两家的做法互斥？** 为什么选 A 不选 B？
4. **哪些是"看起来对但实际有坑"？** 前人有没有采信了某个看似优雅但实践中失败的设计？

另外**必答**：
1. **前人的 166 项功能清单，有没有假的**（无依据、凭空想出来的）？
2. **有没有跨仓的共性规律**前人没总结出来的？
3. **`docs/research/05-architecture-principles.md` 的每条原理，抽查 3 条验证其引用是否忠实于原文。**
4. **那 4 个未细读的仓，值得读吗？** 给出明确判断。

### 七、输出

写入 `docs/research/06-deep-review.md`，中文，结构：

```
# 深度复查报告（独立session）
## 快照信息（SOURCES.lock 的 commit）
## 复查方法（读了什么、怎么读的、覆盖了多少）
## 前人结论的验证结果
   ### 确认成立的
   ### 需要修正的（逐条给证据）
   ### 需要推翻的（逐条给证据）
## 新发现的遗漏（按 A–S 分层）
## 之前未细读的 4 个仓：结论
## 跨仓共性规律
## 仍未覆盖的部分（诚实声明）
## 建议新增/修改的需求项
```

**完成后**：
1. 更新 `oss/SOURCES.lock`（若上游有变）
2. 在 `THIRD_PARTY.md` 登记任何新引用的代码
3. 提交（一改动一提交，中文 commit message）
4. 若改动了 `docs/requirements.md`，运行 `bash tools/count-features.sh` 并更新合计表

### 八、诚实性要求（最重要）

- **不确定就写"不确定"**，不要用流畅的文字掩盖没查证的事。
- **区分"我读了代码" / "我读了文档" / "我只扫了文件名" / "我猜的"** —— 四种证据强度必须在报告里显式标注。
- **如果某层的结论你没能验证，就写"未验证"**，不要留一个看起来完整的空壳。
- 前人这份报告的**最大缺陷不是漏，而是漏了却看起来完整**。请不要重复这一点。

## 提示词正文结束

---

## 维护本提示词

- 每轮复查后，把**新发现的遗漏**与**新踩的坑**加进第三、五节。
- 若 `docs/research/` 新增了编号文件，同步更新第一节的目录树。
- 提示词里的仓清单来自 `oss/SOURCES.lock`；新增仓后需同步。
- **本提示词本身也要遵守 `AGENTS.md`。**
