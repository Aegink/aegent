/**
 * 供应商页（T-P3-137 · pi-desktop「模型配置」形态重构——用户裁决"全面
 * 参考 PI-Desktop"+7+ 功能点）：AI 服务列表（字母头像/域名·模型数/启停/
 * 排序/默认徽标）+ 默认项卡（默认模型「更改」全模型下拉）+ 添加/编辑
 * 大模态（接口地址/API 密钥/接口格式 + 模型双栏：左"该服务的模型"真实
 * 拉取〔op:provider-models——host 代理 GET /models，WebView CSP 不放外网〕
 * + 搜索/全选/复选 + 自定义模型添加；右"模型设置"：协议按模型覆盖〔同站
 * 混合协议〕/别名/上下文窗口/最大输出/思考等级/移除）+ 测试连接（
 * op:provider-test 真实发"你好"——成功才算可以使用，verified 落档）+
 * 请求头高级设置（键值行/常用请求头/导入 JSON/复制 JSON）。
 * 数据面：providers 段整体替换 + key 走 credentials-set（零明文）原语义。
 */

import { sendRequest, sendSettings } from "../../api.js";
import { settingsCache, getSessionId } from "../../state.js";
import { appendLine, toast } from "../../feedback.js";
import { icon } from "../../icons.js";
import {
  markDirty,
  dirtySections,
  openDialog,
  confirmDialog,
  openMenu,
  upgradeSelects,
  onSectionRefresh,
  rowEl,
  rowCopyEl,
  rowControl,
  btnEl,
  emptyState,
  chipEl,
  switchEl,
  refreshSelectPanel,
} from "./core.js";

export const SECTIONS_HTML = `
<section data-section="providers">
  <div class="section-head">
    <h2 class="section-title">供应商</h2>
    <button id="provider-add" type="button" class="btn btn-primary">添加服务</button>
  </div>
  <div id="provider-default-card" class="row-list"></div>
  <div class="group-title">AI 服务 <span id="provider-count" class="badge">0</span></div>
  <div id="provider-list" class="tile-list"></div>
  <div id="provider-orphan-keys" class="row-list"></div>
  <p class="hint">默认模型 = 新会话启动装配选中的服务与模型。服务列表顺序 = 故障转移优先级（J15 队列序）；停用的服务保留在清单（开关是开回的路径）。API key 经凭据面独立存储（DPAPI 加密、零明文）——下方"预存密钥"区显示尚未被任何服务引用的 key（含语音识别的 stt），可在此删除。</p>
</section>
`;

// —— 模块状态（域状态归子模块——批 B 拆分纪律） ——
let editingProviderName = null; // 非 null = 模态在改既有条目
let credentials = []; // [{name, masked, updatedAt}]——hasSecret 判定
let discoveredModels = null; // 拉取的模型 id 清单（模态生命周期）
let draftModels = []; // 模态内模型草稿 [{id, adapter?, alias?, contextWindow?, maxOutputTokens?, reasoning?, verified?}]
let draftHeaders = {}; // 请求头草稿
let draftAdapter = "openai"; // 服务级缺省协议
let advancedOpenId = null; // 展开高级设置的模型 id
let leftFilter = ""; // 左栏搜索
let testRunning = false;

const CTX_PRESETS = [
  ["128k", 131072],
  ["256k", 262144],
  ["312k", 319232],
  ["500k", 524288],
  ["1M", 1048576],
];
const OUT_PRESETS = [
  ["4k", 4096],
  ["8k", 8192],
  ["16k", 16384],
  ["32k", 32768],
  ["128k", 131072],
];
const REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const COMMON_HEADERS = [
  ["User-Agent", "aegent/0.1.0"],
  ["X-Title", "aegent"],
  ["X-Client-Name", "aegent"],
];

const ADAPTER_LABEL = {
  openai: "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic Messages",
  google: "Google Generative AI",
};

// —— 内置模型目录（T-P3-137 三轮——pi-desktop models.dev 快照同源裁剪：
//    ui/model-catalog.json 11 家主流 provider / 252 模型；勾选模型时自动
//    预填 上下文/最大输出/思考档位/附件能力——"跟随目录；手动修改后固定"） ——
let modelCatalog = null; // {providers: {pid: {models: [{id, ctx, out, img, pdf, re, lv}]}}}
let catalogPromise = null;

function ensureModelCatalog() {
  if (modelCatalog !== null) return Promise.resolve(modelCatalog);
  if (catalogPromise === null) {
    catalogPromise = fetch("model-catalog.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        modelCatalog = data;
        return data;
      })
      .catch(() => null);
  }
  return catalogPromise;
}

/** 目录匹配：模型 ID 尾段（/ 分隔最后一段）精确命中——中转自定义前缀
 *  （如 cline-pass/deepseek-v4.1-flash）也按尾段对上目录同名条目。 */
function catalogLookup(modelId) {
  if (modelCatalog === null || modelCatalog?.models === undefined) return undefined;
  const tail = modelId.split("/").pop() ?? modelId;
  return modelCatalog.models[tail];
}

/** 勾选/添加模型时按目录预填缺省（不覆盖用户已改的值——?? 语义）。 */
function applyCatalogDefaults(m) {
  const cat = catalogLookup(m.id);
  if (cat === undefined) return false;
  if (m.contextWindow === undefined && cat.ctx !== undefined) m.contextWindow = cat.ctx;
  if (m.maxOutputTokens === undefined && cat.out !== undefined) m.maxOutputTokens = cat.out;
  if (m.thinkingLevels === undefined && cat.lv !== undefined) m.thinkingLevels = [...cat.lv];
  if (m.imageInput === undefined && cat.img === 1) m.imageInput = true;
  if (m.pdfInput === undefined && cat.pdf === 1) m.pdfInput = true;
  return true;
}

/** 统一加入草稿（去重 + 目录预填——目录未加载完时异步补填并重渲染）。 */
function addDraftModel(id) {
  if (draftModels.some((m) => m.id === id)) return false;
  const m = { id };
  if (modelCatalog !== null) {
    applyCatalogDefaults(m);
  } else {
    void ensureModelCatalog().then(() => {
      if (applyCatalogDefaults(m)) renderDraftModels();
    });
  }
  draftModels.push(m);
  return true;
}

function hasSecret(name) {
  return credentials.some((c) => c.name === name);
}

// —— 上移/下移的动态反馈（FLIP：First-Last-Invert-Play——渲染前后同行
//    位置差反演成 transform，过渡归零即滑动动画） ——
function captureTileTops() {
  const tops = new Map();
  for (const tile of document.querySelectorAll("#provider-list .provider-tile")) {
    const name = tile.querySelector(".row-title")?.firstChild?.textContent;
    if (name !== undefined && name !== null) tops.set(name, tile.getBoundingClientRect().top);
  }
  return tops;
}

function playTileFlip(before, movedName) {
  for (const tile of document.querySelectorAll("#provider-list .provider-tile")) {
    const name = tile.querySelector(".row-title")?.firstChild?.textContent;
    if (name === null || name === undefined || !before.has(name)) continue;
    const delta = before.get(name) - tile.getBoundingClientRect().top;
    if (Math.abs(delta) < 2) continue; // 未移动的行不动
    tile.style.transition = "none";
    tile.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      tile.style.transition = "transform 0.3s ease";
      tile.style.transform = "";
    });
  }
  // 被移动行高亮闪烁（确定性反馈——动了哪一行一目了然）
  for (const tile of document.querySelectorAll("#provider-list .provider-tile")) {
    const name = tile.querySelector(".row-title")?.firstChild?.textContent;
    if (name === movedName) {
      tile.classList.remove("tile-flash");
      void tile.offsetWidth; // 重启动画
      tile.classList.add("tile-flash");
      setTimeout(() => tile.classList.remove("tile-flash"), 1100);
      tile.scrollIntoView({ block: "nearest", behavior: "smooth" });
      break;
    }
  }
}

function entryModels(entry) {
  return entry.models ?? (entry.model !== undefined ? [{ id: entry.model }] : []);
}

function hostFromBaseUrl(baseUrl) {
  if (baseUrl === undefined || baseUrl === "") return "（未设置地址）";
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.slice(0, 28);
  }
}

function fmtTokens(n) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `${Math.round(n / 1024)}k`;
}

// ---------------------------------------------------------------------------
// 列表页：默认项卡 + AI 服务行
// ---------------------------------------------------------------------------

function renderDefaultCard() {
  const box = document.getElementById("provider-default-card");
  if (box === null) return;
  box.replaceChildren();
  const row = rowEl();
  const titleEl = document.createElement("div");
  titleEl.className = "row-title";
  titleEl.textContent = "默认模型";
  const currentProvider = settingsCache?.defaultProvider;
  const currentEntry = (settingsCache?.providers ?? []).find((p) => p.name === currentProvider);
  const currentModel = settingsCache?.defaultModel ?? entryModels(currentEntry ?? {})[0]?.id;
  const descEl = document.createElement("div");
  descEl.className = "row-desc";
  descEl.textContent =
    currentEntry !== undefined
      ? `${currentEntry.name} · ${currentModel ?? "（条目未设模型）"}`
      : "（未设置——右侧两级选择：先服务后模型）";
  // 两级选择（用户反馈：只看模型不知道供应商）——先服务后模型联动
  const providers = (settingsCache?.providers ?? []).filter(
    (p) => p.enabled !== false && entryModels(p).length > 0,
  );
  const providerSel = document.createElement("select");
  providerSel.className = "select";
  providerSel.setAttribute("aria-label", "默认服务");
  providerSel.style.display = "none"; // 桥接宿主——触发器由 upgradeSelects 生成
  const providerPlaceholder = document.createElement("option");
  providerPlaceholder.value = "";
  providerPlaceholder.textContent = "选择服务";
  providerSel.appendChild(providerPlaceholder);
  for (const p of providers) {
    const o = document.createElement("option");
    o.value = p.name;
    o.textContent = p.name;
    providerSel.appendChild(o);
  }
  const modelSel = document.createElement("select");
  modelSel.className = "select";
  modelSel.setAttribute("aria-label", "默认模型");
  modelSel.style.display = "none";
  const modelPlaceholder = document.createElement("option");
  modelPlaceholder.value = "";
  modelPlaceholder.textContent = "选择模型";
  modelSel.appendChild(modelPlaceholder);
  const fillModels = (providerName) => {
    const entry = providers.find((p) => p.name === providerName);
    modelSel.replaceChildren(modelPlaceholder);
    for (const m of entryModels(entry ?? {})) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.alias ? `${m.id}（${m.alias}）` : m.id;
      modelSel.appendChild(o);
    }
    refreshSelectPanel(modelSel); // 级联重建后同步桥接面板（T-P3-146 修；未桥接时零操作）
  };
  if (currentProvider !== undefined && providers.some((p) => p.name === currentProvider)) {
    providerSel.value = currentProvider;
    fillModels(currentProvider);
    if (currentModel !== undefined) modelSel.value = currentModel;
  }
  providerSel.addEventListener("change", (ev) => {
    const name = ev.target.value;
    if (name === "") return;
    fillModels(name);
    const firstModel = entryModels(providers.find((p) => p.name === name) ?? {})[0]?.id;
    settingsCache.defaultProvider = name;
    if (firstModel !== undefined) settingsCache.defaultModel = firstModel;
    modelSel.value = firstModel ?? "";
    dirtySections.add("defaultProvider");
    dirtySections.add("defaultModel");
    renderProviderList();
    markDirty("defaultProvider");
    markDirty("defaultModel");
    toast(`默认服务已切换：${name}${firstModel !== undefined ? ` · ${firstModel}` : ""}（新会话生效）`, "info");
  });
  modelSel.addEventListener("change", (ev) => {
    const modelId2 = ev.target.value;
    if (modelId2 === "" || providerSel.value === "") return;
    settingsCache.defaultModel = modelId2;
    dirtySections.add("defaultModel");
    renderProviderList();
    markDirty("defaultModel");
    descEl.textContent = `${providerSel.value} · ${modelId2}`;
    toast(`默认模型已切换：${providerSel.value} · ${modelId2}（新会话生效）`, "info");
  });
  const control = rowControl(providerSel, modelSel);
  control.classList.add("default-pickers");
  row.append(rowCopyEl(titleEl, descEl), control);
  box.appendChild(row);
  upgradeSelects(box);
}

function renderProviderList() {
  const list = document.getElementById("provider-list");
  if (list === null) return;
  list.replaceChildren();
  const providers = settingsCache?.providers ?? [];
  const count = document.getElementById("provider-count");
  if (count !== null) count.textContent = String(providers.length);
  if (providers.length === 0) {
    list.appendChild(emptyState("暂无供应商条目", "点右上「添加服务」接入 AI 服务——支持拉取模型列表与真实测试连接"));
    return;
  }
  for (const entry of providers) {
    // 单行渲染防御（走查反馈：上移/下移后列表偶发消失——单行异常不再
    // 静默拖垮整个列表，即时可见）
    try {
      if (entry === null || typeof entry !== "object") continue; // 坏元素防御（不进渲染）
      const enabled = entry.enabled !== false;
      const isDefault = settingsCache?.defaultProvider === entry.name;
    // tile 行（pi-desktop ModelConfigPage 形态——独立圆角卡 + hover 面；
    // 操作收纳 … 菜单，行面只留启停开关）
    const tile = document.createElement("div");
    tile.className = "provider-tile";
    // 字母头像座（首字符圆形徽标）
    const avatar = document.createElement("span");
    avatar.className = "avatar-badge";
    avatar.textContent = (entry.name[0] ?? "?").toUpperCase();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = entry.name;
    if (isDefault) titleEl.appendChild(chipEl("默认", true));
    if (!enabled) titleEl.appendChild(chipEl("已停用"));
    if (!hasSecret(entry.name)) titleEl.appendChild(chipEl("未设密钥"));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = `${hostFromBaseUrl(entry.baseUrl)} · ${entryModels(entry).length} 个模型`;
    const copy = rowCopyEl(titleEl, descEl);
    // 启停（enabled 缺省 true——停用写 false、启用删键回缺省）
    const toggle = switchEl(enabled, (checked) => {
      settingsCache.providers = (settingsCache.providers ?? []).map((d) => {
        if (d.name !== entry.name) return d;
        if (checked) {
          const { enabled: _omit, ...rest } = d;
          return rest;
        }
        return { ...d, enabled: false };
      });
      dirtySections.add("providers");
      renderProviderList();
      renderDefaultCard();
      markDirty("providers");
    }, `启停服务 ${entry.name}`);
      // ↑↓ 故障转移优先级（J15 队列序——… 菜单项消费）。按 name 定位——
      // 防抖保存成功会整体替换 settingsCache（服务端 parse 的全新元素对象），
      // 闭包里的旧行引用 indexOf 会失配（-1 → 交换塞 undefined → 列表崩，
      // 走查复现实锤——T-P3-137 反馈③根因）
      const move = (delta) => {
        const arr = [...settingsCache.providers];
        const i = arr.findIndex((p) => p !== null && p !== undefined && p.name === entry.name);
        if (i < 0) return;
        const j = i + delta;
        if (j < 0 || j >= arr.length) return;
        const before = captureTileTops(); // FLIP 前照（用户反馈：要有动态反馈）
        [arr[i], arr[j]] = [arr[j], arr[i]];
        settingsCache.providers = arr;
        dirtySections.add("providers");
        renderProviderList();
        renderDefaultCard();
        playTileFlip(before, entry.name); // 位置滑动 + 被移动行高亮
        markDirty("providers");
      };
    // 本会话切换（U5/T-P3-104——model/switch 请求，立即受理新 turn 生效）
    const switchSession = async () => {
      const sid = getSessionId();
      if (sid === "") {
        appendLine("会话未连接，无法切换（新会话将以默认供应商启动）", "warn");
        return;
      }
      const firstModel = entryModels(entry)[0];
      const envelope = await sendRequest(sid, {
        type: "model/switch",
        identity: {
          provider: firstModel?.adapter ?? entry.adapter ?? "openai",
          modelId: firstModel?.id ?? settingsCache.defaultModel ?? "",
        },
      });
      if (envelope.ok) {
        appendLine(`已切换到 ${entry.name}（当前轮结束后新 turn 生效）`, "meta");
      } else {
        appendLine(`切换被拒：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      }
    };
    const del = async () => {
      if (!(await confirmDialog(`删除服务「${entry.name}」？其模型清单与配置将一并移除（凭据保留）。`, { title: "删除服务", confirmLabel: "删除", danger: true }))) return;
      settingsCache.providers = settingsCache.providers.filter((p) => p.name !== entry.name);
      if (settingsCache.defaultProvider === entry.name) settingsCache.defaultProvider = undefined;
      dirtySections.add("providers");
      renderProviderList();
      renderDefaultCard();
      markDirty("providers");
    };
    // … 操作菜单（pi-desktop 行形态：编辑/本会话切换/测试连接/上移/下移/删除）
    const moreBtn = btnEl("⋯", "btn btn-icon", "更多操作");
    moreBtn.setAttribute("aria-haspopup", "menu");
    moreBtn.addEventListener("click", () => {
      openMenu(moreBtn, [
        { label: "编辑", onClick: () => openProviderDialog(entry) },
        { label: "本会话切换", onClick: () => void switchSession() },
        { label: "测试连接", onClick: () => void rowTest(entry) },
        { label: "上移", onClick: () => move(-1) },
        { label: "下移", onClick: () => move(1) },
        { label: "删除", danger: true, onClick: () => void del() },
      ]);
    });
      tile.append(avatar, copy, rowControl(toggle, moreBtn));
      list.appendChild(tile);
      titleEl.style.cursor = "pointer";
      titleEl.title = "点击编辑该服务";
      titleEl.addEventListener("click", () => openProviderDialog(entry));
    } catch (e) {
      // 行渲染失败不影响其余行（列表不再消失）——异常即时可见
      console.error("服务行渲染失败", entry?.name, e);
      toast(`服务「${entry?.name ?? "?"}」行渲染失败：${e.message}`, "warn");
    }
  }
}

/** 行内测试连接（… 菜单——对服务的第一个模型真实发"你好"；成功写
 *  verified 标记即改即存）。文案带协议标签——模型级协议是否生效肉眼可验。 */
async function rowTest(entry) {
  const first = entryModels(entry)[0];
  if (first === undefined) {
    toast("该服务没有模型——先编辑添加", "warn");
    return;
  }
  const adapter = first.adapter ?? entry.adapter ?? "openai";
  const adapterLabel = ADAPTER_LABEL[adapter] ?? adapter;
  toast(`正在测试 ${entry.name} · ${first.id}（${adapterLabel}，真实发送「你好」）…`, "info");
  const envelope = await sendSettings({
    op: "provider-test",
    provider: entry.name,
    baseUrl: entry.baseUrl ?? "",
    adapter,
    modelId: first.id,
    // 默认思考档同步消费（模型级 reasoning——真实进测试请求）
    ...(first.reasoning !== undefined && first.reasoning !== "off" ? { reasoning: first.reasoning } : {}),
    ...(entry.headers !== undefined ? { headers: entry.headers } : {}),
  });
  const result = envelope.ok ? envelope.result : { ok: false, error: envelope.error?.message ?? "" };
  if (result.ok === true) {
    first.verified = true;
    dirtySections.add("providers");
    markDirty("providers");
    toast(`${entry.name} · ${first.id}（${adapterLabel}）回复：「${result.reply ?? ""}」（${result.latencyMs ?? "?"}ms）`, "info");
  } else {
    toast(`测试失败：${result.error ?? "未知错误"}`, "warn");
  }
  renderProviderList();
}

// ---------------------------------------------------------------------------
// 添加/编辑服务大模态（pi-desktop ProviderSetupDialog 形态）
// ---------------------------------------------------------------------------

function openProviderDialog(entry, prefillName) {
  editingProviderName = entry?.name ?? null;
  discoveredModels = null;
  advancedOpenId = null;
  leftFilter = "";
  draftModels = entry !== undefined ? JSON.parse(JSON.stringify(entryModels(entry))) : [];
  draftHeaders = entry?.headers !== undefined ? { ...entry.headers } : {};
  draftAdapter = entry?.adapter ?? "openai";
  void ensureModelCatalog(); // 目录预取（勾选时若已到则同步预填）
  const holder = document.createElement("div");
  holder.innerHTML = `
  <form id="provider-form">
    <div class="form-grid">
      <label>名称<input id="provider-name" class="input" type="text" placeholder="服务名（如 main）" autocomplete="off" /></label>
      <label>接口地址<input id="provider-baseurl" class="input" type="text" placeholder="https://api.example.com/v1" autocomplete="off" /></label>
      <label>API 密钥（${entry !== undefined && hasSecret(entry.name) || (prefillName !== undefined && hasSecret(prefillName)) ? "已设置——留空保留" : "不回显"}）<input id="provider-key" class="input" type="password" placeholder="sk-…" autocomplete="new-password" /></label>
      <label>接口格式（服务缺省协议）
        <select id="provider-adapter" class="select">
          <option value="openai">OpenAI Chat Completions</option>
          <option value="openai-responses">OpenAI Responses</option>
          <option value="anthropic">Anthropic Messages</option>
          <option value="google">Google Generative AI</option>
        </select>
      </label>
    </div>
    <p id="provider-test-status" class="hint probe-line">未测试——保存前可先「测试连接」（真实发送一条消息）</p>
    <div class="setup-panes">
      <div class="setup-pane" id="provider-models-left">
        <div class="pane-head">
          <span class="pane-title">该服务的模型</span>
          <button id="provider-fetch" type="button" class="btn btn-icon">获取列表</button>
        </div>
        <input id="provider-model-filter" class="input input-search" type="text" placeholder="搜索模型…" autocomplete="off" />
        <label class="check-line"><input id="provider-model-all" type="checkbox" /> 全选可见</label>
        <div id="provider-discovered" class="model-scroll"></div>
      </div>
      <div class="setup-pane" id="provider-models-right">
        <div class="pane-head"><span class="pane-title">模型设置 <span id="draft-count" class="badge">0</span></span></div>
        <div id="provider-drafts" class="model-scroll"></div>
        <div class="custom-model-row">
          <input id="provider-custom-model" class="input" type="text" placeholder="自定义模型 ID，如 my-model-v2" autocomplete="off" />
          <button id="provider-add-model" type="button" class="btn">＋ 添加</button>
        </div>
      </div>
    </div>
  </form>`;
  const form = holder.firstElementChild;
  if (entry !== undefined) {
    form.querySelector("#provider-name").value = entry.name;
    form.querySelector("#provider-baseurl").value = entry.baseUrl ?? "";
  } else if (prefillName !== undefined) {
    form.querySelector("#provider-name").value = prefillName; // 孤儿 key 转服务——名称预填，保存时引用同名已存密钥
  }
  form.querySelector("#provider-adapter").value = draftAdapter;
  form.querySelector("#provider-adapter").addEventListener("change", (ev) => {
    draftAdapter = ev.target.value;
  });
  // 模态内交互接线（拉取/搜索/全选/自定义模型）
  form.querySelector("#provider-fetch").addEventListener("click", () => void fetchModels(form));
  form.querySelector("#provider-model-filter").addEventListener("input", (ev) => {
    leftFilter = ev.target.value.trim();
    renderDiscoveredList();
  });
  form.querySelector("#provider-model-all").addEventListener("change", (ev) => {
    const checked = ev.target.checked;
    const visible = (discoveredModels ?? []).filter(
      (id) => leftFilter === "" || id.toLowerCase().includes(leftFilter.toLowerCase()),
    );
    for (const id of visible) {
      if (checked) addDraftModel(id);
      else draftModels = draftModels.filter((m) => m.id !== id);
    }
    renderDraftModels();
    renderDiscoveredList();
  });
  form.querySelector("#provider-add-model").addEventListener("click", () => {
    const input = form.querySelector("#provider-custom-model");
    const id = input.value.trim();
    if (id === "") {
      toast("输入模型 ID", "warn");
      return;
    }
    if (!addDraftModel(id)) {
      toast("该模型已在清单", "warn");
      return;
    }
    input.value = "";
    renderDraftModels();
    renderDiscoveredList();
  });
  openDialog({
    title: entry !== undefined ? `编辑服务：${entry.name}` : "添加服务",
    description:
      "接口地址填到根（如 https://api.example.com/v1）；拉取模型与测试连接均经 host 代理。「接口格式」= 拉取模型列表用的协议，也是各模型的缺省协议；模型卡里单独改「接口协议」对该模型的实际请求（含测试连接）生效（OpenAI 双端点 / Anthropic / Google）。此窗口仅经「取消」或「保存服务」关闭。",
    width: "max",
    className: "dialog-provider",
    dismissible: false,
    body: form,
    actions: [
      {
        label: "高级设置（请求头）",
        className: "btn",
        close: false,
        onClick: () => openHeadersDialog(),
      },
      {
        label: "测试连接",
        className: "btn",
        close: false,
        onClick: () => void runTestConnection(form),
      },
      { label: "取消", className: "btn btn-ghost" },
      { label: "保存服务", className: "btn btn-primary", onClick: () => saveProviderFromDialog(form) },
    ],
  });
  renderDiscoveredList();
  renderDraftModels();
}

// —— 左栏：拉取的模型清单（复选 = 加入 draftModels） ——

async function fetchModels(form) {
  const baseUrl = form.querySelector("#provider-baseurl").value.trim();
  const statusEl = form.querySelector("#provider-test-status");
  if (baseUrl === "") {
    toast("接口地址必填——先填地址再获取列表", "warn");
    return;
  }
  const apiKey = form.querySelector("#provider-key").value;
  const btn = form.querySelector("#provider-fetch");
  btn.disabled = true;
  statusEl.textContent = "正在获取模型列表…（经 host 代理，最长 10 秒）";
  statusEl.className = "hint probe-line";
  try {
    const envelope = await sendSettings({
      op: "provider-models",
      provider: document.getElementById("provider-name")?.value.trim() ?? editingProviderName ?? "",
      baseUrl,
      adapter: draftAdapter,
      ...(Object.keys(draftHeaders).length > 0 ? { headers: draftHeaders } : {}),
      ...(apiKey !== "" ? { apiKey } : {}),
    });
    if (form.isConnected === false) return;
    if (!envelope.ok) {
      statusEl.textContent = `获取失败：${envelope.error?.message ?? ""}`;
      statusEl.classList.add("probe-bad");
    } else {
      discoveredModels = (envelope.result.models ?? []).map((m) => m.id);
      statusEl.textContent = `已连接 · 发现 ${discoveredModels.length} 个模型（勾选加入服务）`;
      statusEl.classList.add("probe-ok");
      if (discoveredModels.length === 0) {
        toast("端点返回空清单——确认地址与协议是否正确", "warn");
      }
    }
  } finally {
    if (btn.isConnected) btn.disabled = false;
    renderDiscoveredList();
  }
}

function renderDiscoveredList() {
  const box = document.getElementById("provider-discovered");
  if (box === null) return;
  box.replaceChildren();
  if (discoveredModels === null) {
    box.appendChild(emptyState("填写地址即可获取模型列表", "「获取列表」经 host 代理请求 /models（需先填密钥或服务已存 key）"));
    return;
  }
  const visible = discoveredModels.filter((id) => leftFilter === "" || id.toLowerCase().includes(leftFilter.toLowerCase()));
  if (visible.length === 0) {
    box.appendChild(emptyState("无匹配模型", `没有 ID 含「${leftFilter}」的模型`));
    return;
  }
  for (const id of visible) {
    const line = document.createElement("label");
    line.className = "model-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = draftModels.some((m) => m.id === id);
    cb.addEventListener("change", () => {
      if (cb.checked) addDraftModel(id);
      else draftModels = draftModels.filter((m) => m.id !== id);
      renderDraftModels();
    });
    // 目录命中的模型标注参数来源（已填上下文/输出——pi-desktop 目录预填语义）
    if (catalogLookup(id) !== undefined) line.title = "内置目录已收录——勾选即自动预填上下文/输出/思考档位/能力";
    const label = document.createElement("span");
    label.className = "model-id mono";
    label.textContent = id;
    line.append(cb, label);
    box.appendChild(line);
  }
}

// —— 右栏：已选模型设置卡（协议覆盖/别名/限额/思考等级/移除） ——

function renderDraftModels() {
  const box = document.getElementById("provider-drafts");
  const count = document.getElementById("draft-count");
  if (count !== null) count.textContent = String(draftModels.length);
  if (box === null) return;
  box.replaceChildren();
  if (draftModels.length === 0) {
    box.appendChild(emptyState("尚未选择模型", "在左栏勾选，或在下方输入自定义模型 ID"));
    return;
  }
  for (const m of draftModels) {
    box.appendChild(draftModelCard(m));
  }
}

function draftModelCard(m) {
  const card = document.createElement("div");
  card.className = "model-card";
  const head = document.createElement("div");
  head.className = "model-card-head";
  const idEl = document.createElement("span");
  idEl.className = "model-id mono";
  idEl.textContent = m.id;
  idEl.title = m.id; // 截断兜底时悬浮可见全名
  head.appendChild(idEl);
  if (m.alias) {
    const a = chipEl(m.alias);
    head.appendChild(a);
  }
  // 头行 meta 短格式（pi-desktop 同款 "1M · 375k"——前缀词与思考档不进
  // 头行，长 meta 会把模型名压成省略号、× 挤下换行——用户走查实测抓漏）
  const meta = [];
  if (m.verified === true) meta.push("已实测");
  if (m.contextWindow !== undefined) meta.push(fmtTokens(m.contextWindow));
  if (m.maxOutputTokens !== undefined) meta.push(fmtTokens(m.maxOutputTokens));
  const metaEl = document.createElement("span");
  metaEl.className = "model-meta";
  metaEl.textContent = meta.join(" · ");
  if (m.verified === true) metaEl.title = "已实测——测试连接成功（真实发送过消息）";
  head.appendChild(metaEl);
  const advBtn = btnEl(advancedOpenId === m.id ? "收起" : "高级", "btn btn-icon", "模型高级设置（别名/上下文/最大输出/思考等级）");
  advBtn.addEventListener("click", () => {
    advancedOpenId = advancedOpenId === m.id ? null : m.id;
    renderDraftModels();
  });
  const delBtn = btnEl("", "btn btn-icon", "从服务移除该模型");
  delBtn.replaceChildren(icon("close", { cls: "icon-sm" }));
  delBtn.addEventListener("click", () => {
    draftModels = draftModels.filter((x) => x.id !== m.id);
    renderDraftModels();
  });
  head.append(advBtn, delBtn);
  card.appendChild(head);
  // 协议覆盖（同站混合协议——需求③：有的模型 openai、有的 anthropic）
  const body = document.createElement("div");
  body.className = "model-card-body";
  const protoLabel = document.createElement("label");
  protoLabel.className = "proto-line";
  protoLabel.append(document.createTextNode("接口协议"));
  const protoSel = document.createElement("select");
  protoSel.className = "select";
  protoSel.setAttribute("aria-label", `模型 ${m.id} 的接口协议`);
  for (const [value, label] of Object.entries(ADAPTER_LABEL)) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    protoSel.appendChild(o);
  }
  protoSel.value = m.adapter ?? draftAdapter;
  protoSel.addEventListener("change", () => {
    m.adapter = protoSel.value;
  });
  protoLabel.appendChild(protoSel);
  body.appendChild(protoLabel);
  if (advancedOpenId === m.id) body.appendChild(advancedPanel(m));
  card.appendChild(body);
  return card;
}

/** 模型高级设置面板（pi-desktop ProviderSetupDialog 展开形态——用户裁决
 *  "高级设置补全且真实可用"）：别名 / 上下文·最大输出两列（目录预填）/
 *  思考档位多选胶囊 + 默认思考等级下拉（spec.reasoning 真实进请求——openai
 *  reasoning_effort / anthropic thinking budget / google thinkingConfig，
 *  测试连接同步消费）/ 能力复选（图片/PDF/可供 AI 自动调度/原生联网搜索
 *  ——webSearch 仅 anthropic 形态真实生效）。 */
function advancedPanel(m) {
  const panel = document.createElement("div");
  panel.className = "advanced-panel";
  const infoEl = (text) => {
    const i = document.createElement("span");
    i.className = "adv-info";
    i.textContent = "?";
    i.title = text;
    return i;
  };
  const hintEl = (text) => {
    const h = document.createElement("div");
    h.className = "adv-hint";
    h.textContent = text;
    return h;
  };

  // —— 别名（显示处生效；请求仍用模型 ID） ——
  const aliasField = document.createElement("div");
  aliasField.className = "adv-field";
  const aliasHead = document.createElement("div");
  aliasHead.className = "adv-label";
  aliasHead.append(document.createTextNode("别名"), infoEl("在显示模型名称的地方生效；请求仍使用模型 ID"));
  const aliasInput = document.createElement("input");
  aliasInput.className = "input";
  aliasInput.type = "text";
  aliasInput.placeholder = "例如 fast";
  aliasInput.value = m.alias ?? "";
  aliasInput.addEventListener("input", () => {
    m.alias = aliasInput.value.trim() || undefined;
  });
  aliasField.append(aliasHead, aliasInput);
  panel.appendChild(aliasField);

  // —— 上下文窗口 | 最大输出 两列（目录预填值 + "手动修改后固定"） ——
  const grid = document.createElement("div");
  grid.className = "adv-grid2";
  const limitField = (labelText, presets, field, catalogNote) => {
    const wrap = document.createElement("div");
    wrap.className = "adv-field";
    const head = document.createElement("div");
    head.className = "adv-label";
    head.textContent = labelText;
    wrap.appendChild(head);
    const chips = document.createElement("div");
    chips.className = "preset-chips";
    const sync = () => {
      for (const b of chips.querySelectorAll(".preset-chip")) {
        b.classList.toggle("active", Number(b.dataset.value) === m[field]);
      }
    };
    for (const [label2, value] of presets) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "preset-chip";
      chip.dataset.value = String(value);
      chip.textContent = label2;
      chip.addEventListener("click", () => {
        m[field] = value;
        input.value = String(value);
        sync();
      });
      chips.appendChild(chip);
    }
    const input = document.createElement("input");
    input.className = "input input-num";
    input.type = "number";
    input.min = "1";
    input.placeholder = "自定义";
    input.value = m[field] !== undefined ? String(m[field]) : "";
    input.addEventListener("change", () => {
      const v = Number(input.value);
      m[field] = Number.isInteger(v) && v > 0 ? v : undefined;
      sync();
    });
    wrap.append(chips, input, hintEl(catalogNote));
    return wrap;
  };
  grid.append(
    limitField("上下文窗口", CTX_PRESETS, "contextWindow", "勾选时已按内置目录预填；手动修改后固定为你的值"),
    limitField("最大输出", OUT_PRESETS, "maxOutputTokens", "勾选时已按内置目录预填；手动修改后固定为你的值"),
  );
  panel.appendChild(grid);

  // —— 思考档位多选胶囊（目录标注档位优先；未标注 = 全档手动开启） ——
  const thinkField = document.createElement("div");
  thinkField.className = "adv-field";
  const thinkHead = document.createElement("div");
  thinkHead.className = "adv-label";
  thinkHead.append(
    document.createTextNode("思考等级"),
    infoEl("勾选该模型可用的思考档位；默认档随每次请求真实发送（reasoning_effort / thinking budget / thinkingConfig）"),
  );
  const thinkChips = document.createElement("div");
  thinkChips.className = "preset-chips";
  const shownLevels = m.thinkingLevels ?? [...REASONING_LEVELS];
  const ensureLevels = () => {
    if (m.thinkingLevels === undefined) m.thinkingLevels = [...shownLevels]; // 用户动过才落档
  };
  const syncThink = () => {
    for (const b of thinkChips.querySelectorAll(".preset-chip")) {
      b.classList.toggle("active", m.thinkingLevels?.includes(b.dataset.value) === true);
    }
  };
  for (const level of shownLevels) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "preset-chip";
    chip.dataset.value = level;
    chip.textContent = level;
    chip.addEventListener("click", () => {
      ensureLevels();
      const i = m.thinkingLevels.indexOf(level);
      if (i >= 0) m.thinkingLevels.splice(i, 1);
      else m.thinkingLevels.push(level);
      syncThink();
    });
    thinkChips.appendChild(chip);
  }
  syncThink();
  thinkField.append(
    thinkHead,
    thinkChips,
    hintEl(m.thinkingLevels !== undefined ? "内置目录标注的档位" : "目录未标注——已列出全部档位可手动开启"),
  );
  panel.appendChild(thinkField);

  // —— 默认思考等级下拉（off + 档位集 ∪ 现值；真实进请求） ——
  const defField = document.createElement("div");
  defField.className = "adv-field";
  const defHead = document.createElement("div");
  defHead.className = "adv-label";
  defHead.append(
    document.createTextNode("默认思考等级"),
    infoEl("随该模型每次请求真实发送（openai reasoning_effort / anthropic thinking budget / google thinkingConfig）；off = 不启用思考；测试连接同步消费"),
  );
  const defSel = document.createElement("select");
  defSel.className = "select";
  defSel.setAttribute("aria-label", `模型 ${m.id} 的默认思考等级`);
  for (const level of ["off", ...shownLevels, ...(m.reasoning !== undefined && !shownLevels.includes(m.reasoning) ? [m.reasoning] : [])]) {
    const o = document.createElement("option");
    o.value = level;
    o.textContent = level;
    defSel.appendChild(o);
  }
  defSel.value = m.reasoning ?? "off";
  defSel.addEventListener("change", () => {
    m.reasoning = defSel.value === "off" ? undefined : defSel.value;
  });
  defField.append(defHead, defSel);
  panel.appendChild(defField);

  // —— 能力复选（图片/PDF 目录预填；webSearch 仅 anthropic 形态真实生效） ——
  const capField = document.createElement("div");
  capField.className = "adv-field";
  const capHead = document.createElement("div");
  capHead.className = "adv-label";
  capHead.append(document.createTextNode("能力"));
  const capChecks = document.createElement("div");
  capChecks.className = "adv-checks";
  const capCheck = (labelText, get, set, info) => {
    const line = document.createElement("label");
    line.className = "adv-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = get() === true;
    cb.addEventListener("change", () => set(cb.checked));
    line.append(cb, document.createTextNode(labelText));
    if (info !== undefined) line.appendChild(infoEl(info));
    capChecks.appendChild(line);
    return cb;
  };
  capCheck("图片", () => m.imageInput, (v) => { m.imageInput = v; }, "模型支持图片输入（内置目录预填；发送附件时由端点裁决）");
  capCheck("PDF", () => m.pdfInput, (v) => { m.pdfInput = v; }, "模型支持 PDF 输入（内置目录预填；发送附件时由端点裁决）");
  capCheck("可供 AI 自动调度", () => m.forSubagents, (v) => { m.forSubagents = v; }, "允许 AI 在委派子任务时自动选用此模型（消费随子智能体装配面）");
  const webCb = capCheck(
    "原生联网搜索",
    () => m.webSearch,
    (v) => { m.webSearch = v; },
    undefined,
  );
  const effectiveAdapter = m.adapter ?? draftAdapter;
  if (effectiveAdapter === "anthropic") {
    webCb.title = "为该模型的请求附加 web_search server 工具（需端点实际支持；按次计费由提供商收取）";
  } else {
    webCb.disabled = true;
    webCb.checked = false;
    webCb.title = "原生联网搜索需要 Anthropic Messages 接口风格（openai chat 端点无此能力——协议下拉切到 Anthropic 后可勾）";
  }
  capField.append(capHead, capChecks);
  panel.appendChild(capField);
  return panel;
}

// —— 测试连接（真实发"你好"——成功才算可以使用） ——

async function runTestConnection(form) {
  if (testRunning) return;
  const baseUrl = form.querySelector("#provider-baseurl").value.trim();
  const apiKey = form.querySelector("#provider-key").value;
  const name = form.querySelector("#provider-name").value.trim();
  const statusEl = form.querySelector("#provider-test-status");
  const target = draftModels[0];
  if (baseUrl === "") {
    toast("接口地址必填", "warn");
    return;
  }
  if (target === undefined) {
    toast("先选择或添加至少一个模型——测试会真实发送一条消息", "warn");
    return;
  }
  testRunning = true;
  statusEl.className = "hint probe-line";
  const testAdapter = target.adapter ?? draftAdapter; // 模型级协议覆盖优先（与实际对话装配 spec.adapter ?? entry.adapter 同语义）
  statusEl.textContent = `正在连接…真实发送「你好」到 ${target.id}（${ADAPTER_LABEL[testAdapter] ?? testAdapter}，最长 20 秒）`;
  try {
    const envelope = await sendSettings({
      op: "provider-test",
      provider: name !== "" ? name : (editingProviderName ?? ""),
      baseUrl,
      adapter: testAdapter,
      modelId: target.id,
      // 默认思考档同步消费——测试连接即可验证档位真实可用
      ...(target.reasoning !== undefined && target.reasoning !== "off" ? { reasoning: target.reasoning } : {}),
      ...(Object.keys(draftHeaders).length > 0 ? { headers: draftHeaders } : {}),
      ...(apiKey !== "" ? { apiKey } : {}),
    });
    if (form.isConnected === false) return;
    const result = envelope.ok ? envelope.result : { ok: false, error: envelope.error?.message ?? "" };
    if (result.ok === true) {
      target.verified = true;
      statusEl.textContent = `已连接 · ${target.id}（${ADAPTER_LABEL[testAdapter] ?? testAdapter}）回复：「${result.reply ?? ""}」（${result.latencyMs ?? "?"}ms）——可以使用`;
      statusEl.classList.add("probe-ok");
      appendLine(`供应商测试成功：${name || editingProviderName} / ${target.id}`, "meta");
    } else {
      target.verified = false;
      statusEl.textContent = `测试失败：${result.error ?? "未知错误"}`;
      statusEl.classList.add("probe-bad");
    }
  } finally {
    testRunning = false;
    renderDraftModels();
  }
}

// —— 请求头高级设置（键值行 + 常用请求头 + 导入/复制 JSON） ——

function openHeadersDialog() {
  const holder = document.createElement("div");
  holder.innerHTML = `
  <div>
    <div class="pane-head">
      <span class="pane-title">请求头</span>
      <div class="section-tools">
        <select id="provider-header-preset" class="select">
          <option value="">添加常用请求头…</option>
          ${COMMON_HEADERS.map(([k, v]) => `<option value="${k}\u0000${v}">${k}</option>`).join("")}
        </select>
        <button id="provider-header-import" type="button" class="btn btn-icon">导入 JSON</button>
        <button id="provider-header-copy" type="button" class="btn btn-icon">复制 JSON</button>
      </div>
    </div>
    <div id="provider-header-rows"></div>
    <button id="provider-header-add" type="button" class="btn">＋ 添加请求头</button>
    <textarea id="provider-header-json" class="textarea" rows="3" placeholder='导入 JSON：{"X-Title": "aegent"}（粘贴后点导入）' hidden></textarea>
    <p class="hint">Authorization / x-api-key 等鉴权头由系统管理（自定义值会被剔除）。</p>
  </div>`;
  const root = holder.firstElementChild;
  const rowsEl = root.querySelector("#provider-header-rows");
  const renderRows = () => {
    rowsEl.replaceChildren();
    for (const [k, v] of Object.entries(draftHeaders)) {
      const row = document.createElement("div");
      row.className = "kv-row";
      const keyInput = document.createElement("input");
      keyInput.className = "input";
      keyInput.type = "text";
      keyInput.value = k;
      keyInput.placeholder = "头名";
      const valInput = document.createElement("input");
      valInput.className = "input";
      valInput.type = "text";
      valInput.value = v;
      valInput.placeholder = "值";
      const apply = () => {
        delete draftHeaders[k];
        const nk = keyInput.value.trim();
        if (nk !== "") draftHeaders[nk] = valInput.value;
        renderRows();
      };
      keyInput.addEventListener("change", apply);
      valInput.addEventListener("change", () => {
        draftHeaders[k] = valInput.value;
      });
      const delBtn = btnEl("", "btn btn-icon", "删除该请求头");
      delBtn.replaceChildren(icon("close", { cls: "icon-sm" }));
      delBtn.addEventListener("click", () => {
        delete draftHeaders[k];
        renderRows();
      });
      row.append(keyInput, valInput, delBtn);
      rowsEl.appendChild(row);
    }
    if (Object.keys(draftHeaders).length === 0) {
      rowsEl.appendChild(emptyState("无自定义请求头", "可添加常用请求头或导入 JSON"));
    }
  };
  root.querySelector("#provider-header-add").addEventListener("click", () => {
    draftHeaders["X-New-Header"] = "";
    renderRows();
  });
  root.querySelector("#provider-header-preset").addEventListener("change", (ev) => {
    const v = ev.target.value;
    if (v === "") return;
    const [k, val] = v.split("\u0000");
    draftHeaders[k] = val;
    ev.target.value = "";
    renderRows();
  });
  root.querySelector("#provider-header-import").addEventListener("click", () => {
    const ta = root.querySelector("#provider-header-json");
    if (ta.hidden) {
      ta.hidden = false;
      return;
    }
    try {
      const parsed = JSON.parse(ta.value);
      const flat = parsed?.headers !== undefined ? parsed.headers : parsed;
      for (const [k, v] of Object.entries(flat)) {
        if (typeof v === "string") draftHeaders[k] = v;
      }
      ta.hidden = true;
      renderRows();
      toast("请求头已导入", "info");
    } catch (e) {
      toast(`JSON 解析失败：${e.message}`, "warn");
    }
  });
  root.querySelector("#provider-header-copy").addEventListener("click", () => {
    void navigator.clipboard?.writeText(JSON.stringify({ headers: draftHeaders }, null, 2));
    toast("请求头 JSON 已复制", "info");
  });
  renderRows();
  openDialog({
    title: "高级设置（请求头）",
    description: "随该服务的所有模型请求发送（鉴权头除外）。",
    width: "md",
    body: root,
  });
}

// —— 保存（providers 段整体替换 + key 走凭据） ——

async function saveProviderFromDialog(form) {
  const name = form.querySelector("#provider-name").value.trim();
  const baseUrl = form.querySelector("#provider-baseurl").value.trim();
  const apiKey = form.querySelector("#provider-key").value;
  if (name === "" || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    toast("服务名必填（字母数字 . _ -，≤64 字符）", "warn");
    return;
  }
  if (baseUrl === "" || !/^https?:\/\//.test(baseUrl)) {
    toast("接口地址必填（http/https 根地址）", "warn");
    return;
  }
  if (draftModels.length === 0) {
    toast("至少选择或添加一个模型", "warn");
    return;
  }
  if (apiKey !== "") {
    const envelope = await sendSettings({ op: "credentials-set", provider: name, key: apiKey });
    if (!envelope.ok) {
      toast(`密钥保存失败：${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    // 本地凭据缓存即时同步（"未设密钥"徽标随手消散——不等奖下次打开刷新）
    credentials = credentials.filter((c) => c.name !== name);
    credentials.push({ name, masked: envelope.result.masked });
  }
  const entry = {
    name,
    baseUrl,
    models: draftModels.map((m) => ({ ...m, ...(m.adapter === draftAdapter ? { adapter: undefined } : {}) })),
    ...(draftAdapter !== "openai" ? { adapter: draftAdapter } : {}),
    ...(Object.keys(draftHeaders).length > 0 ? { headers: draftHeaders } : {}),
  };
  // 条目内 adapter 字段只在覆盖服务缺省协议时保留（undefined 序列化会被剔除——清理）
  for (const m of entry.models) {
    if (m.adapter === undefined) delete m.adapter;
  }
  const rest = (settingsCache.providers ?? []).filter((p) => p.name !== name && p.name !== editingProviderName);
  settingsCache.providers = [...rest, entry];
  if (!settingsCache.defaultProvider || settingsCache.defaultProvider === editingProviderName) {
    settingsCache.defaultProvider = name;
    settingsCache.defaultModel = draftModels[0].id;
    dirtySections.add("defaultProvider");
    dirtySections.add("defaultModel");
  }
  editingProviderName = null;
  renderProviderList();
  renderDefaultCard();
  markDirty("providers");
  toast(`服务已保存：${name}（${draftModels.length} 个模型——新会话生效）`, "info");
}

// ---------------------------------------------------------------------------
// 挂载 / 回填 / 刷新
// ---------------------------------------------------------------------------

export function bind() {
  document.getElementById("provider-add").addEventListener("click", () => openProviderDialog(undefined));
  // Profiles 切换/保存成功后的联动刷新（core 钩子——同引用注册，Set 去重）
  onSectionRefresh(refreshProvidersSection);
}

/** 凭据清单刷新（钩子目标——命名函数保证 Set 去重，多次挂载不累积）。 */
function refreshProvidersSection() {
  renderProviderList();
  renderDefaultCard();
  renderOrphanKeys();
}

// ---------------------------------------------------------------------------
// 预存密钥区（原"凭据"页并入——未被任何服务引用的 key 在此可见可删：
// 语音识别的 stt、手动预存、或服务已删但 key 留存的残留。在用 key 不重复
// 显示——tile 的"未设密钥"徽标已经表达其状态）
// ---------------------------------------------------------------------------

function renderOrphanKeys() {
  const box = document.getElementById("provider-orphan-keys");
  if (box === null) return;
  box.replaceChildren();
  const providerNames = new Set(
    (settingsCache?.providers ?? []).map((p) => p?.name).filter((n) => typeof n === "string"),
  );
  const orphans = credentials.filter(
    (c) => providerNames.has(c?.name) === false && c?.name !== undefined,
  );
  if (orphans.length === 0) return; // 无孤儿不占版面
  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = "预存密钥（未被服务引用）";
  box.appendChild(title);
  for (const meta of orphans) {
    // 与上方服务 tile 同构且功能对齐（用户裁决"不止外观，功能也要一样"）：
    // 头像座/名称/徽标/描述 + 右侧「转为服务」（名称预填、key 自动引用——
    // 补接口地址即可用）+ ⋯ 菜单（删除）；整体 muted 灰态表达未启用
    const tile = document.createElement("div");
    tile.className = "provider-tile provider-tile-muted";
    const avatar = document.createElement("span");
    avatar.className = "avatar-badge";
    avatar.textContent = (meta.name[0] ?? "?").toUpperCase();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = meta.name;
    titleEl.appendChild(chipEl(meta.name === "stt" ? "语音 STT" : "未被引用"));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = `${meta.masked ?? ""}（更新于 ${meta.updatedAt}）`;
    const copy = rowCopyEl(titleEl, descEl);
    const useBtn = btnEl("转为服务", "btn", `用预存密钥 ${meta.name} 创建服务（补接口地址即可用）`);
    useBtn.addEventListener("click", () => openProviderDialog(undefined, meta.name));
    const moreBtn = btnEl("⋯", "btn btn-icon", "更多操作");
    moreBtn.setAttribute("aria-haspopup", "menu");
    moreBtn.addEventListener("click", () => {
      openMenu(moreBtn, [
        { label: "转为服务", onClick: () => openProviderDialog(undefined, meta.name) },
        { label: "删除预存密钥", danger: true, onClick: () => void deleteOrphanKey(meta.name) },
      ]);
    });
    tile.append(avatar, copy, rowControl(useBtn, moreBtn));
    box.appendChild(tile);
  }
}

async function deleteOrphanKey(name) {
  const ok = await confirmDialog(
    name === "stt"
      ? `删除语音识别（stt）的密钥？语音功能的下一次使用将鉴权失败。`
      : `删除预存密钥「${name}」？之后添加同名服务需要重新填写 key。`,
    { title: "删除预存密钥", confirmLabel: "删除", danger: true },
  );
  if (!ok) return;
  const envelope = await sendSettings({ op: "credentials-delete", provider: name });
  if (envelope.ok) {
    toast(`凭据已删除：${name}`, "info");
    credentials = credentials.filter((c) => c.name !== name); // 本地缓存同步（不等奖下次拉取）
    renderOrphanKeys();
    renderProviderList(); // "未设密钥"徽标态随之刷新
  } else {
    toast(`删除失败：${envelope.error?.message ?? ""}`, "warn");
  }
}

export function fill() {
  renderProviderList();
  renderDefaultCard();
  renderOrphanKeys();
}

export function refreshCredentials() {
  void sendSettings({ op: "credentials-list" }).then((creds) => {
    if (creds.ok && document.getElementById("provider-list") !== null) {
      credentials = creds.result.credentials ?? [];
      renderProviderList();
      renderDefaultCard();
      renderOrphanKeys();
    }
  });
}
