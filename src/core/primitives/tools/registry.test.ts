import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry, type ToolDef } from "./registry.js";
import { withTimeout } from "../../skeleton/timeout.js";
import { createToolLoadTool } from "../../../kernel/tools/builtin/tool-load.js";

const tmpDirs: string[] = [];
afterEach(() => {
  // 测试夹具自清理（mkdtemp 建在 os.tmpdir()，只删本测试建的目录）
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDescriptionsDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-tool-desc-"));
  tmpDirs.push(dir);
  return dir;
}

const echoDef: ToolDef = {
  name: "echo",
  execute: (args) => ({ content: JSON.stringify(args) }),
};

describe("ToolRegistry（B1 注册表）", () => {
  it("动态注册自定义工具即可被 dispatch 执行——无需改任何内核文件（验收①）", async () => {
    // ToolDef 由调用方（本测试）现场构造注册：第三方扩展面的事实证明
    const registry = new ToolRegistry();
    let executed = false;
    registry.registerTool({
      name: "echo",
      execute: (args) => {
        executed = true;
        return { content: `args.x=${String((args as { x?: number }).x)}` };
      },
    });
    const result = await registry.dispatch({
      callId: "c1",
      name: "echo",
      arguments: '{"x":42}',
    });
    expect(executed).toBe(true);
    expect(result).toEqual({ content: "args.x=42" });
    expect(result.isError).toBeUndefined();
  });

  it("重名注册立刻失败", () => {
    const registry = new ToolRegistry();
    registry.registerTool(echoDef);
    expect(() => registry.registerTool(echoDef)).toThrow(/重复注册/);
  });
});

describe("描述与代码分离（B2）", () => {
  it("描述从 descriptions/<name>.txt 按名读取；改 txt 内容后 description 变化而代码零改动（验收②）", () => {
    const dir = makeTempDescriptionsDir();
    const registry = new ToolRegistry({ descriptionsDir: dir });
    registry.registerTool(echoDef);

    writeFileSync(path.join(dir, "echo.txt"), "版本 A 的描述\n", "utf8");
    expect(registry.description("echo")).toBe("版本 A 的描述");

    // 只改 txt（带尾换行验证 trim），同一 registry 实例、同一份 .ts——
    // 本测试文件此后对 echo 的描述改动为零
    writeFileSync(path.join(dir, "echo.txt"), "版本 B 的描述\n第二行", "utf8");
    expect(registry.description("echo")).toBe("版本 B 的描述\n第二行");
  });

  it("描述文件缺失即抛（模型可见的描述不静默成空串）", () => {
    const dir = makeTempDescriptionsDir();
    const registry = new ToolRegistry({ descriptionsDir: dir });
    registry.registerTool(echoDef);
    expect(() => registry.description("echo")).toThrow(/缺少描述文件/);
    expect(() => registry.description("no-such-tool")).toThrow(/未注册/);
  });

  it("toChatTools 装配描述与缺省参数 schema（wire 必填）", () => {
    const dir = makeTempDescriptionsDir();
    writeFileSync(path.join(dir, "echo.txt"), "echo 描述", "utf8");
    const registry = new ToolRegistry({ descriptionsDir: dir });
    registry.registerTool(echoDef);
    registry.registerTool({
      name: "with-schema",
      parameters: { type: "object", properties: { p: { type: "string" } } },
      execute: () => ({ content: "" }),
    });
    writeFileSync(path.join(dir, "with-schema.txt"), "ws 描述", "utf8");
    expect(registry.toChatTools()).toEqual([
      {
        name: "echo",
        description: "echo 描述",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "with-schema",
        description: "ws 描述",
        parameters: { type: "object", properties: { p: { type: "string" } } },
      },
    ]);
  });
});

describe("dispatch 的错误分层（call/result 配平不变量）", () => {
  it("未知工具返回 isError 的 TOOL_NOT_FOUND，不上抛", async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch({
      callId: "c1",
      name: "no-such",
      arguments: "{}",
    });
    expect(result.isError).toBe(true);
    expect(result.error).toEqual({
      name: "RegistryError",
      code: "TOOL_NOT_FOUND",
    });
  });

  it("参数非合法 JSON / 非对象 → isError 的 TOOL_ARGUMENTS_INVALID，reason 回喂可自修", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(echoDef);
    for (const bad of ["not json", "[1,2]", '"str"', "null", "42"]) {
      const result = await registry.dispatch({
        callId: "c1",
        name: "echo",
        arguments: bad,
      });
      expect(result.isError, `arguments=${bad}`).toBe(true);
      expect(result.error?.code).toBe("TOOL_ARGUMENTS_INVALID");
      expect(result.content).toContain("echo");
    }
  });

  it("工具执行体崩溃 → 原样上抛（loop.dispatchTool 兜底落 TOOL_EXECUTE_FAILED）", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "boom",
      execute: () => {
        throw new Error("工具内部崩溃");
      },
    });
    await expect(
      registry.dispatch({ callId: "c1", name: "boom", arguments: "{}" }),
    ).rejects.toThrow("工具内部崩溃");
  });
});

// ---------------------------------------------------------------------------
// 工具 schema 延迟加载（F12/F14 / T-P1-17）：deferrable 占位 + tool_load 索取
// ---------------------------------------------------------------------------

describe("工具 schema 延迟加载（F12+F14 / T-P1-17）", () => {
  /** 一个带真参数面的 deferrable 工具 + 描述文件。 */
  function registerDeferred(registry: ToolRegistry, dir: string): void {
    writeFileSync(path.join(dir, "big-tool.txt"), "大工具的说明", "utf8");
    registry.registerTool({
      name: "big-tool",
      deferrable: true,
      parameters: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
      execute: () => ({ content: "ran" }),
    });
  }

  it("验收①：deferrable 工具首请求只见占位（无真 schema），非 deferrable 照旧", () => {
    const dir = makeTempDescriptionsDir();
    writeFileSync(path.join(dir, "plain.txt"), "普通工具", "utf8");
    const registry = new ToolRegistry({ descriptionsDir: dir });
    registry.registerTool({ name: "plain", execute: () => ({ content: "" }) });
    registerDeferred(registry, dir);

    const tools = registry.toChatTools();
    const plain = tools.find((t) => t.name === "plain")!;
    const deferred = tools.find((t) => t.name === "big-tool")!;
    // 普通：真 schema 原样
    expect(plain.parameters).toEqual({ type: "object", properties: {} });
    // 延迟：空 schema 占位 + 延迟标记描述，真参数面缺席
    expect(deferred.parameters).toEqual({ type: "object", properties: {} });
    expect(deferred.description).toContain("大工具的说明");
    expect(deferred.description).toContain("[deferred]");
    expect(deferred.description).toContain('tool_load(name: "big-tool")');
  });

  it("验收②：tool_load 按名索取后，后续 toChatTools 原位出现真 schema；未知名 TOOL_NOT_FOUND；非 deferrable 幂等", async () => {
    const dir = makeTempDescriptionsDir();
    writeFileSync(path.join(dir, "tool_load.txt"), "检索柄", "utf8");
    const registry = new ToolRegistry({ descriptionsDir: dir });
    registerDeferred(registry, dir);
    registry.registerTool(createToolLoadTool({ registry }));
    writeFileSync(path.join(dir, "plain.txt"), "普通工具", "utf8");
    registry.registerTool({ name: "plain", execute: () => ({ content: "" }) });

    // 索取未知名 → 类型化 isError（模型可自修）
    const missing = await registry.dispatch({ callId: "c0", name: "tool_load", arguments: '{"name":"ghost"}' });
    expect(missing.isError).toBe(true);
    expect((missing.error as { code: string }).code).toBe("TOOL_NOT_FOUND");

    // 索取成功 → 真 schema 进清单（原位替换，清单长度不变）
    const before = registry.toChatTools();
    const loaded = await registry.dispatch({ callId: "c1", name: "tool_load", arguments: '{"name":"big-tool"}' });
    expect(loaded.isError).toBeUndefined();
    expect(loaded.content).toContain("已加载");
    const after = registry.toChatTools();
    expect(after.length).toBe(before.length);
    const real = after.find((t) => t.name === "big-tool")!;
    expect(real.description).toBe("大工具的说明");
    expect(real.parameters).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    });
    // 重复索取幂等（"已在清单"语义）
    const again = await registry.dispatch({ callId: "c2", name: "tool_load", arguments: '{"name":"big-tool"}' });
    expect(again.content).toContain("已在当前工具清单");

    // 非 deferrable 工具索取 → visible 幂等，零危害
    const plainLoad = await registry.dispatch({ callId: "c3", name: "tool_load", arguments: '{"name":"plain"}' });
    expect(plainLoad.isError).toBeUndefined();
    expect(plainLoad.content).toContain("已在当前工具清单");
  });

  it("验收③：前缀稳定——其他工具的新增不动已声明占位，占位形状只从 name/描述派生", () => {
    const dirA = makeTempDescriptionsDir();
    const dirB = makeTempDescriptionsDir();
    // 两个注册表：同样的 big-tool 占位，不同的伴随工具
    const a = new ToolRegistry({ descriptionsDir: dirA });
    registerDeferred(a, dirA);
    const b = new ToolRegistry({ descriptionsDir: dirB });
    registerDeferred(b, dirB);
    writeFileSync(path.join(dirB, "extra.txt"), "额外工具", "utf8");
    b.registerTool({ name: "extra", execute: () => ({ content: "" }) });

    const placeholderA = a.toChatTools().find((t) => t.name === "big-tool")!;
    const placeholderB = b.toChatTools().find((t) => t.name === "big-tool")!;
    // 占位逐字节相等（伴随工具不同不扰动——F14 前缀稳定）
    expect(placeholderA).toEqual(placeholderB);

    // a 注册新工具后，已有条目（占位含内）不变
    writeFileSync(path.join(dirA, "late.txt"), "后注册工具", "utf8");
    const before = a.toChatTools();
    a.registerTool({ name: "late", execute: () => ({ content: "" }) });
    const after = a.toChatTools();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBe(before.length + 1);
  });
});

describe("M6 工具级超时预算（ToolDef.timeoutMs）", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => void unhandled.push(reason);
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    unhandled.length = 0;
  });

  it("声明 timeoutMs 的挂死工具：超时 → 结构化 isError 结果（code=TOOL_TIMEOUT + timeoutMs）", async () => {
    process.on("unhandledRejection", onUnhandled);
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "hang",
      timeoutMs: 30,
      execute: () => new Promise(() => {}), // 永不结算
    });
    const result = await registry.dispatch({ callId: "c1", name: "hang", arguments: "{}" });
    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({ name: "ToolTimeoutError", code: "TOOL_TIMEOUT" });
    expect(result.content).toContain("30ms");
  });

  it("超时后工具 promise 迟到结算被丢弃：零 unhandled rejection（不弃 promise 纪律）", async () => {
    process.on("unhandledRejection", onUnhandled);
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "late",
      timeoutMs: 20,
      execute: () =>
        new Promise<{ content: string }>((resolve, reject) => {
          setTimeout(() => reject(new Error("late-crash")), 80);
        }),
    });
    const result = await registry.dispatch({ callId: "c1", name: "late", arguments: "{}" });
    expect(result.error).toMatchObject({ code: "TOOL_TIMEOUT" });
    await new Promise((r) => setTimeout(r, 120));
    expect(unhandled).toEqual([]);
  });

  it("未声明 timeoutMs 的工具零行为变化（含失败透传 loop 兜底的既有路径）", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "boom",
      execute: () => {
        throw new Error("infra-crash");
      },
    });
    await expect(
      registry.dispatch({ callId: "c1", name: "boom", arguments: "{}" }),
    ).rejects.toThrow("infra-crash");
  });

  it("J22 作用域：内层自有 code 的 TimeoutError 不被外层武装误捕（原样上抛）", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "inner-timeout",
      timeoutMs: 5_000,
      execute: () =>
        withTimeout("INNER_SCOPE", 10, new Promise<string>(() => {})).then((v) => ({
          content: v,
        })),
    });
    await expect(
      registry.dispatch({ callId: "c1", name: "inner-timeout", arguments: "{}" }),
    ).rejects.toMatchObject({ code: "INNER_SCOPE" });
  });
});
