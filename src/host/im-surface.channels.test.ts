/** T7-3 渠道注册表测试：挂载/卸载/路由解析（可裁剪语义——关渠道 = 无入站面）。 */
import { describe, expect, it } from "vitest";
import { ChannelRegistry, type ChannelRegistration } from "./im-surface.js";

const makeChannel = (id: string, route: string): ChannelRegistration => ({
  channelId: id,
  routePath: `/webhook/${route}`,
  handleWebhook: async () => true,
  deliverEvent: async () => {},
  configureCredentials: () => {},
});

describe("W12/T7-3 渠道注册表（EP-6，可裁剪）", () => {
  it("挂载后路由解析命中；卸载后 = 无该渠道入站面（关插件 = 无渠道）", () => {
    const registry = new ChannelRegistry().register(makeChannel("feishu", "feishu"));
    expect(registry.byRoutePath("/webhook/feishu/x")?.channelId).toBe("feishu");
    registry.unregister("feishu");
    expect(registry.byRoutePath("/webhook/feishu/x")).toBeUndefined();
    expect(registry.ids()).toHaveLength(0);
  });

  it("多渠道并存：按路由前缀分型", () => {
    const registry = new ChannelRegistry().register(makeChannel("feishu", "feishu")).register(makeChannel("slack", "slack"));
    expect(registry.byRoutePath("/webhook/slack/event")?.channelId).toBe("slack");
    expect(registry.ids()).toEqual(["feishu", "slack"]);
  });

  it("凭据注入接口在位（配置后注册——凭据不落代码）", () => {
    let injected = "";
    const registry = new ChannelRegistry().register({
      ...makeChannel("feishu", "feishu"),
      configureCredentials: (c) => {
        injected = c["appSecret"] ?? "";
      },
    });
    registry.get("feishu")?.configureCredentials({ appSecret: "test-secret" });
    expect(injected).toBe("test-secret");
  });
});
