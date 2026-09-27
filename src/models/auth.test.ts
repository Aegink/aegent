/**
 * J13/T-P1-106 验收：鉴权刷新不得改变模型身份——
 * ①resolver 每请求被调用且 header 用最新 key（轮换前后 authorization 不同）；
 * ②身份不变：两次请求的 identity 逐字节相等（结构保证的端到端断言——
 *   wire body 的 model 字段 = identity.modelId 跨刷新不变）；
 * ③resolver 抛错 → 该请求失败上抛（不吞）且 provider 可复用（下一请求重
 *   resolve）；
 * ④缺省（无 resolver）行为零变化；
 * ⑤AuthRefreshIdentityError / assertAuthIdentityUnchanged 契约面（J5 适配
 *   层的防御性调用点——形状被测试钉死）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProviderConfig } from "./config.js";
import { createOpenAiCompatProvider } from "./openai-compat.js";
import { modelIdentity } from "./identity.js";
import { assertAuthIdentityUnchanged, AuthRefreshIdentityError } from "./auth.js";
import type { AuthResolver } from "./auth.js";
import { HttpMock } from "../test-support/http-mock.js";

function wireChunk(delta: object): object {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-test",
    choices: [{ index: 0, delta, finish_reason: null }],
  };
}

describe("鉴权刷新（J13）——每请求现取 + 身份不变", () => {
  let mock: HttpMock;

  beforeEach(async () => {
    mock = new HttpMock();
    await mock.start();
  });
  afterEach(async () => {
    await mock.stop();
  });

  function makeProvider(resolver?: AuthResolver): ReturnType<typeof createOpenAiCompatProvider> {
    return createOpenAiCompatProvider(
      parseProviderConfig({
        name: "mock",
        settingsConfig: JSON.stringify({ baseUrl: mock.url("/v1"), apiKey: "sk-static" }),
      }),
      resolver !== undefined ? { authResolver: resolver } : undefined,
    );
  }

  it("验收①：resolver 每请求调用且 header 用最新 key（轮换前后不同）", async () => {
    let resolves = 0;
    const keys = ["sk-rotated-1", "sk-rotated-2"];
    const resolver: AuthResolver = {
      resolve: async () => {
        const apiKey = keys[Math.min(resolves, keys.length - 1)]!;
        resolves += 1;
        return { apiKey };
      },
    };
    const seen: string[] = [];
    // 记录每请求到达服务端的 authorization
    const provider = createOpenAiCompatProvider(
      parseProviderConfig({
        name: "mock",
        settingsConfig: JSON.stringify({ baseUrl: mock.url("/v1"), apiKey: "sk-static" }),
      }),
      { authResolver: resolver },
    );
    mock.mountSseSequence([{ events: [wireChunk({ content: "ok" })] }]);
    for await (const _ of provider.streamChat({
      identity: modelIdentity("mock", "gpt-test"),
      messages: [{ role: "user", content: "r1" }],
    })) {
      void _;
      break;
    }
    seen.push(String(mock.requests()[0]?.headers.authorization));
    mock.mountSseSequence([{ events: [wireChunk({ content: "ok" })] }]);
    for await (const _ of provider.streamChat({
      identity: modelIdentity("mock", "gpt-test"),
      messages: [{ role: "user", content: "r2" }],
    })) {
      void _;
      break;
    }
    seen.push(String(mock.requests()[1]?.headers.authorization));
    expect(resolves).toBe(2); // 每请求恰好 resolve 一次
    expect(seen).toEqual(["Bearer sk-rotated-1", "Bearer sk-rotated-2"]);
    expect(seen[0]).not.toBe(seen[1]); // 轮换生效
  });

  it("验收②：身份不变——wire body 的 model 字段跨刷新逐字节相等（结构保证的端到端断言）", async () => {
    let resolves = 0;
    const resolver: AuthResolver = {
      resolve: async () => {
        resolves += 1;
        return { apiKey: `sk-r${String(resolves)}` };
      },
    };
    const provider = makeProvider(resolver);
    mock.mountSseSequence([{ events: [wireChunk({ content: "ok" })] }]);
    for await (const _ of provider.streamChat({
      identity: modelIdentity("mock", "gpt-test"),
      messages: [{ role: "user", content: "a" }],
    })) {
      void _;
      break;
    }
    mock.mountSseSequence([{ events: [wireChunk({ content: "ok" })] }]);
    for await (const _ of provider.streamChat({
      identity: modelIdentity("mock", "gpt-test"),
      messages: [{ role: "user", content: "b" }],
    })) {
      void _;
      break;
    }
    const models = mock.requests().map((r) => {
      const body = JSON.parse(String(r.body)) as { model: string };
      return body.model;
    });
    expect(models).toEqual(["gpt-test", "gpt-test"]); // 身份跨刷新不变
  });

  it("验收③：resolver 抛错 → 该请求失败上抛且下一请求重 resolve（provider 可复用）", async () => {
    let resolves = 0;
    const resolver: AuthResolver = {
      resolve: async () => {
        resolves += 1;
        if (resolves === 1) throw new Error("密钥服务暂时不可用");
        return { apiKey: "sk-recovered" };
      },
    };
    const provider = makeProvider(resolver);
    await expect(
      (async () => {
        for await (const _ of provider.streamChat({
          identity: modelIdentity("mock", "gpt-test"),
          messages: [{ role: "user", content: "x" }],
        })) {
          void _;
        }
      })(),
    ).rejects.toThrow("密钥服务暂时不可用");
    expect(mock.requests()).toHaveLength(0); // 鉴权失败 → 请求未发出
    // 下一请求重 resolve 成功
    mock.mountSseSequence([{ events: [wireChunk({ content: "ok" })] }]);
    for await (const _ of provider.streamChat({
      identity: modelIdentity("mock", "gpt-test"),
      messages: [{ role: "user", content: "y" }],
    })) {
      void _;
      break;
    }
    expect(resolves).toBe(2);
    expect(mock.requests()[0]?.headers.authorization).toBe("Bearer sk-recovered");
  });

  it("验收④：缺省（无 resolver）→ 构造期 settings 定死（零行为变化）", async () => {
    const provider = makeProvider();
    mock.mountSseSequence([{ events: [wireChunk({ content: "ok" })] }]);
    for await (const _ of provider.streamChat({
      identity: modelIdentity("mock", "gpt-test"),
      messages: [{ role: "user", content: "hi" }],
    })) {
      void _;
      break;
    }
    expect(mock.requests()[0]?.headers.authorization).toBe("Bearer sk-static");
  });

  it("验收⑤：assertAuthIdentityUnchanged —— 身份不一致抛类型化错误（J5 契约面）", () => {
    const bound = modelIdentity("mock", "gpt-test");
    expect(() => assertAuthIdentityUnchanged(bound, modelIdentity("mock", "gpt-test"))).not.toThrow();
    expect(() => assertAuthIdentityUnchanged(bound, modelIdentity("mock", "gpt-other"))).toThrow(
      AuthRefreshIdentityError,
    );
    try {
      assertAuthIdentityUnchanged(bound, modelIdentity("other", "gpt-test"));
    } catch (e) {
      expect((e as AuthRefreshIdentityError).code).toBe("AUTH_REFRESH_IDENTITY_CHANGED");
      expect((e as AuthRefreshIdentityError).bound).toEqual(bound);
    }
  });
});
