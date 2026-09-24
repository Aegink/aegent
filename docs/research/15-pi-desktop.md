# PI-Desktop 代码精读（vastsa/PI-Desktop，**LGPL-3.0**，`a634b68`）

> ⚠️ **许可提醒**：LGPL-3.0。**行为可学，代码不可整段抄入**（与 MIT/Apache 的仓不同）。
> 本文件只记结论与设计，不摘实现。
>
> 前几轮我读了它 **321 篇 ADR**（见 `05-architecture-principles.md`）。
> 本轮补代码。范围：`crates/host-core/src/`。

---

## 0. 一句话

pi-desktop 的 `host-core` 里有两个**成熟度明显高于其他仓**的子系统：
**①崩溃后的启动期对账（`boot_maintenance`）；②多设备配置同步（`config_sync/`，含加密 vault、
三方合并、导入日志）。** 前者正好回答我方 L0 的"崩溃孤儿"问题，后者我此前**完全没意识到存在**。

---

## 1. ★ `boot_maintenance`：崩溃孤儿在**启动期**用 SQL 对账关掉

`crates/host-core/src/db/migrations.rs:6` 起。host 每次启动时执行：

```sql
UPDATE turns SET status='aborted', error_code=COALESCE(error_code,'TURN_ABORTED'), ended_at=?1
  WHERE status='running'
UPDATE task_runs SET status='aborted', ended_at=?1 WHERE status='running'
```

然后对 `plan_approvals` 做分级打断，**两种不同结局给两个不同错误码**：

| 原状态 | 变成 | 错误码 |
| --- | --- | --- |
| `status='pending'` | `interrupted` | `PLAN_APPROVAL_INTERRUPTED` |
| `execution_state IN ('queued','running')` | `interrupted` | `PLAN_EXECUTION_INTERRUPTED` |

并 `version = version + 1`（乐观并发）。代码注释给出了**设计原则**（原文）：

> **No durable Plan work is safe to replay after a host restart.** Keep terminal approved session
> configuration intact, but **interrupt every pending approval and execution descriptor** that
> could otherwise be returned as queued to the desktop runner.

### 1.1 与 DSH 的对照（同一个问题的两种解法）

| | pi-desktop | DSH |
| --- | --- | --- |
| 手段 | **启动期对账**：把所有 `running` 改成 `interrupted` | **执行纪元（epoch/generation）**：过期代不能写 |
| 位置 | DB 维护任务 | 持久化权威分代 |
| 哲学 | **什么都不重放** | **旧代的工作不重放** |

两者都不重放，但**pi-desktop 更暴力也更简单**：重启即宣告"上一代的进行中工作全部作废"。

> **对我方 L0 的价值**：我在 `docs/l0-events.md` 里设计了
> `TurnEndReason = { kind: "interrupted" }`「**崩溃孤儿闭合，loop 永不实时发出**」，
> 但**没写"谁在什么时候发"**。pi-desktop 给出了答案：
> **由启动期的对账任务发**，且**按对象类型细分错误码**（审批被中断 ≠ 执行被中断）。
> 这条应当补进 L0 的配套说明。

### 1.2 顺手记两个保留策略常量

```rust
const AUDIT_RETENTION_MS: i64 = 90 * 24 * 3600 * 1000;   // 审计保留 90 天
const TASK_RUNS_KEEP: i64 = 100;                          // 任务运行记录保留最近 100 条
```
以及 `CREATE INDEX IF NOT EXISTS idx_turns_ended_at ON turns(ended_at DESC)` —— **为"最近会话"查询建的索引**。

---

## 2. ★ `config_sync/`：一个我此前完全不知道存在的子系统

`crates/host-core/src/config_sync/` **13 个文件**（`engine.rs` 1,654 行、`transport.rs` 954 行）：

```
engine.rs  engine_remote.rs  engine_history.rs   → 同步引擎与历史
crypto.rs                                        → 加密 vault（create_vault / unlock_vault /
                                                    rewrap_vault / encrypt_object / decrypt_object）
transport.rs                                     → WebDAV 传输
merge.rs                                         → 三方合并，有 MergeConflict 类型
apply.rs                                         → apply_bundle + recover_import_journal
domains.rs  domains_capture.rs                   → 可移植实体（PortableEntity）、
                                                    CategorySelection、LocalSnapshot、RevisionManifest
coordinator.rs                                   → sync_if_enabled / sync_now
handlers.rs                                      → approve / reject / restore / pause /
                                                    change_password / unlock / disconnect
```

**能力清单**：把配置（providers、MCP servers、agent capabilities、项目映射等）
**加密后经 WebDAV 同步到多设备**，带**修订清单（RevisionManifest）**、
**三方合并与冲突（MergeConflict）**、**导入日志与崩溃恢复（recover_import_journal）**、
**审批/拒绝/恢复/暂停的完整句柄**、**改密码与 vault 重包裹（rewrap_vault）**。

> **对我方的影响**：
> 我此前把"配置管理"当作 cc-switch 那个层面的东西（我记过 "ccs 全行业最好指的是配置管理"）。
> **pi-desktop 把它做成了产品内的一等子系统**，且解决了三个我们不面对但不该忽略的问题：
> ①**加密**（配置里有 API key）②**多设备合并冲突**（不是覆盖）③**导入过程可崩溃可恢复**。
> **新增待定11：我方的配置是否要跨设备同步？** 若要，这是一个独立子系统的工程量，
> 不是"配置文件放哪儿"的问题。
>
> **注意**：`merge.rs` 的存在本身说明 **pi-desktop 拒绝了"最后写入者胜"** ——
> 与我本轮从 Codex（`permission_profile_intersection`）和 kimi-code（四层 AND）得到的
> **"合成只能取交、不能覆盖"** 是同一条原则在**配置域**的又一次出现。**第三个独立实现。**

---

## 3. 插件清单校验：安装期全量校验，拒绝即失败，且**明确拒绝实现不了的功能**

`crates/host-core/src/plugins/validation.rs`。`validate_contributions(root, manifest)`
对 `contributes` 逐字段校验，**错误一律带类型码 `PLUGIN_INVALID: ...`**：

- `contributes` 必须是对象；`contributes.settings` 必须是数组
- **setting key 必须合法且不得重复**（`is_setting_key` 校验格式）
- `title` 必填且**不得空白**（`.map(|t| t.trim().is_empty()).unwrap_or(true)` → 空白即失败）
- `type` 必须是**闭集**：`string | number | boolean | select | json | shortcut`

**★ 最值得抄的一条**：

```rust
if obj.get("secret").and_then(Value::as_bool) == Some(true) {
    bail!("PLUGIN_INVALID: setting {key} cannot be secret in this release");
}
```

**"本版本不支持 secret 类型的设置，所以直接拒绝声明它的插件"** ——
不是忽略该字段、不是降级处理、不是警告，**是 bail**。
**该能力没做完就不许声明**，fail-closed 到"拒绝加载"。

> **对我方 I 层（扩展）**：插件清单**安装期**全量校验、**闭集枚举**、
> **不允许空白**、**未实现的能力直接拒绝声明**。
> 这比我方现在"扩展点先留着"的思路安全得多：**一个被声明但不生效的字段，
> 会让插件作者以为它在生效** —— 与 §五 的"权限配置静默不生效"是同一类故障。

---

## 4. 附带收获：`host-core/src/` 的模块清单本身就是一份**分层名册**

```
activation  agent_capabilities  artifacts  audit  config_sync  db  keyboard
mcp_servers  network_policy  network_proxy  notifications  permissions  plans
plugin_sessions  plugin_usage  plugins  providers  review  rpc  scheduled
scratch  secrets  session_collaboration  session_search  sessions  state
tool_budget  tools  transcripts  turn_queue  user_skills  user_subagents  workspace
```

对照我方 19 层，**其中有几个是我方没有独立列出的**：

| pi-desktop 模块 | 我方对应 | 备注 |
| --- | --- | --- |
| `tool_budget.rs` | B 层的重试预算 | **有独立文件**，说明这不是小功能 |
| `scratch.rs` | 无 | **草稿区** |
| `turn_queue.rs` | A 层 steer/排队 | 独立模块 |
| `session_search.rs` | Q 层检索 | 独立模块 |
| `session_collaboration/` | N 层 | 独立目录 |
| `plugin_usage.rs` | I 层 | **插件的用量统计** |
| `user_subagents/` | H 层 | 用户自定义子 agent |
| `network_proxy.rs` | D 层 | **代理是独立模块**（不是网络策略的一部分） |
| `artifacts.rs` | 无 | 产物 |

> 建议：把这份清单与我方 19 层做一次**双向覆盖检查**（我方有哪些它没有、它有哪些我方没有）。
> **这是本轮唯一一个"清单 vs 清单"的可操作产出。**

---

## 5. 诚实声明：未读

- `crates/host-core/src/rpc/mod.rs`（**8,810 行，全仓最大**，RPC 面）—— **只看了文件名**
- `crates/host-core/src/sessions.rs`（6,779）—— **未读**
- `crates/host-core/src/tools/mod.rs`（4,435）与 `tools/shell.rs`(926) —— **未读**
- `crates/host-core/src/permissions.rs`、`review.rs`、`agent_capabilities/`
  —— **未读**（**这是 pi-desktop 的权限主战场，本轮没读，是明显缺口**）
- `config_sync/` 的 13 个文件 —— **只读了 `engine.rs` 的 import 区与 `ls`**，
  `merge.rs` / `crypto.rs` / `apply.rs` **一行未读**
- `packages/agent-host`、`agent-runtime`、`host-runtime`、`plugin-sdk`、`racp` —— **未读**
- `apps/desktop/`（渲染层）—— **未读**
- 321 篇 ADR —— **本轮未读**（前几轮读过一部分）
- `docs/spec/`、`docs/architecture/`、`docs/superpowers/` —— **未读**

**本报告是"启动期对账 + config_sync 的存在性 + 插件校验 + 模块名册"四点。**
**不是对 PI-Desktop 的评估。**
