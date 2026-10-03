use serde::Serialize;
use std::io;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: &'static str,
}

impl AppError {
    pub fn new(code: &'static str) -> Self {
        Self { code }
    }
}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        Self::new(match error.kind() {
            io::ErrorKind::AlreadyExists => "DESTINATION_EXISTS",
            io::ErrorKind::NotFound => "FILE_NOT_FOUND",
            io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
            io::ErrorKind::StorageFull => "DISK_FULL",
            _ if matches!(error.raw_os_error(), Some(32 | 33)) => "FILE_IN_USE",
            _ => "IO_ERROR",
        })
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("DATABASE_ERROR")
    }
}
impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        Self::new("DATABASE_ERROR")
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code)
    }
}
impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;
