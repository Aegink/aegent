/**
 * Agent 能力组（T-P3-135 · UI 批次 B⑤⑥⑧——mcp/skills/subagents/prompts/
 * enhancement/plugins/speech 七分节）：
 * - mcp（T-P3-143 v2）：36px 图标座 + 四态状态点（绿=测过成功/红=测过失败/
 *   灰=停用/无点=启用未测）+ 44×24 开关 + 命令行等宽 + transport/工具数/
 *   含 env/导入来源 chips + 行级「测试」（真握手）+ 双形式向导（表单 | JSON
 *   三形状粘贴——zcode McpServerForm 同构）+ 外部配置导入模态（zcode
 *   ExternalAgentImportDialog 行为锚：全选/计数/刷新/重名跳过）；
 * - skills/subagents/prompts：分组卡片 + 空状态虚线框引导 + 工具数徽标 +
 *   顶部搜索框；
 * - plugins：市场式卡片行（图标座 + 名称/来源 tag + 描述 + 右侧操作组 +
 *   错误行红文本——InstalledPluginsPanel 形态（只学行为）；安装表单下沉模态）；
 * - enhancement/speech：行式卡。
 * 数据面逻辑原样（op:skills-list/skill-save/subagents-list/plugins-list/
 * mcp-check/mcp-import-scan 增删改与即改即存链全保留）。
 */

import { sendSettings, ensureMetaCache } from "../../api.js";
import { settingsCache, getSessionId, markPromptsLoaded } from "../../state.js";
import { appendLine, toast } from "../../feedback.js";
import { icon } from "../../icons.js";
import {
  markDirty,
  dirtySections,
  openDialog,
  confirmDialog,
  rowEl,
  rowCopyEl,
  rowControl,
  btnEl,
  emptyState,
  chipEl,
  switchEl,
  refreshSelectPanel,
  flushSettings,
} from "./core.js";

export const SECTIONS_HTML = `
<section data-section="mcp">
  <div class="section-head">
    <h2 class="section-title">MCP 服务器</h2>
    <div class="section-tools">
      <button id="mcp-import" type="button" class="btn">导入外部配置</button>
      <button id="mcp-add" type="button" class="btn btn-primary">添加 server</button>
    </div>
  </div>
  <div id="mcp-list" class="row-list"></div>
  <div id="mcp-wizard" class="card-box" hidden>
    <div id="mcp-step1">
      <div class="mcp-mode-row">
        <span class="mcp-mode-title" id="mcp-wizard-title">新建 MCP server</span>
        <div class="mcp-mode-seg" role="tablist" aria-label="新建形式">
          <button id="mcp-mode-form" type="button" class="seg-btn active">表单</button>
          <button id="mcp-mode-json" type="button" class="seg-btn">JSON</button>
        </div>
      </div>
      <div id="mcp-form-mode">
        <div class="form-grid">
          <label>类型
            <select id="mcp-type" class="select">
              <option value="stdio">stdio（本地命令）</option>
              <option value="http" disabled>http（内核暂未支持——随 HTTP transport 扩展）</option>
            </select>
          </label>
          <label>名称（工具前缀）<input id="mcp-name" class="input" type="text" placeholder="不含 __" autocomplete="off" /></label>
          <label>启动命令<input id="mcp-command" class="input" type="text" placeholder="如 npx" autocomplete="off" /></label>
          <label>参数（空格分隔）<input id="mcp-args" class="input" type="text" placeholder="空格分隔，如 -y @modelcontextprotocol/server-memory" autocomplete="off" /></label>
          <label>超时 MS（可选）<input id="mcp-timeout" class="input" type="number" min="1000" step="500" placeholder="缺省 10000" autocomplete="off" /></label>
        </div>
        <details class="mcp-adv">
          <summary>环境变量（可选）</summary>
          <textarea id="mcp-env" class="textarea" rows="3" placeholder='{"MY_API_KEY": "your-key"}（JSON 对象，随条目落档）'></textarea>
          <p id="mcp-env-error" class="hint error-text" hidden></p>
        </details>
      </div>
      <div id="mcp-json-mode" hidden>
        <textarea id="mcp-json" class="textarea mono" rows="8" placeholder='{
  "my-mcp-server": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-memory"]
  }
}'></textarea>
        <p class="hint">支持直接粘贴 <code>{"server-name": {...}}</code>、<code>{"mcpServers": {"server-name": {...}}}</code> 或裸配置对象（含 command）；一次添加一个 server，远程（url 型）暂不支持。</p>
        <p id="mcp-json-error" class="hint error-text" hidden></p>
      </div>
      <div class="form-actions"><button id="mcp-next" type="button" class="btn btn-primary">下一步：测连接</button></div>
    </div>
    <div id="mcp-step2" hidden>
      <p id="mcp-check-result" class="hint">未测试</p>
      <div id="mcp-check-tools" class="row-chips" hidden></div>
      <div class="form-actions">
        <button id="mcp-test" type="button" class="btn">测连接</button>
        <button id="mcp-save" type="button" class="btn btn-primary" disabled>保存</button>
        <button id="mcp-back" type="button" class="btn btn-ghost">上一步</button>
      </div>
    </div>
  </div>
  <p class="hint">启停即时落档，新会话生效（子进程装配期连接注册；单 server 失败不影响启动）。「测试」= 真 spawn + 握手 + 列工具：绿点 = 最近测试成功、红 = 失败、无点 = 启用但未测试、灰 = 已停用；工具数与工具名（前 24）随测试结果显示。环境变量与超时随条目落档。</p>
</section>
<section data-section="skills">
  <div class="section-head">
    <h2 class="section-title">技能</h2>
    <div class="section-tools">
      <input id="skill-search" class="input input-search" type="text" placeholder="搜索技能…" autocomplete="off" />
      <button id="skill-import" type="button" class="btn">导入技能</button>
      <button id="skill-new" type="button" class="btn btn-primary">新建技能</button>
    </div>
  </div>
  <div id="skill-list" class="row-list"></div>
  <div id="skill-editor" class="card-box" hidden>
    <div class="form-grid">
      <label>技能名（slug）<input id="skill-name" class="input" type="text" placeholder="小写字母数字开头，可含 . - _" autocomplete="off" /></label>
      <label>描述<input id="skill-desc" class="input" type="text" placeholder="清单与系统提示显示用" autocomplete="off" /></label>
    </div>
    <div class="hint">工具集（可选——勾选该技能声明的工作工具）</div>
    <div id="skill-tools" class="chip-picker"></div>
    <textarea id="skill-body" class="textarea" rows="6" placeholder="技能正文（写入 SKILL.md 的 frontmatter 之后——给模型看的操作指引）"></textarea>
    <div id="skill-bytes" class="skill-bytes"></div>
    <div class="form-actions">
      <button id="skill-save" type="button" class="btn btn-primary">保存技能</button>
      <button id="skill-cancel" type="button" class="btn btn-ghost">取消</button>
    </div>
  </div>
  <h3 class="group-title">来源目录</h3>
  <div id="skill-roots" class="row-list"></div>
  <form id="skill-root-form" class="form-inline">
    <input id="skill-root-path" class="input" type="text" placeholder="附加技能来源目录（绝对路径）" autocomplete="off" />
    <button type="submit" class="btn">添加来源</button>
  </form>
  <p class="hint">workspace 主目录（.zcode/skills）恒为首个来源；附加目录的技能同样出现在清单。停用 = 从新会话装配剔除（清单/系统提示/skill_load 三面一致）；技能正文上限 128KB（超 80% 计数器变黄）。「导入技能」扫 Claude Code / Codex / .agents 等外部源整目录复制（同名跳过绝不覆盖）；删除 = 删技能目录（含附属资源，受控根护栏）。</p>
</section>
<section data-section="subagents">
  <div class="section-head">
    <h2 class="section-title">子智能体</h2>
    <div class="section-tools">
      <input id="subagent-search" class="input input-search" type="text" placeholder="搜索子代理…" autocomplete="off" />
      <button id="subagent-new" type="button" class="btn btn-primary">新建自定义子代理</button>
    </div>
  </div>
  <div id="subagent-list"></div>
  <div id="subagent-editor" class="card-box" hidden>
    <div id="subagent-preset-row" hidden>
      <div class="hint">从模板开始（点击整体填充名称/描述/工具/指令——高级字段保留你已选的值）</div>
      <div id="subagent-presets" class="row-chips"></div>
    </div>
    <div class="form-grid">
      <label>预设名（slug）<input id="subagent-name" class="input" type="text" placeholder="小写字母数字- _，task 调用标识" autocomplete="off" /></label>
      <label>何时委派给它<input id="subagent-desc" class="input" type="text" placeholder="一句话说明——这是主代理委派前唯一能看到的内容" autocomplete="off" /></label>
    </div>
    <div class="hint">可用工具——「继承主会话工具」= 不收窄；不勾时至少勾选一个工具。<span class="mutating-mark">橙框</span>工具可改动文件或执行命令。</div>
    <label class="check-line"><input id="subagent-inherit-tools" type="checkbox" checked /> 继承主会话工具（不收窄）</label>
    <div id="subagent-tools" class="chip-picker"></div>
    <div class="hint">指令（写入子会话系统提示的身份段——"父会话只看你的最终消息，看不到你的过程"）<span id="subagent-bytes" class="skill-bytes" style="display:inline-block;float:right"></span></div>
    <textarea id="subagent-prompt" class="textarea" rows="6" placeholder="## 任务&#10;<这个子代理要做什么>&#10;&#10;## 汇报要求&#10;说清楚最终答案长什么样——父会话只看你的最终消息，看不到你的步骤。&#10;&#10;## 限制&#10;<不得做什么>"></textarea>
    <details id="subagent-advanced">
      <summary>高级</summary>
      <div class="form-grid form-grid-2">
        <label>模型条目<select id="subagent-provider" class="select"></select></label>
        <label>模型 id<select id="subagent-model" class="select"></select></label>
      </div>
      <div class="form-grid form-grid-2">
        <label>推理强度<select id="subagent-reasoning" class="select">
          <option value="">与会话一致</option>
          <option value="omit">不传递（omit）</option>
          <option value="minimal">minimal</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select></label>
        <label>输出上限（单次响应 token）<input id="subagent-maxtokens" class="input" type="number" min="1" max="200000" step="1000" placeholder="跟随模型" autocomplete="off" /></label>
      </div>
      <div class="hint">备用模型（按序尝试——仅 provider 终态错误触发）</div>
      <div id="subagent-fallbacks" class="row-chips"></div>
      <div class="form-inline">
        <select id="subagent-fallback-add" class="select"></select>
        <button id="subagent-fallback-append" type="button" class="btn">添加备用模型</button>
      </div>
    </details>
    <div class="form-actions">
      <button id="subagent-save" type="button" class="btn btn-primary">保存预设</button>
      <button id="subagent-cancel" type="button" class="btn btn-ghost">取消</button>
    </div>
  </div>
  <p class="hint">内置预设可在 task 工具中以 subagent_type 调用（如 explorer / code-reviewer）；停用的内置保留在清单里（开关是开回的路径）。「复制为我的定义」= 以内置为底稿建同名覆盖记录。指令上限 32KB（超 80% 计数器变黄）。</p>
</section>
<section data-section="prompts">
  <div class="section-head">
    <h2 class="section-title">提示词模板<span id="prompt-status" class="section-count"></span></h2>
    <div class="section-tools">
      <input id="prompt-search" class="input input-search" type="text" placeholder="搜索模板…" autocomplete="off" />
      <button id="prompt-import" type="button" class="btn">导入外部命令</button>
      <button id="prompt-new" type="button" class="btn btn-primary">新建模板</button>
    </div>
  </div>
  <div id="prompt-list" class="row-list"></div>
  <details id="prompt-mcp-wrap" class="skill-diag" hidden>
    <summary id="prompt-mcp-summary">MCP prompts（只读）</summary>
    <div id="prompt-mcp-list" class="row-list"></div>
  </details>
  <p class="hint">模板 = 斜杠命令：有参模板（正文含 $1/$ARGUMENTS 或填了参数提示）在输入区选中后插入 "/名 " 续打参数，发送时由内核展开（发送时求值——pi/zcode/opencode 统一语义）；无参模板保持整段插入。文件落盘 <code>.zcode/prompts/</code>（项目）与 <code>~/.aegent/prompts/</code>（用户级），项目遮蔽同名用户模板；frontmatter 支持 description / argument-hint / agent（以子代理执行）/ model（命令级模型）。内置 <code>/init</code> 可被同名文件覆盖；停用开关不改文件。</p>
</section>
<section data-section="enhancement">
  <div class="section-head">
    <h2 class="section-title">辅助模型</h2>
    <div class="section-tools">
      <label class="check-line" title="关闭后：标题不跑、润色停用、判官落回人、摘要回退主模型"><input id="enh-enabled" type="checkbox" /> 辅助流量总开关</label>
    </div>
  </div>
  <p class="hint">主对话之外的模型调用统一在此路由，回退链 = 任务显式配置 → 全局轻模型 → 主模型（新会话生效；摘要质量任务建议显式配主模型档——命名/分类类轻任务适合轻模型）。备选模型（fallbacks）为有序列表，当前在配置文件 enhancement.*.fallbacks 生效。</p>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">全局轻模型（fastModel）</div>
        <div class="row-desc">所有未显式配置任务的缺省辅助模型——轻任务的自然落点</div>
      </div>
      <div class="row-control">
        <select id="enh-fastModel-provider" class="select" aria-label="轻模型供应商"></select>
        <select id="enh-fastModel-model" class="select" aria-label="轻模型模型"></select>
        <button id="enh-test-fastModel" type="button" class="btn">测试</button>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">判官（策略 ask 复核）</div>
        <div class="row-desc">allow 假阳性免挂起、deny 确定性复核——未配置时判官落回人</div>
      </div>
      <div class="row-control">
        <select id="enh-judge-provider" class="select" aria-label="判官供应商"></select>
        <select id="enh-judge-model" class="select" aria-label="判官模型"></select>
        <button id="enh-test-judge" type="button" class="btn">测试</button>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">摘要（F5 上下文压缩）</div>
        <div class="row-desc">压缩摘要走主模型质量最佳——轻模型仅加速；回退主模型链</div>
      </div>
      <div class="row-control">
        <select id="enh-summarizer-provider" class="select" aria-label="摘要供应商"></select>
        <select id="enh-summarizer-model" class="select" aria-label="摘要模型"></select>
        <button id="enh-test-summarizer" type="button" class="btn">测试</button>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">会话标题</div>
        <div class="row-desc">首个轮次后异步生成短标题（历史页/侧栏显示）——失败静默保留默认</div>
      </div>
      <div class="row-control">
        <select id="enh-title-provider" class="select" aria-label="标题供应商"></select>
        <select id="enh-title-model" class="select" aria-label="标题模型"></select>
        <button id="enh-test-title" type="button" class="btn">测试</button>
      </div>
    </div>
  </div>
  <details class="prompt-help"><summary>标题指令覆写（可选）</summary>
    <textarea id="enh-title-prompt" class="textarea" rows="3" placeholder="缺省：≤25 字符短具体名 / 跟随用户语言 / 只输出标题本身"></textarea>
  </details>
  <details class="prompt-help"><summary>压缩摘要指令覆写（可选——codex compact_prompt 同构）</summary>
    <textarea id="enh-summary-prompt" class="textarea" rows="4" placeholder="缺省：内置摘要员指令（≤500 字 + title/summary 标签格式）。整段覆盖——改写请保留输出格式约束。"></textarea>
  </details>
  <div class="section-head" style="margin-top:16px"><h3 class="section-title">一键润色（输入区润色按钮）</h3></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">润色模型</div>
        <div class="row-desc">缺省回退轻模型 → 主模型；reasoning 缺省关（改写很少受益）</div>
      </div>
      <div class="row-control">
        <select id="enh-polish-provider" class="select" aria-label="润色供应商"></select>
        <select id="enh-polish-model" class="select" aria-label="润色模型"></select>
        <button id="enh-test-polish" type="button" class="btn">测试</button>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">用户润色模板</div>
        <div class="row-desc">{{draft}} 占位；编辑回默认文本 = 清除覆盖（恢复内置模板）</div>
      </div>
      <div class="row-control">
        <label class="check-line"><input id="enh-polish-custom" type="checkbox" /> 启用自定义</label>
      </div>
    </div>
  </div>
  <textarea id="enh-polish-template" class="textarea" rows="3" placeholder="{{draft}}（勾选「启用自定义」后生效——草稿即变量值）"></textarea>
  <div id="enh-polish-bytes" class="skill-bytes"></div>
  <div class="row-control" style="gap:8px">
    <button id="enh-polish-insert" type="button" class="btn">插入 {{draft}}</button>
    <button id="enh-polish-reset" type="button" class="btn btn-ghost">恢复默认</button>
  </div>
</section>
<section data-section="speech">
  <div class="section-head"><h2 class="section-title">语音 <span class="badge">实验性</span></h2></div>
  <p class="hint">两个独立服务：语音识别（输入区麦克风按钮，录音→文字进输入框）与语音合成（消息朗读）。端点 key 分别在「供应商」页底部"预存密钥"区以 <code>stt</code> / <code>tts</code> 录入（零明文）；音频即时处理，不留存。</p>
  <div class="row-title" style="margin:16px 0 4px">语音识别（STT——录音转文字）</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">协议通道</div>
        <div class="row-desc">转写端点 = OpenAI /audio/transcriptions；对话端点 = chat 接口 input_audio（DashScope 类 Qwen-ASR 走此通道）</div>
      </div>
      <div class="row-control">
        <select id="stt-protocol" class="select">
          <option value="transcriptions">转写端点（whisper 系）</option>
          <option value="chat">对话端点（input_audio）</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">STT 端点根</div>
        <div class="row-desc">OpenAI 协议兼容端点（如 https://api.openai.com/v1）；「复用供应商」= 填入当前供应商 baseUrl 并复用其凭据（供应商带语音模型时零额外配置）。</div>
      </div>
      <div class="row-control">
        <input id="stt-baseurl" class="input input-wide" type="text" placeholder="（未配置——语音输入不可用）" autocomplete="off" />
        <button id="stt-from-provider" type="button" class="btn">复用供应商</button>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">转写模型</div>
        <div class="row-desc">如 whisper-1（转写端点）或 qwen3-asr-flash（对话端点）</div>
      </div>
      <div class="row-control"><input id="stt-model" class="input" type="text" placeholder="如 whisper-1" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">语言提示（BCP-47 可选）</div>
        <div class="row-desc">如 zh（缺省自动检测）</div>
      </div>
      <div class="row-control"><input id="stt-language" class="input input-num" type="text" placeholder="如 zh" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">录音时长上限（秒）</div>
        <div class="row-desc">到点自动停止并转写（缺省 120，上限 600）</div>
      </div>
      <div class="row-control"><input id="stt-maxseconds" class="input input-num" type="number" min="1" max="600" placeholder="120" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">转写后润色</div>
        <div class="row-desc">辅助模型清理口语填充词（超时/失败自动回退原文；/·@ 开头的指令文本不参与）</div>
      </div>
      <div class="row-control"><label class="check-line"><input id="stt-refine" type="checkbox" /> 启用</label></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">静音自动停止</div>
        <div class="row-desc">录音中连续 2 秒静音自动结束并转写（起始 3 秒保护期不计）</div>
      </div>
      <div class="row-control"><label class="check-line"><input id="stt-silence" type="checkbox" /> 启用</label></div>
    </div>
  </div>
  <div class="row-control" style="gap:8px;margin:8px 0">
    <button id="stt-test" type="button" class="btn">测试识别</button>
    <span id="stt-test-result" class="row-desc" style="flex:1">发送 0.5 秒静音音频走真实端点——回显转写结果或错误。</span>
  </div>
  <div class="row-title" style="margin:16px 0 4px">语音合成（TTS——消息朗读）</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">TTS 端点根</div>
        <div class="row-desc">OpenAI 协议 /audio/speech 端点（如 https://api.openai.com/v1）</div>
      </div>
      <div class="row-control"><input id="tts-baseurl" class="input input-wide" type="text" placeholder="（未配置——消息朗读不可用）" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">合成模型</div>
        <div class="row-desc">如 tts-1 / gpt-4o-mini-tts</div>
      </div>
      <div class="row-control"><input id="tts-model" class="input" type="text" placeholder="如 tts-1" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">音色（可选）</div>
        <div class="row-desc">如 alloy / nova（缺省 provider 自选）</div>
      </div>
      <div class="row-control"><input id="tts-voice" class="input input-num" type="text" placeholder="如 alloy" autocomplete="off" /></div>
    </div>
  </div>
  <div class="row-control" style="gap:8px;margin:8px 0">
    <button id="tts-test" type="button" class="btn">测试合成</button>
    <span id="tts-test-result" class="row-desc" style="flex:1">合成一句测试语并直接播放——回显结果或错误。</span>
  </div>
  <p class="hint">录音交互：点击麦克风按钮开始（计时+音量条），再点停止或到上限自动停，Esc 取消；转写文本插入输入框供确认，不自动发送。</p>
</section>
`;

// ---------------------------------------------------------------------------
// T-P3-143 MCP 管理：列表（行级测试 / 四态状态点 / 工具数·env·来源徽章）+
// 双形式向导（表单 | JSON 三形状粘贴——zcode McpServerForm 同构）+ 外部配置
// 导入模态（mcp-import-scan 扫描 → 勾选 → 并入 settings.mcp，随保存落档）。
// 连接校验数据面 = op:"mcp-check"（probeServer 真握手，env/timeoutMs 随载荷）
// ---------------------------------------------------------------------------

let editingMcpName = null;
let mcpWizardEntry = null; // 向导当前编辑的 {name, command, args?, env?, timeoutMs?}
let mcpTestOk = false;
let mcpMode = "form"; // 向导当前形式："form" | "json"
/** 最近一次测试失败的 server 名（行状态点红）。 */
const mcpCheckFailures = new Set();
/** 最近一次测试结果（name → {ok, toolCount, toolNames, protocolVersion}——内存面，不落 settings）。 */
const mcpCheckResults = new Map();
/** 行级测试进行中（防重入）。 */
const mcpTesting = new Set();
/** 导入来源徽章（name → 来源 label——内存面，不落 settings）。 */
const mcpImportSource = new Map();

/** 行状态点四态（zcode 状态语义同构）：绿=测过成功 / 红=测过失败 / 灰=停用 / 无点=启用未测。 */
function mcpIconBadge(name, enabled) {
  const badge = document.createElement("span");
  badge.className = "icon-badge";
  badge.appendChild(icon("plug"));
  const failed = mcpCheckFailures.has(name);
  const ok = mcpCheckResults.get(name)?.ok === true;
  if (enabled && (ok || failed)) {
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.style.setProperty("--dot-color", ok ? "var(--success)" : "var(--destructive)");
    dot.title = ok ? "已启用（最近测试成功）" : "最近一次测试失败";
    badge.appendChild(dot);
  } else if (!enabled) {
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.style.setProperty("--dot-color", "var(--text-subtlest)");
    dot.title = "已停用";
    badge.appendChild(dot);
  } // 启用但未测试——无点（badge title 交代语义）
  badge.title = enabled
    ? ok
      ? "已启用（最近测试成功）"
      : failed
        ? "最近一次测试失败"
        : "已启用（未测试——行内「测试」真握手）"
    : "已停用";
  return badge;
}

/** 测试一行（行级真实测试——同一 mcp-check 数据面，env/timeoutMs 随载荷）。 */
function testMcpEntry(entry, onDone) {
  mcpTesting.add(entry.name);
  void sendSettings({
    op: "mcp-check",
    name: entry.name,
    command: entry.command,
    ...(entry.args !== undefined ? { args: entry.args } : {}),
    ...(entry.env !== undefined ? { env: entry.env } : {}),
    ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
  }).then((envelope) => {
    mcpTesting.delete(entry.name);
    onDone(envelope);
  });
}

/** 测试结果落内存面 + 回执（成功/失败两态——toolNames 前 24 截断）。 */
function recordMcpCheck(name, envelope) {
  if (!envelope.ok) return { ok: false, message: envelope.error?.message ?? "校验不可用" };
  const check = envelope.result.check;
  if (check.ok) {
    const tools = check.tools ?? [];
    mcpCheckResults.set(name, {
      ok: true,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      protocolVersion: check.protocolVersion,
    });
    mcpCheckFailures.delete(name);
    return { ok: true, tools, protocolVersion: check.protocolVersion };
  }
  mcpCheckResults.delete(name);
  mcpCheckFailures.add(name);
  return { ok: false, message: check.error?.message ?? "连接失败" };
}

/** 工具数徽标（title = 前 24 个工具名一览——pi-desktop 形态）。 */
function mcpToolChip(name) {
  const result = mcpCheckResults.get(name);
  if (result === undefined || !result.ok) return null;
  const chip = chipEl(`${result.toolCount} 工具`);
  const preview = (result.toolNames ?? []).slice(0, 24).join(", ");
  chip.title =
    preview === ""
      ? "该 server 未声明工具"
      : (result.toolNames ?? []).length > 24
        ? `${preview} …（共 ${String(result.toolCount)} 个）`
        : preview;
  return chip;
}

function renderMcpList() {
  const list = document.getElementById("mcp-list");
  if (list === null) return;
  list.replaceChildren();
  const servers = settingsCache?.mcp ?? [];
  if (servers.length === 0) {
    const empty = emptyState("无 MCP server", "手动建档，或从 Claude / Codex / Cursor 等外部工具的配置一键导入");
    const actions = document.createElement("div");
    actions.className = "empty-actions";
    const addBtn = btnEl("添加 server", "btn btn-primary");
    addBtn.addEventListener("click", () => {
      editingMcpName = null;
      openMcpWizard(null);
    });
    const importBtn = btnEl("导入外部配置", "btn");
    importBtn.addEventListener("click", () => void openMcpImportDialog());
    actions.append(addBtn, importBtn);
    empty.appendChild(actions);
    list.appendChild(empty);
    return;
  }
  for (const s of servers) {
    const row = rowEl();
    const enabled = s.enabled !== false;
    const titleEl = document.createElement("div");
    titleEl.className = "row-title title-btn";
    titleEl.textContent = s.name;
    const descEl = document.createElement("div");
    descEl.className = "row-desc mono";
    descEl.textContent = `${s.command}${(s.args ?? []).length > 0 ? ` ${(s.args ?? []).join(" ")}` : ""}`;
    const copy = rowCopyEl(titleEl, descEl);
    const tools = document.createElement("div");
    tools.className = "row-chips";
    tools.appendChild(chipEl(s.transport === "ws" ? "ws" : "stdio"));
    const toolChip = mcpToolChip(s.name);
    if (toolChip !== null) tools.appendChild(toolChip);
    if (Object.keys(s.env ?? {}).length > 0) {
      const envChip = chipEl("含 env");
      envChip.title = `环境变量键：${Object.keys(s.env).join(", ")}（值不显示）`;
      tools.appendChild(envChip);
    }
    if (mcpImportSource.has(s.name)) {
      const srcChip = chipEl(`导入自 ${mcpImportSource.get(s.name)}`);
      srcChip.title = "导入来源（本次应用内记忆，不落档）";
      tools.appendChild(srcChip);
    }
    titleEl.style.cursor = "pointer";
    titleEl.title = "点击编辑该 server";
    titleEl.addEventListener("click", () => {
      editingMcpName = s.name;
      openMcpWizard(s);
    });
    const toggle = switchEl(enabled, (checked) => {
      // 缺省启用（enabled 缺省 true）：停用写 false、启用删字段回缺省
      settingsCache.mcp = (settingsCache.mcp ?? []).map((x) => {
        if (x.name !== s.name) return x;
        if (!checked) return { ...x, enabled: false };
        const { enabled: _omit, ...rest } = x;
        return rest;
      });
      if (!checked) mcpCheckFailures.delete(s.name);
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    }, `启停 MCP server ${s.name}`);
    const testBtn = btnEl(mcpTesting.has(s.name) ? "测试中…" : "测试", "btn", "真 spawn + 握手 + 列工具");
    testBtn.disabled = mcpTesting.has(s.name);
    testBtn.addEventListener("click", () => {
      testMcpEntry(s, (envelope) => {
        if (testBtn.isConnected === false) return; // 视图已卸载
        const outcome = recordMcpCheck(s.name, envelope);
        if (envelope.ok === false) {
          toast(`测试不可用：${outcome.message}`, "warn");
        } else if (outcome.ok) {
          toast(`${s.name}：${outcome.tools.length} 个工具（协议 ${outcome.protocolVersion}）`, "info");
        } else {
          toast(`${s.name}：${outcome.message}`, "warn");
        }
        renderMcpList();
      });
    });
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除 MCP server「${s.name}」？装载清单将移除该条目。`, { title: "删除 MCP server", confirmLabel: "删除", danger: true }))) return;
      settingsCache.mcp = (settingsCache.mcp ?? []).filter((x) => x.name !== s.name);
      mcpCheckFailures.delete(s.name);
      mcpCheckResults.delete(s.name);
      mcpImportSource.delete(s.name);
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    });
    const editBtn = btnEl("编辑", "btn", "打开向导修改该 server（名称/命令/参数/环境变量/超时）");
    editBtn.addEventListener("click", () => {
      editingMcpName = s.name;
      openMcpWizard(s);
    });
    row.append(mcpIconBadge(s.name, enabled), copy, rowControl(tools, testBtn, toggle, editBtn, delBtn));
    list.appendChild(row);
  }
}

// —— 向导：双形式（表单 | JSON——zcode 分段切换同构） ——

/** 表单模式当前字段的原始读取（envRaw 未解析——校验在提交面）。 */
function mcpFormRaw() {
  return {
    name: document.getElementById("mcp-name").value.trim(),
    command: document.getElementById("mcp-command").value.trim(),
    args: document.getElementById("mcp-args").value.trim().split(/\s+/).filter((a) => a !== ""),
    timeoutRaw: document.getElementById("mcp-timeout").value.trim(),
    envRaw: document.getElementById("mcp-env").value.trim(),
  };
}

/** JSON → 表单回填（名称空 = 裸配置形状——沿用表单名称字段现值）。 */
function fillMcpFormFromEntry(name, entry) {
  if (name !== "") document.getElementById("mcp-name").value = name;
  document.getElementById("mcp-command").value = entry.command;
  document.getElementById("mcp-args").value = (entry.args ?? []).join(" ");
  document.getElementById("mcp-env").value =
    entry.env !== undefined ? JSON.stringify(entry.env, null, 2) : "";
  document.getElementById("mcp-timeout").value =
    entry.timeoutMs !== undefined ? String(entry.timeoutMs) : "";
  document.getElementById("mcp-env-error").hidden = true;
}

/** 环境变量文本域解析（空 = undefined；非对象/非字符串值 → error）。 */
function parseMcpEnvText(text) {
  if (text === "") return { env: undefined };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "环境变量不是合法 JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "环境变量须为对象（{\"KEY\": \"value\"}）" };
  }
  const env = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") return { error: `环境变量 ${k} 的值须为字符串` };
    env[k] = v;
  }
  return { env: Object.keys(env).length > 0 ? env : undefined };
}

/**
 * JSON 粘贴三形状解析（zcode jsonDraftToForm 同构）：
 * {"name": {...}} / {"mcpServers": {"name": {...}}}（多条报错）/ 裸 config
 * （含 command——名称回退表单名称字段）。url 型 → 明确报错（内核仅 stdio）。
 */
function parseMcpJsonDraft(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "须为 JSON 对象" };
  }
  let name;
  let config;
  if (parsed.mcpServers !== undefined) {
    if (parsed.mcpServers === null || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) {
      return { error: "mcpServers 须为对象" };
    }
    const entries = Object.entries(parsed.mcpServers);
    if (entries.length === 0) return { error: "mcpServers 为空" };
    if (entries.length > 1) return { error: `一次只添加一个 server（mcpServers 含 ${entries.length} 个）` };
    [name, config] = entries[0];
  } else if (typeof parsed.command === "string" || typeof parsed.url === "string") {
    config = parsed; // 裸配置——名称取表单名称字段
  } else {
    const entries = Object.entries(parsed);
    const first = entries[0];
    if (entries.length !== 1 || first === undefined || first[1] === null || typeof first[1] !== "object" || Array.isArray(first[1])) {
      return { error: '无法识别的形状（支持 {"name": {...}} / {"mcpServers": {...}} / 裸配置对象）' };
    }
    [name, config] = first;
  }
  if (typeof config !== "object" || config === null) return { error: "server 配置须为对象" };
  if (typeof config.command !== "string" || config.command.trim() === "") {
    if (typeof config.url === "string" && config.url !== "") {
      return { error: "远程 server（url 型）暂不支持——内核仅 stdio" };
    }
    return { error: "配置缺少 command" };
  }
  const args =
    Array.isArray(config.args) && config.args.every((a) => typeof a === "string")
      ? config.args
      : undefined;
  const timeoutMs =
    typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : undefined;
  let env;
  if (config.env !== undefined) {
    if (config.env === null || typeof config.env !== "object" || Array.isArray(config.env)) {
      return { error: "env 须为对象" };
    }
    env = {};
    for (const [k, v] of Object.entries(config.env)) {
      if (typeof v !== "string") return { error: `env.${k} 的值须为字符串` };
      env[k] = v;
    }
    if (Object.keys(env).length === 0) env = undefined;
  }
  return {
    name: typeof name === "string" ? name.trim() : "",
    entry: {
      command: config.command,
      ...(args !== undefined && args.length > 0 ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
}

function setMcpMode(mode) {
  mcpMode = mode;
  const formMode = mode === "form";
  document.getElementById("mcp-form-mode").hidden = !formMode;
  document.getElementById("mcp-json-mode").hidden = formMode;
  document.getElementById("mcp-mode-form").classList.toggle("active", formMode);
  document.getElementById("mcp-mode-json").classList.toggle("active", !formMode);
}

function openMcpWizard(entry) {
  mcpWizardEntry = entry ?? null;
  mcpTestOk = false;
  document.getElementById("mcp-wizard").hidden = false;
  document.getElementById("mcp-step1").hidden = false;
  document.getElementById("mcp-step2").hidden = true;
  document.getElementById("mcp-save").disabled = true;
  document.getElementById("mcp-check-result").textContent = "未测试";
  document.getElementById("mcp-check-tools").hidden = true;
  document.getElementById("mcp-wizard-title").textContent =
    entry !== null ? `编辑 MCP server：${entry.name}` : "新建 MCP server";
  document.getElementById("mcp-name").value = entry?.name ?? "";
  document.getElementById("mcp-command").value = entry?.command ?? "";
  document.getElementById("mcp-args").value = (entry?.args ?? []).join(" ");
  document.getElementById("mcp-timeout").value =
    entry?.timeoutMs !== undefined ? String(entry.timeoutMs) : "";
  document.getElementById("mcp-env").value =
    entry?.env !== undefined ? JSON.stringify(entry.env, null, 2) : "";
  document.getElementById("mcp-env-error").hidden = true;
  document.getElementById("mcp-json").value = "";
  document.getElementById("mcp-json-error").hidden = true;
  setMcpMode("form");
  document.getElementById("mcp-wizard").scrollIntoView({ block: "nearest" });
}

// —— 外部配置导入模态（mcp-import-scan 扫描 → 勾选 → 并入 settings.mcp） ——

async function openMcpImportDialog() {
  const holder = document.createElement("div");
  holder.innerHTML = `
    <div class="mcp-import-head">
      <label class="check-line"><input id="mcp-imp-all" type="checkbox" checked /> 全选</label>
      <span id="mcp-imp-count" class="hint">已选 0/0</span>
      <button id="mcp-imp-refresh" type="button" class="btn">刷新</button>
    </div>
    <div id="mcp-imp-list" class="mcp-import-list"><p class="hint">扫描中…</p></div>
    <p class="hint">候选只读不写——导入并入下方清单（同名跳过），随设置「保存」落档。来源文件路径见各分组头。</p>`;
  let scan = null; // 最近一次扫描结果（刷新按钮重扫）
  const listBox = holder.querySelector("#mcp-imp-list");
  const countEl = holder.querySelector("#mcp-imp-count");

  function syncCount() {
    const boxes = [...listBox.querySelectorAll("input[data-candidate]")];
    const picked = boxes.filter((b) => b.checked).length;
    countEl.textContent = `已选 ${picked}/${boxes.length}`;
    holder.querySelector("#mcp-imp-all").checked = boxes.length > 0 && picked === boxes.length;
  }

  function renderScan() {
    listBox.replaceChildren();
    if (scan === null) {
      listBox.appendChild(document.createTextNode("扫描中…"));
      return;
    }
    if (scan.candidates.length === 0) {
      listBox.appendChild(emptyState("未发现可导入的 MCP server", "没有检出候选——来源状态见下方明细"));
    }
    // 候选分组（按来源 label）——组头 = 来源名 + 文件路径；行 = 勾选 + 名 + 命令
    const bySource = new Map();
    for (const c of scan.candidates) {
      if (!bySource.has(c.sourceLabel)) bySource.set(c.sourceLabel, []);
      bySource.get(c.sourceLabel).push(c);
    }
    for (const [label, items] of bySource) {
      const head = document.createElement("div");
      head.className = "group-title";
      head.textContent = `${label}（${items.length}）`;
      listBox.appendChild(head);
      for (const c of items) {
        const line = document.createElement("label");
        line.className = "check-line mcp-imp-line";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.candidate = c.name;
        box.addEventListener("change", syncCount);
        const nameEl = document.createElement("span");
        nameEl.className = "row-title";
        nameEl.textContent = c.name;
        const cmdEl = document.createElement("span");
        cmdEl.className = "row-desc mono";
        cmdEl.textContent = `${c.config.command}${(c.config.args ?? []).length > 0 ? ` ${(c.config.args ?? []).join(" ")}` : ""}`;
        line.append(box, nameEl, cmdEl);
        if (c.warning !== undefined) {
          line.title = c.warning;
        }
        listBox.appendChild(line);
      }
    }
    // 来源明细（未检出/跳过/错误——每源一行报告不静默）
    const detail = document.createElement("p");
    detail.className = "hint";
    const bits = [];
    for (const src of scan.sources) {
      if (!src.exists) continue;
      const flags = [];
      if (src.error !== undefined) flags.push(`错误：${src.error}`);
      if ((src.skipped ?? 0) > 0) flags.push(`跳过 ${src.skipped} 个（远程/停用/重名/坏条目）`);
      if (flags.length > 0) bits.push(`${src.label}（${src.path}）：${flags.join("；")}`);
    }
    detail.textContent = bits.length > 0 ? bits.join("\n") : "";
    detail.hidden = bits.length === 0;
    listBox.appendChild(detail);
    syncCount();
  }

  async function rescan() {
    scan = null;
    renderScan();
    const envelope = await sendSettings({ op: "mcp-import-scan" });
    if (!listBox.isConnected) return; // 模态已关
    if (!envelope.ok) {
      listBox.replaceChildren();
      listBox.appendChild(emptyState("扫描不可用", envelope.error?.message ?? ""));
      return;
    }
    scan = envelope.result;
    renderScan();
  }

  holder.querySelector("#mcp-imp-all").addEventListener("change", (ev) => {
    const checked = ev.target.checked;
    for (const box of listBox.querySelectorAll("input[data-candidate]")) box.checked = checked;
    syncCount();
  });
  holder.querySelector("#mcp-imp-refresh").addEventListener("click", () => void rescan());

  openDialog({
    title: "导入外部 Agent MCP 服务器",
    description:
      "扫描 Claude Code / Claude Desktop / Codex CLI / Cursor / OpenCode / Qwen Code / Trae / 通用 .agents / 工作区 .mcp.json 落盘的 MCP 配置（只读）。",
    width: "lg",
    body: holder,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "导入所选",
        className: "btn btn-primary",
        onClick: () => {
          if (scan === null) {
            toast("扫描尚未完成", "warn");
            return;
          }
          const boxes = [...holder.querySelectorAll("input[data-candidate]")];
          const picked = new Set(boxes.filter((b) => b.checked).map((b) => b.dataset.candidate));
          const existing = new Set((settingsCache.mcp ?? []).map((x) => x.name));
          const next = [...(settingsCache.mcp ?? [])];
          let imported = 0;
          let skipped = 0;
          for (const c of scan.candidates) {
            if (!picked.has(c.name)) continue;
            if (existing.has(c.name) || next.some((x) => x.name === c.name)) {
              skipped++; // 目标清单同名——zcode sameNameExists 语义
              continue;
            }
            next.push({
              name: c.name,
              command: c.config.command,
              ...(c.config.args !== undefined ? { args: c.config.args } : {}),
              ...(c.config.env !== undefined ? { env: c.config.env } : {}),
            });
            mcpImportSource.set(c.name, c.sourceLabel);
            imported++;
          }
          if (imported > 0) {
            settingsCache.mcp = next;
            dirtySections.add("mcp");
            renderMcpList();
            markDirty("mcp");
          }
          toast(
            imported === 0 && skipped === 0
              ? "未选择可导入项"
              : `已导入 ${imported} 个${skipped > 0 ? `（跳过重名 ${skipped} 个）` : ""}${imported > 0 ? "——保存设置后落档" : ""}`,
            imported > 0 ? "info" : "warn",
          );
        },
      },
    ],
  });
  void rescan();
}

// ---------------------------------------------------------------------------
// U22/T-P3-125 技能管理：清单（多根扫描 + 停用开关 + 搜索）+ 编辑器写回
// T-P3-144 v2：外部源导入（scan/apply）/ 行级删除（受控根护栏在 host）/
// Reveal / 新建种子模板 / 字节计数器 / 外部来源保存确认 / 根计数与诊断折叠
// ---------------------------------------------------------------------------

/** 技能清单缓存（open 时刷新——文件系统面，不与会话期缓存混用）。 */
let skillsView = null;
let editingSkillName = null; // 非 null = 编辑器在改既有技能（同名覆盖）
let editingSkillOrigin = null; // 编辑目标的来源根（外部来源保存确认面）
let skillBodyTouched = false; // 正文是否用户手写过（种子模板门控）
const skillToolsSelected = new Set();
let skillFilter = "";

/** 正文上限（与 host MAX_SKILL_BODY_BYTES 同值——pi-desktop SkillEditorSheet 同源）。 */
const SKILL_BODY_MAX_BYTES = 128 * 1024;

function skillMatches(s) {
  if (skillFilter === "") return true;
  const q = skillFilter.toLowerCase();
  return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
}

/** 正文字节计数（pi-desktop 形态：>80% 黄、超限红 + 保存禁用）。 */
function updateSkillBytes() {
  const el = document.getElementById("skill-bytes");
  if (el === null) return;
  const n = new TextEncoder().encode(document.getElementById("skill-body").value).length;
  el.textContent = n >= 1024 ? `${(n / 1024).toFixed(1)}KB / 128KB` : `${n}B / 128KB`;
  el.classList.toggle("warn", n > SKILL_BODY_MAX_BYTES * 0.8 && n <= SKILL_BODY_MAX_BYTES);
  el.classList.toggle("over", n > SKILL_BODY_MAX_BYTES);
  document.getElementById("skill-save").disabled = n > SKILL_BODY_MAX_BYTES;
}

/** C：种子模板（pi-desktop skillTemplate 同语义——"空编辑器教不会格式"）。 */
function skillSeedBody(name) {
  return `## 何时使用\n\n<「${name}」解决什么问题、什么时候该用它——一句话给模型判断依据>\n\n## 步骤\n\n1. \n\n## 注意\n\n- \n`;
}

async function refreshSkillsList() {
  const envelope = await sendSettings({ op: "skills-list" });
  if (document.getElementById("skill-list") === null) return; // 视图已卸载
  if (!envelope.ok) {
    const list = document.getElementById("skill-list");
    if (list === null) return;
    list.replaceChildren();
    list.appendChild(emptyState("技能清单不可用", envelope.error?.message ?? ""));
    return;
  }
  skillsView = envelope.result;
  renderSkills(); // 渲染与 fetch 拆分——本地乐观重渲走 renderSkills
}

function renderSkills() {
  // 本地权威渲染（T-P3-145 跟手修）：disabled 判定用 settingsCache（本地
  // 未落盘真相）——toggle 翻转立即重渲，不等服务端清单回包覆盖。
  const list = document.getElementById("skill-list");
  if (list === null || skillsView === null) return;
  list.replaceChildren();
  const localDisabled = new Set(settingsCache?.skills?.disabled ?? []);
  const visible = skillsView.skills.filter(skillMatches);
  if (visible.length === 0) {
    list.appendChild(
      skillsView.skills.length === 0
        ? emptyState("无技能", "点右上「新建技能」，或在 workspace/.zcode/skills 下放 SKILL.md 自动发现")
        : emptyState("无匹配技能", `没有名称/描述含「${skillFilter}」的技能`),
    );
  }
  for (const s of visible) {
    const row = rowEl();
    const disabled = localDisabled.has(s.name);
    const badge = document.createElement("span");
    badge.className = "icon-badge";
    badge.appendChild(icon("sparkles"));
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = s.name;
    const isWorkspace = s.origin === skillsView.roots[0];
    if (!isWorkspace) titleEl.appendChild(chipEl("外部来源"));
    if (disabled) titleEl.appendChild(chipEl("已停用"));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = s.description;
    const copy = rowCopyEl(titleEl, descEl);
    // 工具集 chips（技能声明的工具集——清单元数据展示）
    const toolsRow = document.createElement("div");
    toolsRow.className = "row-chips";
    for (const t of s.tools ?? []) toolsRow.appendChild(chipEl(t));
    const toggle = switchEl(!disabled, (checked) => {
      const cur = new Set(settingsCache.skills?.disabled ?? []);
      if (checked) cur.delete(s.name);
      else cur.add(s.name);
      settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.size > 0 ? { disabled: [...cur] } : {}) };
      dirtySections.add("skills");
      markDirty("skills");
      renderSkills(); // 乐观重渲（本地权威——不等服务端回包）
    }, `启停技能 ${s.name}`);
    const editBtn = btnEl("编辑", "btn", "打开技能编辑器（写回 SKILL.md）");
    editBtn.addEventListener("click", () => {
      void openSkillEditor(s);
    });
    const revealBtn = btnEl("目录", "btn", "打开技能所在文件夹");
    revealBtn.addEventListener("click", () => {
      void sendSettings({ op: "skill-reveal", path: s.filePath }).then((envelope) => {
        if (!envelope.ok) toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
      });
    });
    const delBtn = btnEl("删除", "btn btn-danger", "删除技能目录（含附属资源——受控根护栏在 host）");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除技能「${s.name}」？将删除其技能目录（含附属资源），不可恢复。`, { title: "删除技能", confirmLabel: "删除", danger: true }))) return;
      const envelope = await sendSettings({ op: "skill-delete", path: s.filePath });
      if (!envelope.ok) {
        toast(`删除失败：${envelope.error?.message ?? ""}`, "warn");
        return;
      }
      // 停用名单按名匹配——已删技能的停用记录同步清理
      const cur = (settingsCache.skills?.disabled ?? []).filter((x) => x !== s.name);
      settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.length > 0 ? { disabled: cur } : {}) };
      if (cur.length === 0 && settingsCache.skills !== undefined) delete settingsCache.skills.disabled;
      dirtySections.add("skills");
      markDirty("skills");
      toast(`技能已删除：${s.name}`, "info");
      void refreshSkillsList(); // 删除是文件系统面——必须回服务端重扫
    });
    row.append(badge, copy, rowControl(toolsRow, toggle, editBtn, revealBtn, delBtn));
    list.appendChild(row);
  }
  if (skillsView.diagnostics.length > 0) {
    // 诊断折叠汇总（zcode 琥珀横幅形态的轻量版——量小时一行可展开）
    const details = document.createElement("details");
    details.className = "skill-diag";
    const summary = document.createElement("summary");
    summary.textContent = `诊断（${skillsView.diagnostics.length}）`;
    details.appendChild(summary);
    for (const d of skillsView.diagnostics) {
      const row = rowEl();
      const warnEl = document.createElement("div");
      warnEl.className = "row-copy";
      const t = document.createElement("div");
      t.className = "row-desc error-text";
      t.textContent = `[${d.code}] ${d.path}——${d.message}`;
      warnEl.appendChild(t);
      row.append(warnEl);
      details.appendChild(row);
    }
    list.appendChild(details);
  }
  renderSkillRoots(); // 技能计数随清单刷新（skillsView.roots 序对应已就绪）
}

function renderSkillRoots() {
  const list = document.getElementById("skill-roots");
  if (list === null) return;
  list.replaceChildren();
  const roots = settingsCache?.skills?.roots ?? [];
  if (roots.length === 0) {
    list.appendChild(emptyState("无附加来源", "workspace 主目录恒在——附加目录的技能同样自动发现"));
    return;
  }
  for (let i = 0; i < roots.length; i++) {
    const r = roots[i];
    // 技能计数（E）：settingsCache roots 序对应 skillsView.roots[1..]
    // （首根 = workspace 主技能目录）；skillsView 未加载时无计数
    const originDir = skillsView?.roots?.[i + 1];
    const count =
      originDir !== undefined
        ? (skillsView?.skills ?? []).filter((s) => s.origin === originDir).length
        : undefined;
    const row = rowEl();
    const descEl = document.createElement("div");
    descEl.className = "row-desc mono";
    descEl.textContent = count !== undefined ? `${r}（${count} 个技能）` : r;
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", () => {
      settingsCache.skills = {
        ...(settingsCache.skills ?? {}),
        roots: roots.filter((x) => x !== r),
      };
      if ((settingsCache.skills.roots ?? []).length === 0) delete settingsCache.skills.roots;
      dirtySections.add("skills");
      renderSkillRoots();
      markDirty("skills");
      void refreshSkillsList();
    });
    row.append(descEl, rowControl(delBtn));
    list.appendChild(row);
  }
}

async function openSkillEditor(skill) {
  editingSkillName = skill?.name ?? null;
  editingSkillOrigin = skill?.origin ?? null;
  skillBodyTouched = (skill?.body ?? "") !== ""; // 既有技能 = 已有正文——种子不触发
  skillToolsSelected.clear();
  // 工具集候选 = ready 协议的注册表工具名（meta 会话期缓存——无会话时为空）
  const meta = (await ensureMetaCache(getSessionId())) ?? { tools: [], skills: [] };
  const box = document.getElementById("skill-tools");
  if (box === null) return;
  box.replaceChildren();
  for (const t of meta.tools) {
    const chip = document.createElement("button");
    chip.type = "button";
    const selected = skill?.tools?.includes(t) ?? false;
    if (selected) skillToolsSelected.add(t);
    chip.className = selected ? "chip-ui active" : "chip-ui";
    chip.textContent = t;
    chip.addEventListener("click", () => {
      if (skillToolsSelected.has(t)) {
        skillToolsSelected.delete(t);
        chip.classList.remove("active");
      } else {
        skillToolsSelected.add(t);
        chip.classList.add("active");
      }
    });
    box.appendChild(chip);
  }
  document.getElementById("skill-name").value = skill?.name ?? "";
  document.getElementById("skill-desc").value = skill?.description ?? "";
  document.getElementById("skill-body").value = skill?.body ?? "";
  updateSkillBytes();
  document.getElementById("skill-editor").hidden = false;
  document.getElementById("skill-new").hidden = true;
}

// ---------------------------------------------------------------------------
// T-P3-144 外部技能源导入模态（scan/apply——形态复用 MCP 导入模态基座）
// ---------------------------------------------------------------------------

function fmtSkillBytes(n) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`;
}

async function openSkillImportDialog() {
  const holder = document.createElement("div");
  holder.innerHTML = `
    <div class="mcp-import-head">
      <label class="check-line"><input id="skill-imp-all" type="checkbox" checked /> 全选</label>
      <span id="skill-imp-count" class="hint">已选 0/0</span>
      <button id="skill-imp-refresh" type="button" class="btn">刷新</button>
    </div>
    <div id="skill-imp-list" class="mcp-import-list"><p class="hint">扫描中…</p></div>
    <p class="hint">候选只读不写——导入 = 整目录复制进工作区技能主目录（同名跳过，绝不覆盖）；单文件技能自动转成 &lt;名&gt;/SKILL.md 目录形状。</p>`;
  let scan = null; // 最近一次扫描结果（刷新按钮重扫）
  const listBox = holder.querySelector("#skill-imp-list");
  const countEl = holder.querySelector("#skill-imp-count");

  function syncCount() {
    const boxes = [...listBox.querySelectorAll("input[data-idx]")];
    const picked = boxes.filter((b) => b.checked).length;
    countEl.textContent = `已选 ${picked}/${boxes.length}`;
    holder.querySelector("#skill-imp-all").checked = boxes.length > 0 && picked === boxes.length;
  }

  function renderScan() {
    listBox.replaceChildren();
    if (scan === null) {
      listBox.appendChild(document.createTextNode("扫描中…"));
      return;
    }
    if (scan.candidates.length === 0) {
      listBox.appendChild(emptyState("未发现可导入的技能", "没有检出候选——来源状态见下方明细"));
    }
    const bySource = new Map();
    for (let i = 0; i < scan.candidates.length; i++) {
      const c = scan.candidates[i];
      if (!bySource.has(c.sourceLabel)) bySource.set(c.sourceLabel, []);
      bySource.get(c.sourceLabel).push([c, i]);
    }
    for (const [label, items] of bySource) {
      const head = document.createElement("div");
      head.className = "group-title";
      head.textContent = `${label}（${items.length}）`;
      listBox.appendChild(head);
      for (const [c, idx] of items) {
        const line = document.createElement("label");
        line.className = "check-line mcp-imp-line";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.idx = String(idx);
        box.addEventListener("change", syncCount);
        const nameEl = document.createElement("span");
        nameEl.className = "row-title";
        nameEl.textContent = c.name;
        const descEl = document.createElement("span");
        descEl.className = "row-desc";
        descEl.textContent = `${c.description ?? "（无描述）"} · ${fmtSkillBytes(c.bytes)}${c.kind === "file" ? " · 单文件" : ""}`;
        line.append(box, nameEl, descEl);
        if (c.warning !== undefined) line.title = c.warning;
        listBox.appendChild(line);
      }
    }
    const detail = document.createElement("p");
    detail.className = "hint";
    const bits = [];
    for (const src of scan.sources) {
      if (!src.exists) continue;
      const flags = [];
      if (src.error !== undefined) flags.push(`错误：${src.error}`);
      if ((src.skipped ?? 0) > 0) flags.push(`跳过 ${src.skipped} 个（空正文/重名）`);
      if (flags.length > 0) bits.push(`${src.label}（${src.dir}）：${flags.join("；")}`);
    }
    detail.textContent = bits.length > 0 ? bits.join("\n") : "";
    detail.hidden = bits.length === 0;
    listBox.appendChild(detail);
    syncCount();
  }

  async function rescan() {
    scan = null;
    renderScan();
    const envelope = await sendSettings({ op: "skill-import-scan" });
    if (!listBox.isConnected) return; // 模态已关
    if (!envelope.ok) {
      listBox.replaceChildren();
      listBox.appendChild(emptyState("扫描不可用", envelope.error?.message ?? ""));
      return;
    }
    scan = envelope.result;
    renderScan();
  }

  holder.querySelector("#skill-imp-all").addEventListener("change", (ev) => {
    const checked = ev.target.checked;
    for (const box of listBox.querySelectorAll("input[data-idx]")) box.checked = checked;
    syncCount();
  });
  holder.querySelector("#skill-imp-refresh").addEventListener("click", () => void rescan());

  openDialog({
    title: "导入外部 Agent 技能",
    description:
      "扫描 Claude Code / Codex CLI / 通用 .agents / OpenCode / Qwen / Trae / Kiro / Roo / Windsurf / 工作区生态位落盘的技能目录（只读）。",
    width: "lg",
    body: holder,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "从 ZIP 导入…",
        className: "btn",
        onClick: () => void importSkillZip(holder),
      },
      {
        label: "导入所选",
        className: "btn btn-primary",
        onClick: async () => {
          if (scan === null) {
            toast("扫描尚未完成", "warn");
            return;
          }
          const boxes = [...holder.querySelectorAll("input[data-idx]")];
          const items = boxes
            .filter((b) => b.checked)
            .map((b) => scan.candidates[Number(b.dataset.idx)])
            .filter((c) => c !== undefined)
            .map((c) => ({ name: c.name, sourcePath: c.sourcePath, kind: c.kind }));
          if (items.length === 0) {
            toast("未选择可导入项", "warn");
            return;
          }
          const envelope = await sendSettings({ op: "skill-import-apply", items });
          if (!envelope.ok) {
            toast(`导入不可用：${envelope.error?.message ?? ""}`, "warn");
            return;
          }
          const r = envelope.result;
          toast(
            `已导入 ${r.imported.length} 个${r.skipped.length > 0 ? `（跳过同名 ${r.skipped.length} 个）` : ""}${r.failed.length > 0 ? `，失败 ${r.failed.length} 个` : ""}`,
            r.imported.length > 0 ? "info" : "warn",
          );
          if (r.failed.length > 0) {
            appendLine(`技能导入失败明细：${r.failed.map((f) => `${f.name}——${f.error}`).join("；")}`, "warn");
          }
          if (r.imported.length > 0) void refreshSkillsList();
        },
      },
    ],
  });
  void rescan();
}

// —— T-P3-174 批次 4：技能 ZIP 导入（zip-read 安全解包——穿越/大小/CRC
// 四道检查在 host；UI 只做文件选择 + base64 上送 + 结果 toast）。 ——
async function importSkillZip(holder) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,application/zip";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    if (file.size > 20 * 1024 * 1024) {
      toast(`zip 超大小上限（${(file.size / 1024 / 1024).toFixed(1)}MB > 20MB）`, "warn");
      return;
    }
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const content = btoa(binary);
    toast("导入中…", "info");
    const envelope = await sendSettings({ op: "skill-import-zip", content });
    if (!envelope.ok) {
      toast(`ZIP 导入不可用：${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    const r = envelope.result;
    const warnNote = r.skipped.filter((s) => s.reason.includes("description"));
    const hardSkip = r.skipped.length - warnNote.length;
    toast(
      `ZIP 导入完成：成功 ${r.imported.length}，跳过 ${hardSkip}（同名/空正文），失败 ${r.failed.length}` +
        `${warnNote.length > 0 ? `；${warnNote.length} 个缺 description（清单不可见）` : ""}`,
      r.imported.length > 0 ? "info" : "warn",
    );
    if (r.failed.length > 0) {
      appendLine(`技能 ZIP 导入失败明细：${r.failed.map((f) => `${f.name}——${f.error}`).join("；")}`, "warn");
    }
    if (r.imported.length > 0) {
      void refreshSkillsList();
      holder.querySelectorAll("#skill-imp-refresh")[0]?.click(); // 重扫目录清单
    }
  });
  input.click();
}

// ---------------------------------------------------------------------------
// U23/T-P3-126 子智能体管理：内置/自定义分组卡（开关/工具徽标/搜索）+ CRUD
// ---------------------------------------------------------------------------

let subagentsView = null; // subagents-list 缓存（open 时刷新——内置预设即模板数据源）
let editingSubagentName = null; // 非 null = 编辑既有条目（同名覆盖）
const subagentToolsSelected = new Set();
let subagentFilter = "";
// T-P3-145 v2 编辑器状态：模板/骨架/继承/fallbacks 有序面
let subagentPromptTouched = false; // 指令手写过（骨架 seed 门控——技能页同款）
let subagentFallbackList = []; // 备用模型有序面（providers 条目名——J15 序）
/** 指令上限（pi-desktop MAX_SUBAGENT_BYTES 同值——内核 settings parse 同步）。 */
const SUBAGENT_PROMPT_MAX_BYTES = 32 * 1024;
/** mutating 工具（可改动文件/执行命令——pi-desktop is-mutating 高亮）。 */
const SUBAGENT_MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

function subagentMatches(d) {
  if (subagentFilter === "") return true;
  const q = subagentFilter.toLowerCase();
  return (
    d.name.toLowerCase().includes(q) ||
    (d.description ?? "").toLowerCase().includes(q)
  );
}

/** 指令字节计数（>80% 黄、超限红 + 保存禁用——pi-desktop 同形态）。 */
function updateSubagentBytes() {
  const el = document.getElementById("subagent-bytes");
  if (el === null) return;
  const n = new TextEncoder().encode(document.getElementById("subagent-prompt").value).length;
  el.textContent = n >= 1024 ? `${(n / 1024).toFixed(1)}KB / 32KB` : `${n}B / 32KB`;
  el.classList.toggle("warn", n > SUBAGENT_PROMPT_MAX_BYTES * 0.8 && n <= SUBAGENT_PROMPT_MAX_BYTES);
  el.classList.toggle("over", n > SUBAGENT_PROMPT_MAX_BYTES);
  document.getElementById("subagent-save").disabled = n > SUBAGENT_PROMPT_MAX_BYTES;
}

/** A：指令骨架（pi-desktop subagentTemplate 中文版——"空编辑器教不会格式"）。 */
function subagentSeedPrompt(name) {
  return `## 任务\n\n<「${name}」要做什么——一句话目标>\n\n## 汇报要求\n\n说清楚最终答案长什么样——父会话只看你的最终消息，看不到你的步骤。\n\n## 限制\n\n- <不得做什么>\n`;
}

/** C：模型条目下拉（空值 = 与会话一致——回退链既有语义）。 */
function renderSubagentProviderOptions(selected) {
  const sel = document.getElementById("subagent-provider");
  if (sel === null) return;
  sel.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "与会话一致";
  sel.appendChild(placeholder);
  for (const p of settingsCache?.providers ?? []) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = selected ?? "";
  refreshSelectPanel(sel); // 动态重建后同步桥接面板（T-P3-145 修）
}

/** C：模型 id 下拉（条目 models 数组优先，回退条目 model 单值）。 */
function renderSubagentModelOptions(providerName, selected) {
  const sel = document.getElementById("subagent-model");
  if (sel === null) return;
  sel.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "条目/主模型回退";
  sel.appendChild(placeholder);
  const entry = (settingsCache?.providers ?? []).find((p) => p.name === providerName);
  const ids = (entry?.models ?? []).map((m) => m.id).filter((id) => typeof id === "string" && id !== "");
  if (ids.length === 0 && typeof entry?.model === "string" && entry.model !== "") ids.push(entry.model);
  for (const id of ids) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    sel.appendChild(opt);
  }
  sel.value = selected ?? "";
  refreshSelectPanel(sel);
}

/** C：备用模型有序 chips（↑↓×——pi-desktop SubagentFallbackModels 形态）。 */
function renderSubagentFallbacks() {
  const box = document.getElementById("subagent-fallbacks");
  if (box === null) return;
  box.replaceChildren();
  if (subagentFallbackList.length === 0) {
    const empty = document.createElement("span");
    empty.className = "hint";
    empty.textContent = "（未配置——主模型终态失败后落回主模型链）";
    box.appendChild(empty);
    return;
  }
  subagentFallbackList.forEach((name, i) => {
    const chip = chipEl(`${i + 1}. ${name}`);
    const up = document.createElement("button");
    up.type = "button";
    up.className = "chip-ui";
    up.textContent = "↑";
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      [subagentFallbackList[i - 1], subagentFallbackList[i]] = [subagentFallbackList[i], subagentFallbackList[i - 1]];
      renderSubagentFallbacks();
    });
    const down = document.createElement("button");
    down.type = "button";
    down.className = "chip-ui";
    down.textContent = "↓";
    down.disabled = i === subagentFallbackList.length - 1;
    down.addEventListener("click", () => {
      [subagentFallbackList[i + 1], subagentFallbackList[i]] = [subagentFallbackList[i], subagentFallbackList[i + 1]];
      renderSubagentFallbacks();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "chip-ui";
    del.textContent = "×";
    del.addEventListener("click", () => {
      subagentFallbackList.splice(i, 1);
      renderSubagentFallbacks();
      renderSubagentFallbackAdd();
    });
    chip.append(up, down, del);
    box.appendChild(chip);
  });
}

/** C：备用模型添加下拉（候选 = providers 条目名 − 已选）。 */
function renderSubagentFallbackAdd() {
  const sel = document.getElementById("subagent-fallback-add");
  if (sel === null) return;
  sel.replaceChildren();
  const candidates = (settingsCache?.providers ?? []).map((p) => p.name).filter((n) => !subagentFallbackList.includes(n));
  if (candidates.length === 0) {
    sel.disabled = true;
    sel.appendChild(new Option("（无更多条目）", ""));
    return;
  }
  sel.disabled = false;
  for (const n of candidates) sel.appendChild(new Option(n, n));
  refreshSelectPanel(sel);
}

/** B：继承勾选 ↔ 工具 chips 区联动（勾选 = 不收窄，chips 区禁用）。 */
function syncSubagentInherit() {
  const inherit = document.getElementById("subagent-inherit-tools").checked;
  document.getElementById("subagent-tools").style.opacity = inherit ? "0.45" : "1";
  document.getElementById("subagent-tools").style.pointerEvents = inherit ? "none" : "auto";
}

/** 分组块（组标题 + 行卡容器）。 */
function groupBlock(title, hintBadge) {
  const wrap = document.createElement("div");
  wrap.className = "subagent-group";
  const head = document.createElement("div");
  head.className = "group-title";
  head.textContent = title;
  if (hintBadge !== undefined) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = hintBadge;
    head.appendChild(b);
  }
  const list = document.createElement("div");
  list.className = "row-list";
  wrap.append(head, list);
  return { wrap, list };
}

function subagentRow(d, opts) {
  const row = rowEl();
  const badge = document.createElement("span");
  badge.className = "icon-badge";
  badge.appendChild(icon("bot"));
  const titleEl = document.createElement("div");
  titleEl.className = "row-title";
  titleEl.textContent = d.name;
  const descEl = document.createElement("div");
  descEl.className = "row-desc";
  // E：task(name) 调用标识（pi-desktop Task({name}) handle 形态——模型的
  // subagent_type 取值即 name，行上显式可见）
  const extra =
    `task(${d.name})` +
    opts.kindLabel +
    (d.modelProvider ? `［模型 ${d.modelProvider}${d.model ? `/${d.model}` : ""}］` : "");
  descEl.textContent = `${d.description ?? ""}${extra}`;
  const copy = rowCopyEl(titleEl, descEl);
  // 工具数徽标（声明面收窄的可见性——H3/H5 降级面之上再收窄）
  const toolsRow = document.createElement("div");
  toolsRow.className = "row-chips";
  if ((d.tools ?? []).length > 0) {
    toolsRow.appendChild(chipEl(`${d.tools.length} 工具`));
  }
  const control = [];
  if (opts.toggle !== undefined) control.push(opts.toggle);
  const editBtn = btnEl(opts.editLabel ?? "编辑", "btn", opts.editTitle ?? "");
  editBtn.addEventListener("click", opts.onEdit);
  control.push(editBtn);
  if (opts.onDelete !== undefined) {
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", opts.onDelete);
    control.push(delBtn);
  }
  row.append(badge, copy, rowControl(toolsRow, ...control));
  return row;
}

function renderSubagentList() {
  const list = document.getElementById("subagent-list");
  if (list === null) return;
  list.replaceChildren();
  if (subagentsView === null) return;
  // 本地权威合并（T-P3-145 跟手修）：enabled/覆盖/自定义清单以 settingsCache
  // 为准——toggle/删除本地更新后立即重渲，不被服务端旧快照回拉覆盖。
  const localDefs = settingsCache?.subagents ?? [];
  const builtinNames = new Set(subagentsView.builtins.map((b) => b.name));
  const builtins = subagentsView.builtins
    .map((b) => {
      const localDef = localDefs.find((d) => d.name === b.name);
      return {
        ...b,
        ...(localDef?.tools !== undefined ? { tools: localDef.tools } : {}),
        ...(localDef?.modelProvider !== undefined ? { modelProvider: localDef.modelProvider } : {}),
        enabled: localDef ? localDef.enabled !== false : b.enabled,
        overridden: localDef !== undefined,
      };
    })
    .filter(subagentMatches);
  const customs = localDefs.filter((d) => !builtinNames.has(d.name)).filter(subagentMatches);
  if (builtins.length === 0 && customs.length === 0) {
    list.appendChild(
      emptyState(
        subagentsView.builtins.length === 0 ? "无子代理" : "无匹配子代理",
        subagentsView.builtins.length === 0
          ? "五内置预设装配面在位——右上新建自定义子代理"
          : `没有名称/描述含「${subagentFilter}」的子代理`,
      ),
    );
    return;
  }
  const builtinGroup = groupBlock("内置预设", `${builtins.length}`);
  for (const b of builtins) {
    const toggle = switchEl(b.enabled, (checked) => {
      // 停用 = 写同名覆盖记录（enabled:false——最简形状）；启用 = 移除记录
      const defs = (settingsCache.subagents ?? []).filter((d) => d.name !== b.name);
      if (!checked) defs.push({ name: b.name, enabled: false });
      settingsCache.subagents = defs;
      dirtySections.add("subagents");
      markDirty("subagents");
      renderSubagentList(); // 乐观重渲（本地权威——不等服务端回包）
    }, `启停内置预设 ${b.name}`);
    builtinGroup.list.appendChild(
      subagentRow(b, {
        kindLabel: b.overridden ? "（内置·已自定义覆盖）" : "（内置）",
        toggle,
        onEdit: () => {
          // 本地覆盖在位时以内地合并后的定义进编辑器（含本地 enabled 视角）
          const localDef = (settingsCache.subagents ?? []).find((d) => d.name === b.name);
          openSubagentEditor(localDef ?? b, true);
        },
        // D：pi-desktop copyBuiltin 语义——内置入口是"以内置为底稿复制一份
        // 我的定义"（保存 = 写同名覆盖记录）；已有覆盖时即"编辑覆盖记录"。
        editLabel: b.overridden ? "编辑" : "复制为我的定义",
        editTitle: b.overridden ? "编辑该覆盖记录" : "以内置预设为底稿新建同名定义（保存后覆盖内置）",
      }),
    );
  }
  const customGroup = groupBlock("自定义", `${customs.length}`);
  for (const c of customs) {
    customGroup.list.appendChild(
      subagentRow(c, {
        kindLabel: "（自定义）",
        onEdit: () => openSubagentEditor(c, false),
        onDelete: async () => {
          if (!(await confirmDialog(`删除自定义子代理「${c.name}」？task 调用将不再可用。`, { title: "删除子代理", confirmLabel: "删除", danger: true }))) return;
          settingsCache.subagents = (settingsCache.subagents ?? []).filter((d) => d.name !== c.name);
          dirtySections.add("subagents");
          markDirty("subagents");
          renderSubagentList(); // 乐观重渲（本地权威）
        },
      }),
    );
  }
  list.append(builtinGroup.wrap, customGroup.wrap);
}

async function refreshSubagentsList() {
  const envelope = await sendSettings({ op: "subagents-list" });
  const list = document.getElementById("subagent-list");
  if (list === null) return;
  if (!envelope.ok) {
    list.replaceChildren();
    list.appendChild(emptyState("子代理清单不可用", envelope.error?.message ?? ""));
    return;
  }
  subagentsView = envelope.result;
  renderSubagentList();
}

async function openSubagentEditor(def, isBuiltin) {
  editingSubagentName = def.name || null;
  subagentPromptTouched = (def.prompt ?? "") !== "";
  subagentFallbackList = [...(def.fallbacks ?? [])];
  subagentToolsSelected.clear();
  const meta = (await ensureMetaCache(getSessionId())) ?? { tools: [], skills: [] };
  const box = document.getElementById("subagent-tools");
  if (box === null) return;
  box.replaceChildren();
  // 候选 = live 注册表工具 ∪ 内置预设声明的工具（T-P3-145 修：无活跃会话
  // 时 meta.tools 为空——预设模板的工具名必须可勾，否则模板保存被
  // "至少一个工具"校验挡死；live 面在位时并集不引入噪音）
  const candidateTools = [
    ...new Set([...meta.tools, ...(subagentsView?.builtins ?? []).flatMap((b) => b.tools ?? [])]),
  ];
  for (const t of candidateTools) {
    const chip = document.createElement("button");
    chip.type = "button";
    const selected = def.tools?.includes(t) ?? false;
    if (selected) subagentToolsSelected.add(t);
    // B：mutating 工具高亮（bash/edit/write 可改动文件——pi-desktop is-mutating）
    const mutating = SUBAGENT_MUTATING_TOOLS.has(t);
    chip.className = `${selected ? "chip-ui active" : "chip-ui"}${mutating ? " mutating" : ""}`;
    chip.textContent = t;
    if (mutating) chip.title = "可改动文件或执行命令";
    chip.addEventListener("click", () => {
      if (subagentToolsSelected.has(t)) {
        subagentToolsSelected.delete(t);
        chip.classList.remove("active");
      } else {
        subagentToolsSelected.add(t);
        chip.classList.add("active");
      }
    });
    box.appendChild(chip);
  }
  document.getElementById("subagent-name").value = def.name ?? "";
  document.getElementById("subagent-desc").value = def.description ?? "";
  document.getElementById("subagent-prompt").value = def.prompt ?? "";
  // B：继承勾选（tools undefined = 继承——数据面语义不变，UI 显式化）
  const inherit = (def.tools ?? []).length === 0;
  document.getElementById("subagent-inherit-tools").checked = inherit;
  syncSubagentInherit();
  // C：高级区回填
  renderSubagentProviderOptions(def.modelProvider);
  renderSubagentModelOptions(def.modelProvider, def.model);
  document.getElementById("subagent-reasoning").value = def.reasoning ?? "";
  document.getElementById("subagent-maxtokens").value =
    def.maxTokens !== undefined ? String(def.maxTokens) : "";
  renderSubagentFallbacks();
  renderSubagentFallbackAdd();
  // A：模板 chips 仅新建时渲染（编辑时隐藏——pi-desktop PresetPicker 语义）
  const presetRow = document.getElementById("subagent-preset-row");
  presetRow.hidden = editingSubagentName !== null;
  if (editingSubagentName === null) {
    const chips = document.getElementById("subagent-presets");
    chips.replaceChildren();
    for (const b of subagentsView?.builtins ?? []) {
      const chip = chipEl(b.name);
      chip.title = `${b.description ?? ""}（点击整体填充名称/描述/工具/指令）`;
      chip.addEventListener("click", () => {
        // applyPreset 语义：整体覆盖 name/desc/tools/prompt，保留已选高级字段
        document.getElementById("subagent-name").value = b.name;
        document.getElementById("subagent-desc").value = b.description ?? "";
        subagentToolsSelected.clear();
        for (const t of b.tools ?? []) subagentToolsSelected.add(t);
        for (const el of chips.querySelectorAll(".chip-ui")) {
          el.classList.toggle("active", el.textContent === b.name);
        }
        document.getElementById("subagent-inherit-tools").checked = false;
        syncSubagentInherit();
        for (const el of box.querySelectorAll(".chip-ui")) {
          el.classList.toggle("active", subagentToolsSelected.has(el.textContent));
        }
        document.getElementById("subagent-prompt").value = subagentSeedPrompt(b.name) + "\n" + (b.prompt ?? "");
        subagentPromptTouched = true; // 模板填充视同手写——name 改动不再重播种
        updateSubagentBytes();
      });
      chips.appendChild(chip);
    }
    const blank = chipEl("空白开始");
    blank.addEventListener("click", () => {
      document.getElementById("subagent-name").value = "";
      document.getElementById("subagent-desc").value = "";
      document.getElementById("subagent-prompt").value = "";
      subagentToolsSelected.clear();
      subagentPromptTouched = false;
      for (const el of chips.querySelectorAll(".chip-ui")) el.classList.remove("active");
      document.getElementById("subagent-inherit-tools").checked = true;
      syncSubagentInherit();
      for (const el of box.querySelectorAll(".chip-ui")) el.classList.remove("active");
      updateSubagentBytes();
    });
    chips.appendChild(blank);
  }
  updateSubagentBytes();
  document.getElementById("subagent-advanced").open = editingSubagentName !== null;
  document.getElementById("subagent-editor").hidden = false;
  document.getElementById("subagent-new").hidden = true;
  document.getElementById("subagent-editor").scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------------------
// T-P3-146 提示词模板域重做（C 文件化 + A 参数化 + B 管理面 + D 导入 + E 停用）：
// 清单走 op:"prompts-list"（文件域 + 旧内联库一次性迁移）；停用开关 patch
// settings prompts 段对象形态；新建/编辑 = prompt-save 落盘（slug/保留名/
// 128KB 校验在 host，UI 侧先行同规则提示）；导入 = prompt-import-scan/apply。
// ---------------------------------------------------------------------------

let promptFilter = "";
let promptsView = null; // op:"prompts-list" 回执（文件域清单 + 诊断 + 配置）

/** 名称段规则（host validatePromptName 同规则前置——错误提前到表单）。 */
const PROMPT_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROMPT_RESERVED = new Set(["cancel", "find", "search", "history", "settings", "help"]);

function promptNameError(name) {
  if (name === "") return "名称必填";
  for (const seg of name.split("/")) {
    if (!PROMPT_SEGMENT_RE.test(seg) || seg.includes("..")) {
      return `名称段「${seg}」须为 slug 形状（小写字母数字开头，. - _ 可内用）`;
    }
  }
  if (name.includes(":")) return "名称不可含冒号（MCP prompts 命名空间保留符）";
  if (PROMPT_RESERVED.has(name.toLowerCase())) return `「${name}」为本地命令保留名`;
  return undefined;
}

async function refreshPromptsList() {
  const envelope = await sendSettings({ op: "prompts-list" });
  const list = document.getElementById("prompt-list");
  if (list === null) return; // 视图已卸载（异步回包晚于导航——静默丢弃）
  if (!envelope.ok) {
    list.replaceChildren();
    list.appendChild(emptyState("模板清单不可用", envelope.error?.message ?? ""));
    return;
  }
  promptsView = envelope.result;
  if (envelope.result.migratedFromSettings !== undefined) {
    toast(`已迁移旧内联库 ${String(envelope.result.migratedFromSettings)} 个模板到 ~/.aegent/prompts/`, "info");
  }
  renderPromptList();
}

function renderPromptList() {
  const list = document.getElementById("prompt-list");
  if (list === null) return;
  list.replaceChildren();
  const prompts = promptsView?.prompts ?? [];
  const status = document.getElementById("prompt-status");
  if (status !== null) status.textContent = prompts.length > 0 ? `（${String(prompts.length)} 个）` : "";
  const visible = prompts.filter((p) => {
    if (promptFilter === "") return true;
    const q = promptFilter.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      (p.argumentHint ?? "").toLowerCase().includes(q) ||
      p.content.toLowerCase().includes(q)
    );
  });
  if (visible.length === 0) {
    list.appendChild(
      prompts.length === 0
        ? emptyState("提示词库为空", "点右上「新建模板」建档，或「导入外部命令」吃进 Claude/ZCode 等存量命令——输入区 / 补全即可调用")
        : emptyState("无匹配模板", `没有含「${promptFilter}」的模板`),
    );
  }
  const disabledSet = new Set((promptsView?.disabled ?? []).map((d) => d.toLowerCase()));
  for (const p of visible) {
    const row = rowEl();
    const badge = document.createElement("span");
    badge.className = "icon-badge";
    badge.appendChild(icon("sparkles"));
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    const nameSpan = document.createElement("span");
    nameSpan.className = "mono";
    nameSpan.textContent = `/${p.name}`;
    titleEl.appendChild(nameSpan);
    const sourceLabel = p.source === "project" ? "项目" : p.source === "user" ? "用户" : "外部来源";
    titleEl.appendChild(chipEl(sourceLabel));
    if (disabledSet.has(p.name.toLowerCase())) titleEl.appendChild(chipEl("已停用"));
    if (p.agent !== undefined) titleEl.appendChild(chipEl(`agent: ${p.agent}`));
    if (p.model !== undefined) titleEl.appendChild(chipEl(`model: ${p.model}`));
    const descEl = document.createElement("div");
    descEl.className = "row-desc clamp-2";
    descEl.textContent = `${p.argumentHint !== undefined ? `[参数] ${p.argumentHint}——` : ""}${p.description ? `${p.description}——` : ""}${p.content}`;
    row.append(badge, rowCopyEl(titleEl, descEl));
    const toggle = switchEl(!disabledSet.has(p.name.toLowerCase()), (checked) => {
      // E：停用开关不改文件——settings prompts 段对象形态 patch（改名不迁移
      // 语义按名匹配——与 skills.disabled 一致；文件域展开面新鲜读 settings）
      const cur = new Set(promptsView?.disabled ?? []);
      if (checked) cur.delete(p.name);
      else cur.add(p.name);
      const config = { ...(promptsView?.config ?? {}), disabled: [...cur] };
      if (cur.size === 0) delete config.disabled;
      settingsCache.prompts = config;
      dirtySections.add("prompts");
      markDirty("prompts");
      promptsView.disabled = [...cur];
      promptsView.config = { ...promptsView.config, disabled: [...cur] };
      renderPromptList();
      markPromptsLoaded(false); // / 补全缓存失效（停用即时可见）
    }, `启停模板 ${p.name}`);
    const editBtn = btnEl("编辑", "btn", "打开模板编辑器（写回 .md 文件）");
    editBtn.addEventListener("click", () => openPromptDialog(p));
    const revealBtn = btnEl("目录", "btn", "打开模板所在文件夹");
    revealBtn.addEventListener("click", () => {
      void sendSettings({ op: "prompt-reveal", path: p.filePath }).then((envelope) => {
        if (!envelope.ok) toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
      });
    });
    const delBtn = btnEl("删除", "btn btn-danger", "删除模板文件（受控根护栏在 host）");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除模板「/${p.name}」？文件将删除，不可恢复。`, { title: "删除模板", confirmLabel: "删除", danger: true }))) return;
      const envelope = await sendSettings({ op: "prompt-delete", path: p.filePath });
      if (!envelope.ok) {
        toast(`删除失败：${envelope.error?.message ?? ""}`, "warn");
        return;
      }
      toast(`模板已删除：/${p.name}`, "info");
      markPromptsLoaded(false);
      void refreshPromptsList();
    });
    row.append(rowControl(toolsChipsRow(p), toggle, editBtn, revealBtn, delBtn));
    list.appendChild(row);
  }
  renderPromptDiagnostics();
  void renderPromptMcpSection();
}

/** 模板附加 chips（占位符提示——$1/$ARGUMENTS 一目了然）。 */
function toolsChipsRow(p) {
  const wrap = document.createElement("div");
  wrap.className = "row-chips";
  const placeholders = [...new Set([...p.content.matchAll(/\$(?:ARGUMENTS|[0-9]+|@|\{@:\d+(?::\d+)?\}|\{@\})/g)].map((m) => m[0]))];
  for (const ph of placeholders) wrap.appendChild(chipEl(ph));
  return wrap;
}

/** 诊断折叠行（技能分节同款形态）。 */
function renderPromptDiagnostics() {
  const list = document.getElementById("prompt-list");
  if (list === null) return;
  const diagnostics = promptsView?.diagnostics ?? [];
  if (diagnostics.length === 0) return;
  const details = document.createElement("details");
  details.className = "skill-diag";
  const summary = document.createElement("summary");
  summary.textContent = `诊断（${String(diagnostics.length)}）`;
  details.appendChild(summary);
  for (const d of diagnostics) {
    const row = rowEl();
    const t = document.createElement("div");
    t.className = "row-desc error-text";
    t.textContent = `[${d.code}] ${d.path}——${d.message}`;
    row.append(t);
    details.appendChild(row);
  }
  list.appendChild(details);
}

/** MCP prompts 只读区（meta 目录 source=mcp——host 不持 MCP 连接）。 */
async function renderPromptMcpSection() {
  const wrap = document.getElementById("prompt-mcp-wrap");
  const listEl = document.getElementById("prompt-mcp-list");
  if (wrap === null || listEl === null) return;
  const meta = await ensureMetaCache(getSessionId());
  const mcpPrompts = (meta?.prompts ?? []).filter((p) => p.source === "mcp");
  if (mcpPrompts.length === 0) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const summary = document.getElementById("prompt-mcp-summary");
  if (summary !== null) summary.textContent = `MCP prompts（只读，${String(mcpPrompts.length)} 个——来自已连接 server）`;
  listEl.replaceChildren();
  for (const p of mcpPrompts) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    const nameSpan = document.createElement("span");
    nameSpan.className = "mono";
    nameSpan.textContent = `/${p.name}`;
    titleEl.appendChild(nameSpan);
    titleEl.appendChild(chipEl("MCP"));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = p.description ?? "";
    row.append(rowCopyEl(titleEl, descEl));
    listEl.appendChild(row);
  }
}

function openPromptDialog(p) {
  const holder = document.createElement("div");
  holder.innerHTML = `
  <form id="prompt-form">
    <div class="form-grid">
      <label>模板名（斜杠调用标识）<input id="prompt-name" class="input" type="text" placeholder="如 review 或 ci/build" autocomplete="off" /></label>
      <label>参数提示 argument-hint<input id="prompt-hint" class="input" type="text" placeholder="如 &lt;file&gt; [focus]（有参模板的标志）" autocomplete="off" /></label>
      <label>描述（可选）<input id="prompt-desc" class="input" type="text" placeholder="清单显示用" autocomplete="off" /></label>
      <label>保存位置<select id="prompt-scope" class="select">
        <option value="project">项目（.zcode/prompts）</option>
        <option value="user">用户级（~/.aegent/prompts）</option>
      </select></label>
      <label>agent（可选——以子代理执行）<input id="prompt-agent" class="input" type="text" placeholder="如 explorer（子代理预设名）" autocomplete="off" /></label>
      <label>model（可选——命令级模型）<input id="prompt-model" class="input" type="text" placeholder="如 provider/model-id" autocomplete="off" /></label>
    </div>
    <textarea id="prompt-content" class="textarea" rows="7" placeholder="模板正文：{{var}} 变量保留手改；$1 $2 位置参数、$ARGUMENTS 整串参数发送时替换；感叹号反引号语法前置执行（需开关）、@file 文件注入"></textarea>
    <div id="prompt-bytes" class="skill-bytes"></div>
  </form>
  <details class="prompt-help"><summary>模板语法帮助</summary><pre>---
description: 评审当前改动
argument-hint: [scope]
---

请评审 $1 范围的代码改动，关注正确性与安全。

$ARGUMENTS = 参数整串；$1 $2 = 位置参数（引号可包空格）；
正文无占位符时参数自动追加到文末。
frontmatter 可选：agent（子代理执行）/ model（命令级模型）。
</pre></details>`;
  const form = holder.firstElementChild;
  const bytesEl = form.querySelector("#prompt-bytes");
  const contentEl = form.querySelector("#prompt-content");
  const nameEl = form.querySelector("#prompt-name");
  const updateBytes = () => {
    const n = new TextEncoder().encode(contentEl.value).length;
    bytesEl.textContent = `${String(n)} / 131072 字节`;
    bytesEl.className = `skill-bytes${n > 131072 ? " over" : n > 104857 ? " warn" : ""}`;
  };
  contentEl.addEventListener("input", updateBytes);
  if (p !== undefined) {
    nameEl.value = p.name;
    form.querySelector("#prompt-desc").value = p.description ?? "";
    form.querySelector("#prompt-hint").value = p.argumentHint ?? "";
    form.querySelector("#prompt-agent").value = p.agent ?? "";
    form.querySelector("#prompt-model").value = p.model ?? "";
    form.querySelector("#prompt-scope").value = p.source === "user" ? "user" : "project";
    contentEl.value = p.content;
  } else {
    form.querySelector("#prompt-scope").value = "project";
  }
  updateBytes();
  openDialog({
    title: p !== undefined ? `编辑模板：/${p.name}` : "新建提示词模板",
    description: "模板名即输入区 / 补全的调用标识；有参模板（参数提示或 $ 占位）选中后插入 /名 等参数，发送时展开。",
    width: "md",
    body: holder,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      // 注意时序：openDialog 先 close 再调 onClick（form 已 detach）——
      // 字段读取必须走闭包持有的 form 引用，不能 getElementById
      { label: "保存", className: "btn btn-primary", onClick: () => void savePromptFromDialog(form) },
    ],
  });
}

async function savePromptFromDialog(form) {
  const name = form.querySelector("#prompt-name")?.value.trim().toLowerCase() ?? "";
  const desc = form.querySelector("#prompt-desc")?.value.trim() ?? "";
  const hint = form.querySelector("#prompt-hint")?.value.trim() ?? "";
  const agent = form.querySelector("#prompt-agent")?.value.trim() ?? "";
  const model = form.querySelector("#prompt-model")?.value.trim() ?? "";
  const scope = form.querySelector("#prompt-scope")?.value ?? "project";
  const content = form.querySelector("#prompt-content")?.value ?? "";
  if (name === "" || content.trim() === "") {
    toast("模板名与正文必填", "warn");
    return;
  }
  const nameErr = promptNameError(name);
  if (nameErr !== undefined) {
    toast(nameErr, "warn");
    return;
  }
  // 重名即时检测（同域其他模板占用该名 = 覆盖提示）
  const occupied = (promptsView?.prompts ?? []).find((x) => x.name === name);
  if (occupied !== undefined && occupied.filePath !== undefined) {
    const ok = await confirmDialog(`模板 /${name} 已存在（${occupied.filePath}）——覆盖它？`, { title: "覆盖确认", confirmLabel: "覆盖" });
    if (!ok) return;
  }
  if (new TextEncoder().encode(content).length > 131072) {
    toast("模板正文超限（上限 128KB）", "warn");
    return;
  }
  const envelope = await sendSettings({
    op: "prompt-save",
    prompt: {
      name,
      content,
      ...(desc !== "" ? { description: desc } : {}),
      ...(hint !== "" ? { argumentHint: hint } : {}),
      ...(agent !== "" ? { agent } : {}),
      ...(model !== "" ? { model } : {}),
      scope,
    },
  });
  if (!envelope.ok) {
    toast(`保存失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  markPromptsLoaded(false);
  toast("模板已保存（/ 补全即时可调用——展开面新鲜读取）", "info");
  void refreshPromptsList();
}

// —— T-P3-146 D：外部命令导入模态（prompt-import-scan 扫描 → 勾选 →
// 复制进 workspace 模板主目录；skill-import 同构——护栏在 host op）。 ——
function openPromptImportDialog() {
  const holder = document.createElement("div");
  holder.innerHTML = `
    <div class="mcp-import-head">
      <input id="prompt-imp-filter" class="input input-search" type="text" placeholder="过滤候选…" autocomplete="off" />
      <label class="check-line"><input id="prompt-imp-all" type="checkbox" /> 全选</label>
    </div>
    <div id="prompt-imp-list" class="mcp-import-list"><p class="hint">扫描中…</p></div>
    <div id="prompt-imp-result" class="hint"></div>`;
  openDialog({
    title: "导入外部命令模板",
    description: "扫描本机其他 AI 工具的自定义命令目录（Claude Code / OpenCode / ZCode / Pi / Qwen / .agents）——勾选后复制进项目模板目录，同名绝不覆盖。",
    width: "lg",
    body: holder,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        // T-P3-174 批次 4：一键全导（等价全选+导入——扫描完成后零点击直送）
        label: "导入全部",
        className: "btn",
        onClick: () => {
          for (const cb of holder.querySelectorAll("#prompt-imp-list input[type=checkbox]")) cb.checked = true;
          void applyPromptImport(holder);
        },
      },
      { label: "导入选中", className: "btn btn-primary", onClick: () => void applyPromptImport(holder) },
    ],
  });
  let candidates = [];
  const renderList = () => {
    const q = holder.querySelector("#prompt-imp-filter").value.trim().toLowerCase();
    const listEl = holder.querySelector("#prompt-imp-list");
    listEl.replaceChildren();
    const visible = candidates.filter((c) => q === "" || c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q));
    if (candidates.length === 0) {
      listEl.appendChild(emptyState("未发现候选", "其他工具的命令目录为空或不存在"));
      return;
    }
    for (const c of visible) {
      const line = document.createElement("label");
      line.className = "check-line";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.sourcePath = c.sourcePath;
      cb.dataset.name = c.name;
      cb.checked = q === "";
      line.appendChild(cb);
      const text = document.createElement("span");
      const desc = c.description !== undefined ? `——${c.description}` : "";
      const warn = c.warning !== undefined ? `（警告：${c.warning}）` : "";
      text.textContent = `/${c.name}（${c.sourceLabel}，${String(c.bytes)}B）${desc}${warn}`;
      line.appendChild(text);
      listEl.appendChild(line);
    }
  };
  void (async () => {
    // 兜底：8s 无回包/网络异常都落到"扫描不可用"——永不停留在"扫描中…"
    // （走查实录：壳 UI 连到僵尸旧 host 时新 op 无响应，模态永久卡初始化态）
    const envelope = await Promise.race([
      sendSettings({ op: "prompt-import-scan" }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: { message: "扫描超时（host 无响应——请重启应用后重试）" } }), 8_000)),
    ]).catch((e) => ({ ok: false, error: { message: e instanceof Error ? e.message : String(e) } }));
    if (!envelope.ok) {
      holder.querySelector("#prompt-imp-list").replaceChildren(emptyState("扫描不可用", envelope.error?.message ?? ""));
      return;
    }
    candidates = envelope.result.candidates ?? [];
    const sources = envelope.result.sources ?? [];
    const found = sources.filter((s) => s.exists);
    if (found.length > 0) {
      const resultEl = holder.querySelector("#prompt-imp-result");
      if (resultEl !== null) resultEl.textContent = `已扫源：${found.map((s) => `${s.label} ${String(s.count ?? 0)}`).join("、")}`;
    }
    renderList();
  })();
  holder.querySelector("#prompt-imp-filter").addEventListener("input", renderList);
  holder.querySelector("#prompt-imp-all").addEventListener("change", (ev) => {
    for (const cb of holder.querySelectorAll("#prompt-imp-list input[type=checkbox]")) cb.checked = ev.target.checked;
  });
}

async function applyPromptImport(holder) {
  const items = [...holder.querySelectorAll("#prompt-imp-list input[type=checkbox]:checked")].map((cb) => ({
    name: cb.dataset.name,
    sourcePath: cb.dataset.sourcePath,
  }));
  if (items.length === 0) {
    toast("未勾选任何候选", "warn");
    return;
  }
  const envelope = await sendSettings({ op: "prompt-import-apply", items });
  if (!envelope.ok) {
    toast(`导入失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  const r = envelope.result;
  const failedText = r.failed.length > 0 ? `，失败 ${String(r.failed.length)}（${r.failed[0]?.error ?? ""}）` : "";
  toast(`导入完成：成功 ${String(r.imported.length)}，跳过 ${String(r.skipped.length)}（同名绝不覆盖）${failedText}`, r.failed.length > 0 ? "warn" : "info");
  markPromptsLoaded(false);
  void refreshPromptsList();
}

// ---------------------------------------------------------------------------
// U18/T-P3-120 辅助模型三字段即改即存（enhancement 段整段合并——两任务互不覆盖）
// ---------------------------------------------------------------------------

// —— T-P3-147 I：统一"任务→模型"选择件（四任务卡共用——分组 providers
// 实列 + 级联 models + 即改即存 + 测试按钮；refreshSelectPanel 纪律同前）。
const ENHANCEMENT_TASK_KEYS = ["fastModel", "judge", "summarizer", "polish", "title"];

/** 任务当前配置（settingsCache.enhancement[task] ?? {}）。 */
function enhancementTaskOf(taskName) {
  return settingsCache?.enhancement?.[taskName] ?? {};
}

/** 写回任务配置（空值剥除——provider/model/reasoning 全空 = 删除任务段）。 */
function enhancementTaskWrite(taskName, patch) {
  const cur = { ...enhancementTaskOf(taskName), ...patch };
  for (const k of ["provider", "model", "reasoning"]) {
    if (cur[k] === "" || cur[k] === undefined) delete cur[k];
  }
  const next = { ...(settingsCache.enhancement ?? {}) };
  if (Object.keys(cur).length === 0 && taskName !== "polish") delete next[taskName];
  else next[taskName] = cur;
  settingsCache.enhancement = next;
  dirtySections.add("enhancement");
  markDirty("enhancement");
}

/** 任务卡的 provider 下拉（占位"跟随主模型"+ enabled 条目实列）。 */
function renderTaskProviderOptions(taskName) {
  const sel = document.getElementById(`enh-${taskName}-provider`);
  if (sel === null) return;
  const current = sel.value;
  sel.replaceChildren();
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "（跟随主模型）";
  sel.appendChild(ph);
  for (const p of settingsCache?.providers ?? []) {
    if (p.enabled === false) continue;
    const o = document.createElement("option");
    o.value = p.name;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = current;
  refreshSelectPanel(sel);
}

/** 任务卡的 model 下拉（随 provider 级联——条目 models 实列 + 条目 model 兜底）。 */
function renderTaskModelOptions(taskName) {
  const sel = document.getElementById(`enh-${taskName}-model`);
  if (sel === null) return;
  const providerName = document.getElementById(`enh-${taskName}-provider`)?.value ?? "";
  const entry = (settingsCache?.providers ?? []).find((x) => x.name === providerName);
  sel.replaceChildren();
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = providerName === "" ? "（主模型）" : "（条目默认）";
  sel.appendChild(ph);
  const models = entry?.models?.length > 0
    ? entry.models.map((m) => m.id)
    : entry?.model !== undefined
      ? [entry.model]
      : [];
  for (const id of models) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
  sel.value = enhancementTaskOf(taskName).model ?? "";
  refreshSelectPanel(sel);
}

/** 绑定一张任务卡（provider/model 级联 + 即改即存 + 测试按钮）。 */
function bindEnhancementTask(taskName) {
  const providerSel = document.getElementById(`enh-${taskName}-provider`);
  const modelSel = document.getElementById(`enh-${taskName}-model`);
  providerSel?.addEventListener("change", () => {
    enhancementTaskWrite(taskName, { provider: providerSel.value });
    renderTaskModelOptions(taskName);
  });
  modelSel?.addEventListener("change", () => {
    enhancementTaskWrite(taskName, { model: modelSel.value });
  });
  document.getElementById(`enh-test-${taskName}`)?.addEventListener("click", () => {
    void runEnhancementTest(taskName);
  });
}

/** D：任务真实测试（1-token 探测——诚实回执：命中/未配置/总闸关闭三态）。 */
async function runEnhancementTest(taskName) {
  const btn = document.getElementById(`enh-test-${taskName}`);
  if (btn !== null) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  try {
    const envelope = await sendSettings({ op: "enhancement-test", task: taskName });
    if (!envelope.ok) {
      toast(`测试失败：${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    const r = envelope.result;
    if (r.ok === true) {
      toast(`${r.resolved?.provider ?? ""} · ${r.resolved?.modelId ?? ""}（${String(r.latencyMs ?? "?")}ms）`, "info");
    } else if (r.code === "NOT_CONFIGURED") {
      toast(`未配置——运行时将回退主模型链`, "info");
    } else {
      toast(`${r.error ?? "测试失败"}`, "warn");
    }
  } catch (e) {
    toast(`测试异常：${e instanceof Error ? e.message : String(e)}`, "warn");
  } finally {
    if (btn !== null) {
      btn.disabled = false;
      btn.textContent = "测试";
    }
  }
}

/** 润色模板面（customTemplate 开关 + textarea + 插入/恢复默认 + 字节计数）。 */
const POLISH_TEMPLATE_MAX_BYTES = 8000;
function polishTemplateText() {
  return document.getElementById("enh-polish-template")?.value ?? "";
}
function syncPolishTemplateState() {
  const custom = document.getElementById("enh-polish-custom")?.checked === true;
  const bytes = new TextEncoder().encode(polishTemplateText()).length;
  const bytesEl = document.getElementById("enh-polish-bytes");
  if (bytesEl !== null) {
    bytesEl.textContent = `${String(bytes)} / 8000 字节${custom ? "" : "（未启用——勾选「启用自定义」生效）"}`;
    bytesEl.className = `skill-bytes${bytes > POLISH_TEMPLATE_MAX_BYTES ? " over" : ""}`;
  }
  const ta = document.getElementById("enh-polish-template");
  if (ta !== null) ta.disabled = !custom;
  // 模板持久写回（即改即存——开关/内容变化都落 settingsCache）
  const cur = { ...(enhancementTaskOf("polish")) };
  if (custom) {
    cur.customTemplate = true;
    if (polishTemplateText().trim() !== "") cur.template = polishTemplateText();
    else delete cur.template;
  } else {
    delete cur.customTemplate;
    // pi 语义：关掉保留模板以便重开——customTemplate 删除但 template 保留
  }
  const next = { ...(settingsCache.enhancement ?? {}) };
  const modelFields = {
    provider: cur.provider,
    model: cur.model,
    reasoning: cur.reasoning,
    fallbacks: cur.fallbacks,
  };
  const hasModel = ["provider", "model", "reasoning"].some((k) => cur[k] !== undefined && cur[k] !== "");
  const hasTemplate = cur.customTemplate === true || cur.template !== undefined;
  if (hasModel || hasTemplate) {
    next.polish = { ...(hasModel ? modelFields : {}), ...(hasTemplate ? { customTemplate: cur.customTemplate, template: cur.template } : {}) };
    if (next.polish.customTemplate === undefined) delete next.polish.customTemplate;
    if (next.polish.template === undefined) delete next.polish.template;
  } else delete next.polish;
  settingsCache.enhancement = next;
  dirtySections.add("enhancement");
  markDirty("enhancement");
}



// ---------------------------------------------------------------------------
// U26/T-P3-129 语音设置（实验性）：STT 配置即改即存（录音链在入口
// app.js——Composer 域）；空配置 = 删除 stt 段（回退缺省）
// ---------------------------------------------------------------------------

function sttInputHandler(field) {
  document.getElementById(`stt-${field}`).addEventListener("change", () => {
    const baseUrl = document.getElementById("stt-baseurl").value.trim();
    const model = document.getElementById("stt-model").value.trim();
    const language = document.getElementById("stt-language").value.trim();
    const maxSeconds = Number(document.getElementById("stt-maxseconds").value);
    const refine = document.getElementById("stt-refine").checked;
    const silenceStop = document.getElementById("stt-silence").checked;
    const protocol = document.getElementById("stt-protocol").value;
    const next = {};
    if (baseUrl !== "") next.baseUrl = baseUrl;
    if (model !== "") next.model = model;
    if (language !== "") next.language = language;
    if (protocol === "chat") next.protocol = "chat"; // transcriptions = 缺省不存
    // maxSeconds/refine 是修饰项——不参与"已配置"判定（baseUrl+model 齐备为准）
    if (Number.isInteger(maxSeconds) && maxSeconds > 0 && maxSeconds <= 600) {
      next.maxSeconds = maxSeconds;
    }
    if (refine) next.refineTranscript = true;
    if (silenceStop) next.silenceStop = true;
    if (baseUrl === "" || model === "") {
      settingsCache.stt = undefined;
      delete settingsCache.stt;
    } else {
      settingsCache.stt = next;
    }
    dirtySections.add("stt");
    markDirty("stt");
  });
}

/** 复用供应商（T-P3-166 需求 4）：把当前缺省供应商的 baseUrl 填进 STT
 *  端点——语音模型挂在供应商名下时零额外配置；凭据读取侧 provider 留空 =
 *  复用缺省供应商 key（stt 凭据解析的既有语义）。 */
function bindSttFromProvider() {
  document.getElementById("stt-from-provider")?.addEventListener("click", () => {
    const providers = settingsCache?.providers ?? [];
    const provider = providers.find((p) => p.id === settingsCache?.defaultProvider || p.name === settingsCache?.defaultProvider) ?? providers[0];
    if (provider === undefined || (provider.baseUrl ?? "") === "") {
      toast("尚未配置任何供应商——语音输入先要有一个可用供应商", "warn");
      return;
    }
    const baseUrl = String(provider.baseUrl ?? "");
    const modelInput = document.getElementById("stt-model");
    document.getElementById("stt-baseurl").value = baseUrl;
    if (modelInput !== null && modelInput.value.trim() === "") {
      // 常见语音模型缺省猜测（用户可改）
      const audioModel = (provider.models ?? []).find((m) => /audio|asr|whisper|voice/i.test(String(m.id ?? m.name ?? "")));
      if (audioModel !== undefined) modelInput.value = String(audioModel.id ?? audioModel.name ?? "");
    }
    document.getElementById("stt-baseurl").dispatchEvent(new Event("change"));
    toast(`已填入供应商端点：${baseUrl}`, "info");
  });
}

// T-P3-149：TTS 配置即改即存（同 stt 惯例——baseUrl+model 齐备为已配置）
function ttsInputHandler(field) {
  document.getElementById(`tts-${field}`).addEventListener("change", () => {
    const baseUrl = document.getElementById("tts-baseurl").value.trim();
    const model = document.getElementById("tts-model").value.trim();
    const voice = document.getElementById("tts-voice").value.trim();
    if (baseUrl === "" || model === "") {
      settingsCache.tts = undefined;
      delete settingsCache.tts;
    } else {
      const next = { baseUrl, model };
      if (voice !== "") next.voice = voice;
      settingsCache.tts = next;
    }
    dirtySections.add("tts");
    markDirty("tts");
  });
}

// ---------------------------------------------------------------------------
// T-P3-149：语音服务行级测试（真调用真回执——对齐 MCP 页行级测试模式）。
// 测试前先 flushSettings——保证 host 侧读到表单草稿的最新值。
// ---------------------------------------------------------------------------

/** 0.5s 16kHz 单声道静音 WAV（手写 44 字节头 + 9600 个零样本 PCM16）。 */
function silentWavBase64() {
  const samples = 8000;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  let bytes = new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes));
}

function voiceErrorMessage(e) {
  const code = e?.code ?? e?.envelopeCode ?? "";
  const map = {
    STT_NOT_CONFIGURED: "未配置——填端点与模型",
    TTS_NOT_CONFIGURED: "未配置——填端点与模型",
    STT_AUTH_ERROR: "API key 无效（检查 stt 凭据）",
    TTS_AUTH_ERROR: "API key 无效（检查 tts 凭据）",
    STT_BAD_ENDPOINT: "路径不存在（核对端点根/协议通道）",
    TTS_BAD_ENDPOINT: "路径不存在（核对端点根）",
    STT_TIMEOUT: "端点 60s 未响应（超时）",
    TTS_TIMEOUT: "端点 60s 未响应（超时）",
    STT_ENDPOINT_BLOCKED: "端点地址被安全护栏拒绝",
    TTS_ENDPOINT_BLOCKED: "端点地址被安全护栏拒绝",
  };
  const detail = e?.message ?? String(e);
  return map[code] !== undefined ? `${map[code]}（${detail}）` : detail;
}

async function runSttTest() {
  const result = document.getElementById("stt-test-result");
  const btn = document.getElementById("stt-test");
  if (settingsCache?.stt === undefined) {
    result.textContent = "未配置——先填 STT 端点根与转写模型";
    return;
  }
  btn.disabled = true;
  result.textContent = "测试中…（真实端点往返）";
  try {
    await flushSettings();
    const envelope = await sendSettings({
      op: "stt-transcribe",
      mediaType: "audio/wav",
      content: silentWavBase64(),
    });
    if (!envelope.ok) {
      const err = envelope.error ?? {};
      const e = Object.assign(new Error(err.message ?? ""), { code: err.code });
      result.textContent = `失败：${voiceErrorMessage(e)}`;
      return;
    }
    result.textContent = `成功——模型 ${envelope.result.model ?? ""} 返回文本：「${String(envelope.result.text ?? "").slice(0, 60)}」（静音输入返回空文本/极短文本均属正常）`;
  } catch (e) {
    result.textContent = `失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    btn.disabled = false;
  }
}

async function runTtsTest() {
  const result = document.getElementById("tts-test-result");
  const btn = document.getElementById("tts-test");
  if (settingsCache?.tts === undefined) {
    result.textContent = "未配置——先填 TTS 端点根与合成模型";
    return;
  }
  btn.disabled = true;
  result.textContent = "测试中…（真实端点往返）";
  try {
    await flushSettings();
    const envelope = await sendSettings({
      op: "tts-synthesize",
      text: "你好，这是一段语音合成测试。",
    });
    if (!envelope.ok) {
      const err = envelope.error ?? {};
      const e = Object.assign(new Error(err.message ?? ""), { code: err.code });
      result.textContent = `失败：${voiceErrorMessage(e)}`;
      return;
    }
    const bytes = envelope.result.audioBase64 ?? "";
    const kb = Math.round((bytes.length * 3) / 4 / 1024);
    // 真实播放（Audio 元素——播完释放 Blob URL）
    const mediaType = envelope.result.mediaType ?? "audio/mpeg";
    const binary = atob(bytes);
    const audioBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) audioBytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([audioBytes], { type: mediaType }));
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    audio.addEventListener("error", () => URL.revokeObjectURL(url));
    void audio.play().catch(() => URL.revokeObjectURL(url));
    result.textContent = `成功——模型 ${envelope.result.model ?? ""} 合成 ${String(kb)}KB 音频，正在播放`;
  } catch (e) {
    result.textContent = `失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 挂载 / 回填
// ---------------------------------------------------------------------------

export function bind() {
  document.getElementById("mcp-add").addEventListener("click", () => {
    editingMcpName = null;
    openMcpWizard(null);
  });
  document.getElementById("mcp-import").addEventListener("click", () => void openMcpImportDialog());
  // 双形式切换：form → json 生成草稿（当前表单字段序列化）；json → form
  // 解析回填（失败留在 JSON 模式并显示错误——比弹回更可诊断）
  document.getElementById("mcp-mode-form").addEventListener("click", () => {
    if (mcpMode === "form") return;
    const text = document.getElementById("mcp-json").value.trim();
    if (text === "") {
      setMcpMode("form");
      return;
    }
    const parsed = parseMcpJsonDraft(text);
    const jsonErrorEl = document.getElementById("mcp-json-error");
    if (parsed.error !== undefined) {
      jsonErrorEl.textContent = parsed.error;
      jsonErrorEl.hidden = false;
      return; // 转换失败留在 JSON 模式
    }
    fillMcpFormFromEntry(parsed.name, parsed.entry);
    setMcpMode("form");
  });
  document.getElementById("mcp-mode-json").addEventListener("click", () => {
    if (mcpMode === "json") return;
    const raw = mcpFormRaw();
    const { env } = parseMcpEnvText(raw.envRaw);
    const config = {
      ...(raw.command !== "" ? { command: raw.command } : {}),
      ...(raw.args.length > 0 ? { args: raw.args } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(raw.timeoutRaw !== "" && Number(raw.timeoutRaw) > 0 ? { timeoutMs: Number(raw.timeoutRaw) } : {}),
    };
    let draft = {};
    if (raw.name !== "") {
      draft = { [raw.name]: config };
    } else if (raw.command !== "") {
      draft = config;
    }
    document.getElementById("mcp-json").value =
      Object.keys(draft).length > 0 ? JSON.stringify(draft, null, 2) : "";
    document.getElementById("mcp-json-error").hidden = true;
    setMcpMode("json");
  });
  document.getElementById("mcp-next").addEventListener("click", () => {
    const envErrorEl = document.getElementById("mcp-env-error");
    const jsonErrorEl = document.getElementById("mcp-json-error");
    envErrorEl.hidden = true;
    jsonErrorEl.hidden = true;
    if (mcpMode === "form") {
      const raw = mcpFormRaw();
      if (raw.name === "" || raw.name.includes("__") || raw.command === "") {
        toast("名称（不含 __）与启动命令必填", "warn");
        return;
      }
      const { env, error } = parseMcpEnvText(raw.envRaw);
      if (error !== undefined) {
        envErrorEl.textContent = error;
        envErrorEl.hidden = false;
        return;
      }
      const timeoutNumber = raw.timeoutRaw === "" ? undefined : Number(raw.timeoutRaw);
      if (raw.timeoutRaw !== "" && (!Number.isFinite(timeoutNumber) || timeoutNumber <= 0)) {
        toast("超时须为正数（ms）", "warn");
        return;
      }
      mcpWizardEntry = {
        name: raw.name,
        command: raw.command,
        ...(raw.args.length > 0 ? { args: raw.args } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(timeoutNumber !== undefined ? { timeoutMs: timeoutNumber } : {}),
      };
    } else {
      const text = document.getElementById("mcp-json").value;
      if (text.trim() === "") {
        toast("粘贴 JSON 配置", "warn");
        return;
      }
      const parsed = parseMcpJsonDraft(text);
      if (parsed.error !== undefined) {
        jsonErrorEl.textContent = parsed.error;
        jsonErrorEl.hidden = false;
        return;
      }
      const name = parsed.name !== "" ? parsed.name : document.getElementById("mcp-name").value.trim();
      if (name === "" || name.includes("__")) {
        jsonErrorEl.textContent = '缺少 server 名（JSON 键名，或表单模式先填名称）——且不能含 "__"';
        jsonErrorEl.hidden = false;
        return;
      }
      mcpWizardEntry = { name, ...parsed.entry };
    }
    document.getElementById("mcp-step1").hidden = true;
    document.getElementById("mcp-step2").hidden = false;
  });
  document.getElementById("mcp-back").addEventListener("click", () => {
    document.getElementById("mcp-step2").hidden = true;
    document.getElementById("mcp-step1").hidden = false;
  });
  document.getElementById("mcp-test").addEventListener("click", () => {
    if (mcpWizardEntry === null) return;
    const resultEl = document.getElementById("mcp-check-result");
    const toolsBox = document.getElementById("mcp-check-tools");
    resultEl.textContent = "测试中…";
    toolsBox.hidden = true;
    testMcpEntry(mcpWizardEntry, (envelope) => {
      if (resultEl.isConnected === false) return; // 视图已卸载
      if (!envelope.ok) {
        resultEl.textContent = `校验不可用：${envelope.error?.message ?? ""}`;
        return;
      }
      const outcome = recordMcpCheck(mcpWizardEntry.name, envelope);
      if (outcome.ok) {
        mcpTestOk = true;
        document.getElementById("mcp-save").disabled = false;
        resultEl.textContent = `连接成功（协议 ${outcome.protocolVersion}，${outcome.tools.length} 个工具）`;
        toolsBox.replaceChildren(...outcome.tools.slice(0, 24).map((t) => chipEl(t.name)));
        toolsBox.hidden = outcome.tools.length === 0;
        toolsBox.title = outcome.tools.length > 24 ? "仅显示前 24 个工具名" : "";
      } else {
        resultEl.textContent = `连接失败：${outcome.message}`;
      }
      renderMcpList(); // 状态点随检测结果刷新
    });
  });
  document.getElementById("mcp-save").addEventListener("click", () => {
    if (mcpWizardEntry === null || !mcpTestOk) return;
    // 重名校验（对其他条目——本条目编辑改名时以 editingMcpName 排除自身）
    const conflict = (settingsCache.mcp ?? []).some(
      (x) => x.name === mcpWizardEntry.name && x.name !== editingMcpName,
    );
    if (conflict) {
      toast("server 名已存在", "warn");
      return;
    }
    let list = (settingsCache.mcp ?? []).filter(
      (x) => x.name !== mcpWizardEntry.name && x.name !== editingMcpName,
    );
    list.push(mcpWizardEntry);
    // 改名保存：测试结果/来源徽章随名迁移（内存面键同步）
    if (editingMcpName !== null && editingMcpName !== mcpWizardEntry.name) {
      if (mcpCheckResults.has(editingMcpName)) {
        mcpCheckResults.set(mcpWizardEntry.name, mcpCheckResults.get(editingMcpName));
        mcpCheckResults.delete(editingMcpName);
      }
      mcpCheckFailures.delete(editingMcpName);
      if (mcpImportSource.has(editingMcpName)) {
        mcpImportSource.set(mcpWizardEntry.name, mcpImportSource.get(editingMcpName));
        mcpImportSource.delete(editingMcpName);
      }
    }
    settingsCache.mcp = list;
    editingMcpName = null;
    document.getElementById("mcp-wizard").hidden = true;
    dirtySections.add("mcp");
    renderMcpList();
    markDirty("mcp");
  });

  document.getElementById("skill-search").addEventListener("input", (ev) => {
    skillFilter = ev.target.value.trim();
    void refreshSkillsList();
  });
  document.getElementById("skill-import").addEventListener("click", () => void openSkillImportDialog());
  document.getElementById("skill-new").addEventListener("click", () => {
    void openSkillEditor(null);
  });
  // C：种子模板——新建时输入名称且正文未写 → 一次性填充三段骨架
  document.getElementById("skill-name").addEventListener("input", () => {
    if (editingSkillName !== null || skillBodyTouched) return;
    const name = document.getElementById("skill-name").value.trim();
    const bodyEl = document.getElementById("skill-body");
    if (name !== "" && bodyEl.value.trim() === "") {
      bodyEl.value = skillSeedBody(name);
      updateSkillBytes();
    }
  });
  // D：字节计数（正文手写即置 touched——种子不再触发）
  document.getElementById("skill-body").addEventListener("input", () => {
    skillBodyTouched = true;
    updateSkillBytes();
  });
  document.getElementById("skill-cancel").addEventListener("click", () => {
    document.getElementById("skill-editor").hidden = true;
    document.getElementById("skill-new").hidden = false;
    editingSkillName = null;
    editingSkillOrigin = null;
  });
  document.getElementById("skill-save").addEventListener("click", async () => {
    const name = document.getElementById("skill-name").value.trim();
    const description = document.getElementById("skill-desc").value.trim();
    const body = document.getElementById("skill-body").value;
    if (name === "" || description === "" || body.trim() === "") {
      toast("技能名、描述与正文必填", "warn");
      return;
    }
    if (new TextEncoder().encode(body).length > SKILL_BODY_MAX_BYTES) {
      toast(`正文超限（上限 128KB）`, "warn");
      return;
    }
    // D：外部来源技能保存语义澄清——写的是主目录同名副本（原文件不动），
    // 现状静默变副本无感知，先确认（pi-desktop 无此面——来源根只读模型不同）
    if (editingSkillOrigin !== null && editingSkillOrigin !== skillsView?.roots?.[0]) {
      const ok = await confirmDialog(
        `该技能来自外部来源（${editingSkillOrigin}）。\n保存将写入工作区主目录的同名副本（原文件不动）。继续？`,
        { title: "保存外部来源技能", confirmLabel: "保存副本" },
      );
      if (!ok) return;
    }
    const envelope = await sendSettings({
      op: "skill-save",
      skill: {
        name,
        description,
        body,
        ...(skillToolsSelected.size > 0 ? { tools: [...skillToolsSelected] } : {}),
      },
    });
    if (!envelope.ok) {
      appendLine(`技能保存失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    // 改名保存 = 旧名技能不再被停用名单管着（名单按名匹配——同步清理）
    if (editingSkillName !== null && editingSkillName !== name) {
      const cur = (settingsCache.skills?.disabled ?? []).filter((x) => x !== editingSkillName);
      settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.length > 0 ? { disabled: cur } : {}) };
      if (cur.length === 0) delete settingsCache.skills.disabled;
      dirtySections.add("skills");
      markDirty("skills");
    }
    const editor = document.getElementById("skill-editor");
    if (editor === null) return; // 保存回包晚于导航——缓存已写，无需 UI 收尾
    editor.hidden = true;
    document.getElementById("skill-new").hidden = false;
    editingSkillName = null;
    appendLine(`技能已保存：${name}（新会话装配生效）`, "meta");
    toast("技能已保存", "info");
    editingSkillOrigin = null;
    void refreshSkillsList();
  });
  document.getElementById("skill-root-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const p = document.getElementById("skill-root-path").value.trim();
    if (p === "") return;
    const roots = settingsCache.skills?.roots ?? [];
    if (roots.includes(p)) {
      toast("该来源目录已在清单", "warn");
      return;
    }
    settingsCache.skills = { ...(settingsCache.skills ?? {}), roots: [...roots, p] };
    document.getElementById("skill-root-path").value = "";
    dirtySections.add("skills");
    renderSkillRoots();
    markDirty("skills");
    void refreshSkillsList();
  });

  document.getElementById("subagent-search").addEventListener("input", (ev) => {
    subagentFilter = ev.target.value.trim();
    renderSubagentList();
  });
  document.getElementById("subagent-new").addEventListener("click", () => {
    openSubagentEditor({ name: "", description: "", prompt: "" }, false);
  });
  // A：骨架 seed——新建输入名称且指令未写 → 一次性填充（技能页同款门控）
  document.getElementById("subagent-name").addEventListener("input", () => {
    if (editingSubagentName !== null || subagentPromptTouched) return;
    const name = document.getElementById("subagent-name").value.trim();
    const promptEl = document.getElementById("subagent-prompt");
    if (name !== "" && promptEl.value.trim() === "") {
      promptEl.value = subagentSeedPrompt(name);
      updateSubagentBytes();
    }
  });
  document.getElementById("subagent-prompt").addEventListener("input", () => {
    subagentPromptTouched = true;
    updateSubagentBytes();
  });
  // B：继承勾选联动（勾选 = 不收窄——chips 区禁用置灰）
  document.getElementById("subagent-inherit-tools").addEventListener("change", syncSubagentInherit);
  // C：模型条目级联（条目变 → 模型 id 选项重挂）
  document.getElementById("subagent-provider").addEventListener("change", (ev) => {
    renderSubagentModelOptions(ev.target.value, "");
  });
  // C：备用模型添加
  document.getElementById("subagent-fallback-append").addEventListener("click", () => {
    const sel = document.getElementById("subagent-fallback-add");
    const name = sel.value;
    if (name === "" || subagentFallbackList.includes(name)) return;
    subagentFallbackList.push(name);
    renderSubagentFallbacks();
    renderSubagentFallbackAdd();
  });
  document.getElementById("subagent-cancel").addEventListener("click", () => {
    document.getElementById("subagent-editor").hidden = true;
    document.getElementById("subagent-new").hidden = false;
    editingSubagentName = null;
  });
  document.getElementById("subagent-save").addEventListener("click", () => {
    const name = document.getElementById("subagent-name").value.trim();
    const description = document.getElementById("subagent-desc").value.trim();
    const prompt = document.getElementById("subagent-prompt").value;
    const provider = document.getElementById("subagent-provider").value.trim();
    const model = document.getElementById("subagent-model").value.trim();
    const reasoning = document.getElementById("subagent-reasoning").value;
    const maxTokensRaw = document.getElementById("subagent-maxtokens").value.trim();
    const inherit = document.getElementById("subagent-inherit-tools").checked;
    if (name === "" || description === "" || prompt.trim() === "") {
      toast("预设名、描述与指令必填", "warn");
      return;
    }
    if (new TextEncoder().encode(prompt).length > SUBAGENT_PROMPT_MAX_BYTES) {
      toast("指令超限（上限 32KB）", "warn");
      return;
    }
    // B：pi-desktop 同规则——不勾继承时至少勾一个工具
    if (!inherit && subagentToolsSelected.size === 0) {
      toast("不继承主会话工具时至少勾选一个可用工具", "warn");
      return;
    }
    const maxTokens = maxTokensRaw === "" ? undefined : Number(maxTokensRaw);
    if (maxTokensRaw !== "" && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 200_000)) {
      toast("输出上限须为 1..200000 的整数", "warn");
      return;
    }
    const entry = {
      name,
      description,
      prompt,
      // B：继承 = tools 字段不写（undefined = 不收窄——既有装配语义）
      ...(!inherit && subagentToolsSelected.size > 0 ? { tools: [...subagentToolsSelected] } : {}),
      ...(provider !== "" ? { modelProvider: provider } : {}),
      ...(model !== "" ? { model } : {}),
      ...(reasoning !== "" ? { reasoning } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(subagentFallbackList.length > 0 ? { fallbacks: [...subagentFallbackList] } : {}),
    };
    const defs = (settingsCache.subagents ?? []).filter(
      (d) => d.name !== name && d.name !== editingSubagentName,
    );
    defs.push(entry);
    settingsCache.subagents = defs;
    document.getElementById("subagent-editor").hidden = true;
    document.getElementById("subagent-new").hidden = false;
    editingSubagentName = null;
    dirtySections.add("subagents");
    markDirty("subagents");
    toast("子代理预设已保存（新会话生效）", "info");
    void refreshSubagentsList();
  });

  document.getElementById("prompt-search").addEventListener("input", (ev) => {
    promptFilter = ev.target.value.trim();
    renderPromptList();
  });
  document.getElementById("prompt-new").addEventListener("click", () => openPromptDialog(undefined));
  document.getElementById("prompt-import").addEventListener("click", () => openPromptImportDialog());

  // T-P3-147 C/I/G：辅助模型四任务卡 + fastModel + 润色模板 + 总闸
  for (const t of ENHANCEMENT_TASK_KEYS) bindEnhancementTask(t);
  document.getElementById("enh-enabled").addEventListener("change", (ev) => {
    const next = { ...(settingsCache.enhancement ?? {}) };
    if (ev.target.checked) delete next.enabled;
    else next.enabled = false;
    settingsCache.enhancement = next;
    dirtySections.add("enhancement");
    markDirty("enhancement");
    toast(ev.target.checked ? "辅助流量已开启" : "辅助流量已关闭——标题/润色停用，判官落回人", "info");
  });
  // 润色模板面
  document.getElementById("enh-polish-custom").addEventListener("change", syncPolishTemplateState);
  document.getElementById("enh-polish-template").addEventListener("input", syncPolishTemplateState);
  document.getElementById("enh-polish-insert").addEventListener("click", () => {
    const ta = document.getElementById("enh-polish-template");
    const pos = ta.selectionStart ?? ta.value.length;
    ta.value = `${ta.value.slice(0, pos)}{{draft}}${ta.value.slice(ta.selectionEnd ?? pos)}`;
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  });
  document.getElementById("enh-polish-reset").addEventListener("click", () => {
    const ta = document.getElementById("enh-polish-template");
    ta.value = "";
    const next = { ...(settingsCache.enhancement ?? {}) };
    const polish = { ...(next.polish ?? {}) };
    delete polish.customTemplate;
    delete polish.template;
    if (Object.keys(polish).length === 0) delete next.polish;
    else next.polish = polish;
    settingsCache.enhancement = next;
    dirtySections.add("enhancement");
    markDirty("enhancement");
    document.getElementById("enh-polish-custom").checked = false;
    syncPolishTemplateState();
    toast("已恢复内置润色模板", "info");
  });
  // 标题指令 / 摘要指令覆写（即改即存）
  document.getElementById("enh-title-prompt").addEventListener("change", (ev) => {
    const next = { ...(settingsCache.enhancement ?? {}) };
    const title = { ...(next.title ?? {}) };
    if (ev.target.value.trim() === "") delete title.prompt;
    else title.prompt = ev.target.value;
    if (Object.keys(title).length === 0) delete next.title;
    else next.title = title;
    settingsCache.enhancement = next;
    dirtySections.add("enhancement");
    markDirty("enhancement");
  });
  document.getElementById("enh-summary-prompt").addEventListener("change", (ev) => {
    const next = { ...(settingsCache.enhancement ?? {}) };
    if (ev.target.value.trim() === "") delete next.summaryPrompt;
    else next.summaryPrompt = ev.target.value;
    settingsCache.enhancement = next;
    dirtySections.add("enhancement");
    markDirty("enhancement");
  });

  sttInputHandler("baseurl");
  sttInputHandler("model");
  sttInputHandler("language");
  sttInputHandler("maxseconds");
  sttInputHandler("refine");
  sttInputHandler("silence");
  sttInputHandler("protocol");
  bindSttFromProvider();
  ttsInputHandler("baseurl");
  ttsInputHandler("model");
  ttsInputHandler("voice");
  document.getElementById("stt-test").addEventListener("click", () => void runSttTest());
  document.getElementById("tts-test").addEventListener("click", () => void runTtsTest());

}



export function fill() {
  // T-P3-147 C/I/G：辅助模型四任务卡回填（下拉选项渲染 + 级联 + 总闸 + 模板）
  document.getElementById("enh-enabled").checked = settingsCache?.enhancement?.enabled !== false;
  for (const t of ENHANCEMENT_TASK_KEYS) {
    renderTaskProviderOptions(t);
    const sel = document.getElementById(`enh-${t}-provider`);
    sel.value = enhancementTaskOf(t).provider ?? "";
    renderTaskModelOptions(t);
  }
  const polishCfg = enhancementTaskOf("polish");
  const polishCustom = polishCfg.customTemplate === true;
  document.getElementById("enh-polish-custom").checked = polishCustom;
  document.getElementById("enh-polish-template").value = polishCustom ? (polishCfg.template ?? "") : "";
  syncPolishTemplateState();
  document.getElementById("enh-title-prompt").value = settingsCache?.enhancement?.title?.prompt ?? "";
  document.getElementById("enh-summary-prompt").value = settingsCache?.enhancement?.summaryPrompt ?? "";
  // U26/T-P3-129：STT 分节回填（空输入 = 未配置——语音输入不可用）
  document.getElementById("stt-baseurl").value = settingsCache?.stt?.baseUrl ?? "";
  document.getElementById("stt-model").value = settingsCache?.stt?.model ?? "";
  document.getElementById("stt-language").value = settingsCache?.stt?.language ?? "";
  document.getElementById("stt-maxseconds").value = settingsCache?.stt?.maxSeconds ?? "";
  document.getElementById("stt-refine").checked = settingsCache?.stt?.refineTranscript === true;
  document.getElementById("stt-silence").checked = settingsCache?.stt?.silenceStop === true;
  document.getElementById("stt-protocol").value = settingsCache?.stt?.protocol === "chat" ? "chat" : "transcriptions";
  // T-P3-149：TTS 分节回填
  document.getElementById("tts-baseurl").value = settingsCache?.tts?.baseUrl ?? "";
  document.getElementById("tts-model").value = settingsCache?.tts?.model ?? "";
  document.getElementById("tts-voice").value = settingsCache?.tts?.voice ?? "";
  renderMcpList();
  renderPromptList();
  renderSkillRoots();
}

/** 打开时异步清单刷新（壳 open 委派——文件系统面每次打开刷新）。 */
export function refreshLists() {
  void refreshSkillsList(); // U22：技能清单（文件系统面——每次打开刷新）
  void refreshSubagentsList(); // U23：子代理清单（内置+自定义——每次打开刷新）
  // T-P3-148 O：插件清单迁独立页 views/plugins.js（设置页不再承载）
  void refreshPromptsList(); // T-P3-146：模板清单（文件域——每次打开刷新 + 迁移）
}
