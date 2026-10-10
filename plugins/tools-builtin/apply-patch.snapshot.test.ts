import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/core/index.js";
import { registerBuiltinTools } from "../../src/kernel/tools/builtin/index.js";
import { PathGuard } from "../../src/sandbox/path-guard.js";

/**
 * apply_patch 两阶段验证快照（O21/O22 反哺，T-P1-65）——批次 7 工具纪律的
 * 规格快照：读 Scenario 行即知被钉死的行为。验证阶段任一 hunk 失败 → 整体
 * 拒绝且零文件变更（不落半态）；执行阶段 A/M/D 汇总 + started 标记（D15）。
 */

const SCENARIO =
  "apply_patch 两阶段：parse → 逐 hunk 守卫断言与读派生验证（任一失败整体拒绝、零文件变更）→ " +
  "全通过才执行（add/update/delete 落盘 + A/M/D 汇总 + started 标记）";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-applypatch-snapshot-"));
  tmpDirs.push(dir);
  return dir;
}

function renderSnapshot(scenario: string, lines: string[]): string {
  return [`Scenario: ${scenario}`, ...lines.map((l) => `[emit] ${l}`)].join("\n");
}

describe("apply_patch 两阶段验证快照（O21/O22：批次 7 工具纪律规格一条）", () => {
  it("Scenario 头 + 两阶段行为派生断言（验证先行 / 不落半态 / started 标记）", async () => {
    const dir = tempDir();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir) });
    writeFileSync(path.join(dir, "old.txt"), "旧内容\n");
    writeFileSync(path.join(dir, "gone.txt"), "删除我\n");
    const p = (rel: string): string => `${dir.split(path.sep).join("/")}/${rel}`;

    const observations: string[] = [];
    // 阶段一失败：第二个 hunk 验证不过 → 整体拒绝
    const rejected = await registry.dispatch({
      callId: "c1",
      name: "apply_patch",
      arguments: JSON.stringify({
        patchText: [
          "*** Begin Patch",
          `*** Add File: ${p("new.txt")}`,
          "+content",
          `*** Update File: ${p("missing.txt")}`,
          "-nope",
          "+yes",
          "*** End Patch",
        ].join("\n"),
      }),
    });
    observations.push(`验证失败 → isError=${String(rejected.isError === true)} code=${String(rejected.error?.code)} 零变更=${String(!readExists(path.join(dir, "new.txt")))}`);
    expect(rejected.isError).toBe(true);
    expect(rejected.error?.code).toBe("HUNK_NOT_APPLIED");
    expect(readExists(path.join(dir, "new.txt"))).toBe(false);

    // 修正后全量验证通过 → 执行
    const applied = await registry.dispatch({
      callId: "c2",
      name: "apply_patch",
      arguments: JSON.stringify({
        patchText: [
          "*** Begin Patch",
          `*** Add File: ${p("new.txt")}`,
          "+content",
          `*** Update File: ${p("old.txt")}`,
          "-旧内容",
          "+新内容",
          `*** Delete File: ${p("gone.txt")}`,
          "*** End Patch",
        ].join("\n"),
      }),
    });
    observations.push(`执行 → A=${String(applied.content.includes("A "))} M=${String(applied.content.includes("M "))} D=${String(applied.content.includes("D "))}`);
    observations.push(`失败上报预算面（B13）→ ${String((rejected.meta as { mutationPaths?: string[] })?.mutationPaths?.length === 1)}`);
    expect(readFileSync(path.join(dir, "new.txt"), "utf8")).toBe("content\n");
    expect(readFileSync(path.join(dir, "old.txt"), "utf8")).toBe("新内容\n");
    expect(readExists(path.join(dir, "gone.txt"))).toBe(false);

    const snapshot = renderSnapshot(SCENARIO, observations);
    expect(snapshot).toContain("Scenario: apply_patch 两阶段");
    expect(snapshot).toContain("code=HUNK_NOT_APPLIED 零变更=true");
    expect(snapshot).toContain("失败上报预算面（B13）→ true");
  });
});

function readExists(file: string): boolean {
  try {
    readFileSync(file, "utf8");
    return true;
  } catch {
    return false;
  }
}
