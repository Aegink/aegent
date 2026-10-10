/**
 * S4 计算机使用测试（T-P2-408）——四操作 schema + 强制审批断言（无审批
 * 不执行——helper 零调用）+ unattended 恒拒 + L2 审计全落（含拒绝事实）
 * + helper 存根协议往返。
 */

import { describe, expect, it } from "vitest";

import {
    COMPUTER_OPERATIONS,
    ComputerRefusalError,
    computerExecute,
    createComputerTools,
    type ComputerUseRequest,
    type ComputerUseResponse,
} from "./computer.js";

const OK_RESPONSE: ComputerUseResponse = { ok: true, data: "done" };

describe("操作闭集与工具族形状", () => {
    it("四操作闭集（screenshot/click/type/key）", () => {
        expect([...COMPUTER_OPERATIONS]).toEqual(["screenshot", "click", "type", "key"]);
    });

    it("四工具 schema：排他执行 + 描述文件含最强审批标注", () => {
        const tools = createComputerTools({ run: async () => OK_RESPONSE });
        expect(tools.map((t) => t.name)).toEqual([
            "computer_screenshot",
            "computer_click",
            "computer_type",
            "computer_key",
        ]);
        // 排他（有屏幕副作用——fail-closed 缺省，绝不声明 parallel）
        expect(tools.every((t) => t.parallel !== true)).toBe(true);
        for (const name of ["computer_screenshot", "computer_click", "computer_type", "computer_key"]) {
            const text = readDescription(name);
            expect(text).toContain("NOTICE");
            expect(text).toContain("显式审批");
        }
    });

    function readDescription(name: string): string {
        // B2 描述与代码分离——按名读 descriptions 文件
        // eslint 不适用；直接同步读（测试环境）
        const { readFileSync } = require("node:fs") as typeof import("node:fs");
        const { join } = require("node:path") as typeof import("node:path");
        return readFileSync(join("plugins/tools-builtin/descriptions", `${name}.txt`), "utf8");
    }
});

const REQUEST: ComputerUseRequest = { operation: "click", x: 10, y: 20 };

describe("最强审批（computerExecute）", () => {

    it("无审批回调（缺省恒拒）→ 拒绝且 helper 零调用", async () => {
        let helperCalls = 0;
        await expect(
            computerExecute("c1", REQUEST, { run: async () => (helperCalls++, OK_RESPONSE) }),
        ).rejects.toBeInstanceOf(ComputerRefusalError);
        expect(helperCalls).toBe(0); // 无审批不执行
    });

    it("审批返回 false → 拒绝且 helper 零调用", async () => {
        let helperCalls = 0;
        await expect(
            computerExecute("c1", REQUEST, {
                run: async () => (helperCalls++, OK_RESPONSE),
                approve: async () => false,
            }),
        ).rejects.toMatchObject({ code: "COMPUTER_APPROVAL_DENIED" });
        expect(helperCalls).toBe(0);
    });

    it("unattended 恒拒：即使审批回调放行也拒（forced-approval 级）", async () => {
        let helperCalls = 0;
        await expect(
            computerExecute("c1", REQUEST, {
                run: async () => (helperCalls++, OK_RESPONSE),
                approve: async () => "human-1",
                isUnattended: () => true,
            }),
        ).rejects.toMatchObject({ code: "COMPUTER_UNATTENDED_DENIED" });
        expect(helperCalls).toBe(0);
    });

    it("审批通过（带 approver 标识）→ helper 执行 → 响应透传", async () => {
        const approvers: string[] = [];
        const response = await computerExecute("c1", REQUEST, {
            run: async (req) => ({ ok: true, data: `clicked ${String(req.x)},${String(req.y)}` }),
            approve: async (req) => {
                approvers.push(req.operation);
                return "human-1";
            },
        });
        expect(response).toEqual({ ok: true, data: "clicked 10,20" });
        expect(approvers).toEqual(["click"]);
    });

    it("四操作全走同一强制审批链（screenshot/type/key 每操作必过）", async () => {
        for (const operation of COMPUTER_OPERATIONS) {
            let approved = 0;
            const response = await computerExecute("c1", { operation }, {
                run: async () => OK_RESPONSE,
                approve: async () => (approved++, "human-1"),
            });
            expect(response.ok).toBe(true);
            expect(approved).toBe(1);
        }
    });
});

describe("L2 审计全落（含拒绝事实）", () => {
    it("拒绝审计：phase=denied + 请求全文", async () => {
        const records: Array<{ kind: string; phase: string; tool: string; payload: unknown }> = [];
        await computerExecute("c1", REQUEST, {
            run: async () => OK_RESPONSE,
            audit: (r) => records.push(r as never),
        }).catch(() => undefined);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ kind: "computer_use", phase: "denied", tool: "computer_click" });
        expect((records[0]?.payload as { request: ComputerUseRequest }).request).toEqual(REQUEST);
    });

    it("unattended 拒绝也审计（phase=unattended-denied）", async () => {
        const records: Array<{ phase: string; approver: string }> = [];
        await computerExecute("c1", { operation: "screenshot" }, {
            run: async () => OK_RESPONSE,
            isUnattended: () => true,
            audit: (r) => records.push(r as never),
        }).catch(() => undefined);
        expect(records).toEqual([expect.objectContaining({ phase: "unattended-denied" })]);
    });

    it("执行审计：phase=executed + approver 标识 + 结果", async () => {
        const records: Array<{ phase: string; approver: string; payload: unknown }> = [];
        await computerExecute("c1", { operation: "type", text: "hello" }, {
            run: async () => OK_RESPONSE,
            approve: async () => "human-1",
            audit: (r) => records.push(r as never),
        });
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            kind: "computer_use",
            phase: "executed",
            approver: "human-1",
            requestId: "c1",
            surface: "computer",
        });
    });
});

describe("四工具 execute 链（isError 回喂）", () => {
    it("审批拒绝 → isError 回喂（不上抛——模型可自纠语义）", async () => {
        const tools = createComputerTools({ run: async () => OK_RESPONSE });
        const click = tools[1]!;
        const result = (await click.execute({ x: 5, y: 6 } as never, { toolCallId: "c1" } as never)) as {
            isError?: boolean;
            error?: { code: string };
        };
        expect(result.isError).toBe(true);
        expect(result.error?.code).toBe("COMPUTER_APPROVAL_DENIED");
    });

    it("unattended → isError 回喂（COMPUTER_UNATTENDED_DENIED）", async () => {
        const tools = createComputerTools({
            run: async () => OK_RESPONSE,
            approve: async () => "human-1",
            isUnattended: () => true,
        });
        const shot = tools[0]!;
        const result = (await shot.execute({} as never, { toolCallId: "c1" } as never)) as {
            isError?: boolean;
            error?: { code: string };
        };
        expect(result.error?.code).toBe("COMPUTER_UNATTENDED_DENIED");
    });

    it("审批通过 → screenshot 返回形状摘要（data 进 meta）", async () => {
        const tools = createComputerTools({
            run: async () => ({ ok: true, data: "iVBORw0KGgo=" }),
            approve: async () => "human-1",
        });
        const shot = tools[0]!;
        const result = (await shot.execute({} as never, { toolCallId: "c1" } as never)) as {
            content: string;
            meta: { data: string };
        };
        expect(result.content).toContain("screenshot");
        expect(result.meta.data).toBe("iVBORw0KGgo=");
    });
});
