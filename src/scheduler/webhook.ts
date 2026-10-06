/**
 * S2 webhook 触发会话（T-P2-403）——HTTP 入站端点 → 校验 → fire-and-forget
 * 会话派发（如 GitHub 事件）。
 *
 * 锚点：dsh·packages/webhook（webhook-origin prompt admission——入站校验
 * 后派发会话的行为）；其 Cordis invariant/workspace 归属面不抄（我方单会话
 * host，payload 透传最小面）。
 *
 * 端口共存：本类不自建监听——host server 的 HTTP server 按路径分型把
 * /webhook/* 交给本处理器（handle 返回 false = 路径不归我，静态面接手）。
 *
 * 鉴权两层：①路径 token（/webhook/<token>——timingSafeEqual 恒定时间比对，
 * token 由调用方从环境变量注入，凭据零落盘——全局约束 3）；②HMAC-SHA256
 * 签名（可配 secret——`x-signature: sha256=<hex>`，对 raw body 校验）。
 *
 * fire-and-forget：入站校验通过即派发 job 并回 202（不阻塞响应等会话跑完
 * ——dsh"detached"同语义）；payload 原文进 job 的 log ring（消费方 read
 * 取用）。大小上限防呆（缺省 1MB——超限 413 拒绝，防 payloads 撑爆内存）。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { JobRegistry } from "../kernel/jobs.js";

export const WEBHOOK_PATH_PREFIX = "/webhook/";

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface WebhookEndpointOptions {
    /** 路径 token（凭据红线：环境变量注入，零落盘）。 */
    token: string;
    /** HMAC-SHA256 签名密钥（可选——提供时强制校验 x-signature）。 */
    secret?: string;
    /** payload 大小上限（字节；缺省 1MB）。 */
    maxPayloadBytes?: number;
    /** fire-and-forget 派发面（M1/M2 job 底座）。 */
    jobs: Pick<JobRegistry, "start">;
    /** 派发附加动作（如把 payload 送给会话派发——装配面注入；缺省只入 ring）。 */
    onDispatch?: (payload: unknown, jobId: string) => void;
    /**
     * 载荷形状校验（装配面注入——形状不合格回 400 WEBHOOK_PAYLOAD_INVALID
     * 而非"收下后静默丢弃"：假装受理是 C31 同族纪律的反面）。
     */
    validatePayload?: (payload: unknown) => { ok: true } | { ok: false; message: string };
}

/** 恒定时间字符串相等（防时序侧信道——凭据比对统一走这里）。 */
function timingSafeEqualStr(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

/**
 * 收 body：超上限后**丢弃内容继续收完**（不中途 destroy——那样会把响应
 * 一起断掉，客户端只见 socket error 收不到 413；上限防的是内存膨胀不是
 * 带宽），流结束后应答方回 413。
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<{ ok: true; body: Buffer } | { ok: false; reason: "too-large" }> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let tooLarge = false;
        let settled = false;
        const finish = (result: { ok: true; body: Buffer } | { ok: false; reason: "too-large" }) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        req.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
                tooLarge = true;
                chunks.length = 0; // 丢内容——内存不随 payload 涨
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (tooLarge) finish({ ok: false, reason: "too-large" });
            else finish({ ok: true, body: Buffer.concat(chunks) });
        });
        req.on("error", () => finish({ ok: false, reason: "too-large" }));
    });
}

function verifySignature(secret: string, rawBody: Buffer, header: string | string[] | undefined): boolean {
    const value = Array.isArray(header) ? header[0] : header;
    if (value === undefined || !value.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const provided = value.slice("sha256=".length);
    return timingSafeEqualStr(expected, provided);
}

export class WebhookEndpoint {
    private readonly maxPayloadBytes: number;

    constructor(private readonly options: WebhookEndpointOptions) {
        this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    }

    /**
     * 处理一次入站请求。返回 false = 路径不归本端点（调用方继续自己的
     * 路由）；返回 true = 已应答（含各鉴权/校验拒绝——响应已写完）。
     */
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith(WEBHOOK_PATH_PREFIX)) return false;
        const providedToken = url.pathname.slice(WEBHOOK_PATH_PREFIX.length);
        if (!timingSafeEqualStr(providedToken, this.options.token)) {
            res.writeHead(401).end(JSON.stringify({ error: "WEBHOOK_TOKEN_MISMATCH" }));
            return true;
        }
        if (req.method !== "POST") {
            res.writeHead(405).end(JSON.stringify({ error: "WEBHOOK_METHOD_NOT_ALLOWED" }));
            return true;
        }
        const body = await readBody(req, this.maxPayloadBytes);
        if (!body.ok) {
            res.writeHead(413).end(JSON.stringify({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" }));
            return true;
        }
        if (this.options.secret !== undefined && !verifySignature(this.options.secret, body.body, req.headers["x-signature"])) {
            res.writeHead(401).end(JSON.stringify({ error: "WEBHOOK_SIGNATURE_MISMATCH" }));
            return true;
        }
        let payload: unknown;
        try {
            payload = JSON.parse(body.body.toString("utf8"));
        } catch {
            res.writeHead(400).end(JSON.stringify({ error: "WEBHOOK_PAYLOAD_NOT_JSON" }));
            return true;
        }
        // 装配面载荷校验（C5：形状不合格回 400 而非"收下后静默丢弃"）
        if (this.options.validatePayload !== undefined) {
            const check = this.options.validatePayload(payload);
            if (!check.ok) {
                res.writeHead(400).end(JSON.stringify({ error: "WEBHOOK_PAYLOAD_INVALID", message: check.message }));
                return true;
            }
        }
        const rawText = body.body.toString("utf8");
        // fire-and-forget：入 job 后立即 202——不阻塞响应等会话执行
        const jobId = this.options.jobs.start({
            kind: "webhook",
            run: async (ctx) => {
                ctx.emit("log", rawText);
            },
        });
        this.options.onDispatch?.(payload, jobId);
        res.writeHead(202).end(JSON.stringify({ accepted: true, jobId }));
        return true;
    }
}
