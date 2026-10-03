pub mod repositories;
use crate::errors::{AppError, AppResult};
use rusqlite::Connection;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Database(Arc<Mutex<Connection>>);

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > 2 {
            return Err(AppError::new("DATABASE_VERSION"));
        }
        if version == 0 {
            connection.execute_batch(include_str!("migrations/001-initial.sql"))?;
        }
        if version < 2 {
            connection.execute_batch(include_str!("migrations/002-workspace.sql"))?;
        }
        Ok(Self(Arc::new(Mutex::new(connection))))
    }
    pub fn with<T>(&self, work: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut connection = self.0.lock().map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        work(&mut connection)
    }
}
