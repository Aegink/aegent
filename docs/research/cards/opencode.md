# opencode — anomalyco/opencode (= sst/opencode)

`18ef3cc` · MIT · 219M · Node/TS monorepo（40+ 包）· 收 PR · 有 clean-room 声明
> 两 owner 同 commit 同 tree（`9c24c963`），只克隆一份。

1. **许可/社区**：MIT (`Copyright (c) 2025 opencode`)。有 CONTRIBUTING/SECURITY/AGENTS.md。
   SECURITY.md 声明「不接受 AI 生成的安全报告，提交即封禁」。
2. **分层**：40+ 包，多端覆盖最全。`core/`(内核) `opencode/`(主实现) `llm/` `protocol/` `server/`
   `sdk/` `plugin/` `session-ui/` + 端壳 `tui/` `app/` `web/` `desktop/` `console/` `enterprise/`
   + **`slack/`（IM 适配器）**。kernel/host/ui 分离清晰。
3. **Loop**：`packages/opencode/src/session/processor.ts` + `llm.ts`；`core/src/session/run-coordinator.ts`
   + `execution/` + `runner/`。`session/retry.ts` `overflow.ts` `revert.ts` `status.ts` `run-state.ts` 各自独立。
4. **工具**（`tool/registry.ts` 注册）：`read` `write` `edit` `apply_patch` `glob` `grep` `shell`
   `task`(子代理) `todo` `webfetch` `lsp` `skill` `question`(HITL 提问) `plan`(PlanExit)
   `code-mode` `mcp-websearch` `invalid` `external-directory`。
   每个工具旁挂同名 `.txt` 作描述文件（如 `plan-enter.txt`/`plan-exit.txt`）——**工具提示词与代码分离**。
5. **会话**：**正在迁移，两套并存**。
   (a) 旧：JSON 文件树 `storage/session/message/<sid>/<mid>.json`、`part/<sid>/<mid>/<pid>/*.json`、`session_diff/`；
   (b) 新：`core/src/session/store.ts` 用 **drizzle ORM + SQL 表**（`SessionMessageTable`/`SessionTable`）。
   `core/src/session/{event.ts,projector.ts,history.ts,context-epoch.ts}` = 事件源 + 投影。
6. **扩展**：`plugin/` 包 + `@opencode-ai/plugin` 的 `ToolDefinition`（工具可由插件注册）+ MCP + `AGENTS.md`。
7. **多端**：`server/`+`protocol/`+`sdk/`；端壳含 **`slack/`**（IM）、`desktop/`、`web/`、`tui/`。多端参考价值最高。
8. **权限模型（本层最高价值发现）** — `packages/opencode/src/permission/index.ts`：
   ```ts
   rulesets.flat().findLast(rule =>
     Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)
   ) ?? { action: "ask", permission, pattern: "*" }
   ```
   - **`findLast` 后匹配优先**（可覆盖规则，非累积）
   - **默认落回 `ask` 而非 `allow`**
   - 双维度通配：`permission="bash"` × `pattern="git *"`
   - 审批以 `Deferred` 挂在 `pending: Map`，接口 `ask`/`reply`/`list` → **审批可跨端异步回转**
9. **安全（关键）**：`SECURITY.md` 明确 **No Sandbox**：
   > OpenCode does **not** sandbox the agent. The permission system exists as a **UX feature**
   > ... it is **not designed to provide security isolation**.
   与 pi 结论一致：权限是 UX，不是安全边界。沙箱须自建。
10. **评分**：内核 4 · 沙箱参考 1 · UI 参考 5(`tui`+`app`) · 多端参考 **5**(`slack`+`desktop`+`server`)
