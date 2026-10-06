import { describe, expect, it } from "vitest";

import { buildComputerScript, createWin32ComputerRun, parseKeySequence } from "./computer-win32.js";

describe("S4：SendKeys 转义与键序解析", () => {
  it("parseKeySequence：修饰符收敛 + 具名键映射 + 未知键字面透传", () => {
    expect(parseKeySequence("ctrl+c")).toBe("^c");
    expect(parseKeySequence("ctrl+shift+s")).toBe("^+s");
    expect(parseKeySequence("alt+F4")).toBe("%F4");
    expect(parseKeySequence("enter")).toBe("{ENTER}");
    expect(parseKeySequence("win+d")).toBe("#d");
    expect(parseKeySequence("ctrl+alt+delete")).toBe("^%{DEL}");
    expect(parseKeySequence("a")).toBe("a"); // 未知键字面透传
  });

  it("buildComputerScript：四操作各自的脚本形状（截图面/点击旗标/转义面）", () => {
    const shot = buildComputerScript({ operation: "screenshot" });
    expect(shot).toContain("CopyFromScreen");
    expect(shot).toContain("ToBase64String");
    const click = buildComputerScript({ operation: "click", x: 120, y: 240, button: "right" });
    expect(click).toContain("SetCursorPos(120, 240)");
    expect(click).toContain("mouse_event(8"); // RIGHTDOWN
    expect(click).toContain("mouse_event(16"); // RIGHTUP
    const type = buildComputerScript({ operation: "type", text: "a+b^c{d}" });
    expect(type).toContain("a{+}b{^}c{{}d{}}"); // SendKeys 规范转义：{{} 与 {}}
    const key = buildComputerScript({ operation: "key", key: "ctrl+p" });
    expect(key).toContain("^p");
  });
});

describe("S4 真机执行（Windows PowerShell——本机环境实测）", () => {
  it("screenshot：真实屏幕捕获返回 base64 PNG（data 面供画中画渲染）", async () => {
    const run = createWin32ComputerRun();
    const response = await run({ operation: "screenshot" });
    expect(response.ok).toBe(true);
    expect(response.data).toBeDefined();
    // PNG 魔数（base64 首字节 iVBOR）
    expect(String(response.data).startsWith("iVBOR")).toBe(true);
  }, 30_000);

  it("key：SendKeys 无害键序执行成功（无窗口聚焦副作用）", async () => {
    const run = createWin32ComputerRun();
    const response = await run({ operation: "key", key: "shift" });
    // shift 单修饰符 SendKeys 语义下按一次 shift——无副作用
    expect(response.ok).toBe(true);
  }, 30_000);
});
