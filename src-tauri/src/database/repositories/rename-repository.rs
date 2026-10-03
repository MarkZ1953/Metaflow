use crate::{database::Database, domain::rename::RenameConfiguration, errors::AppResult};
use rusqlite::OptionalExtension;
pub fn load(db: &Database) -> AppResult<RenameConfiguration> {
    db.with(|c| {
        let json: Option<String> = c
            .query_row(
                "SELECT value FROM settings WHERE key='rename-configuration'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        match json {
            Some(json) => Ok(serde_json::from_str(&json)?),
            None => Ok(RenameConfiguration::default()),
        }
    })
}
pub fn save(db: &Database, configuration: &RenameConfiguration) -> AppResult<()> {
    db.with(|c|{c.execute("INSERT INTO settings VALUES ('rename-configuration',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(configuration)?])?;Ok(())})
}
