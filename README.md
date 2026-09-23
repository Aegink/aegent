# aegent — 多端 Agent 自研工作区

自研 Agent Harness（Web + IM + 桌面）的调研与内核开发工作区。
上游开源实现只作为**参考读物**克隆在本机，不进我方版本控制。

## 目录结构

```
aegent/
├── AGENTS.md              仓库级开发规范（优先级高于本文件）
├── README.md              本文件：结构说明与工作流
├── THIRD_PARTY.md         第三方许可清单（引用了谁的代码、什么许可、版权头）
├── oss/                   上游参考仓库克隆（gitignored，各自带 .git）
│   ├── SOURCES.lock       ← 唯一被跟踪的文件：每个上游的 URL + commit SHA + 许可
│   └── <repo>/            ...
├── refs/                  官方公开文档摘录（gitignored）
│   └── claude-official/   anthropics/claude-code 公开仓
├── docs/
│   ├── requirements.md    需求文档（v0.1 待评审，含 7 项阻塞决策）
│   └── research/          调研报告（tag research/v1）
│       ├── 00-inventory.md   本机仓库盘点
│       ├── 01-conclusion.md  结论 + 排除清单 + 验证命令
│       ├── 02-comparison.md  A–N × 10 仓对比总表
│       ├── 03-conflicts.md   9 处冲突与决策
│       ├── 04-module-map.md  P0 17 文件 + 接口草稿
│       └── cards/            仓库卡片
├── tools/                 可重跑脚本（被跟踪）
│   ├── clone-all.sh       幂等克隆全部上游（已存在则跳过）
│   ├── snapshot.sh        刷新 oss/SOURCES.lock
│   ├── license-detect.sh  精确识别根许可（被其他脚本 source）
│   ├── license-audit.sh   合规扫描：许可 / 泄露迹象 / sourcemap
│   └── inventory.sh       生成 docs/research/00-inventory.md
├── notes/                 踩坑记录与草稿（被跟踪）
│   └── 01-workspace-gotchas.md
└── src/                   我方内核代码（待建）
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

### 多轮修改的纪律

调研报告会反复改。规则是：

- **一个逻辑改动一个 commit**，不要一次提交攒三天的修改。
- **每轮报告定稿打 tag**：`git tag research/v1`，需要对比时 `git diff research/v1..research/v2`。
- **报告开头必须写 `SOURCES.lock 快照日期 + 相关仓 commit`**，否则这轮报告半年后没人能验证。
- **结论被推翻时不要删旧报告**，在新报告里写明推翻理由并链接旧文件 —— 这是最有价值的记录。
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
- 开源 ≠ 无版权。摘代码必须保留版权头并登记到 `THIRD_PARTY.md`。
- 无许可证、或明确是泄露镜像的仓库，一律移入排除清单，不读不复述。
- 合规检查：`bash tools/license-audit.sh`
