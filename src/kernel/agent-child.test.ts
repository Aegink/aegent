import { describe, expect, it } from "vitest";
import { resolveWorkspaceRoot } from "./agent-child.js";
import type { SettingsShape } from "../session/settings.js";

const base = { version: 1 as const, providers: [], permission: {}, sandbox: {}, appearance: { theme: "dark", language: "zh-CN" }, logging: {}, projects: [], prompts: [], mcp: [], profiles: [] };

describe("resolveWorkspaceRoot（工作区跟随项目——反馈轮九）", () => {
  const settings = (projects: unknown[], activeProject?: string): SettingsShape =>
    ({ ...base, ...(projects.length > 0 ? { projects } as never : {}), ...(activeProject !== undefined ? { activeProject } : {}) }) as never;

  it("显式 --workspace 优先", () => {
    expect(resolveWorkspaceRoot({ workspace: "F:/proj" } as never, settings([], undefined))).toBe("F:/proj");
  });

  it("activeProject 解析项目的首个 folder（id 或 name 匹配）", () => {
    const projects = [
      { id: "p-ui", name: "ui", folders: ["F:/aegent/ui"] },
      { id: "p-other", name: "other", folders: ["F:/other"] },
    ];
    expect(resolveWorkspaceRoot({} as never, settings(projects, "p-ui"))).toBe("F:/aegent/ui");
    expect(resolveWorkspaceRoot({} as never, settings(projects, "ui"))).toBe("F:/aegent/ui");
  });

  it("无 activeProject / 项目不存在 → undefined（装配落 cwd 既有语义）", () => {
    expect(resolveWorkspaceRoot({} as never, settings([], undefined))).toBeUndefined();
    expect(resolveWorkspaceRoot({} as never, settings([{ id: "p", name: "p", folders: ["F:/x"] }], "ghost"))).toBeUndefined();
  });
});
