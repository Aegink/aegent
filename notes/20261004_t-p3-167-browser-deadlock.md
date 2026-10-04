# 会话笔记：T-P3-167 三条实测修复（浏览器内核死锁破案/关不掉/导入 tab 回迁）
- 日期时间：2026-10-04 22:00
- 工具/路线：CDP（WebView2 remote-debugging-port）驱动真壳页面实测 → 破案 → 修复 → 复测
- 目标：用户三条——①浏览器还是加载不出来 ②点设置右侧栏消失 ③导入统一回添加项目弹窗；另"又关不掉便捷版"

## 步骤与观察
1. **实测方法论突破**：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` 起便携壳 → CDP（ws）驱动壳内页面（点击/读 DOM/手调 invoke）——桌面壳 UI 的自动化实测通道打通（IAB 只能测 web 模式，壳内能力此前是盲区）。
2. **浏览器内核死锁破案**（三轮实测递进）：webview.log 恒停在 browser_create 入口（无后续日志）→ run_on_main 封装仍挂 → **根因 = Tauri 2 sync command 在主线程执行，WebView2 controller 创建是"派发主线程+同步等待"——主线程等自己 → 死锁**（方案 A 的 add_child 与方案 B 的 WebviewWindowBuilder.build 同理）。**修复 = 五 command 改 async fn**（跑线程池，等待不阻塞主线程泵）→ build 成功+独立子窗 bing 真实加载（CDP targets 实证"搜索 - Microsoft 必应"）。
3. **浏览器承载方案 B 定稿**：独立无边框子窗（decorations false+skipTaskbar）承载浏览器内容，bounds 由 UI 面板区域上报驱动（browser_show 改 set_position/set_size）；add_child 运行时动态添加弃用（死锁）；复用自愈（标记在窗已亡=Alt+F4 → 重建）。
4. **"又关不掉"破案**：主窗关闭时**浏览器子窗活着 → 不满足「全部窗口关闭」→ app 不退**（进程/host 残留）。修 = exit 行为杀树后显式 `app.exit(0)`。CDP 实测：**开着浏览器子窗发主窗 WM_CLOSE → aegent 与 node portable 进程全部清零** ✓。
5. **"右侧栏消失"**：CDP 实测 settings 往返——settings-mode false→true→false、侧栏 260px 回位正常（T-P3-166 修复已覆盖）；用户所见或为旧版+面板收束的组合观感，真机复测确认。
6. **restart_host EADDRINUSE**：杀树后端口 TIME_WAIT——spawn 前轮询等释放（最多 5s）；Destroyed 路径补杀工作池（此前漏）。
7. **导入 tab 回迁**（用户裁决）：添加项目弹窗恢复"扫描导入" tab（项目导入统一在此，更顺手）；#import 一体化页保留为全量视角入口。
8. 8 测试绿+cargo check 过；9f6c2fe 已推；便携完整重编（exe b5d43a39+签名）——**浏览器子窗+关窗收束均为 CDP 实测证据**。

## 结论（一行）
浏览器内核死锁与关不掉双双真机破案修复（async command+显式 exit）——CDP 壳内实测通道建立，浏览器面板从"从未工作"到"bing 真实加载"。

## 未解决 / 下一步
- 用户真机复测：浏览器面板（真实 WebView2 子窗跟随面板区域——首次实机视觉确认）/关窗清零/导入弹窗 tab
- CDP 实测通道记档（WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port）——壳内 UI 自动化从此可测
- 残留僵尸进程 26048（旧方案 A 死锁进程）杀不掉——用户重启机器自然清；新版不再产生
## 追记（同日）：T-P3-168 子窗跟随与 z 序（1193f55+9d5da3f，已推）
- **位置语义重定位**：browser_set_offset 上报「面板区域相对视口的物理偏移」，Rust 在主窗 Moved/Resized 事件里直算子窗屏幕位置（视口原点=outer+边框修正（outer/inner 差）+offset）——拖动/拖宽零延迟跟随，不依赖 UI 轮询（窗口移动不触发 DOM ResizeObserver 的实测盲区）。
- **CDP 实测**：子窗 1263,194=理论精确对齐；主窗移动+158,+150 后子窗 1420,344=理论 1421,344（±1 取整）——跟随通过。
- **z 序修复（用户实测"移动主窗子窗被覆盖"）**：子窗设 owner（属主窗口）语义——tauri 2.12 WebviewWindowBuilder.owner_raw(HWND)；MSDN：owned 窗恒浮于属主之上/随属主最小化/属主销毁即销毁。CDP 复测：主窗 133,74→307,180、子窗 1263,194→1437,300 同步零偏差且不再被覆盖。
- 便携 exe 已重编含全部修复。
## 追记二（同日）：T-P3-169 浏览器承载终版（91a4275，已推；便携 6ceedda0）
- **跨窗方案整体弃用**：方案 B（独立子窗+SetWindowPos 跟随）在 Windows 拖拽边框的模态消息循环里高频跨窗 SetWindowPos → 消息重入 → 卡死+renderer 崩溃（用户实测拖边框卡死、CDP 诊断页面 DOM 全空——后证实部分为 CDP target 选错到 bing 页的假象，但重入风险真实）。
- **终版 = 主窗内嵌 child webview（方案 A 正确打开方式）**：add_child 的死锁解 = **async command（线程池）+ run_on_main 排队到活着的事件循环**（泵在跑 → WebView2 controller 异步创建可完成——不再"等自己"）。内嵌后跟随/覆盖/z 序天然成立（webview 是主窗一部分，bounds 相对视口 set_bounds）。
- **CDP 全链实测**（9223 调试口驱动真壳）：add_child 成功 → 导航 Example Domain 真实加载 → 30 次高频 resize（985ms）不卡页面存活 → 关 tab browser_destroy 真销毁（onClose 钩子——区别于切走 hide 保活，修 webview 泄漏）。
- **CDP 壳内实测方法论**：WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 + target 选择器须用 tauri.localhost 前缀（bing 页 url 也 endsWith('/') 会误选）。
- 多实例：registry 按 label 天然支持多浏览器 tab 并存（子代理/子会话面板各自实例）；agent 自动驱动浏览器（AI 操作网页）为内核工具面记档。

