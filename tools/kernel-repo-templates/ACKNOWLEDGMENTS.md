# 致谢（ACKNOWLEDGMENTS）

{{NAME}} 的架构与实现建立在前人工作之上。本文件按贡献方式分类致谢，
第三方组件许可登记见 [THIRD_PARTY.md](THIRD_PARTY.md)。

---

## 一、设计借鉴（行为研究 · 零代码复制）

以下开源项目的公开代码与设计文档为内核的关键决策提供了研究样本。
**本软件未复制其代码**（逐项许可核验见 THIRD_PARTY.md 的许可分级实况），
仅在行为层面参考与再设计：

| 项目 | 许可 | 借鉴面 |
|---|---|---|
| [pi](https://github.com/earendil-works/pi)（earendil-works） | MIT | agent 双层循环与策略钩子、提示队列语义（all / one-at-a-time）、模型目录数据化生成、工具负载差量声明、输出截断即整批拒绝纪律、压缩挂点 |
| [PI-Desktop](https://github.com/vastsa/PI-Desktop)（vastsa） | LGPL-3.0 | 多会话编排方向盘（collab）、子代理生命周期、审批竞速第二出口（**仅行为研究，未链接、未复制**） |
| [opencode](https://github.com/anomalyco/opencode) | MIT | runTask 单轮语义、工具调度模型 |
| [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek） | MIT | 事件词汇设计、工具调用配平不变量、continuable 回投 |
| [ZCode](https://github.com/zai-org/ZCode)（zai-org） | Apache-2.0 | 审批竞速、配置热刷新分层、输出触顶续跑 |
| [kimi-code](https://github.com/MoonshotAI/kimi-code) | MIT | 配置行级写回（保注释原子编辑）、turn 结算产物自报 |
| [codex](https://github.com/openai/codex)（OpenAI） | Apache-2.0 | 工具保留声明（在途 step 工具集快照）、沙箱分级与升级审批 |
| [hermes-agent](https://github.com/NousResearch/hermes-agent) | MIT | 模型目录三纪律（去重 / 每厂商上限 / 发现兜底） |
| [agentscope](https://github.com/modelscope/agentscope) | Apache-2.0 | 权限档位归一 |
| [qwen-code](https://github.com/QwenLM/qwen-code) | Apache-2.0 | Agent 交互范式 |
| [grok-build](https://github.com/xai-org/grok-build) | Apache-2.0 | 插件信任降级（trust.rs 语义） |
| [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) | MIT | 最小内核哲学 |
| [Mini-Agent](https://github.com/MiniMax-AI/Mini-Agent) | MIT | 轻量 Agent 结构 |
| [pi-mono](https://github.com/lue-labs/pi-mono) | MIT | monorepo 包边界 |
| [PiDeck](https://github.com/ayuayue/PiDeck) | MIT | 任务编排视图 |

## 二、特别致谢

- **[Claude Code](https://github.com/anthropics/claude-code) 团队**（Anthropic）：
  其公开产品行为与官方文档为权限模型（审批分级、计划模式、规则持久化）、
  工具契约（参数校验、进度上报）与 Agent 交互范式提供了重要参考。
  本项目**仅研究其公开行为与文档，未使用任何专有代码**
  （该产品为专有软件，本仓经许可核验确认零复制）。

## 三、运行时依赖

感谢以下开源库的维护者（许可登记见 THIRD_PARTY.md）：

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) —— 同步 SQLite 绑定，
  会话事件流的存储基石（MIT）；
- [ws](https://github.com/websockets/ws) —— WebSocket 实现（MIT）；
- [undici](https://github.com/nodejs/undici) —— 高性能 HTTP 客户端（MIT）；
- [fetch-socks](https://github.com/Kusabi/fetch-socks) —— SOCKS 代理分发器（MIT）。

## 四、工具链

感谢 [TypeScript](https://github.com/microsoft/TypeScript)、
[Vitest](https://github.com/vitest-dev/vitest)、
[Node.js](https://github.com/nodejs/node) 社区提供的开发基础设施。

## 五、贡献者

感谢所有为本项目提交代码、报告缺陷、参与讨论的贡献者。
（贡献者名单随项目发展更新。）

---

如果你认为本项目的致谢存在遗漏或不当之处，请提交 Issue 或 PR 指正——
我们尊重每一位开源作者的工作。

Copyright 2026 Aegink · Licensed under the Apache License, Version 2.0
