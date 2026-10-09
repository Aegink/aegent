# aegent

本地优先的多端 AI Agent 内核与桌面应用——事件溯源内核 + 多供应商接入 + 工具执行
（沙箱/审批/容错）+ Tauri 桌面壳（Windows），全部数据（会话、用量、凭据）落在本机。

> **免责声明（重要，请务必阅读）**
>
> 1. 本软件按"**现状**"提供，**不附带任何明示或默示的担保**——包括但不限于对
>    适销性、特定用途适用性与不侵权的担保。使用风险由使用者自行承担。
> 2. 本软件是**可以驱动 AI 模型执行命令、读写文件、发起网络请求**的开发者工具。
>    内置了沙箱档与审批机制，但任何机制都不能保证绝对安全——请在理解其
>    权限模型之后再接入真实模型，并自行评估给它的能力边界。
> 3. 模型输出（含代码、命令、结论）**不代表本项目的立场，也不构成专业建议**；
>    其正确性需使用者自行核验。因信任模型输出而产生的任何后果与本项目的
>    作者无关。
> 4. 本项目**不收集、不上传任何遥测数据**；除使用者自行配置的 AI 服务端点外，
>    不与任何第三方通信。**API 密钥由使用者自行保管**（桌面形态经 Windows
>    DPAPI 加密存储），因密钥泄露造成的损失由使用者自行承担。
> 5. 本项目与下列任何上游项目、任何 AI 厂商**均无隶属或背书关系**。
> 6. 使用本项目即表示您已阅读并同意本声明与 [`THIRD_PARTY.md`](THIRD_PARTY.md)
>    中的相关约定。

## 功能一览

- **事件溯源内核**：封闭事件词汇表 + SQLite 事件源存储 + write-behind/快照/回放，
  会话可完整重建（跨端续接同一条事实流）。
- **多供应商接入**：OpenAI Chat Completions / OpenAI Responses / Anthropic
  Messages / Google Generative AI 四协议；模型级协议覆盖、思考档（reasoning
  effort / thinking budget）真实下发、模型清单拉取与"真实发消息才算可用"的
  连接测试；内置 2600+ 模型参数目录（models.dev 裁剪）自动预填。
- **工具执行安全面**：权限档（allow/ask/deny + 规则）、命令审批（批量审批、
  守卫重跑）、沙箱（Windows 受限令牌）、IMDS/SSRF 黑名单、变更预算、幂等重试。
- **容错**：请求内重试 + 跨请求熔断（三态）+ 限流桶 + 多供应商故障转移队列
  （环绕尝试、粘住、全败类型化错误）。
- **桌面壳（Tauri）**：主对话流（工具卡/审批/小地图/日期分隔）、供应商与凭据、
  用量统计（SVG 可视化）、会话历史/搜索/工作台/通知、PiP 画中画、自动更新。
- **质量基建**：1800+ vitest 用例（含 XSS 渲染十例、协议 e2e、live 端点门控）、
  架构检查（行数/依赖环/域边界）、文档链接校验、功能计数对账。

## 当前状态（2026-10-10）

开发主线转入**内核战略期**——目标「越轻越好：0 底座 + 万物可插件」（道生一/一生二/二生三/三生万物：
0=骨架、一=循环+会话原语、二=工具/子代理/编排/渠道、三=全部插件）。已交付内核全面调研三路分报告与
总报告 [`docs/20261010_内核架构对比与改造建议.md`](docs/20261010_内核架构对比与改造建议.md)
（10 域 × 10 参考仓对照矩阵、0 底座定义、扩展点清单、W1~W17 分级方案），**待裁决后进入分批实施**。

## 构建与运行

```bash
pnpm install                # 依赖（Node 22+）
npm run build:single        # 打包 host/agent-child 单文件 + portable 资产
# 桌面安装器（需要 Tauri 2 + Rust + 签名私钥，见 src-tauri/tauri.conf.json）
TAURI_SIGNING_PRIVATE_KEY=<key> npx tauri build
# 便携形态：dist/portable/aegent-desktop.exe 与同目录布局文件一起即可运行
# 仅跑测试与类型检查
npx vitest run && npx tsc --noEmit
```

Web/IM 接入（`src/host`、`src/acp`、IM 通道）与 CLI 形态见
[`docs/requirements.md`](docs/requirements.md) 对应层。

## 许可证

本项目以 **GNU Affero General Public License v3.0-or-later**（AGPL-3.0）发布——
当前对开源项目可用的**约束最强的许可**：任何形式的分发或网络服务提供，都必须
以同一许可开放完整对应源码。详见根目录 [`LICENSE`](LICENSE) 与
[`THIRD_PARTY.md`](THIRD_PARTY.md)（第三方 npm 依赖（marked、highlight.js）的
许可、出处与版权头保留情况也在其中登记）。

## 参考项目与致谢

本项目在需求驱动下按条目研读了大量上游实现的公开源码与设计文档，
**只借鉴行为与架构决策，未复制任何受限代码**（复制过的两个 npm 库已在
`THIRD_PARTY.md` 登记并随分发保留其许可）。在此致谢：

| 上游 | 许可 | 主要借鉴 |
| --- | --- | --- |
| [pi-mono](https://github.com/badlogic/pi-mono)、[opencode](https://github.com/anomalyco/opencode)、[kimi-code](https://github.com/MoonshotAI/kimi-code)、[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)、[hermes-agent](https://github.com/NousResearch/hermes-agent)、[mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent)、[PiDeck](https://github.com/ayuayue/PiDeck) | MIT | 事件词汇表、会话存储、渲染管线、工具链语义 |
| [openai/codex](https://github.com/openai/codex)、[QwenLM/qwen-code](https://github.com/QwenLM/qwen-code)、[zai-org/zcode](https://github.com/zai-org/zcode)、[xai-org/grok-build](https://github.com/xai-org/grok-build)、[modelscope/agentscope](https://github.com/modelscope/agentscope) | Apache-2.0 | 审批/守卫、网络策略、turn 机器、多端形态 |
| [PI-Desktop](https://github.com/vastsa/PI-Desktop) | LGPL-3.0 | 供应商「模型配置」页形态（**只学行为，未复制代码**） |
| [models.dev](https://models.dev) | MIT（数据） | 内置模型参数目录（裁剪快照 `ui/model-catalog.json`） |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | 专有 | 仅阅读公开文档与产品行为（`THIRD_PARTY.md` 有专门勘误） |

各上游的 URL、commit SHA 与许可快照固定在 `oss/SOURCES.lock`
（上游克隆不入库；`THIRD_PARTY.md` 记录逐条引用与合规分级）。

## 仓库结构

- `src/` 内核与各域（kernel / session / models / policy / sandbox / host / mcp / …）
- `ui/` 桌面前端（零构建链静态资产 + `views/` 模块化）
- `src-tauri/` Tauri 桌面壳
- `tools/` 质量脚本（架构检查 / 许可审计 / 文档链接 / 功能计数）
- `docs/` 需求（337 条）、四层计划与执行记录、调研深读——内部开发过程文档，
  保留公开以完整呈现决策依据；其中历史端点地址已脱敏为 `<redacted-*>`。

## 行为规范

开发/协作请先读 [`AGENTS.md`](AGENTS.md)（仓库级规范）与
[`docs/requirements.md`](docs/requirements.md)（唯一权威需求文档）。
调研工作流的完整约定（上游克隆/快照/锚点核对/法律边界）见
[`docs/research/README.md`](docs/research/README.md) 与 `THIRD_PARTY.md`。
