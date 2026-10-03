/**
 * U14/T-P3-103 · 设置中心与视图资产断言（T-P3-135 批 B 自 tauri-shell.test
 * 拆出——diagnostics 域 400 行纪律触顶即拆〔16d 三拆模式延续〕；断言本体
 * 一条不删，批 B 拆分重定目标随行）——设置分节齐全 + 主题变量 + 各域视图
 * 资产（设置域 views/settings/ 子模块 / 用量统计页 / 历史 / 渲染 / 检索 /
 * Composer / 通知五件套 / 工作面板）与 token 层。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");

function read(name: string): string {
  return readFileSync(path.join(uiDir, ...name.split("/")), "utf8");
}

describe("U14/T-P3-103 · 设置中心与视图资产（拆自 tauri-shell.test——批 B 行数治理）", () => {
  it("U14/T-P3-103 · 设置中心资产：分节齐全 + 主题变量在位 + 导航入口（分节与 settings 模块一一对应）", () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    const read = (name: string) => readFileSync(path.join(uiDir, ...name.split("/")), "utf8");
    const html = read("index.html");
    const app = read("app.js");
    const voice = read("composer-voice.js"); // T-P3-149 录音状态机模块
    const router = read("router.js"); // T-P3-150 项目页路由注册面
    const projectsView = read("views/projects.js"); // T-P3-150 项目中心
    const projectsFiles = read("views/projects-files.js"); // 文件树/预览模块
    const css = read("style.css");
    const theme = read("theme.css");
    const usageView = read("views/usage.js");
    const workView = read("views/work.js");
    const historyView = read("views/history.js");
    const searchView = read("views/search.js");
    const state = read("state.js");
    // T-P3-135 批 B：设置域拆分 views/settings/ 子模块（core/basic/agents/
    // system 三组分域）——既有断言全保留，settingsView 改为壳+子模块拼接
    // 读取（标记随所在模块核对：断言本体一条不删，重定目标随拆分）。
    const settingsDir = path.join(uiDir, "views", "settings");
    expect(statSync(settingsDir).isDirectory()).toBe(true);
    for (const name of ["core.js", "basic.js", "agents.js", "system.js"]) {
      expect(statSync(path.join(settingsDir, name)).isFile()).toBe(true);
    }
    const settingsView = [
      read("views/settings.js"),
      ...readdirSync(settingsDir)
        .filter((f) => f.endsWith(".js"))
        .sort()
        .map((f) => read(`views/settings/${f}`)),
    ].join("\n");
    // 批 A 重定目标说明：原断言读 app.js/index.html 巨石；拆分后标记随
    // 代码/标记所在模块核对（断言本体一条不删）。
    // 十八分节（……speech、plugins、about——settings.json 各段与文件位
    // 一一对应；speech 为 U26/T-P3-129 语音（实验性）；plugins 为 T-P3-133
    // 插件管理——I4/I5/I9 管理面延伸）——批 A 迁 views/settings.js；
    // credentials 分节并入供应商页（用户裁决"功能重复"——凭据管理面 =
    // providers.js 的孤儿预存密钥区，data-section 不复存在）
    // T-P3-148 O：plugins 分节迁独立页 views/plugins.js（data-section 不复存在）
    for (const section of ["providers", "permission", "sandbox", "appearance", "logging", "projects", "prompts", "skills", "subagents", "instructions", "shortcuts", "mcp", "enhancement", "profiles", "transfer", "speech", "about"]) {
      expect(settingsView).toContain(`data-section="${section}"`);
    }
    expect(settingsView).not.toContain('data-section="credentials"');
    expect(settingsView).not.toContain('data-section="plugins"');
    // 导航入口（侧栏齿轮——批 A 布局骨架）与凭据不回显（U2 面注入防呆）
    expect(html).toContain('id="settings-btn"');
    expect(settingsView).toContain('type="password"');

    // settings 信封直答（get/update + credentials-*）与即改即存（防抖合并）
    expect(read("sidebar.js")).toContain('op: "get"'); // 侧栏首拉（maybeOnboard 删除后 app.js 无 get——反馈 1 随行重定）
    expect(settingsView).toContain('op: "update"'); // settings 即改即存（core.js flushSettings——onboardingDone 写回移除后消费在设置域）
    expect(settingsView).toContain("credentials-set");
    expect(settingsView).toContain("credentials-delete");
    expect(settingsView).toContain("markDirty");
    // U5/T-P3-104：会话期切换（model/switch）+ T-P3-137：真实测试连接
    // （op:provider-test 发"你好"——用户裁决"成功才算可以使用"，替代旧
    // probe 连通探测；op:provider-models = host 代理拉取模型清单）+
    // 编辑态标记
    expect(settingsView).toContain('"model/switch"');
    expect(settingsView).toContain('op: "provider-test"');
    expect(settingsView).toContain('op: "provider-models"');
    expect(settingsView).toContain("editingProviderName");
    // 主题全端一致：改动即应用 body[data-theme]（dataset.theme——批 A 下沉 state.js）
    expect(state).toContain("dataset.theme");
    // T-P3-135 走查反馈修正（2026-09-30 用户裁决）：单分节页面形态——每个
    // tab 单独一页（DOM 19 分节全挂载，显示层 .section-active 单显；导航
    // 切换 history.replaceState 同步 hash 不触发路由重挂载）
    expect(settingsView).toContain("section-active");
    expect(settingsView).toContain("history.replaceState");
    expect(css).toContain(".tab-body section.section-active");

    // U3/T-P3-105：会话历史页（清单/只读查看/删除确认/resume 提示）——
    // T-P3-156 布局批（方案 A）重定目标：功能迁 ui/sidebar.js「最近会话」
    // 分段（views/history.js 保留深链壳），断言本体随行
    const sidebar = read("sidebar.js");
    expect(sidebar).toContain('getElementById("sb-history")'); // 分段容器（骨架 id）
    expect(sidebar).toContain('op: "sessions"'); // 清单数据面
    expect(sidebar).toContain('op: "session-delete"'); // 删除面
    expect(sidebar).toContain("confirmDialog"); // 硬删除确认对话框（settings/core 共享件）
    expect(sidebar).toContain("aegent sessions resume"); // 续聊入口提示
    expect(sidebar).toContain("aegent.readSessions"); // 未读标记（本端）

    // U4/T-P3-107 · 渲染分层资产：vendor 本地化 + THIRD_PARTY 登记 + 分层标记（XSS 防呆面在位）
    for (const name of [
      "vendor/marked.esm.js",
      "vendor/highlight.esm.js",
      "vendor/LICENSE.marked.md",
      "vendor/LICENSE.highlight.js",
      "vendor/README.md",
    ]) {
      expect(statSync(path.join(uiDir, ...name.split("/"))).isFile()).toBe(true);
    }
    const thirdParty = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "THIRD_PARTY.md"),
      "utf8",
    );
    expect(thirdParty).toContain("marked@16.4.2");
    expect(thirdParty).toContain("highlight.js@11.12.0");

    const render = read("render.js");
    // XSS 防呆在管线内固化（行为机验见 ui-render.test.ts 动态 import 直测）
    expect(render).toContain("./vendor/marked.esm.js");
    expect(render).toContain("./vendor/highlight.esm.js");
    expect(render).toContain("md-html-raw"); // 禁 HTML 透传（转义可见）
    expect(render).toContain("/^(https?:|mailto:)/i"); // href 协议白名单
    expect(render).toContain("parseDenial"); // C55 拒绝面解析
    expect(render).toContain("buildDiffLines"); // 写操作 diff 对照

    // 分层：assistant 走管线（import renderMarkdown）；用户输入 textContent 不渲染
    expect(app).toContain('from "./render.js"');
    expect(app).toContain("typeStream"); // 流式打字（rAF 节流）
    expect(app).toContain("requestAnimationFrame");
    expect(app).toContain("data-call-id"); // 工具卡 callId 成对
    expect(app).toContain(".code-copy"); // 代码块复制（事件委托）
    expect(app).toContain("retry-btn"); // 错误重试交互
    expect(app).toContain('className = "chip"'); // 审批卡 C54 分类 chip
    expect(app).toContain("countdown"); // 审批卡超时倒计时

    // 气泡/工具卡/代码块/diff/拒绝面样式在位 + hljs token 色
    for (const marker of [".bubble", ".tool-card", ".code-block", ".diff-row", ".denial", ".hljs-keyword"]) {
      expect(css).toContain(marker);
    }
    // U9/T-P3-108：会话内搜索条 + 跨会话搜索页 + 小地图（导航/检索资产）
    expect(html).toContain('id="find-bar"');
    expect(html).toContain('id="find-input"');
    expect(html).toContain('id="minimap"');
    expect(searchView).toContain('id="search-panel"');
    expect(searchView).toContain('id="search-results"');
    expect(searchView).toContain('op: "search"'); // Q2 检索的 UI 消费
    expect(app).toContain("findInStream"); // 渲染层文本检索
    expect(app).toContain("minimapRegister"); // 消息结构导航条
    // U10/T-P3-109：Composer 升级（多行/两类补全/粘贴图入附件链）
    expect(html).toContain('id="autocomplete"');
    expect(html).toContain('id="attachments-preview"');
    expect(html).toContain("<textarea");
    expect(app).toContain("UI_COMMANDS"); // 斜杠命令本地集
    expect(app).toContain("addAttachment"); // 粘贴图 → 附件链
    expect(app).toContain("MAX_ATTACHMENT_BYTES"); // 限额防呆与 limits.ts 同源
    // @ / 补全数据面（op:"files"/op:"meta"——批 A 下沉 api.js 会话期缓存）
    expect(read("api.js")).toContain('op: "files"'); // @ 补全的 workspace 列举面
    expect(read("api.js")).toContain('op: "meta"'); // / 补全的清单来源（ready 捕获）
    expect(app).toContain("ensurePromptsCache"); // / 补全的模板数据面
    expect(app).toContain('kind: "prompt"'); // 补全候选混入标记
    expect(app).toContain("templateVarNames"); // {{var}} 变量提取（UI 侧）
    // U11 项目 CRUD → T-P3-150 迁独立页 → T-P3-156（方案 A）迁侧栏两分段
    // ui/sidebar.js（工作区/任务/文件树/添加三模式）；settings 分节只留
    // 跳转卡 + 项目指令仍走指令中心
    expect(settingsView).toContain("打开工作台"); // 分节跳转卡（T-P3-157 P-044：#projects 死链改 #work）
    expect(html).toContain('id="sb-new-task"'); // 侧栏「新建任务」入口（方案 A）
    expect(sidebar).toContain("git-clone"); // A3 Git 仓库添加
    expect(sidebar).toContain("import-scan"); // A4 扫描导入
    expect(sidebar).toContain('op: "session-rename"'); // B2 任务重命名
    expect(sidebar).toContain("openAddDialog"); // 三模式添加入口（对话框）
    expect(projectsFiles).toContain("renderMarkdown"); // C3 md 真渲染
    expect(projectsFiles).toContain("添加到聊天"); // C7 树行右键菜单项
    expect(settingsView).toContain('id="instr-editor-text"'); // T-P3-151 指令中心编辑面（域文件 instructions.js）
    // U16/T-P3-118：提示词模板库（settings prompts 段 CRUD + / 补全调用）
    expect(settingsView).toContain('id="prompt-list"');
    expect(settingsView).toContain('id="prompt-form"');
    expect(settingsView).toContain("renderPromptList"); // 库列表渲染
    // U17/T-P3-119：MCP 管理向导（分步表单 + 测连接 + 统一面板）
    expect(settingsView).toContain('id="mcp-list"');
    expect(settingsView).toContain('id="mcp-wizard"');
    expect(settingsView).toContain('id="mcp-step2"');
    expect(settingsView).toContain('id="mcp-test"');
    expect(settingsView).toContain('op: "mcp-check"'); // 连接校验数据面
    expect(settingsView).toContain("renderMcpList"); // 统一面板（启停/编辑/删除）
    expect(settingsView).toContain("editingMcpName"); // 编辑回填状态
    // U22/T-P3-125：技能管理（清单/编辑器写回/来源目录/停用开关）
    expect(settingsView).toContain('id="skill-list"');
    expect(settingsView).toContain('id="skill-editor"');
    expect(settingsView).toContain('id="skill-roots"');
    expect(settingsView).toContain('id="skill-root-form"');
    expect(settingsView).toContain('op: "skills-list"'); // 清单数据面
    expect(settingsView).toContain('op: "skill-save"'); // 编辑器写回
    expect(settingsView).toContain("refreshSkillsList"); // 清单刷新
    expect(settingsView).toContain('markDirty("skills")'); // 停用/来源即改即存
    expect(settingsView).toContain("skillToolsSelected"); // 工具集多选
    // U23/T-P3-126：子智能体管理（内置预设卡/自定义 CRUD/模型与 fallback）
    expect(settingsView).toContain('id="subagent-list"');
    expect(settingsView).toContain('id="subagent-editor"');
    expect(settingsView).toContain('id="subagent-fallbacks"');
    expect(settingsView).toContain('op: "subagents-list"'); // 清单数据面
    expect(settingsView).toContain("refreshSubagentsList"); // 清单刷新
    expect(settingsView).toContain('markDirty("subagents")'); // CRUD 即改即存
    expect(settingsView).toContain("subagentToolsSelected"); // 工具集多选
    // U24/T-P3-127 → T-P3-151 重构：指令中心（左树右编辑/装配预览/规则三列/
    // 测试器/追加落盘/模板 chips）
    expect(settingsView).toContain('id="instr-editor-text"'); // 编辑器
    expect(settingsView).toContain('id="instr-tree-list"'); // 左树（层级节点）
    expect(settingsView).toContain('id="instr-assembly"'); // A2 装配预览
    expect(settingsView).toContain('id="instr-rules-view"'); // B1 规则三列卡
    expect(settingsView).toContain('id="instr-tester"'); // B3 规则测试器
    expect(settingsView).toContain('op: "instructions-list"'); // 数据面
    expect(settingsView).toContain('op: "instruction-save"'); // 写回
    expect(settingsView).toContain('op: "instruction-append"'); // B2/C1 追加落盘
    expect(settingsView).toContain('op: "instruction-test-rule"'); // B3 测试器数据面
    expect(settingsView).toContain("INSTR_TEMPLATES"); // D2 模板 chips
    expect(settingsView).toContain("generateProjectAgents"); // D1 生成项目指令
    // U25/T-P3-128：快捷键注册表（清单/捕获改绑/冲突提示）+ 设置分节
    expect(settingsView).toContain('id="shortcut-list"');
    expect(settingsView).toContain('id="shortcut-reset"');
    expect(settingsView).toContain("renderShortcutList"); // 清单渲染
    expect(settingsView).toContain("capturingAction"); // 捕获态
    expect(state).toContain("rebuildKeymap"); // 键位表随 settings 同步（批 A 下沉 state.js）
    expect(settingsView).toContain('markDirty("shortcuts")'); // 改绑即改即存
    // U26/T-P3-129 + T-P3-149：语音（实验性）（STT 配置分节 + Composer 麦克风 +
    // 录音转写链 + 权限拒绝降级 + 三态状态机/插入冲突保护）
    expect(settingsView).toContain('id="stt-baseurl"');
    expect(settingsView).toContain('id="stt-model"');
    expect(settingsView).toContain('id="stt-maxseconds"'); // 录音时长上限（批 1）
    expect(settingsView).toContain('id="stt-refine"'); // 转写后润色开关（批 1）
    expect(settingsView).toContain('id="stt-protocol"'); // 协议通道下拉（T-P3-149 C1）
    expect(settingsView).toContain('id="tts-baseurl"'); // TTS 卡（T-P3-149 D 域）
    expect(settingsView).toContain('id="stt-test"'); // 行级测试按钮（真调用真回执）
    expect(settingsView).toContain('id="tts-test"');
    expect(settingsView).toContain("语音（实验性）");
    expect(html).toContain('id="mic-btn"'); // Composer 麦克风按钮
    expect(html).toContain('id="voice-status"'); // 录音三态状态条（批 1）
    expect(app).toContain('op: "stt-transcribe"'); // 转写代理数据面
    expect(app).toContain("composer-voice.js"); // 录音状态机下沉模块
    expect(voice).toContain("MediaRecorder"); // 浏览器录音 API（模块内）
    expect(voice).toContain("resolveVoiceInsertion"); // 插入冲突保护（pideck 移植）
    expect(voice).toContain("NotAllowedError"); // 权限拒绝降级（模块内）
    expect(settingsView).toContain('markDirty("stt")'); // STT 配置即改即存
    // T-P3-148 O/P/Q：插件管理迁独立页 views/plugins.js（清单/详情 sheet/
    // 审批三档——I4/I5/I9 管理面延伸 + contributes 贡献面）
    const pluginsView = read("views/plugins.js");
    expect(pluginsView).toContain('id="plugin-list"');
    expect(pluginsView).toContain('id="plugin-transport"');
    expect(pluginsView).toContain('id="plugin-install"');
    expect(pluginsView).toContain('op: "plugins-list"'); // 清单数据面
    expect(pluginsView).toContain('op: "plugin-check"'); // 安装前真实清单审批面
    expect(pluginsView).toContain("refreshPluginsList"); // 清单刷新
    expect(pluginsView).toContain('markDirty("plugins")'); // 启停/安装/设置即改即存
    expect(pluginsView).toContain("plugin-sheet"); // 详情右侧 sheet（P）
    expect(pluginsView).toContain("risk-${tier}"); // 审批风险三档构造（Q）
    // U18/T-P3-120：辅助模型分节（judge/summarizer 独立配置 + 回退链 hint）
    expect(settingsView).toContain('id="enh-judge-provider"');
    expect(settingsView).toContain('id="enh-summarizer-model"');
    expect(settingsView).toContain('markDirty("enhancement")'); // 即改即存
    expect(settingsView).toContain("回退主模型链"); // 缺省回退语义提示
    // U19/T-P3-121：Profiles 组合档 + 故障转移优先级排序 + 侧栏快速切换
    expect(settingsView).toContain('id="profile-list"');
    expect(html).toContain('id="profile-quick"'); // 侧栏底部快速器（批 A 骨架）
    expect(settingsView).toContain('id="profile-snapshot"');
    expect(settingsView).toContain("applyProfileValues"); // 切换 = 批量写生效段
    expect(settingsView).toContain("故障转移优先级"); // 排序按钮提示（↑↓ = J15 队列序）
    // U20/T-P3-122 → T-P3-153：数据中心五卡组（transfer.js 域文件）
    expect(settingsView).toContain('id="export-open"');
    expect(settingsView).toContain('id="import-open"');
    expect(settingsView).toContain('op: "export-settings"'); // 选择性导出 wire 面
    expect(settingsView).toContain('id="backup-now"'); // 备份中心
    expect(settingsView).toContain('id="checkup-run"'); // 配置体检
    expect(settingsView).toContain('id="session-import-open"'); // 会话 JSON 回导
    expect(app).toContain("aegentApplyDeepLink"); // 深链宿主接线钩子（入口委派设置域）
    expect(app).toContain("chat-export-btn"); // 聊天页会话导出入口（composer ⬇）
    expect(settingsView).toContain("确认导入"); // 导入必确认（不可信输入面）
    expect(settingsView).toContain("不含凭据"); // 零明文纪律的 UI 提示
    // U12/T-P3-111：用量页（上下文检查器 + 成本统计页——J21 消费端；批 A 迁 views/usage.js）
    expect(usageView).toContain('id="usage-panel"');
    expect(usageView).toContain('id="ctx-meter-fill"');
    expect(usageView).toContain('id="cost-table"');
    expect(usageView).toContain('op: "usage"'); // 聚合数据源单源
    expect(usageView).toContain("已压缩"); // 压缩状态可见
    expect(usageView).toContain("pricing 段未配置"); // 无价格不虚构的成本解释面
    // T-P3-135 批 B⑩：统计页可视化（摘要卡行/SVG 趋势线/热力图/模型甜甜圈——
    // 方案 A 手绘复刻；byDay = host 路线定形，server e2e 钉死）
    expect(usageView).toContain('id="usage-summary"'); // 摘要卡行 grid-cols-5
    expect(usageView).toContain('id="usage-trend"'); // SVG 趋势线
    expect(usageView).toContain('id="usage-heatmap"'); // 活跃热力图
    expect(usageView).toContain('id="usage-donut"'); // 模型甜甜圈
    expect(usageView).toContain("tabs-pill"); // 近 7/30 日胶囊切换
    expect(usageView).toContain("byDay"); // 每日聚合消费（§1.2 数据缺口收口）
    expect(usageView).toContain("Intl.NumberFormat"); // Intl compact 数字格式
    // U13/T-P3-112 五件套：通知中心/Toast/引导/恢复横幅/更新横幅（消费端钩子）
    expect(sidebar).toContain("confirmDialog"); // 硬删除确认（会话删除——T-P3-156 迁侧栏）
    expect(read("views/notify.js")).toContain('id="notify-panel"'); // 通知中心（批 A 迁 views/notify.js）
    expect(html).toContain('id="toast-area"');
    expect(html).not.toContain('id="onboarding"'); // 反馈 1：引导窗口移除（2026-10-03 用户裁决）
    expect(html).toContain('id="recovery-banner"');
    expect(html).toContain('id="update-banner"');
    expect(html).toContain('id="release-notes"');
    expect(app).toContain('name === "n5"'); // N5 分型消费
    expect(app).toContain("consumeN5");
    expect(app).not.toContain("maybeOnboard"); // 反馈 1：首跑引导逻辑移除
    expect(app).toContain("showRecoveryIfInterrupted"); // M3 可视化
    expect(app).toContain("aegentShowUpdate"); // U7 接线点（T-P3-114）
    // U15/T-P3-117：工作面板四 Tab（文件树/变更评审/子代理监控/协作——批 A 迁 views/work.js）
    // T-P3-156 布局批：侧栏 work 按钮移除（文件树→侧栏滑入层，变更评审/子代理
    // 随功能批/面板批迁面板宿主），#work 保留深链（keymap Ctrl+J / goto 路由）
    expect(workView).toContain('id="workpanel"');
    expect(app).toContain('go("work")'); // 深链入口（KEYMAP_HANDLERS.work）
    expect(workView).toContain('data-worktab="files"');
    expect(workView).toContain('data-worktab="review"');
    expect(workView).toContain('data-worktab="subagent"');
    expect(workView).toContain('id="work-filetree"');
    expect(workView).toContain('id="work-delegation-table"');
    expect(workView).toContain('op: "review"'); // 变更/委派纯函数直答数据源
    expect(workView).toContain('op: "file"'); // 文件树点击预览
    expect(workView).toContain("refreshWorkReview"); // turn_settled 自动刷新接线
    expect(workView).toContain("previewWorkspaceFile");
    expect(workView).toContain('data-worktab="collab"'); // U27 协作 Tab
    expect(workView).toContain('id="work-collab-table"');
    for (const marker of [".work-tab", ".tree-row", ".review-badge", "#work-preview"]) {
      expect(css).toContain(marker);
    }
    for (const marker of [".search-hit", ".mm-row", "#find-bar", "#minimap", ".ac-row", ".attachment-chip"]) {
      expect(css).toContain(marker);
    }
    // 主题 token 层（批 A 迁 theme.css——全站唯一取色处；亮色覆盖在位）
    expect(theme).toContain('body[data-theme="light"]');
    expect(theme).toContain("--bg:");
    // T-P3-157 批 1：旧名兼容别名退役（消费面全量换主名）——新 token 在位断言
    expect(theme).toContain("--focus-ring:");
    expect(theme).toContain("--bg-menu-hover:");
    expect(theme).toContain("--disabled-opacity:");
    expect(theme).not.toMatch(/--(ok|warn|danger|accent|panel|dim):/); // 别名已删
    expect(css).toContain('@import "./theme.css"'); // token 层接入点
  });
});
