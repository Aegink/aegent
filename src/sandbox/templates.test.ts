/**
 * 权限提示词模板测试（T-6-02 · D2）：
 * - 模板可渲染且包含命令分段说明（验收①）；
 * - 切档后渲染内容随之变化（验收②）；
 * - {{WRITABLE_ROOTS}} 注入与 PathGuard.describeWritableRoots 联测；
 * - 模板文件缺失/未知档位即抛（提示面不静默降级）。
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  APPROVAL_PROMPT_TIERS,
  renderPermissionsPrompt,
  type ApprovalPromptTier,
} from "./templates.js";
import { PathGuard } from "./path-guard.js";

const vars = { writableRoots: "F:\\aegent、C:\\tmp-allow" };

describe("approval_policy 模板（D2）", () => {
  it("两档模板文件在位且非空（形态：独立目录 + 档位文件）", () => {
    expect(APPROVAL_PROMPT_TIERS).toEqual(["on_request", "never"]);
    for (const tier of APPROVAL_PROMPT_TIERS) {
      const rendered = renderPermissionsPrompt(tier, vars);
      expect(rendered.length).toBeGreaterThan(0);
    }
  });

  it("on_request 渲染包含命令分段说明与行为纪律，占位符被替换", () => {
    const rendered = renderPermissionsPrompt("on_request", vars);
    // 分段说明（对齐 T-5-14 B 档的实际行为）
    expect(rendered).toContain("独立命令段");
    expect(rendered).toContain("`|`");
    expect(rendered).toContain("`&&`");
    expect(rendered).toContain(";` 与换行");
    expect(rendered).toContain("重定向");
    // 占位符全量替换
    expect(rendered).toContain(vars.writableRoots);
    expect(rendered).not.toContain("{{WRITABLE_ROOTS}}");
    // 危险命令示例 + 拒绝后纪律
    expect(rendered).toContain("rm -rf");
    expect(rendered).toContain("不要换着法绕过");
  });

  it("切档后系统提示内容随之变化：never 含审批不可用语义且与 on_request 互异", () => {
    const onRequest = renderPermissionsPrompt("on_request", vars);
    const never = renderPermissionsPrompt("never", vars);
    expect(never).toContain("审批通道不可用");
    expect(never).toContain("被直接拒绝");
    expect(never).not.toBe(onRequest);
    // 两档都含分段说明（never 是 on_request 的精简态）
    expect(never).toContain("独立命令段");
    expect(never).toContain(vars.writableRoots);
  });

  it("未知档位即抛（档位闭集，C16 同款纪律）", () => {
    expect(() =>
      renderPermissionsPrompt("bogus" as ApprovalPromptTier, vars),
    ).toThrow();
  });

  it("与 PathGuard 联测：describeWritableRoots 产出可注入模板（T-7-05 装配路径预演）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-tpl-"));
    try {
      const guard = PathGuard.forWorkspace(dir);
      const roots = await guard.describeWritableRoots();
      expect(roots).toContain(dir);
      const rendered = renderPermissionsPrompt("on_request", { writableRoots: roots });
      expect(rendered).toContain(roots);
      expect(rendered).not.toContain("{{WRITABLE_ROOTS}}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
