# {{NAME}}

本地优先的多端 AI Agent 内核——**最小语义面 + 装配全外置**。零宿主假设：
内核不依赖任何 UI、服务端或产品形态，宿主（CLI / Web / IM / 桌面 / 嵌入式）
以装配数据接入。

是从 [aegent](https://github.com/Aegink/aegent) 平台抽取的独立内核层
（原仓 AGPL-3.0；**本仓由版权所有者授权以 Apache-2.0 发布**——允许自由
商用、闭源集成、二次分发）。

## 特性

- **纯内核**：`src/core/` 单一公开入口（0 骨架 + 循环/会话/工具原语 + 契约面），
  跨域深导入禁令 + 架构检查器（0 error 纪律）。
- **进程隔离**：1 会话 1 子进程（stdio JSON-RPC + hello 版本握手），
  崩溃/取消/看门狗不伤宿主。
- **事件源会话**：SQLite 事件流 + write-behind 落库 + 三类恢复降级
  （strict / lenient / discard）+ 投影可重建 + 崩溃点原子界
  （commit 批：事件+标题+血统+文档同事务）。
- **权限全栈**：四层规则链 + 审批 broker + 审批竞速（hook 慢/挂死不阻塞
  用户点击）+ scope=always 规则写回 + 计划模式进出权限 + 配置行级写回。
- **子代理与编排**：内核级子代理 runner（resume / task_send 定向投递 /
  steer）+ 跨会话协作（collab 七动作 + 环检测 + 4/16 在途上限）+
  无人值守调度（cron + 冷恢复 + 只补最近一次）。
- **插件面**：manifest + 17 权限闭集 + 8 能力分片 + 贡献↔权限绑定校验 +
  热重载能力变宽即拒 + 常驻服务 broker + 声明式总线 + OTel 遥测三实现。
- **模型适配**：anthropic-messages / google-generate / openai-compat 三适配器
  + 2647 条内置模型目录（数据化生成，用户配置优先兜底）+ 换模型压缩阈值跟随
  + 重试/故障容忍/健康探测/缓存健康。
- **工具面**：42 个可注册内置工具（16 常驻 + 26 条件注册），
  描述文件外置（改文案零代码 diff），spill 配额、变异预算、后台 shell、
  read-gate 记账、win32 受限令牌沙箱。

## 快速开始

```bash
npm install        # 依赖：better-sqlite3（+ 可选 ws / undici / fetch-socks）
npm test           # vitest 全量（280+ 文件）
npm run check      # tsc 类型检查
npm run architecture:check   # 架构治理（域白名单/深导入/行数纪律）
npm run models:check         # 模型目录与数据源同步校验
```

最小装配示例（内存后端零 native 依赖）：

```ts
import { SessionEventStore, InMemoryEventStorage } from "./src/session/store.js";
import { Projector } from "./src/core/index.js";

const store = new SessionEventStore(new InMemoryEventStorage());
store.append("s1", [{ type: "turn/start", turn: 1 }]);
```

## 目录结构

```
src/core/          纯内核：骨架（事件/循环/队列/看门狗）+ 契约面 + 原语
src/runtime/       装配与进程：assembly / agent-process / child 入口
src/ext-builtin/   能力外置：plugin-runtime / prompt-defaults / subagent-engine
src/session/       事件存储与投影：store / db / migration / collaboration
src/policy/        权限：规则链 / broker / gate / 审批竞速 / 写回
src/models/        模型适配 + 内置模型目录（数据化生成）
src/scheduler/     调度：cron / offpeak / jobs 面
src/diagnostics/   诊断：遥测 sinks / 成本
plugins/tools-builtin/  内置工具包（可裁剪注册）
```

## 治理

- `architecture-policy.json`：20 域白名单 + requires 声明（`npm run architecture:check`）。
- `tools/kernel-edges.mjs`：内核边检查（core 零出边 + 单一入口）。
- `tools/vocabulary-check.mjs`：词汇表纪律。
- 依赖环收紧路线与 P2 技术债台账见主仓
  [W16 排查报告](https://github.com/Aegink/aegent/blob/main/docs/20261011_内核重构W16全面排查报告.md)。

## 许可

Apache License 2.0（见 LICENSE / NOTICE）。第三方组件登记见 THIRD_PARTY.md。
