use crate::{database::Database, domain::workspace::*, errors::AppResult};
use rusqlite::params;

pub fn load(db: &Database) -> AppResult<Workspace> {
    db.with(|c| {
        let (id, name) = c.query_row(
            "SELECT id,name FROM workspaces WHERE id='default'",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )?;
        let roots = c
            .prepare(
                "SELECT id,path,name FROM workspace_roots WHERE workspace_id=?1 ORDER BY rowid",
            )?
            .query_map([&id], |r| {
                Ok(WorkspaceRoot {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    name: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let favorites = c
            .prepare("SELECT path FROM workspace_favorites WHERE workspace_id=?1 ORDER BY rowid")?
            .query_map([&id], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(Workspace {
            id,
            name,
            roots,
            favorites,
        })
    })
}
pub fn add(db: &Database, root: &WorkspaceRoot) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT OR IGNORE INTO workspace_roots VALUES (?1,'default',?2,?3)",
            params![root.id, root.path, root.name],
        )?;
        Ok(())
    })
}
pub fn remove(db: &Database, id: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "DELETE FROM workspace_roots WHERE id=?1 AND workspace_id='default'",
            [id],
        )?;
        Ok(())
    })
}
pub fn favorite(db: &Database, path: &str, enabled: bool) -> AppResult<()> {
    db.with(|c| {
        if enabled {
            c.execute(
                "INSERT OR IGNORE INTO workspace_favorites VALUES ('default',?1)",
                [path],
            )?;
        } else {
            c.execute(
                "DELETE FROM workspace_favorites WHERE workspace_id='default' AND path=?1",
                [path],
            )?;
        }
        Ok(())
    })
}
pub fn remap(db: &Database, from: &std::path::Path, to: &std::path::Path) -> AppResult<()> {
    let workspace = load(db)?;
    db.with(|c| {
        let tx = c.transaction()?;
        for root in &workspace.roots {
            if let Ok(relative) = std::path::Path::new(&root.path).strip_prefix(from) {
                let path = to.join(relative);
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&root.name);
                tx.execute(
                    "UPDATE workspace_roots SET path=?1,name=?2 WHERE id=?3",
                    params![
                        crate::services::access_service::path_text(&path)?,
                        name,
                        root.id
                    ],
                )?;
            }
        }
        for favorite in &workspace.favorites {
            if let Ok(relative) = std::path::Path::new(favorite).strip_prefix(from) {
                tx.execute(
                    "DELETE FROM workspace_favorites WHERE workspace_id='default' AND path=?1",
                    [favorite],
                )?;
                tx.execute(
                    "INSERT OR IGNORE INTO workspace_favorites VALUES ('default',?1)",
                    [crate::services::access_service::path_text(
                        &to.join(relative),
                    )?],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}
