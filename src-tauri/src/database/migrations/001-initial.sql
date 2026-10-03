PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS inboxes (
  id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, mode TEXT NOT NULL CHECK(mode = 'manual')
);
CREATE TABLE IF NOT EXISTS date_rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  destination_path TEXT NOT NULL, date_source TEXT NOT NULL, enabled INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operation_items (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
  sequence INTEGER NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_items_batch ON operation_items(operation_id, sequence);
PRAGMA user_version = 1;
