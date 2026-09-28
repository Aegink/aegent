/**
 * S2 webhook 测试（T-P2-403）——真实 HTTP 往返（port 0 随机——避开
 * Windows 固定端口竞争坑）：入站派发 + token/HMAC 鉴权拒绝 + 202
 * fire-and-forget + 上限防呆 + 路径不归我（false 透传）。
 */

import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JobRegistry } from "../kernel/jobs.js";
import { WEBHOOK_PATH_PREFIX, WebhookEndpoint } from "./webhook.js";

const TOKEN = "whsec-test-token-0123456789";
const SECRET = "hmac-test-secret";

let server: Server;
let baseUrl: string;
let jobs: JobRegistry;
let dispatched: Array<{ payload: unknown; jobId: string }>;
let endpoint: WebhookEndpoint;
let hmacEndpoint: WebhookEndpoint;
let hmacServer: Server;
let hmacBaseUrl: string;

beforeAll(async () => {
    jobs = new JobRegistry();
    dispatched = [];
    endpoint = new WebhookEndpoint({
        token: TOKEN,
        jobs,
        onDispatch: (payload, jobId) => dispatched.push({ payload, jobId }),
    });
    server = createServer((req, res) => {
        void endpoint.handle(req, res).then((handled) => {
            if (!handled) res.writeHead(404).end("not found");
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("监听地址异常");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const hmacJobs = new JobRegistry();
    hmacEndpoint = new WebhookEndpoint({
        token: TOKEN,
        secret: SECRET,
        jobs: hmacJobs,
        maxPayloadBytes: 1024,
    });
    hmacServer = createServer((req, res) => {
        void hmacEndpoint.handle(req, res).then((handled) => {
            if (!handled) res.writeHead(404).end("not found");
        });
    });
    await new Promise<void>((resolve) => hmacServer.listen(0, "127.0.0.1", resolve));
    const hmacAddress = hmacServer.address();
    if (hmacAddress === null || typeof hmacAddress === "string") throw new Error("监听地址异常");
    hmacBaseUrl = `http://127.0.0.1:${hmacAddress.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => hmacServer.close(() => resolve()));
});

function sign(rawBody: string): string {
    return `sha256=${createHmac("sha256", SECRET).update(Buffer.from(rawBody, "utf8")).digest("hex")}`;
}

describe("WebhookEndpoint", () => {
    it("入站派发：POST /webhook/<token> → 202 fire-and-forget + onDispatch + job 落 ring", async () => {
        const payload = { action: "opened", number: 7 };
        const res = await fetch(`${baseUrl}${WEBHOOK_PATH_PREFIX}${TOKEN}`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        expect(res.status).toBe(202);
        const body = (await res.json()) as { accepted: boolean; jobId: string };
        expect(body.accepted).toBe(true);
        expect(body.jobId).toMatch(/^webhook-/);
        // fire-and-forget：202 返回即应答（不等会话执行）——payload 经 onDispatch 可见
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]?.payload).toEqual(payload);
        const read = jobs.read(body.jobId);
        expect(read.chunks.some((c) => c.channel === "log" && c.text === JSON.stringify(payload))).toBe(true);
    });

    it("token 不匹配 → 401（timingSafe 比对）", async () => {
        const res = await fetch(`${baseUrl}${WEBHOOK_PATH_PREFIX}wrong-token`, {
            method: "POST",
            body: "{}",
        });
        expect(res.status).toBe(401);
        expect(((await res.json()) as { error: string }).error).toBe("WEBHOOK_TOKEN_MISMATCH");
        expect(dispatched).toHaveLength(1); // 零派发
    });

    it("非 POST → 405", async () => {
        const res = await fetch(`${baseUrl}${WEBHOOK_PATH_PREFIX}${TOKEN}`, { method: "GET" });
        expect(res.status).toBe(405);
    });

    it("路径不归我 → false 透传（host 静态面接手 404）", async () => {
        const res = await fetch(`${baseUrl}/some/other/path`);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("not found");
    });

    it("payload 非 JSON → 400", async () => {
        const res = await fetch(`${baseUrl}${WEBHOOK_PATH_PREFIX}${TOKEN}`, {
            method: "POST",
            body: "not-json{",
        });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe("WEBHOOK_PAYLOAD_NOT_JSON");
    });

    it("HMAC 校验通过 → 正常派发", async () => {
        const raw = JSON.stringify({ event: "push" });
        const res = await fetch(`${hmacBaseUrl}${WEBHOOK_PATH_PREFIX}${TOKEN}`, {
            method: "POST",
            body: raw,
            headers: { "x-signature": sign(raw) },
        });
        expect(res.status).toBe(202);
    });

    it("HMAC 缺失 / 错误签名 → 401", async () => {
        const raw = JSON.stringify({ event: "push" });
        const missing = await fetch(`${hmacBaseUrl}${WEBHOOK_PATH_PREFIX}${TOKEN}`, {
            method: "POST",
            body: raw,
        });
        expect(missing.status).toBe(401);
        const wrong = await fetch(`${hmacBaseUrl}${WEBHOOK_PATH_PREFIX}${TOKEN}`, {
            method: "POST",
            body: raw,
            headers: { "x-signature": `sha256=${"0".repeat(64)}` },
        });
        expect(wrong.status).toBe(401);
        expect(((await wrong.json()) as { error: string }).error).toBe("WEBHOOK_SIGNATURE_MISMATCH");
    });

    it("payload 超上限 → 413 防呆", async () => {
        const res = await fetch(`${hmacBaseUrl}${WEBHOOK_PATH_PREFIX}${TOKEN}`, {
            method: "POST",
            body: JSON.stringify({ blob: "x".repeat(2048) }),
        });
        expect(res.status).toBe(413);
        expect(((await res.json()) as { error: string }).error).toBe("WEBHOOK_PAYLOAD_TOO_LARGE");
    });
});
