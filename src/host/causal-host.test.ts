/**
 * W19：causal ③ host server 装配盘点复核（自 src/diagnostics/causal.test.ts 拆出
 * ——该用例指认 host/server.test.ts 的 WS e2e 覆盖，属产品仓 host 面）。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("跨组件因果链（O30）· host 面盘点复核", () => {
  it("③host server 装配 → WS 面 hello 可达：既有 e2e 用例的盘点复核（不重写）", () => {
    // 卡面定形：hello 往返已在 src/host/server.test.ts:107「WS e2e 全链：
    // hello → 租约 → prompt → 事件流（与 CLI 同一内核接线）」真实覆盖——
    // 本卡盘点复核指认在案，不重写同一因果链（重叠即复核，test-policy §3）。
    // 机内化指认：源码里该用例文本真实在位（防将来用例改名后指认悬空）。
    const serverTestPath = fileURLToPath(new URL("../host/server.test.ts", import.meta.url));
    expect(existsSync(serverTestPath)).toBe(true);
    const source = readFileSync(serverTestPath, "utf8");
    expect(source).toContain("WS e2e 全链：hello → 租约 → prompt → 事件流");
    expect(source).toContain("hello");
  });
});
