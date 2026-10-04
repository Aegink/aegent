# 会话笔记：T-P3-164 裁决——撤右侧任务面板 + 任务清单实时化双根因
- 日期时间：2026-10-04 15:10
- 工具/路线：pi-desktop/zcode 派发调研 → IAB+黑洞走查 → 打点定位 → 双根因修复
- 目标：用户澄清"不要右侧任务列表面板；要左侧项目下任务列表+运行态（详细参考 pi-desk），运行才有、实时更新"

## 步骤与观察
1. **撤除 pane-tasks**（用户裁决"不要 T-P3-164 新增面"）：pane-tasks.js/pane.js 两处目录/app.js import/progress-dock todos:updated 派发与 getTodos/getRunningTool 导出/style.css tasks-panel-* 全链清理，grep 归零。
2. **运行态形态对齐 pi-desktop**（Explore 派发调研两仓）：行首呼吸点（opacity+scale 双通道+光晕 box-shadow，1.6s；prefers-reduced-motion 降级）= pi sidebar-status-breathe 同构；待审批快脉冲（1.1s）优先于 running；空闲行透明占位（"运行才有点"——行首对齐不跳）；右上进度 pill 圆点同款动画统一；项目折叠态黄 ● 字符→呼吸圆点。
3. **活动项目默认展开**：expandedProjects 空记录时 bootstrap 展开（会话内一次，用户手动折叠不被反复撑开）——对话时项目下任务行可见，运行点有舞台。
4. **走查揭穿第二根因**：宿主+黑洞 provider 造 busy 窗口 → 任务行死活不出现 → 直调 project-tasks op 返回空 → 查库 events=0（write-behind turn 末才排空——活跃会话读库恒空）→ 镜像内存权威修复（server.ts 回注 store 进 gateway，projectTasksOp 折叠 mirror 会话：标题=首条 user/message 截 40 字）。
5. **打点定位第一根因（更底层）**：dist 注 console.error 打点 → mirror-in 正常收流+mirror-fold ids 正常 → 唯独 tasks 空 → `listSessionProjects()` 蛇形列 `SELECT session_id, project_id` 直接 `as {sessionId}`——**断言不是转换，r.sessionId 恒 undefined，归属匹配恒空，project-tasks 从未工作过**（对照 listSessionSummaries 有显式映射）。修复为显式 map。
6. 修复后走查全链：发消息 → 任务行**立刻**出现（标题即时）+ `sb-task-dot busy` 绿呼吸点 + 当前行高亮——截图确认。user/message live 刷侧栏+turn/end 延迟 1.2s 刷（标题落库避竞态）。
7. 2075 测试绿（+2 转正回归锚 settings-project-tasks-mirror.test.ts）+tsc 0+架构 0；便携重打（bundle 219.8MB/exe md5 704d5c34 壳未变/host.cjs d181d3e7/build-info 32a4425）冒烟 200+新资产断言；提交 32a4425 已推。

## 结论（一行）
右侧任务面板撤除；左侧任务列表实时化落地——双根因（蛇形列断言+write-behind 滞后）修后对话中任务行带运行呼吸点即时出现（pi-desktop 形态）。

## 未解决 / 下一步
- 用户真机验收：对话时左侧项目下任务行出现+呼吸点/任务完成后点消失（透明占位）/待审批橙脉冲
- zcode 运行层置顶排序记档（单会话架构下意义有限，多会话并行时再做）
- IAB locator click 隧道不稳再证（本轮回退 evaluate click 可用）——已入工具坑
