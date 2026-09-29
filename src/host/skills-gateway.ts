/**
 * 技能管理面（U22/T-P3-125——settings-gateway 的行数纪律拆分位）：
 * 技能清单（多根扫描 + 停用过滤 + 正文回填）与编辑器写回。
 */

import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  loadSkillsFromRoots,
  skillBody,
  SKILL_FILENAME,
  SKILLS_DIR,
} from "../kernel/skills.js";
import type { SettingsShape } from "../session/settings.js";

/** 技能正文字节上限（pi-desktop·SkillEditorSheet MAX_SKILL_BYTES 同值）。 */
export const MAX_SKILL_BODY_BYTES = 128 * 1024;

/** 读 SKILL.md 并剥 frontmatter（skills-list 的编辑器回填面——读失败回空串）。 */
function readSkillBody(filePath: string): string {
  try {
    return skillBody(readFileSync(filePath, "utf8"));
  } catch {
    return "";
  }
}

export interface SkillsView {
  skills: {
    name: string;
    description: string;
    tools?: readonly string[];
    filePath: string;
    origin: string;
    body: string;
  }[];
  diagnostics: { code: string; message: string; path: string }[];
  roots: string[];
  disabled: string[];
}

/** 技能清单（多根扫描——workspace 主目录 + skills.roots 附加来源）。 */
export function listSkills(
  settings: SettingsShape,
  workspaceRoot: string,
): SkillsView {
  const disabled = settings.skills?.disabled ?? [];
  const result = loadSkillsFromRoots(workspaceRoot, settings.skills?.roots, {
    disabled,
  });
  return {
    skills: result.skills.map((s) => ({
      name: s.name,
      description: s.description,
      ...(s.tools !== undefined ? { tools: s.tools } : {}),
      filePath: s.filePath,
      origin: s.origin ?? "",
      // 正文随清单回（编辑器回填——技能清单量小，逐文件读成本可忽略；
      // 读失败如实回空串不虚构——编辑保存会整体覆盖，无注入面）
      body: readSkillBody(s.filePath),
    })),
    diagnostics: result.diagnostics,
    roots: result.roots,
    disabled: [...disabled],
  };
}

/** 技能编辑器写回（slug 双重防线 + 128KB 上限 + frontmatter 组装 + tmp 原子替换）。 */
export async function saveSkill(
  workspaceRoot: string,
  payload: { name: string; description: string; body: string; tools?: readonly string[] },
): Promise<{ saved: true; path: string }> {
  // 双重防线（parse 层已校验 slug——此处防内部绕行调用）：目录名安全 +
  // 正文字节上限（128KB——超大正文不是技能是数据，fail-closed）。
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(payload.name) || payload.name.includes("..")) {
    const error = new Error(`技能名须为 slug 形状：${payload.name}`);
    (error as unknown as { code: string }).code = "SKILL_BAD_NAME";
    throw error;
  }
  const bodyBytes = Buffer.byteLength(payload.body, "utf8");
  if (bodyBytes > MAX_SKILL_BODY_BYTES) {
    const error = new Error(`技能正文超限：${bodyBytes} 字节（上限 ${MAX_SKILL_BODY_BYTES}）`);
    (error as unknown as { code: string }).code = "SKILL_BODY_TOO_LARGE";
    throw error;
  }
  // frontmatter 组装（name/description/tools 与正文——I2 目录纪律：有
  // SKILL.md 的目录即技能；编辑 = 同名覆盖，新建 = 建目录）。
  const frontmatter = [
    "---",
    `name: ${payload.name}`,
    `description: ${payload.description.replace(/\r?\n/g, " ")}`,
    ...(payload.tools !== undefined && payload.tools.length > 0
      ? [`tools: ${payload.tools.join(", ")}`]
      : []),
    "---",
    "",
    "",
  ].join("\n");
  const dir = path.join(workspaceRoot, SKILLS_DIR, payload.name);
  const target = path.join(dir, SKILL_FILENAME);
  await mkdir(dir, { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${frontmatter}${payload.body}\n`, "utf8");
  await rename(tmp, target);
  return { saved: true, path: target };
}
