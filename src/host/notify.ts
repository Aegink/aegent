/**
 * N5 推送（T-P2-405）——状态变更的分类通知面（自研无锚——行为参照本域
 * 既有 broadcast 面）。通知分型是 **wire 载荷非事件**（展卡定形：通知是
 * 端连接的投递事实，不进会话事件流——词汇表零扩展）。
 *
 * 分型闭集五类：approval_pending（审批/提问挂起——HostBridge 既有审批
 * 广播的分类归类）、turn_settled（轮结算——事件流观察）、job_settled
 * （后台 job 结算——M1/M2 面的分类源，装配桥接）、surface_changed
 * （端面进退——roster 事实的分类归类）、computer_operation（K9/T-P2-409
 * ——S4 屏幕操作的回显推送，装配方经 S4 的 notify 桥接点发布）。
 *
 * 投递两语义（N7 deliveryKind 的消费面）：push = host 主动推（经监听器
 * 即时回调——既有 notification 信封复用）；poll = 端按游标拉取（连接级
 * 环形缓冲存最近 N 条，cursor 之后未读的补投——**连接级内存存续**：
 * 断线即失，重连走 query 恢复视图补齐事件流，通知不跨连接持久——卡内
 * 定形记档）。
 */

export const NOTIFICATION_KINDS = [
    "approval_pending",
    "turn_settled",
    "job_settled",
    "surface_changed",
    "computer_operation",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** 通知载荷形状（wire 面——kind 是分型判据，data 是分类源给的细节）。 */
export interface NotificationPayload {
    readonly kind: NotificationKind;
    /** 分配序号（单调递增——poll 游标补投的定位键）。 */
    readonly seq: number;
    readonly at: number;
    readonly data?: unknown;
}

export interface NotifyHubOptions {
    /** poll 端补投缓冲容量（条数，环形——缺省 256）。 */
    bufferSize?: number;
    now?: () => number;
}

export type NotifyListener = (notification: NotificationPayload) => void;

export class NotificationHub {
    private readonly buffer: NotificationPayload[] = [];
    private readonly listeners = new Set<NotifyListener>();
    private readonly bufferSize: number;
    private readonly now: () => number;
    private seq = 0;

    constructor(options: NotifyHubOptions = {}) {
        this.bufferSize = options.bufferSize ?? 256;
        this.now = options.now ?? (() => Date.now());
    }

    /**
     * 发布一条分类通知：先入环形缓冲（poll 端补投源），再推 push 监听器
     * （即时投递——监听器异常不毒化发布方）。重复发布零去重（分型源
     * 保证——与事件流同款 append-only 纪律）。
     */
    publish(kind: NotificationKind, data?: unknown): NotificationPayload {
        if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) {
            throw new Error(`通知分型只接受 ${NOTIFICATION_KINDS.join("|")}，收到：${String(kind)}`);
        }
        const notification: NotificationPayload = {
            kind,
            seq: ++this.seq,
            at: this.now(),
            ...(data !== undefined ? { data } : {}),
        };
        this.buffer.push(notification);
        while (this.buffer.length > this.bufferSize) this.buffer.shift();
        for (const listener of this.listeners) {
            try {
                listener(notification);
            } catch {
                // push 端单监听器异常不阻断其它端
            }
        }
        return notification;
    }

    /** push 端订阅（HostBridge notification 信封的广播面复用）。 */
    subscribe(listener: NotifyListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * poll 端游标补投：返回 seq > cursor 的存量通知（游标推进由调用方
     * 以返回条目的最大 seq 表达——本面无状态推进，重放安全）。
     */
    poll(cursor: number): NotificationPayload[] {
        return this.buffer.filter((n) => n.seq > cursor);
    }

    /** 缓冲内最老存量 seq（poll 端初始游标起点——0 = 从缓冲起点全量）。 */
    oldestSeq(): number {
        return this.buffer[0]?.seq ?? this.seq;
    }
}
