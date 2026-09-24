-- 事件源 schema（E2）——分层纪律取自 cc-switch database/：schema 独立于连接代码，
-- 迁移用 PRAGMA user_version 单调推进（见 db.ts）。
--
-- 主键是 (session_id, seq) 而不是裸 seq：seq 是"会话内单调整数"（l0-events.md §3.1），
-- 全局裸 seq 主键会让第二个会话插不进来。

CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    created_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    session_id TEXT    NOT NULL REFERENCES sessions (id),
    seq        INTEGER NOT NULL,
    type       TEXT    NOT NULL,
    -- 存整事件 JSON（含 seq/ts）而非拆列：读回 JSON.parse 即得原事件，
    -- 列与载荷永不漂移；seq/type/ts 列只为查询与排序存在。
    payload    TEXT    NOT NULL,
    ts         INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events (session_id, type);
