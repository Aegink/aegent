# T-P3-157 · UI 去 AI 化调研（2026-10-03）

## 调研轮（三路并发子代理）

- 目标：按 docs/20261003_UI去AI化调研开工提示词.md 出对比报告，用户裁决后才实施。
- 编排：A 路（Explore）zcode 设计规格提取 + B 路（general-purpose）真实浏览器走查 + C 路（Explore）图标专项，一次派三路并发。
- 关键发现：
  1. zcode 质感=硬规格可抄：token 四层主题（styles.css @theme）/lucide stroke 1.5 单色线性/28px 按钮+完整状态矩阵/「选中=右侧打勾不填充」/运行态文字扫光禁 spinner/圆角链 sm4-md6-lg8-xl12-2xl16/浮层公式 duration-100+fade+zoom95+slide2。
  2. 我方 AI 味根因两个：icons.js 31 枚仅 11 枚被 3 文件引用（≈205 枚 emoji 顶班）+状态不成套（5723 行 style.css 0 处 :focus-visible、53 处硬编码色红绿各三套）。
  3. **意外收获 7 个 P0 功能 bug**：模型菜单 [object Object]（composer-bar.js:237 内插对象，主会话复核属实）/辅助面板 limit 协议拒/Git 面板 cwd 协议拒+卡死/用量页 section-active 缺失整页空白（复核属实）/960 pill 竖排崩坏/Nord·Tokyonight 无亮色变体（复核属实：皮肤块在亮色块后同特异性覆盖）/项目中心断链。
- 方法论偏差（如实记）：IAB 在子代理不可用（Browser is not available in subagent）——B 路改 agent-browser 0.27.0（Chromium CDP CLI）完成同规格走查；B 路为 general-purpose 类型（需浏览器+build 工具）。
- 产出：docs/20261003_UI去AI化对比与改造建议.md（666 行 12 章：问题库 60 条=P0×7/P1×25/P2×28，方案 A~P 分级待裁决，总工作量 XL，批次 0~6 路线）；底稿 scratch/_tmp_p157/route-{A,B,C}.md + 48 张截图（不入库）。
- 交叉核对补漏：⏩（立即发送）B 路实证但 C 路清单漏列——已记入报告 §5.4 增补；▸ 树 caret 建议补 chevronRight。

## 结论（一行）

- 调研完成：60 条问题库+图标逐条映射+组件规格表就绪，7 个 P0 建议批 0 先行修复；报告交用户对方案 A~P 打勾，打勾前不动代码。

## 未解决 / 下一步

- 用户裁决报告 §⑨（16 方案）+§⑩（10 条待澄清）；裁决后按 §⑫ 批次实施（批 0 bug 修复→批 1 token→批 2 图标→批 3 emoji 清零→批 4 组件→批 5 逐页→批 6 动效验收）。
- 实施期补验【未验证】清单：聊天流内容卡/终端/子代理面板/Catppuccin 等亮色变体逐皮肤截图。
