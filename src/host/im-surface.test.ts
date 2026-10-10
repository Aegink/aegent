import { describe, expect, it } from "vitest";
import { dispatchPrompt, type ImSurfaceDeps } from "./im-surface.js";
import type { HostBridge } from "./bridge.js";

type Deps = Omit<ImSurfaceDeps, "bridge"> & { bridge: Pick<HostBridge, "send"> };
const asDeps = (d: Deps): ImSurfaceDeps => d as unknown as ImSurfaceDeps;

describe("W3/T7-1 IM allowlist 四态 + 入站可建会话（P0 安全项）", () => {
  const makeDeps = (mode: string, allowlist: string[], extra: Record<string, unknown> = {}) => ({
    bridge: { send: async () => ({}), broadcastEvent: () => {} },
    sessionId: "im-session",
    surfaceId: "feishu",
    acquire: () => {},
    release: () => {},
    authorize: (principal: string | undefined, m: string, list: string[]) => {
      if (m === "disabled") return { decision: "deny", reason: "渠道已禁用（disabled）" };
      if (m === "open") return { decision: "allow" };
      if (principal === undefined || principal.trim() === "")
        return { decision: "deny", reason: "空 principal（W3：无身份不可授权）" };
      if (list.includes(principal)) return { decision: "allow" };
      if (m === "pairing") return { decision: "deny", reason: "pairing 模式：请先发送 pair <配对码> 完成绑定" };
      return { decision: "deny", reason: `principal ${principal} 不在白名单（allowlist）` };
    },
    authorizeConfig: () => ({ mode, allowlist }),
    ...extra,
  });

  it("disabled：全部拒绝（渠道下线）", async () => {
    const deps = makeDeps("disabled", []);
    await expect(dispatchPrompt(asDeps(deps as Deps), "hi", { principal: "u1" })).rejects.toThrow(/渠道已禁用/);
  });

  it("allowlist：白名单内放行；不在名单拒绝；blank principal 一律拒绝", async () => {
    const sent: unknown[] = [];
    const deps = makeDeps("allowlist", ["u-ok"], {
      bridge: { send: async (_sid: string, req: unknown) => { sent.push(req); return {}; }, broadcastEvent: () => {} },
    });
    await dispatchPrompt(asDeps(deps as Deps), "hi", { principal: "u-ok" });
    expect(sent).toHaveLength(1);
    await expect(dispatchPrompt(asDeps(deps as Deps), "hi", { principal: "u-stranger" })).rejects.toThrow(/不在白名单/);
    await expect(dispatchPrompt(asDeps(deps as Deps), "hi", { principal: undefined })).rejects.toThrow(/空 principal/);
    await expect(dispatchPrompt(asDeps(deps as Deps), "hi", { principal: "  " })).rejects.toThrow(/空 principal/);
  });

  it("pairing：非配对消息拒绝并提示握手（配对码校验在装配面）", async () => {
    const deps = makeDeps("pairing", []);
    await expect(dispatchPrompt(asDeps(deps as Deps), "hi", { principal: "u-new" })).rejects.toThrow(/pairing/);
  });

  it("未装配授权面 = 既有行为零变化（记档）", async () => {
    const sent: unknown[] = [];
    const deps = {
      bridge: { send: async (_sid: string, req: unknown) => { sent.push(req); return {}; }, broadcastEvent: () => {} },
      sessionId: "im-session", surfaceId: "feishu", acquire: () => {}, release: () => {},
    };
    await dispatchPrompt(asDeps(deps as Deps), "hi", { principal: "anyone" });
    expect(sent).toHaveLength(1);
  });

  it("入站可建会话：createNew + createInboundSession → 投递新会话", async () => {
    const sentTo: string[] = [];
    const deps = makeDeps("open", [], {
      createInboundSession: (parent: string | undefined, title: string) => `new-${title.slice(0, 4)}`,
      bridge: { send: async (sid: string, req: unknown) => { sentTo.push(sid as string); return {}; }, broadcastEvent: () => {} },
    });
    await dispatchPrompt(asDeps(deps as Deps), "帮我建个新会话做调研", { principal: "u-ok", createNew: true });
    expect(sentTo).toEqual(["new-帮我建个"]); // title 截 40 字符（前 4 字符入测试桩返回值）
  });
});
