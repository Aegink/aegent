/**
 * 宿主会话原语测试（T5-2 / EP-1 / EP-2）：权限继承宿主侧解析（调用者无
 * mode 输入面）、打开/投递授权边界、血统与项目继承。
 */
import { describe, expect, it } from "vitest";

import {
  registerSessionPrimitives,
  type SessionLibraryPort,
} from "./session.js";

function makeLibrary(): SessionLibraryPort & { sessions: Map<string, { project?: string; origin?: string; title: string }> } {
  const sessions = new Map<string, { project?: string; origin?: string; title: string }>();
  return {
    sessions,
    createSession(id) {
      sessions.set(id, { title: "" });
    },
    getSessionProject(id) {
      return sessions.get(id)?.project;
    },
    setSessionProject(id, project) {
      const s = sessions.get(id);
      if (s) s.project = project;
    },
    setSessionOrigin(id, parent) {
      const s = sessions.get(id);
      if (s) s.origin = parent;
    },
    setTitle(id, title) {
      const s = sessions.get(id);
      if (s) s.title = title;
    },
    readSessionIndex(id) {
      return sessions.get(id) ?? null;
    },
  };
}

describe("EP-1/EP-2 宿主会话原语（T5-2）", () => {
  it("sessionCreate：血统 + 项目继承 + 权限继承宿主侧解析（调用者只给源，不给 mode）", async () => {
    const library = makeLibrary();
    library.createSession("parent");
    library.setSessionProject("parent", "proj-1");
    const inherited: Array<[string, string]> = [];
    const reg = registerSessionPrimitives({
      library,
      permissionModeOf: async (id) => (id === "parent" ? "read-only" : undefined),
      inheritPermission: (id, mode) => inherited.push([id, mode]),
    });
    const r = await reg.sessionCreate({
      parentSessionId: "parent",
      inheritPermissionFromSessionId: "parent",
      title: "协作：探针",
    });
    const row = library.sessions.get(r.sessionId)!;
    expect(row.origin).toBe("parent");
    expect(row.project).toBe("proj-1");
    expect(row.title).toBe("协作：探针");
    expect(r.inheritedMode).toBe("read-only");
    expect(inherited).toEqual([[r.sessionId, "read-only"]]);
    // 已打开清单初始为空（创建 ≠ 打开）
    expect(reg.openSessions()).toHaveLength(0);
  });

  it("EP-2 授权边界：未打开的会话投递被拒（fail-closed）；打开后放行", async () => {
    const library = makeLibrary();
    library.createSession("s1");
    const reg = registerSessionPrimitives({ library, permissionModeOf: async () => undefined });
    const denied = await reg.sessionDeliver("s1", { messageId: "m1", content: "hi" });
    expect(denied.accepted).toBe(false);
    expect(denied.reason).toContain("未打开");
    await reg.sessionOpen("s1");
    const ok = await reg.sessionDeliver("s1", { messageId: "m2", content: "hi" });
    expect(ok.accepted).toBe(true);
  });

  it("sessionOpen：不存在的会话拒绝打开（导航面真实性）", async () => {
    const library = makeLibrary();
    const reg = registerSessionPrimitives({ library, permissionModeOf: async () => undefined });
    expect(await reg.sessionOpen("ghost")).toBe(false);
  });

  it("权限档不可由调用者提交：collab-dispatch 的 SettingsCall 载荷无 mode 键（信封白名单反例）", async () => {
    // T5-2 反例（验收硬点）：编排载荷若带 mode 键 → parseSettingsEnvelope
    // 整信封拒绝（未知键 fail-closed）——调用者没有任何权限提交面。
    const { parseSettingsEnvelope } = await import("../../host/protocol-settings.js");
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
