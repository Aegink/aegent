# aegent — 多端 Agent 自研工作区

自研 Agent Harness（Web + IM + 桌面）的调研与内核开发工作区。
上游开源实现只作为**参考读物**克隆在本机，不进我方版本控制。

## 先读这三个

| 文件 | 作用 |
| --- | --- |
| **[`docs/requirements.md`](docs/requirements.md)** | **要做什么** —— 唯一权威的需求文档（19 层 / 303 项 / 102 项 P0） |
| **[`docs/reference-cases.md`](docs/reference-cases.md)** | **照着谁做** —— 按功能 ID 查的首选参考索引，带可点击的源码链接 |
| **[`AGENTS.md`](AGENTS.md)** | 怎么写 —— 仓库级开发规范（优先级最高） |

## 工作方式（重要）

**本项目不追求读完上游。** 上游 17 个仓约 2.5GB，`docs/review-prompt.md` 里列的空白
再读十轮也读不完。做法是：

```
需求先定死  →  每条需求标注首选参考  →  做到哪一条，才点开哪一条对应的源码
```

- 每条需求的「参考」列是一个**可点击的链接**，直接落在 `oss/<仓>/…` 的具体行上
- 想知道"为什么这么定"→ `docs/research/` 的对应主题文档（地图见 `docs/research/README.md`）
- 想知道"还没定什么"→ `docs/requirements.md` §3 待定项（12 项）

## 目录结构

```
aegent/
├── AGENTS.md                  仓库级开发规范（优先级高于本文件）
├── README.md                  本文件
├── THIRD_PARTY.md             第三方许可清单（引用了谁的代码、什么许可、版权头）
├── oss/                       上游参考仓库克隆（gitignored，各自带 .git）
│   ├── SOURCES.lock           ← 唯一被跟踪的文件：每个上游的 URL + commit SHA + 许可
│   └── <repo>/                ...
├── refs/claude-official/      anthropics/claude-code 公开仓（PROPRIETARY，只读声明与行为）
├── docs/
│   ├── requirements.md        ★★ 需求文档（要做什么）
│   ├── reference-cases.md     ★★ 参考案例索引（照着谁做）
│   ├── l0-events.md           L0 事件词汇表设计（4 项待定见需求文档 §3.2）
│   ├── l0-eval.md             L0 内核评估
│   ├── review-prompt.md       深度复查提示词（用于开新会话做独立复查）
│   └── research/              调研产出（为什么），地图见其 README.md
│       ├── 00-inventory.md       本机仓库盘点
│       ├── 01-conclusion.md      结论 + 排除清单
│       ├── 02-comparison.md      A–N × 10 仓对比总表
│       ├── 03-conflicts.md       9 处冲突与决策
│       ├── 04-module-map.md      P0 模块 + 接口草稿 + 不变量
│       ├── 05-architecture-principles.md  ★ 决策记录精读（密度最高）
│       ├── 06-claude-code-official.md     官方可参考部分
│       ├── 07-permission.md      ★ 权限域深读（三轮合并）
│       ├── 08-kernel-deep-read.md         最小实现 / shell 语义
│       ├── 10-zcode.md           ★ ZCode 深读（三轮合并）
│       ├── 11-codex.md           ★ Codex 深读（两轮合并）
│       ├── 13-kimi-code.md       kimi-code 深读（两轮合并）
│       ├── 14-dsh.md             DSH 代码深读
│       ├── 15-pi-desktop.md      PI-Desktop 代码深读（LGPL，只学行为）
│       ├── 20-testing.md         ★ 测试深读（三轮合并）
│       ├── 30-round-log.md       第 5–9 轮原始记录（备查）
│       └── cards/                仓库卡片
├── tools/                     可重跑脚本（被跟踪）
│   ├── clone-all.sh           幂等克隆全部上游（已存在则跳过）
│   ├── snapshot.sh            刷新 oss/SOURCES.lock
│   ├── license-detect.sh      精确识别根许可（被其他脚本 source）
│   ├── license-audit.sh       合规扫描：许可 / 泄露迹象 / sourcemap（**全量约 50 分钟**，见下）
│   ├── check-doc-links.sh     ★ 校验文档里所有相对链接（改文档后必跑）
│   ├── count-features.sh      ★ 按层统计功能项数（改功能表后必跑）
│   ├── inventory.sh           生成 docs/research/00-inventory.md
│   ├── probe-repo.sh          单仓结构探针
│   └── sweep.sh               按关注点全仓扫
├── notes/01-workspace-gotchas.md   踩坑记录（**动手前先读**）
└── src/                       我方内核代码（待建）
```

## 核心原则：上游副本 vs 我方产物

`oss/` 和 `refs/` 被 `.gitignore` 排除。原因有两条：

1. **技术**：克隆自带 `.git`，若直接放在仓库里，git 会把它们当嵌入仓库
   （gitlink），`git status` 显示异常，`git add .` 产生警告，且无法真正跟踪其内容。
2. **法律**：上游是第三方版权作品。我方仓库只应保存"我写了什么"，
   而不是把别人的代码复制进自己的历史。引用代码时走 `THIRD_PARTY.md` 登记。

因此 **`oss/SOURCES.lock` 是唯一被跟踪的上游元数据**，它固定住
「调研结论是基于哪个 commit 得出的」。上游随时会变，没有 SHA 的结论无法复现。

## 工作流

### 首次 / 重新拉取全部上游
```bash
bash tools/clone-all.sh      # 幂等，已存在的跳过
bash tools/snapshot.sh       # 刷新 SOURCES.lock 并提交
```

### 升级某个上游到最新
```bash
git -C oss/pi fetch --depth 1 origin && git -C oss/pi reset --hard FETCH_HEAD
bash tools/snapshot.sh
git diff oss/SOURCES.lock    # 先看清 commit 变了什么，再决定要不要重写报告
```

### 改文档后必跑
```bash
bash tools/check-doc-links.sh   # 链接必须 0 失效（现有 478 个）
bash tools/count-features.sh    # 功能数必须与需求文档 §5 表一致
```

### 多轮修改的纪律

调研报告会反复改。规则是：

- **一个逻辑改动一个 commit**，不要一次提交攒三天的修改。
- **每轮报告定稿打 tag**：`git tag research/v1`，需要对比时 `git diff research/v1..research/v2`。
- **报告开头必须写 `SOURCES.lock 快照日期 + 相关仓 commit`**，否则这轮报告半年后没人能验证。
- **结论被推翻时不要删旧报告**，在新报告里写明推翻理由并链接旧文件 —— 这是最有价值的记录。
- **同一主题只有一份文件**：新发现合并进既有主题文档，不要再开一个按轮次编号的文件
  （2026-09-24 的整理就是在还这笔债）。
- 上游代码只读不改。要在其基础上试验，复制到 `notes/` 或 `src/` 并注明来源。

### 提交信息约定
```
research: 补 D 层沙箱对比（pi/opencode/codex）
tools:    snapshot.sh 支持直接读 LICENSE
docs:     修正 K 层对 ACP 的描述
```

## 法律边界

- **禁止**任何 Claude Code / Anthropic CLI 的泄露源码、sourcemap、镜像仓、网盘包。
  `refs/claude-official` 仅限官方公开仓（issues / docs / 官方插件示例）。
- `refs/claude-official` 是 **PROPRIETARY**：**只能读公开行为与官方类型声明，一行代码都不能摘**。
- 开源 ≠ 无版权。摘代码必须保留版权头并登记到 `THIRD_PARTY.md`。
- `pi-desktop` 是 **LGPL-3.0**：**代码一行不可摘**，只学行为。
- 无许可证、或明确是泄露镜像的仓库，一律移入排除清单，不读不复述。
- 合规检查：`bash tools/license-audit.sh`
