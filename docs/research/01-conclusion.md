# 调研结论（1 页）

**快照日期**：2026-09-23 · 对应 `oss/SOURCES.lock`（16 个上游，commit 见该文件）

---

## 一句话结论

**没有任何一个仓可以直接当内核用；但每个仓都有一到两处别人踩过坑才得到的正确形状，值得定点抄。**

你原来的假设大体成立，但有两处需要修正：

| 你的假设 | 实测结果 |
|---|---|
| Kernel 用 Pi agent-core | **成立**。`packages/agent` 分层最干净，内核/host/ui 彻底分离 |
| Policy/Sandbox 学 Codex + PI-Desktop，自写 | **成立，且理由比你想的更强**——见下 |
| 长任务学 DSH goal/compact/job | **成立**。`packages/{goal,jobs,compaction}` 三套齐全 |
| Session 学 Pi 树 + Kimi 事件源 | **成立**。Pi 确有 `{scope:"branch"}\|{scope:"tree"}` |
| 多端壳学 Qwen/ZCode/Hermes/PI-Desktop | **修正**：Qwen 把 ACP 塞进 CLI 包内，是**反面例子**；正例是 Grok 的独立 `xai-acp-lib` crate |

---

## 三个最重要的发现

### 1. 两个最像内核的仓，明确声明不做沙箱

- Pi `SECURITY.md`：信任边界 = 本地用户账号，"由用户自行用容器/虚拟机关起来"
- OpenCode `SECURITY.md`：*No Sandbox*，"权限系统是 **UX feature**……**不提供安全隔离**"

它们这么选是因为假设**单用户 + 本地终端 + 用户自己盯着**。
而你的拓扑里 **Web 和 IM 端的请求不是盯着终端的人发的**——一条被转发的 IM 消息就能触发执行。
**这个假设对你不成立，所以沙箱必须自建，且必须在 P0。** 能抄的只有 Codex 和 DSH（`packages/sandbox/`）。

> **修正（2026-09-23 二次核实）**：初版称"Codex 沙箱深绑 bubblewrap/Landlock，抄不进来"，
> **对 Windows 是错的**。Codex 有五个后端，含两个 Windows 后端：
> `WindowsSandboxLevel = { Disabled(默认), RestrictedToken, Elevated }`。
> 非提权后端 `codex-rs/windows-sandbox-rs`（65 个 .rs：ACL 递归拒绝读 + 能力 SID + AppContainer + DPAPI）。
> **这是 Windows 目标下最该细读的实现。**

### 2. 权限系统有一份可直接复用的正确形状（OpenCode）

`packages/opencode/src/permission/index.ts` 的 `evaluate` 三个点必须一起抄：

```
findLast 后匹配优先  +  默认落 ask（非 allow）  +  permission×pattern 双维度通配
```

配套的 `Deferred` 挂 `pending: Map` + `ask`/`reply`/`list` 接口，
**同时解决了"C 层审批"和"N 层审批跨端回转"两件事**——不需要自创协议。

### 3. 不要复制别人正在进行的迁移

OpenCode 的会话存储**此刻正处于 JSON 文件树 → drizzle/SQL 的迁移中间态**，
仓里两套并存（`storage/` 与 `core/session/store.ts`）。Kimi 也留着 `sessionLegacy`。
这是**历史包袱的现场**。你从零开始，直接上"事件源 + SQL"，跳过这一步。

---

## 建议的选型（与你的原方案差异已标注）

| 层 | 主学 | 与原方案的差异 |
|---|---|---|
| Kernel | Pi | 一致 |
| Tools | OpenCode（`.txt` 分离）+ Pi（写队列） | 补充 |
| Policy | **OpenCode** `evaluate` | 原方案说自写——现建议直接抄形状 |
| Sandbox | **Codex** + DSH 可插后端 | 一致 |
| Session | Pi fork 抽象 + Kimi transcript | 一致 |
| Context | OpenCode（overflow/compaction 分离） | 补充 |
| Planning | DSH goal 四件套 + OpenCode plan 提示词文件化 | 补充 |
| Subagents | OpenCode（task 工具）+ DSH（结算栅栏） | 补充 |
| Models | Pi/OpenCode 独立包 + Kimi OAuth 独立 | 补充 |
| Surfaces | **Grok**（ACP 独立 crate）+ PI-Desktop（远程 host） | **修正**：Qwen 是反例 |
| Observability | Codex rollout-trace + reducer | 补充 |
| 长任务 | DSH + Codex 恢复 + Qwen idle-reaper | 一致 |

**P0 是 17 个文件的最小闭环**（详见 `04-module-map.md`）。
**P0 跑通前不写任何 UI。**

---

# 排除清单

**无仓库需要排除。**

`tools/license-audit.sh` 扫描 16 个仓（`oss/` 15 + `refs/` 1），2026-09-23：

| 检查项 | 结果 |
|---|---|
| 泄露镜像 / 自述源自 leaked Claude Code | **0 命中** |
| 缺少 LICENSE 文件 | 0（16/16 有） |
| 专有 sourcemap | 0 |
| 明确 clean-room 声明 | 7 个：codex、deepseek-harness、mini-swe-agent、**pi**、**pi-mono**、pideck、qwen-code |

初版正则含裸词 `leaked`，曾命中 8 个仓十余处，**逐条查证全是普通技术用语**
（`leaked loop variables`、`values leaked by outcome/cleanup`、`avoid leaked processes`、
`leaked agent worktree registrations`）。正则已收紧为必须与 `claude`/`anthropic` 同现。

## 但有两条许可约束必须遵守

| 仓库 | 许可 | 约束 |
|---|---|---|
| `vastsa/PI-Desktop` | **LGPL-3.0** | 可链接调用；**不可整段抄入 `src/`**（若修改其库本体并分发须回馈） |
| `anthropics/claude-code` | **PROPRIETARY** | `© Anthropic PBC. All rights reserved.` + 商业条款。**只读行为，一行代码都不能摘** |

另有**授权矛盾未决**：`anthropics/claude-code` 的 `plugins/hookify/README.md` 与
`plugins/plugin-dev/README.md` 自称 "MIT License"，但仓根 `LICENSE.md` 是专有许可，
且 `plugin-dev` 写的 "See repository for details" 正指向那份专有许可。
**当前按最保守处理：只读行为。** 若要复用需向作者（Daisy Hollman, daisy@anthropic.com）取得书面澄清。

---

# 建议克隆/加 star 但**不要 fork** 的仓

理由统一：**你要的是形状，不是代码**。fork 会让你背上同步上游的成本，而收益只是几个可以照着重写的抽象。

| 仓库 | 为什么只要 star |
|---|---|
| `earendil-works/pi` | 抄 `AgentEvent`/`AgentTurnDecision`/`ForkCurrentStatePlan` 三个类型形状即可，实现要按你的沙箱前提重写 |
| `anomalyco/opencode` | 抄 `evaluate` 的 11 行 + `Deferred/Map` 审批模型。整仓 219M，40+ 包，绝大部分是端壳，与内核无关 |
| `openai/codex` | 沙箱是 Rust 且深绑 bubblewrap/Landlock，抄不进来；要学的是**网络策略独立**与 **flush-before-snapshot** 这类纪律 |
| `deepseek-ai/deepseek-harness` | goal/jobs 的设计值得学，但它是按"关注点即包"重组织的，直接搬会带来 30+ 个包的依赖面 |
| `MoonshotAI/kimi-code` | 学 `transcript` 独立包 + index/export/legacy 三分；其 legacy 兼容层不该继承 |
| `QwenLM/qwen-code` | **只读它的 `docs/design/*.md`**（crash-recovery / idle-reaper / recap），代码组织是反面例子 |
| `xai-org/grok-build` | 学 `xai-acp-lib` 抽独立 crate 的形态 |
| `vastsa/PI-Desktop` | LGPL，**法律上就不宜 fork 进闭源内核**；学其远程 host + 进程外插件架构 |
| `ayuayue/PiDeck` | 学 `FeishuBridge.ts` 的 IM 桥写法；它是 Electron 壳，形态与你的目标不同 |
| `zai-org/ZCode` | 学"生成式 bash 命令注册表"与遥测契约 |
| `NousResearch/hermes-agent` | 学 `acp_adapter/` 整目录做 ACP 的职责划分 |
| `lue-labs/pi-mono` | 与 pi 同作者（Mario Zechner），是 pi 的相关实现，观察用 |

**不要 fork 的核心原因**：这 12 个仓全部在活跃演进（本次快照中 15/16 的上游提交日在 2026-09-21~23）。
fork 意味着你要持续吸收它们的变更，而你的内核会因为沙箱前提不同**必然分叉**。
用 `oss/SOURCES.lock` 记 commit、按需重读，比 fork 划算得多。

---

# 下一步本机验证命令

按顺序执行，每条都说明"从哪读到哪"。**全部为只读操作。**

```bash
cd /f/aegent

# 1. 确认快照未变，拿到本次报告对应的上游 commit
cat oss/SOURCES.lock

# 2. 验证权限模型三个要点（findLast / 默认 ask / 双维度通配）
sed -n '/export function evaluate/,/^}/p' oss/opencode/packages/opencode/src/permission/index.ts

# 3. 验证 Pi 的停止条件是显式决策，而非隐式约定
grep -n "AgentTurnDecision\|QueueMode" oss/pi/packages/agent/src/types.ts

# 4. 验证 Pi 同时支持线性分支与树 fork
grep -n "ForkCurrentStatePlan" -A3 oss/pi/packages/agent/src/harness/session/fork-policy.ts

# 5. 验证 Pi 与 OpenCode 明确不做沙箱（本报告最关键论据）
grep -A4 -i "trust boundary\|No Sandbox" oss/pi/SECURITY.md oss/opencode/SECURITY.md

# 6. 验证 Codex 沙箱确为真实实现且网络策略独立
ls oss/codex/codex-rs/bwrap/src/ oss/codex/codex-rs/core/src/sandboxing/
ls oss/codex/codex-rs/cli/src/doctor/

# 7. 验证 DSH 长任务三件套齐全
ls oss/deepseek-harness/packages/goal/ oss/deepseek-harness/packages/jobs/

# 8. 验证 OpenCode 会话存储确处于迁移中间态（两套并存）
ls oss/opencode/packages/opencode/src/storage/ oss/opencode/packages/core/src/session/store.ts

# 9. 验证 Qwen 把 ACP 塞进 CLI 包（反面例子）vs Grok 独立成 crate（正面例子）
ls oss/qwen-code/packages/cli/src/acp-integration/
ls oss/grok-build/crates/codegen/xai-acp-lib/src/

# 10. 复跑合规扫描，确认结论可重现
bash tools/license-audit.sh | grep -c "未在文档中命中泄露关键词"   # 期望 16
```
