/**
 * W19：collab-dispatch 信封白名单反例（自 src/runtime/registrations/session.test.ts
 * 拆出——该断言经 host 的 parseSettingsEnvelope，属产品仓 host 面；内核面的
 * 权限快照定死覆盖在 src/session/collaboration.test.ts 的 G4 双向用例）。
 */
import { describe, expect, it } from "vitest";

import { parseSettingsEnvelope } from "./protocol-settings.js";

describe("collab-dispatch 信封白名单（T5-2 反例）", () => {
  it("权限档不可由调用者提交：collab-dispatch 的 SettingsCall 载荷无 mode 键（信封白名单反例）", async () => {
    // T5-2 反例（验收硬点）：编排载荷若带 mode 键 → parseSettingsEnvelope
    // 整信封拒绝（未知键 fail-closed）——调用者没有任何权限提交面。
    const { parseSettingsEnvelope } = await import("./protocol-settings.js");
    const legal = parseSettingsEnvelope({
      type: "settings",
      requestId: "r1",
      op: "collab-dispatch",
      sourceSessionId: "s1",
      targetSessionId: "s2",
      kind: "task",
      content: "做点事",
      createNew: true,
      // 注意：没有 mode / permissionMode / approvalMode 键——调用者无此输入面
    });
    expect(legal.op).toBe("collab-dispatch");
    expect(() =>
      parseSettingsEnvelope({
        type: "settings",
        requestId: "r2",
        op: "collab-dispatch",
        sourceSessionId: "s1",
        targetSessionId: "s2",
        kind: "task",
        content: "做点事",
        // 越权尝试：调用者提交权限档
        mode: "auto",
      }),
    ).toThrow(/未知属性 "mode"/);
  });
});
