/**
 * 示例插件入口（AegentPlugin 三段式）：onActivate 领受限能力 token，
 * registerTool 登记工具，subscribe 订阅已声明的事件类型。
 */
export default {
  async onActivate(caps) {
    const prefix = typeof caps.pluginSettings.prefix === "string" ? caps.pluginSettings.prefix : "[echo] ";
    caps.registerTool({
      name: "echo",
      async execute(args) {
        const text = typeof args?.text === "string" ? args.text : "";
        return { content: prefix + text };
      },
    });
    caps.subscribe(["user/message"]);
  },
  async onEvent(event) {
    // 只收 onActivate 订阅过的类型（contributes.subscriptions 声明收紧——G）
    void event;
  },
  async onDispose() {},
};
