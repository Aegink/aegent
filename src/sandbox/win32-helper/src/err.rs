//! helper 共享错误类型（main.rs / grant.rs / token.rs / spawn.rs 共用）。

#[derive(Debug)]
pub struct HelperError {
    pub code: &'static str,
    pub message: String,
}

impl HelperError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        HelperError { code, message: message.into() }
    }
}

impl std::fmt::Display for HelperError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

pub type Result<T> = std::result::Result<T, HelperError>;

/// 类型化错误码（TS 侧按此透传）。
pub const BAD_REQUEST: &str = "BAD_REQUEST";
pub const GRANT_FAILED: &str = "GRANT_FAILED";
pub const TOKEN_FAILED: &str = "TOKEN_FAILED";
pub const SPAWN_FAILED: &str = "SPAWN_FAILED";
pub const TIMEOUT: &str = "TIMEOUT";
