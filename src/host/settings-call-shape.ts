/**
 * settings 信封载荷类型（自 protocol-settings.ts 拆出——行数纪律位；
 * T-P3-156 面板批触顶搬迁，字段语义注释随行）。parse 层只管信封形状——
 * 业务规则仍在 gateway 层。
 */

import type { SettingsOp } from "./protocol-settings.js";
import type { JsonRecord } from "../kernel/events.js";
import type { SkillImportItem } from "./skill-import-op.js";
import type { PromptSavePayload, SkillSavePayload } from "./settings-gateway-types.js";

export type SettingsCall = {
  op: SettingsOp;
  patch?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  provider?: string;
  key?: string;
  sessionId?: string;
  name?: string;
  command?: string;
  args?: string[];
  /**
   * op=mcp-check：server 环境变量覆盖与单请求超时（T-P3-143——行级测试
   * 与向导共用载荷，形状与 mcp[] 条目一致）。
   */
  env?: Record<string, string>;
  timeoutMs?: number;
  skill?: SkillSavePayload;
  prompt?: PromptSavePayload; // op=prompt-save：模板写回载荷（T-P3-146 C）
  expr?: string; // op=cron-add：cron 表达式（C1）
  // C10：协作族载荷（op=collab-dispatch / collab-cancel）
  sourceSessionId?: string;
  targetSessionId?: string;
  /** op=collab-dispatch：多会话编排——true = 创建真实新会话再派发
   * （targetSessionId 传 "new" 占位，host 侧创建后替换）。 */
  createNew?: boolean;
  collabId?: string;
  items?: SkillImportItem[];
  path?: string;
  target?: string;
  content?: string;
  task?: string; // op=enhancement-test：辅助任务名（T-P3-147 D 闭集）
  // T-P3-148 载荷：dir/action/template/source/marketplace/pluginDescription/view/base
  dir?: string;
  action?: string;
  template?: string;
  source?: string;
  marketplace?: string;
  pluginDescription?: string;
  view?: string;
  base?: string;
  displayName?: string; // op=plugin-scaffold：人读显示名（缺省 = slug）
  mediaType?: string;
  text?: string; // op=tts-synthesize：合成文本（T-P3-149 D 域）
  // T-P3-151 指令中心载荷：kind=追加形态（rule|text）dryRun=只推导不落盘
  // tool/ruleArgs=规则测试器的 PolicyCall 输入。
  kind?: string;
  dryRun?: boolean;
  tool?: string;
  ruleArgs?: JsonRecord;
  // T-P3-150 项目域载荷：url=仓库地址 projectId=项目 id overwrite=归属覆盖
  url?: string;
  projectId?: string;
  overwrite?: boolean;
  importItems?: { source: string; externalId: string; projectPath?: string }[];
  // T-P3-153 数据中心载荷：index=备份序号 format/redact=会话导出 domains=导出域
  index?: number;
  format?: string;
  redact?: boolean;
  domains?: string[];
  entries?: { ts?: string; level?: string; message?: string; stack?: string; source?: string }[]; // op=log-report：UI 错误批（T-P3-154）
  log?: import("./log-query.js").LogQueryFilter; // op=log-query 查询载荷（闭集在 log-query）
  /** op=provider-models / provider-test：端点自足载荷（T-P3-137——UI 草稿直传；apiKey 缺省走 credentials）。 */
  baseUrl?: string;
  adapter?: string;
  modelId?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  // T-P3-156 面板域载荷（R/P/T：git 族/终端族/辅助对话历史——cwd 为活动项目根，
  // host 侧再过项目根白名单边界；字段语义随 dispatch一一对应）
  cwd?: string;
  limit?: number; // op=assistant-log-read：历史回放条数上限
  file?: string; // op=git-diff：目标文件
  staged?: boolean; // op=git-diff：取已暂存侧差异
  files?: string[]; // op=git-stage：批量暂存文件
  unstage?: boolean; // op=git-stage：true = 取消暂存
  message?: string; // op=git-commit：提交信息
  amend?: boolean; // op=git-commit：修补上次提交
  role?: string; // op=assistant-log-append：发言侧（user|assistant，闭集在 domains 校验）
  id?: string; // op=terminal-input/terminal-resize：终端实例 id
  data?: string; // op=terminal-input：键入数据
  cols?: number; // op=terminal-resize：列数
  rows?: number; // op=terminal-resize：行数
  // T-P3-174 批次 4 载荷：confirm=WebDAV 两段式确认 seq=检查点回退目标
  confirm?: boolean;
  seq?: number;
  /** op=terminal-create：PTY 程序（T-P3-165 chat.shell 四选——批次 5 走查实抓信封缺键） */
  shell?: string;
};
