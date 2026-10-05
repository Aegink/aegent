# 会话笔记：T-P3-174 批次 4 —— 数据持久与备份线
- 日期时间：2026-10-05 16:00 ~ 17:00
- 工具/路线：ZCode（GLM）· cc-switch WebDAV 调研（Explore agent 串行派发）→ host 七模块 → UI 三面 → 22/22 e2e 实测 → IAB 走查 → build:single + tauri
- 目标：批次 4 七项全做（用户裁决"做好不简陋"）——周期备份/WebDAV/SQL 导出/checkpoint 时间线/技能 ZIP/提示词一键导入/thinking 落流

## 步骤与观察
1. **调研**：cc-switch WebDAV = 自写 HTTP 原语（PROPFIND/MKCOL/PUT/GET）+ 整库快照替换（manifest sha256 + manifest-last 上传序）+ 用户确认覆盖冲突策略 + 404=远端空语义。我方密码走 DPAPI 凭据库优于参考仓明文。
2. **thinking/set 落流（E16 闭集 30→31）**：词汇表/校验/投影/豁免/落流/restore 五处同步；**child 级两段启动测试实抓 P3-161 三处遗留缺口**——①REQUEST_TYPES 白名单漏 thinking/set（直发被拒）②AgentMessage decode 白名单漏 thinking_set（回执消费端被拒）+ 联合重复成员 ③loop deps 未接 thinkingOverrideForTurn（**思考档覆盖在生产从不生效**）——全部修复，另有落流即 flush（write-behind 窗口）。
3. **周期自动备份**：settings.backup 段（auto/intervalHours/keep）+ host 30min tick（bak.0 mtime 即"上次备份"持久事实，重启无损）+ applyBackupRetentionPolicy（keep 收窄清理）。
4. **WebDAV**：webdav-transfer.ts 传输五原语 + manifest 编排（settings.json 单 artifact——零凭据纪律）；两段式 sync op（探测 needsConfirm → confirm 执行）；lastSyncAt/lastError 状态持久化；sha256/size 校验 fail-closed。技能 zip 同步记 P2（zip 写入器另案）。
5. **SQL 整库导出**：db-export.ts——.sqlite（better-sqlite3 backup 在线备份）+ .sql（自写 dump：schema+INSERT+user_version，Node 绑定无 iterdump）；目录不存在自动创建（e2e 实测后从 fail-closed 改写面语义）。
6. **checkpoint 时间线**：checkpoint-timeline.ts——流提取 + 相邻 diff --shortstat（exitCode 1=有差异是业务结果；ref=null 解析 HEAD；hasPrev 哨兵修"null 基线误判"）+ restoreWorkspaceToCheckpoint（host 直跑 git——历史会话无 child 可回退）。UI = 工作面板第五 Tab（回退带确认）。
7. **技能 ZIP 导入**：zip-read.ts 零依赖 zip 读取器（EOCD/central directory 自解析 + inflateRaw + CRC32 查表）——穿越/加密/大小声明+实测双闸/总量/条目数五道安全检查；skill-zip-import.ts 形状识别（根技能/单层集合/kimi 平面转目录）。**测试构造器踩两坑**：central directory 少 internalAttr 字段错位、crc32 位级实现 `&0xff` 砍高位。
8. **提示词一键导入**：模态 actions 加"导入全部"（全选+导出直达）。
9. **UI 面**：transfer.js 三行卡（周期备份 switch 联动/WebDAV 配置模态/导出会话库模态）+ agents.js ZIP 按钮 + work.js 时间线 Tab。IAB 走查实抓两处 UI 修复：saveConfig 后行卡 desc 不刷新、readSessionEvents"内存优先"吞库数据（host 镜像恒非空跳过库读——**改纯库读**：checkpoint 随轮末 flush 已落库，库即全量真相）。
10. **验收实测 22/22 PASS**：备份→改→恢复 WS 全链路 / backup 段即改即存+保留策略 / db-export 双格式落盘 / WebDAV 本地 server（test→up→down→lastSyncAt→篡改 fail-closed）/ checkpoint-timeline 提取 / 真 git 仓 restore（checkout 丢弃 tracked 回 seed）。
11. **IAB 走查**：数据中心三行卡呈现+联动 ✓、时间线空态/有数据/诚实降级 ✓、技能 ZIP 按钮 ✓、提示词导入全部 ✓、截图存档。

## 结论（一行）
- 批次 4 七项全落地并实测闭环（vitest 2139 绿 / tsc 0 / e2e 22/22 / IAB 走查过）；顺带修好 P3-161 思考档三处生产性缺口与两处 UI 刷新缺陷。

## 未解决 / 下一步
- 技能目录 zip 的 WebDAV 同步（需 zip 写入器）记 P2。
- 批次 5：壳集成线（socks 代理/保持唤醒/node-pty 瘦身/壳命令退役/真机走查）。
