use crate::{
    database::repositories::workspace_repository as repo,
    domain::workspace::*,
    errors::{AppError, AppResult},
    services::{
        access_service::path_text,
        inbox_service::{validate_directory, InboxEngine},
    },
};
use std::path::Path;

pub fn restore(engine: &InboxEngine) -> AppResult<()> {
    for operation in
        crate::database::repositories::history_repository::reference_changes(&engine.db)?
    {
        super::folder_operation_service::update_references(engine, &operation, false)?;
        super::folder_operation_service::update_references(engine, &operation, true)?;
    }
    let workspace = repo::load(&engine.db)?;
    // Restore only explicit persisted grants; no recursive scan at startup.
    for root in workspace.roots {
        let _ = engine.access.grant(Path::new(&root.path));
    }
    Ok(())
}
pub fn add(engine: &InboxEngine, path: &Path) -> AppResult<Workspace> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let folder = engine.access.grant(path)?;
    validate_directory(Path::new(&folder.path))?;
    repo::add(
        &engine.db,
        &WorkspaceRoot {
            id: uuid::Uuid::new_v4().to_string(),
            path: folder.path,
            name: folder.name,
        },
    )?;
    engine.lock()?.revision += 1;
    repo::load(&engine.db)
}
pub fn remove(engine: &InboxEngine, id: &str) -> AppResult<Workspace> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let workspace = repo::load(&engine.db)?;
    if !workspace.roots.iter().any(|r| r.id == id) {
        return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
    }
    repo::remove(&engine.db, id)?;
    // Other Inbox, rule and favorite grants can share this path. Workspace mutation access
    // is checked against persisted roots separately, so removing a reference never deletes data.
    engine.lock()?.revision += 1;
    repo::load(&engine.db)
}
pub fn directory(engine: &InboxEngine, path: &Path) -> AppResult<std::path::PathBuf> {
    let workspace = repo::load(&engine.db)?;
    if !workspace.roots.iter().any(|r| path.starts_with(&r.path)) {
        return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
    }
    let (canonical, _) = engine.access.resolve(path)?;
    if canonical != path
        || !workspace
            .roots
            .iter()
            .any(|r| canonical.starts_with(&r.path))
    {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    validate_directory(&canonical)?;
    Ok(canonical)
}
pub fn favorite(engine: &InboxEngine, path: &Path, enabled: bool) -> AppResult<Workspace> {
    let canonical = directory(engine, path)?;
    repo::favorite(&engine.db, &path_text(&canonical)?, enabled)?;
    repo::load(&engine.db)
}
pub fn new_folder(engine: &InboxEngine, parent: &Path, name: &str) -> AppResult<String> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let parent = directory(engine, parent)?;
    validate_name(name)?;
    let target = parent.join(name);
    std::fs::create_dir(&target)?;
    path_text(&target)
}
pub fn validate_name(name: &str) -> AppResult<()> {
    let base = name.split('.').next().unwrap_or("").to_uppercase();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.encode_utf16().count() > 240
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
    {
        return Err(AppError::new("INVALID_NAME"));
    }
    Ok(())
}
pub fn properties(engine: &InboxEngine, path: &Path) -> AppResult<FolderProperties> {
    let path = directory(engine, path)?;
    let metadata = std::fs::metadata(&path)?;
    Ok(FolderProperties {
        path: path_text(&path)?,
        name: path
            .file_name()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .into(),
        created_at: super::move_service::millis(metadata.created()),
        modified_at: super::move_service::millis(metadata.modified()),
        accessed_at: super::move_service::millis(metadata.accessed()),
        readonly: metadata.permissions().readonly(),
    })
}
