import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry, type ToolDef } from "./registry.js";

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
