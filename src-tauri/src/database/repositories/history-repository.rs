use crate::{
    database::Database,
    domain::organization::{HistoryItem, Operation},
    errors::AppResult,
};
use rusqlite::params;

pub fn create(db: &Database, operation: &Operation) -> AppResult<()> {
    db.with(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO operations VALUES (?1,?2,?3)",
            params![operation.id, operation.created_at, operation.status],
        )?;
        for (i, item) in operation.items.iter().enumerate() {
            tx.execute(
                "INSERT INTO operation_items VALUES (?1,?2,?3,?4)",
                params![
                    item.id,
                    operation.id,
                    i as i64,
                    serde_json::to_string(item)?
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}
pub fn update_item(db: &Database, item: &HistoryItem) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE operation_items SET payload=?1 WHERE id=?2",
            params![serde_json::to_string(item)?, item.id],
        )?;
        Ok(())
    })
}
pub fn finish(db: &Database, id: &str, status: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE operations SET status=?1 WHERE id=?2",
            params![status, id],
        )?;
        Ok(())
    })
}
pub fn list(db: &Database) -> AppResult<Vec<Operation>> {
    list_query(
        db,
        "SELECT id,created_at,status FROM operations ORDER BY created_at DESC LIMIT 100",
    )
}
pub fn incomplete(db: &Database) -> AppResult<Vec<Operation>> {
    list_query(db,"SELECT id,created_at,status FROM operations WHERE EXISTS (SELECT 1 FROM operation_items WHERE operation_id=operations.id AND json_extract(payload,'$.status') IN ('planned','pending','undo-pending')) ORDER BY created_at")
}
pub fn reference_changes(db: &Database) -> AppResult<Vec<Operation>> {
    list_query(db,"SELECT id,created_at,status FROM operations WHERE EXISTS (SELECT 1 FROM operation_items i WHERE i.operation_id=operations.id AND json_extract(i.payload,'$.kind')='rmdir' AND json_extract(i.payload,'$.status') IN ('completed','undone') AND NOT EXISTS (SELECT 1 FROM settings WHERE key='workspace-reference:'||i.id||':'||json_extract(i.payload,'$.status'))) ORDER BY created_at")
}
fn list_query(db: &Database, query: &str) -> AppResult<Vec<Operation>> {
    db.with(|c| {
        let mut stmt = c.prepare(query)?;
        let rows = stmt.query_map([], |r| {
            Ok(Operation {
                id: r.get(0)?,
                created_at: r.get(1)?,
                status: r.get(2)?,
                items: Vec::new(),
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            let mut operation = row?;
            let mut items = c.prepare(
                "SELECT payload FROM operation_items WHERE operation_id=?1 ORDER BY sequence",
            )?;
            let payloads = items.query_map([&operation.id], |r| r.get::<_, String>(0))?;
            for payload in payloads {
                operation.items.push(serde_json::from_str(&payload?)?);
            }
            result.push(operation);
        }
        Ok(result)
    })
}
