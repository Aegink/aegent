# 会话笔记：T-P3-174 批次 2 —— 对话流质感线（zcode 对齐收尾四件套）
- 日期时间：2026-10-05 14:10
- 工具/路线：zcode 参考仓调研（Explore 串行一路）→ 零构建纯 JS 实施 → IAB 真实走查（真实模型轮 + 真实请求被拒）→ 便携重编
- 目标：T-P3-174 批次 2——工具行摘要滚动队列 / toast 分区锚定 / 错误聚合横幅 / 细节打磨

## 步骤与观察
1. **调研**（zcode 源码级）：QueuedSummaryContent 3 格队列（当前+下一条+可插队格，queued 只存后两格、第 2 格锁死新条目只换第 3 格）、800ms/条（300ms 过渡 cubic-bezier(0.4,0,0.2,1) + 500ms 停留）、setTimeout 自链 + performance.now 漂移 >250ms 跳帧、同 key 原位刷新（key 不变不重播）、FlipMetricValue 逐槽两层 rotateX ±90° 0.16s（无进位链、新槽静态出现）、trailing 在滚动层外独立翻页。toast：dedupeKey upsert（同 key 移到栈底+原位更新）、durationMs≤0 常驻（终态换正时长收敛）、分区为调用点约定。ChatErrorBanner：composer 上方单槽后错替前错、中性 surface（bg-surface/border/foreground 不染红）、关闭记指纹（dismissedErrorKeys cap 20）防"关了又被顶回"、详情走 Dialog（长错误不撑高横幅）。
2. **实施**：新 ui/summary-roll.js（叶子模块——状态机+flipMetricInto 全量复刻，常量原文对齐）；feedback.js toast 改造（zone top/bottom 双锚定+dedupeKey Map upsert+栈上限 4+durationMs 语义，旧 API 完全兼容）；index.html 加 #toast-area-top 与 #error-banner 骨架（composer 上方）；app.js 接线：工作行搭载滚动队列 + 三个喂入点（tool/call 动词+参数摘要 / tool/result 行数或失败原因 / assistant 流式字数走同 key 原位刷新）、consumeN5 分区（审批/端面/屏幕操作→顶中；轮次/任务结算→底右）、错误横幅模块（showComposerError/hideComposerError+指纹关闭+详情 Dialog+复制全文+重试=原文重发）、请求被拒进横幅（m- 请求不再一行流内文字重复两处）、断连进横幅（重连成功自动撤下）。CSS：components.css（顶中/底右锚定+drop/slide 动画+toast-out+横幅中性壳+summary-roll 窗口/翻页槽）+ style.css（运行中收起态 mono→sans 的 :has 规则）。
3. **IAB 真实走查**（host.cjs + 真模型 cline-ds，三轮）：
   - 真实长任务轮 ×3（seq 400/600/250 → sleep+seq×4 → sleep 7/10）：**滚动队列实证**——流式事实"正在回复 · 12 字"、工具事实"终端 · $ sleep 7 && echo done-queue-test"运行中滚动展示；四条命令逐条执行、行数全对（901/501/1/1）；工具卡运行中扫光+终态行数正常。
   - **真实请求被拒**（未持租约发消息 → OWNER_NOT_LEASE_HOLDER）：错误横幅在 composer 上方弹出——中性 surface+复制/重试/关闭三钮全在位；修=流内 warn 行对 m- 请求不再重复（横幅是唯一面）；取租约重发后正常跑轮。
   - toast 分区：底右"turn 2 结束"真实弹出（3s 自动消失）；顶中分区渲染冒烟帧（居中锚定+栈内双条）。
   - 侧栏任务行脉冲点+耗时、断连横幅生命周期（重连"已连接"自动撤下）随走查确认。
4. **chevron/思考卡时长**：核对现状——chevron 悬停浮现+展开旋转+200ms 过渡与 think-dur "· 持续了 N 秒"分隔排版在 T-P3-157/171 已达 zcode 形态（本批仅补收起态字体规则），未重复改。
5. 全量测试 2112 绿 0 失败（src 未动——UI 批次零回归确认）；node --check 三文件语法过；便携重编 222.0MB + host.cjs WS hello 冒烟 PASS。

## 结论（一行）
批次 2 四件套全落地并经 IAB 真实走查实证（滚动队列喂入/错误横幅真实被拒触发/toast 双分区）——对话流质感对齐 zcode：步骤事实滚动、通知分区锚定、错误常驻可行动。

## 未解决 / 下一步
- 批次 3（任务并发收尾线）：已工作行升级（运行中"工作中 · Xs"实时态+自动开合）/审批卡管理（多卡并存+超时摘除）/任务段小节头/shell 会话化评估
- FlipMetricValue trailing 数字翻页的 feed 位（diff +/- 计数）暂无消费方——模块能力就绪，等 write/edit 多文件场景喂入（记档）
- toast 栈上限 4 是批次卡规格（zcode 无此实现——调研确认），已按卡落地
