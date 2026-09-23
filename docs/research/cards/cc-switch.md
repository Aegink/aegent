# cc-switch — farion1231/cc-switch

`f2537fd` · MIT (`Copyright (c) 2025 Jason Young`) · Tauri 2 · Node + Rust(245 个 .rs) · 收 PR · 有 clean-room 声明

> 你指定参考此仓做 J 层（多厂商模型配置）。**它不管理一个 agent，它管理八个 agent 的配置。**

1. **许可/合规**：MIT。泄露扫描命中 3 处，**逐条查证全是误报** ——
   CHANGELOG 那句是 *"Gemini Common Config No Longer **Leaks** Credentials"*（修的是自己泄露 API key 的 bug），
   README 命中处是赞助商文案。**无泄露源码。**
2. **技术栈**：**Tauri 2**，不是 Electron（对比：你 Q4 选了 Electron —— 见下方观察）。
   `src/` 前端 462 文件，`src-tauri/` 后端 245 个 `.rs`。
3. **受管应用**（代码证据，`app_config.rs:396` 的 `AppType` 枚举）：
   `claude` `claude_desktop` `codex` `gemini` `grok`/`grok_build` `hermes` `openclaw` `opencode` —— **八个**。
4. **核心难题**：八个目标应用的配置文件**格式各不相同**（`~/.claude.json`、`~/.grok/config.toml`、…），
   且各自有 live config 文件需要原地改写。
5. **关键设计（本仓最大价值）**：`src/lib/schemas/provider.ts` 里
   ```ts
   export const providerSchema = z.object({
     name, websiteUrl?, notes?,
     settingsConfig: z.string().min(1).superRefine((v, ctx) => {
       try { JSON.parse(v) } catch (e) { ctx.addIssue({...}) }
     }),
     icon?, iconColor?,
   });
   ```
   **`settingsConfig` 存的是不透明字符串，不是结构化对象，只校验"是合法 JSON"。**
   因为要为 N 个异构格式建模是维护灾难；存不透明 + 校验语法即可。
   **这是 J 层最该抄的一条。**
6. **存储**：SQLite（`cc-switch.db`，`rusqlite`）。DAO 划分：`providers` / `providers_seed` /
   `universal_providers` / **`failover`** / **`stream_check`** / `proxy` / `mcp` / `skills` / `prompts` / `profiles` / `settings`。
7. **两层 provider 模型**：`providers`（应用专属）与 `universal_providers`（跨应用共享）分开存。
8. **故障转移（`dao/failover.rs`）**：`FailoverQueueItem`，按应用分区：
   `get_failover_queue(app_type)` / `add_to_failover_queue` / `is_in_failover_queue` /
   `get_available_providers_for_failover`。**故障转移是队列，不是开关。**
9. **健康检查（`dao/stream_check.rs`）**：`StreamCheckConfig` + 日志表字段
   `provider_id, provider_name, app_type, status, success, message, response_time_ms, http_status, model_used, retry_count, tested_at`，
   并有 `cleanup_old_stream_check_logs(retain_days)` —— **带保留期清理**。
10. **可复用 vs 只学**：可复用（MIT，需登记）—— `AppType` 统一键的形状、`FailoverQueueItem` 的队列语义、
    健康检查日志字段集。只学行为 —— "不透明配置字符串 + 语法校验"的策略（**这条比代码更重要**）。
11. **评分**：内核 0（它不是 agent）· 沙箱 0 · UI 参考 3 · **多厂商配置参考 5**

## 两条观察（对你 Q4/Q5 的直接影响）

**观察 1：cc-switch 选了 Tauri 而不是 Electron。** 它同样是"多平台桌面 + 需要读写本地文件"的场景，
选了体积更小的 Tauri 2。你 Q4 定了 Electron（PI-Desktop/PiDeck 路线）—— 两者都可行，
但如果你在意安装包体积与内存占用，Tauri 值得再权衡一次。**这正是"哪个高效用哪个"（Q7）该应用的地方。**

**观察 2：它是"配置管理器"，不是"provider 抽象层"。** 它把 provider 当成
"一段要写进目标文件的字符串"来管，而不是"一个统一的调用接口"。这对你的 J 层有个直接含义：
**如果只做配置切换，抄它；如果要做统一的模型调用抽象（中途换模、failover 路由），
那部分它没有，需要你自己设计** —— 它的 `failover` 是"切换配置"，不是"运行时路由"。
