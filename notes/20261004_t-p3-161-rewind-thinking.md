# 会话笔记：T-P3-161 用户消息回溯重发+思考度+图标方案（实测反馈轮 4）
- 日期时间：2026-10-04 11:25
- 工具/路线：内核 revert/effectiveEvents 既有基建盘查 → promptId 定位链 → IAB 走查（seq 实证法）
- 目标：三条反馈——消息复制/编辑外置+真回溯重发（日志保留）；管理模型跳转+思考度切换；图标重设计先出方案

## 步骤与观察
1. **真回溯重发全链**（commit 1235d38）：
   - 发现既有基建：session/revert 事件（E4）+ effectiveEvents 截断投影 + revert wire 命令 + checkpoint 代码态回退——编辑重发 = 复用 revert 到该消息之前 + reverted 回执后走正常 prompt 链
   - UI：复制/编辑图标钮外置气泡右下（zcode 截图形态）；编辑 = 气泡内原地 textarea（Enter 发送/Esc 取消）→ revert(promptId) → 双确认（reverted 回执+历史重放）→ submitPrompt(编辑文本)
   - append-only 纪律：旧消息与 session/revert 标记全量留档（probe 实证：31 条含 revert targetSeq 标记），审计/搜索可查
2. **走查抓出结构性 bug（本轮最大收获）**：UI 端 seq 存在 live/镜像双轨漂移——host 镜像滤掉 surface/attach·detach 再 append → 镜像 seq 与 child 流 seq 系统性错位（重放渲染的气泡 seq 偏小），编辑回溯定位到错误位置（targetSeq=2 而非 5）。修复 = 镜像全量保真（attach/detach 也入镜像，seq 对齐 child 流）+ revert 改 **promptId 定位**（UI 传消息的 promptId，child 端查流定位 seq-1——对一切 seq 漂移免疫）。实证：编辑 seq=22 消息 → targetSeq=21 精确命中。
3. **thinking/set 会话思考档**：档位闭集 THINKING_LEVELS（off~max）+ "omit" 哨兵（请求不带思考参数）；agent-process 校验+assembly 内存覆盖；loop turn 捕获叠加 reasoningEffort（用户显式意图 > 模型默认档）；wire 四面（union/parse/process/回执 thinking_set 通知）+ 写命令租约白名单；UI = 模型面板二级底部思考度档位条（omit~max 八 chip）+ pill 文案带当前档。落流归档记档（词汇表扩展另立）。
4. revert/thinking/set 进 WRITE_COMMANDS 租约白名单（写会话状态必须持约）。
5. fit-content：用户气泡/工具卡随内容自适应（不再横向铺满）。
6. 测试基线：server.test 镜像断言（attach 进镜像+afterSeq）；tsc 三处（union 变体收窄/req 宽 Record/promptId 变体）。2073 绿+架构 0。
7. 便捷版重打（md5 77a93f9f/build-info 1235d38）host.cjs 冒烟 200+新资产确认；已推 GitHub main。
8. 走查遗留：终验编辑回溯在 IAB 隧道不稳（locator 全超时）中断——但核心链路已在此前实证（targetSeq=21 命中+留档 probe）；思考度面板/管理模型跳转待用户真机实测。

## 结论（一行）
回溯重发真语义落地（promptId 定位+留档完整）+ 会话思考档全链 + 镜像 seq 双轨根因修复（1235d38 已推）；图标方案 docs/20261004_图标重设计方案.md 待裁决。

## 未解决 / 下一步
- 图标方案 A/B 用户裁决（A=lucide 官方数据全量替换，推荐）
- 用户真机实测：编辑回溯/思考度/管理模型跳转/决策卡
- thinking/set 落流（词汇表扩展）记档；rewind 的 checkpoint 代码态回退默认跟随（「与文件一起重置」开关记档）
