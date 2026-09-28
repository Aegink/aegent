# known-diffs —— 蓝本域分歧清单（T8）

> **纪律（文件头，随卡生效）**：以某上游为蓝本的域，落地时必须在本清单登记"对齐了什么 / 分歧是什么 / 为什么"；新蓝本域随其卡**追加条目**（只追加不替换）；分歧消失（上游演进或我方重构后语义趋同）时在条目标记并注明核对该，不删除条目。格式对齐 kimi·known-diffs.txt（逐条偏差 + 依据 pin）——pin 用计划卡号 + 完成记录，可回溯核对。
> **词汇表上游特殊案**：事件词汇表不设单一蓝本（三份上游实测后自定，见 §1）——其"分歧"即词汇表本体，演化记录在 [`l0-events.md`](l0-events.md) §8 落地记录。

## 蓝本域清单（P0 / P1 / P2 回溯汇总）

| # | 域（我方位置） | 蓝本上游 | 对齐（取了什么） | 分歧（不抄什么 + 理由） | 证据 pin |
| --- | --- | --- | --- | --- | --- |
| 1 | 事件词汇表（`src/kernel/events.ts`） | pi + DSH + zcode 三家实测 | pi 的封闭联合写法、DSH 的"无运行时对象"纪律 | **词汇表本体不抄任何一家**——以 l0-events.md §3 为准；生命周期 turn → step → message 三级（非 pi 两级）；stream 定为 `TimedStreamChunk[]`（不抄 DSH delta-run 打包） | plan-p0.md T-1-01 完成记录 |
| 2 | 会话存储（`src/session/db.ts`） | DSH sqlite | 同步 append 接口 + write-behind 缓冲 + turn 末 await flush 三层 | 不抄 OpenCode 的 JSON 文件树（展开卡研讨"冲突 5"已否决） | plan-p0.md T-1-02 完成记录 |
| 3 | 投影器（`src/session/project.ts`） | codex（bcode 文件） | "投影走快照 + 增量尾巴，禁止全量重放" | codex 那个文件是**合并器**（E3 提速件）不是投影器本体——投影器按 E16 fold 模式自研 | plan-p0.md T-1-04 完成记录 |
| 4 | host 协议（`src/host/protocol.ts`） | pi·protocol | 五形状：hello 版本握手（不匹配 hello_error）、request/response{id} 关联、事件推送信封、严格校验（未知属性拒绝 + 错误消息有界）、连接生命周期 | 不取 CBOR 与长度前缀帧（JSON 行协议在位——debug 可读，二进制优化无消费方）；不取 serverId/attachmentId 三级路由（单 host sessionId 一级足够）；不抄 Electron IPC invoke 桥 | plan-p1.md 批次 14 展卡结论 5 + K8 完成记录 |
| 5 | ACP 传输（`src/acp/`） | xai-acp-lib | JSON-RPC over stdio 行协议形状 + 独立包纪律（文件数硬约束 + 反向 import 断言） | 不抄 Rust 信箱实现与 agent-client-protocol 依赖（薄编解码 + 方法映射；ACP 方法名/参数按公开约定最小面落——规范全文对齐随真实客户端联调记档） | plan-p1.md 批次 9 对应卡完成记录 |
| 6 | 附件（`src/attachments/`） | kimi + pi-desktop | 类型化附件联合（source 分型 url/file）+ 存储可插接口 + 限额共享常量纪律 | 不抄 kimi 七目录包结构（单域目录足够）；session_media 分型不取（无该域，YAGNI）；Electron main/sidecar 双端共享机制不取（单进程——常量单一入口即可） | plan-p1.md 批次 12 附件卡完成记录 |
| 7 | 权限匹配（`src/policy/`） | zcode | 双维 Wildcard 形状 + 默认 ask 兜底 | 匹配方向用首匹配（不抄 findLast——T-5-01 既有语义，P1 T-P2-201 记档保持） | plan-p0.md T-5-02 完成记录 |
| 8 | 沙箱 Win32（win32-helper Rust） | dsh（SID）+ codex（helper） | dsh 的 SID 派生算法与 grant 形状（MIT 语义自研——Rust 侧重写不摘代码）；codex 的"helper 进程做全部 Win32、TS 侧仅调用"结构 | 不抄 codex 的 provisioning service / AppContainer 面（D16 域 P1 无需求） | plan-p1.md 批次 4 沙箱卡完成记录 |
| 9 | 提示词缓存（F9/F17，`src/kernel/assembly.ts`） | 语义自定（无单一蓝本） | 三纪律：稳定前缀（system/tools 锚）与动态尾分离；中途改动以追加表达不重写；压缩重放活前缀不冷写 | 不抄 anthropic 专有 cache_control wire（我方 openai-compat——机制按语义落，不发专有字段） | plan-p1.md 批次 5 缓存卡完成记录 |
| 10 | 写队列（`src/kernel/tools/` write/edit） | pi·file-mutation-queue | Map promise 链形状、失败不毒化后续（finally releaseNext）、Map 清理防泄漏 | 不取 canonical path 归一（env.realpath——P0 用 resolve 绝对路径；Windows 同文件不同大小写误判为不同路径是已知边界，符号链接归一随需要） | plan-p0.md T-4-04 偏离记录 |
| 11 | 测试快照归一（`src/test-support/`） | codex + dsh + kimi | 三家分工：假 HTTP（codex）+ 具名占位符归一化（dsh）+ 稳定标签与 previous 差分（kimi） | 不抄 kimi 的 tools 快照只打名字不打 schema（需求 §4 O 层负面发现——schema 纳入归一） | plan-p0.md O 件卡完成记录 |
| 12 | 工具并发（B17/B18，`src/kernel/budget.ts`） | codex（RwLock）+ pi（preflight） | codex 的"未声明即不可并行"= fail-closed 纪律；pi 的"preflight 顺序、执行并发"形状 | 不抄 tokio（我方 promise 并发原语） | plan-p1.md 批次 3 并发卡完成记录 |
| 13 | 插件/分轨（I6，`src/mcp/`） | pi-desktop（🔴 只学行为） | "可信轨同链直调、不可信轨隔离子进程且能力受限"分轨纪律 + "未实现的能力声明即拒绝安装（不是警告不是忽略）" | 不抄 Rust manifest 结构（我方 JSON manifest——P1 批次 3 已定形） | plan-p1.md 批次 3 I6 卡完成记录 |
| 14 | 会话 fork（E5，`src/session/store.ts`） | pi·storage.fork | "切点由 position 显式给出、非法切点即抛错"；"fork 产物是完整独立会话（历史复制、运行状态新鲜）" | 不抄 pi 的 AgentLane/Branch/Lane 多轨结构与 tree scope（多轨无消费方；树谱系归 E6——P2 批次 15a fork-tree 以流内事实重建，不建第二套 fork） | plan-p1.md 批次 7 E5 卡完成记录 |
| 15 | 统一 deadline（M7，`src/kernel/deadline.ts`） | dsh·util/timeout | deadline 是可查询的共享原语（绝对截止 + remainingMs + combine 取最近） | 不取 dsh 的 signal 融合形态（AbortSignal.any + Symbol.dispose——我方 promise 风格，等价纪律 = 错误带 code 由调用方按 code 路由）；`timeoutMs <= 0` 无超时哨兵不取（禁用由不构造表达） | plan-p2.md T-P2-301 完成记录 |
| 16 | 插件 SDK（I5，`src/mcp/plugin-sdk.ts`） | opencode·plugin | "SDK = 受限能力面 + 生命周期契约"行为 | 不抄其 client 句柄工厂形态（`(input) => Promise<Hooks>`——我方对象接口 + onActivate 领 token 更贴 manifest 地基） | plan-p2.md T-P2-302 记档 |
| 17 | hook 兼容（I7，`src/mcp/hook-compat.ts`） | dsh·packages/hooks | 兼容 = 输入/输出映射层（stdin/stdout 契约 → HookRegistry 调用） | 不抄双包结构（hooks-claude-code / hooks-codex——单域双适配器文件足够）；dsh 的 hook/invoked + hook/result 流内事件对不取（生态 hook 调用轨迹不进会话词汇表） | plan-p2.md T-P2-304 完成记录 |
| 18 | 会话引用（E9，`src/session/reference.ts`） | dsh·session-reference | "引用是流内事实 + 读取时注入内容"（流存引用不存内容） | 不抄其独立 context 包结构（单域目录足够）；正文内联 mention 语法（`@[label]` + `dsh-session:` URI）不取——引用由 wire/宿主显式给出 | plan-p2.md T-P2-107 记档 |

## 抽查一致性（T8 验收记录）

2026-09-28 抽查 5 域逐条开完成记录原文核对一致：词汇表（plan-p0.md:152）、会话存储（plan-p0.md:164）、投影器（plan-p0.md:188）、权限匹配（plan-p0.md:501）、host 协议（plan-p1.md:1741）——分歧表述与完成记录"不抄什么"行逐字对得上；其余条目同源汇拢（P2 条目 15~18 为本批收官时随卡回填）。
