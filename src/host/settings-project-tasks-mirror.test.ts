/**
 * project-tasks 镜像内存权威（T-P3-164）：
 * 1) listSessionProjects 蛇形→驼峰显式映射——归属匹配根因修的回归锚
 *    （bare-column as 驼峰断言不是转换，r.sessionId 恒 undefined，
 *    任务清单从未出过任务——走查实录）；
 * 2) projectTasksOp 的 mirror 折叠——write-behind 库滞后（turn 进行中
 *    读库恒空）时活跃会话经镜像进清单（对话中任务列表实时出现的根因修）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SqliteEventStorage } from "../session/db.js";
import { projectTasksOp } from "./settings-project-ops.js";

describe("走查：project-tasks 镜像内存权威", () => {
  it("listSessionProjects 返回驼峰键（归属匹配回归锚）", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-mirror-walk-"));
    const db = SqliteEventStorage.open({ path: path.join(tmp, "sessions.db") });
    db.setSessionProject("s-abc", "walk-project");
    const rows = db.listSessionProjects();
    expect(rows).toEqual([{ sessionId: "s-abc", projectId: "walk-project" }]);
  });

  it("turn 中（未 flush）会话经 mirror 折叠进任务清单", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-mirror-walk-"));
    const db = SqliteEventStorage.open({ path: path.join(tmp, "sessions.db") });
    db.setSessionProject("s-h1", "walk-project");
    // 库索引为空（write-behind 未排空——turn 进行中事实）
    const mirror = {
      sessionIds: () => ["s-h1"],
      load: (sid: string) =>
        sid === "s-h1"
          ? [
              { type: "turn/start", ts: 1_700_000_000_000 },
              { type: "user/message", ts: 1_700_000_000_100, message: { content: "走查任务标题——镜像折叠" } },
              { type: "step/start", ts: 1_700_000_000_200 },
            ]
          : [],
    };
    const result = projectTasksOp(db, "walk-project", mirror);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.sessionId).toBe("s-h1");
    expect(result.tasks[0]?.title).toContain("镜像折叠");
  });
});
