use crate::{
    database::Database,
    domain::organization::{DateRule, Inbox, InboxFile},
    errors::AppResult,
};
use rusqlite::{params, OptionalExtension};

pub fn load(db: &Database) -> AppResult<(Option<Inbox>, Vec<DateRule>)> {
    db.with(|c| {
        let inbox = c.query_row("SELECT id,path,mode FROM inboxes LIMIT 1", [], |r| {
            Ok(Inbox { id:r.get(0)?,path:r.get(1)?,mode:r.get(2)? })
        }).optional()?;
        let mut statement = c.prepare("SELECT id,name,start_date,end_date,destination_path,date_source,enabled FROM date_rules ORDER BY start_date")?;
        let rows = statement.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,bool>(6)?)))?;
        let mut rules = Vec::new();
        for row in rows {
            let (id,name,start_date,end_date,destination_path,source,enabled) = row?;
            rules.push(DateRule { id,name,start_date,end_date,destination_path,date_source:serde_json::from_str(&source)?,enabled });
        }
        Ok((inbox,rules))
    })
}
pub fn save_inbox(db: &Database, inbox: &Inbox) -> AppResult<()> {
    db.with(|c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM inboxes", [])?;
        tx.execute("DELETE FROM files", [])?;
        tx.execute(
            "INSERT INTO inboxes VALUES (?1,?2,?3)",
            params![inbox.id, inbox.path, inbox.mode],
        )?;
        tx.commit()?;
        Ok(())
    })
}
pub fn save_rules(db: &Database, rules: &[DateRule]) -> AppResult<()> {
    db.with(|c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM date_rules", [])?;
        for rule in rules {
            tx.execute(
                "INSERT INTO date_rules VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    rule.id,
                    rule.name,
                    rule.start_date,
                    rule.end_date,
                    rule.destination_path,
                    serde_json::to_string(&rule.date_source)?,
                    rule.enabled
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}
pub fn update_index(db: &Database, files: &[InboxFile]) -> AppResult<()> {
    db.with(|c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM files", [])?;
        for file in files {
            tx.execute(
                "INSERT INTO files VALUES (?1,?2)",
                params![file.path, serde_json::to_string(file)?],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}
