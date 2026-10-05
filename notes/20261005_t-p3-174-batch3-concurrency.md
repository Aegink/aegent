# 会话笔记：T-P3-174 批次 3 —— 任务并发收尾线（pi-desk 对齐）
- 日期时间：2026-10-05 15:00
- 工具/路线：现有实现摸底（折叠行/审批卡/侧栏任务渲染）→ 实施 → IAB 场景实测（双任务并发+审批全链路）→ 便携重编
- 目标：T-P3-174 批次 3——已工作行升级 / 审批卡管理 / 任务段小节头 / shell 会话化评估

## 步骤与观察
1. **已工作行升级**：工作行标签改 zcode 用语「工作中」（原"正在工作"）；轮末折叠定格耗时——「已工作 · 3 步 · 11s」（workingLineStartedAt 在 showWorkingLine 记时刻，collapseWorkSegment 回填；zcode autoCollapseOnComplete 边沿语义：运行中平铺即展开态、完成收起一次并定格，之后不再变化）。三工具轮实测：sleep 2 + seq 30 + sleep 2 → 折叠行显示 3 步 · 11s ✓。
2. **审批卡管理**：
   - **计数小节头**「待审批 / 提问（N）」：buildCard 尾部 syncPendingHeader（首版在 append 前调用计数差一——实测发现当场修）；removeCard 同步递减、空区自动移除头。实测 1 卡 → 头显示（1）✓。
   - **超时自动摘除**：countdown interval 到点 → removeCard + 顶中 toast「审批已超时（bash）——内核按超时拒绝结算」。实测等满 120s：卡消失+头消失+顶中提示出现 ✓——审批卡从"倒计时到 0 后永远挂着误导人"变诚实收束。
   - **跳转返回卡仍在**：切到历史任务再切回，卡与倒计时原样保留（cards:1 / 101s 继续走）✓——卡是全局挂载不随会话切换销毁（T-P3-173 来源归属条保留）。
3. **任务段小节头**：sidebar.js loadTasks 排序后插入分组标题——「进行中（N）」（awaiting/busy 任务数）与「历史」；全部历史时不加头（单段列表无噪声）。双任务并发实测：两任务同时跑长命令 → 侧栏「进行中（2）」+ 双绿点脉冲 + 各自运行耗时（17s/13s），历史分组隔开 ✓。
4. **shell 会话化评估**（批次卡可选项）：codex WriteStdinHandler（session 化 stdin 续写）——评估结论：工程量中等（env.spawnBackground 需加 stdin pipe + BackgroundHandle.write + task_output stdin 参数 + 句柄跨 step 存活语义），使用价值有限（aegent bash 以非交互命令为主，交互式进程属边缘场景），**记档延后**（P2）。当前 kill 杀树/输出回收已闭环。
5. **走查中排障（记录认知）**：权限档 config/refresh 是**会话级**运行时配置（重载页面后当前会话可能切到另一个 child——spawn 参数的 auto 重新生效）。实测审批全链路时先对当前会话重设档再触发，流程即复现。审批机器本身无缺陷。
6. 全量测试 2112 绿（本批 src 零改动）；node --check 过；便携 222.0MB 重编 + host 冒烟 PASS。

## 结论（一行）
批次 3 三件套全落地并经 IAB 场景实测（并发分组/审批计数头/超时摘除/跳转保持）——多任务并发的管理面从"能看"到"能管"。

## 未解决 / 下一步
- 批次 4（数据持久与备份线）：周期自动备份 / WebDAV 云同步 / SQL 整库导出 / checkpoint 时间线浏览器 / 技能 ZIP 导入 / 提示词一键导入 / thinking/set 落流
- shell 会话化 stdin 续写记档 P2（评估结论见上）
- 用户实测反馈随时插队
