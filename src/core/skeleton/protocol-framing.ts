/****************************************************************
 * agent 进程协议 · 传输帧层（T1-4 自 protocol.ts 分层——pi 形状）。
 * 职责：stdio JSON 行协议的**帧边界**（行分帧 / 行长上限）与**连接建立**
 * （EP-9 版本握手）。业务载荷形状见 protocol-payload.ts；换传输
 * （WebSocket 等非行协议）只替换本层，payload schema 不动。
 ****************************************************************/
/** 单行 JSON 行数上限（防呆，不设复杂流控；超长即协议错误）。 */
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// EP-9 协议版本握手（T1-3，pi 形状）——连接建立帧独立于业务消息联合：
// 子进程启动后首行必须发 ClientHello，父进程校验版本后回 ServerHello，
// 此后才放行业务帧（父侧缓冲握手期间的请求，保证 ack 是子侧首行）。
// 版本不匹配 / 首帧缺失 / 坏形状一律类型化拒绝（fail-closed，不降级兼容）。
// ---------------------------------------------------------------------------

/** 协议版本：wire 形状发生不兼容变更时 +1（父子同包发布，当前恒 1）。 */
export const PROTOCOL_VERSION = 1;

/** 子侧握手失败自退 exit 码（78 = EX_PROTOCOL 惯例空位；宿主可据此归因）。 */
export const EXIT_PROTOCOL_MISMATCH = 78;

/** 子 → 父首帧：连接建立声明。 */
export type ClientHello = { type: "hello"; protocolVersion: number };

/** 父 → 子首帧应答：版本协商通过，业务帧放行。 */
export type ServerHello = { type: "hello-ack"; protocolVersion: number };

/** 握手失败类型化错误（父/子双侧共用归因口径）。 */
export class ProtocolHandshakeError extends Error {
  constructor(
    readonly code:
      | "PROTOCOL_VERSION_MISMATCH"
      | "PROTOCOL_HELLO_MISSING"
      | "PROTOCOL_HELLO_MALFORMED",
    message: string,
    readonly expected?: number,
    readonly received?: number,
  ) {
    super(message);
    this.name = "ProtocolHandshakeError";
  }
}

function parseProtocolVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    // 握手阶段形状错误统一 HandshakeError（父/子 catch 按 code 归因同口径）
    throw new ProtocolHandshakeError("PROTOCOL_HELLO_MALFORMED", `protocolVersion 须为正整数，收到：${String(raw)}`);
  }
  return raw;
}

/** 解析子进程首行（ClientHello）——首帧非 hello / 坏形状即类型化拒绝。 */
export function decodeClientHello(line: string): ClientHello {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new ProtocolHandshakeError("PROTOCOL_HELLO_MALFORMED", "首行不是合法 JSON");
  }
  const type = (raw as { type?: unknown } | null)?.type;
  if (type !== "hello") {
    throw new ProtocolHandshakeError("PROTOCOL_HELLO_MISSING", `首行必须是 hello，收到 type：${String(type)}`);
  }
  return { type: "hello", protocolVersion: parseProtocolVersion((raw as { protocolVersion?: unknown }).protocolVersion) };
}

/** 解析父进程首行应答（ServerHello）——版本不匹配带 expected/received 拒绝。 */
export function decodeServerHello(line: string, expected: number = PROTOCOL_VERSION): ServerHello {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new ProtocolHandshakeError("PROTOCOL_HELLO_MALFORMED", "握手应答不是合法 JSON");
  }
  const type = (raw as { type?: unknown } | null)?.type;
  if (type !== "hello-ack") {
    throw new ProtocolHandshakeError("PROTOCOL_HELLO_MALFORMED", `握手应答须是 hello-ack，收到 type：${String(type)}`);
  }
  const received = parseProtocolVersion((raw as { protocolVersion?: unknown }).protocolVersion);
  if (received !== expected) {
    throw new ProtocolHandshakeError(
      "PROTOCOL_VERSION_MISMATCH",
      `协议版本不匹配：期望 ${expected}，子进程收到 ${received}`,
      expected,
      received,
    );
  }
  return { type: "hello-ack", protocolVersion: received };
}

/** 帧编码：值 → 单行 JSON（换传输时本函数与 createLineSplitter 成对替换）。 */
export function encodeFrame(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

/**
 * 跨 chunk 行不裂的状态机分帧器（换传输替换点：任何字节流 → 行；
 * 空行透传给 onLine，由调用方决定跳过语义）。
 */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      onLine(line);
    }
  };
}