# test-policy —— 测试基建政策（O28）

> **性质**：keyless 快照层与测试基建是**受治理的包组**（`src/test-support/`，architecture-policy `managed:true` 域）——本文件是其政策化成文：域清单 / keyless 纪律 / 升降级规则 / 使用规约。上游锚 dsh·test-support（7 包 22,817 行的包组形态——只取政策化行为，不取其规模与包结构，见 [`known-diffs.md`](known-diffs.md)）。

## 1. 域清单（test-support 现有件）

| 件 | 职责 | 来源需求 | 配套测试 |
| --- | --- | --- | --- |
| `event-asserts.ts` | 事件流断言方法——在真实事件流上断言不变量（沿流推进的追踪器断言"关系"，不写事件列表） | O7–O11 | `event-asserts.test.ts` |
| `fault-server.ts` | 具名故障剧本库——恢复类逻辑的故障注入（每次请求消费下一剧本） | O16 | `fault-server.test.ts` |
| `http-mock.ts` | 网络边界 mock——本机真端口 HTTP server + 脚本化响应序列（按序消费，多调即报错） | O2 | `http-mock.test.ts` |
| `isolation.ts` | 进程全局状态隔离——全局单例/环境的隔离守卫 + 故障机制注释 | O25 | `isolation.test.ts` |
| `llm-replay.ts` | 录制/回放真实模型流——录制 JSONL fixture，first-call 序消费（避免手写 mock 漂移） | O15 | `llm-replay.test.ts` |
| `migration-asserts.ts` | 迁移断言基建——schema 迁移的升级/降级/前向兼容三类语义 | O19 | `migration-asserts.test.ts` |
| `normalize.ts` | 易变值归一化 + 稳定标签 + 长行截断/指引标签化（O27）——keyless 的机制层 | O3/O5/O6/O27 | `normalize.test.ts` |
| `render.ts` | 上下文快照渲染——窗口内差分（首条全量、后续只留新增后缀） | O14/O24 | `render.test.ts` |
| `snapshots.ts` | 模型上下文快照——`GenerateInputSnapshot{input, previous}` + 稳定文本 | O1/O5/O10/O21 | `snapshots.test.ts` |
| `tmp-fs.ts` | 测试夹具落盘助手——集中落盘面，业务域目录不出现 fs 写函数字面量 | T-6-01 | —（被证伪断言消费） |

## 2. keyless 纪律（成文）

快照与断言基建**不得依赖机器、时间、路径、身份的具体值**。落成两条：

1. **易变值必须归一化**：字符串里的 cwd / tmp 路径、ISO 时间戳、时间键数值走 `normalizeValue` 的具名占位符（`{{cwd}}` / `{{tmp}}` / `{{eventTime}}`）；UUID 走 `StableLabels` 稳定标签（`{{uuid:N}}`）——占位符抹掉身份、稳定标签保留身份，禁止在快照里落原始值。
2. **长文本必须有界**：超长行（>160 字符）由 `truncateLines` 截断（`…[truncated N chars]` 尾标）；已知长指引段（persona 等）由 `tagKnownDirectives` 标签化——diff 只反映真实差异（O27）。

**keyless 复核**（规格即断言）：`snapshots.test.ts` 的 keyless 复核用例断言同一快照两次渲染逐字节相等；跨进程的逐字节等由全量测试多次运行覆盖（任何一次全量绿即一次复核——CI 方差出现即 keyless 被破坏，先查归一化缺口）。

## 3. 升降级规则

- **入组条件**（同时满足其一即可，满足两条优先）：
  1. 被 ≥2 个测试文件复用的断言/夹具逻辑（复用即治理——复制粘贴是散件回潮）；
  2. 某条需求的机验载体（如 `event-asserts` 之于 O7——纪律必须有 helper 承载才可被持续消费）。
- **入组动作**：新件放 `src/test-support/`（managed:true 域——新文件自动受行数与依赖检查约束）；头注释写明职责 + 来源需求 + 上游锚（若取自上游）；**必须有配套自测**（`<件名>.test.ts`——基建自己无测试等于没有）。
- **废弃条件**：无消费方一个批次周期以上 + 对应需求不再被引用 → 在头注释标记 deprecated 并在下一批删除（标记先行，直接删除禁止——消费方可能在快照文本里）。
- **变更纪律**：helper 的**输出语义**变化（归一化形状/截断常量/断言口径）必须：①全量回归绿；②受影响的既有快照显式更新（更新即收紧，禁止放宽断言迁就输出）；③在来源卡完成记录记档。

## 4. 使用规约（哪个场景用哪个件）

| 测试场景 | 用哪个件 | 禁止的替代做法 |
| --- | --- | --- |
| 断言"事件流上发生了什么/顺序关系" | `event-asserts`（流上追踪器） | 手写期望事件数组逐项 deepEqual（脆弱且挡新事件类型） |
| 断言"模型看到了什么"（主断言面） | `snapshots` + `render`（窗口差分） | 直接断言内部 messages 数组字段值 |
| mock 模型/HTTP 端点 | `http-mock`（真端口 + 脚本序列） | 手写 fetch stub（绕过真实 SSE/HTTP 路径） |
| 回放真实模型流样本 | `llm-replay`（录制 fixture） | 手写"我以为是真实流"的剧本（漂移） |
| 注入网络/流故障 | `fault-server`（具名剧本） | 测试里现场拼坏响应（不可复用不可枚举） |
| 隔离进程全局状态（env/单例） | `isolation`（守卫 + 故障机制注释） | 直接改全局再手工恢复（泄漏到并行测试） |
| 断言 schema 迁移 | `migration-asserts` | 手写版本号断言（缺前向兼容面） |
| 测试夹具落盘 | `tmp-fs`（集中落盘） | 业务域文件里直接 `node:fs` 写字面量 |
| 归一化易变值 | `normalize`（占位符 + 稳定标签） | 正则现场替换（形状各自漂移） |
