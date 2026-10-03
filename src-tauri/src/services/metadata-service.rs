use crate::{
    database::repositories::{history_repository, workspace_repository},
    domain::{
        metadata::{DateChange, MetadataRequest},
        organization::*,
    },
    errors::{AppError, AppResult},
    services::{
        access_service::path_text,
        file_date_service as dates, file_operation_service as operations,
        inbox_service::{validate_directory, InboxEngine},
        move_service,
        organizer_service::path_key,
    },
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};

fn roots(engine: &InboxEngine) -> AppResult<Vec<PathBuf>> {
    let mut paths: Vec<_> = workspace_repository::load(&engine.db)?
        .roots
        .into_iter()
        .map(|r| PathBuf::from(r.path))
        .collect();
    let state = engine.lock()?;
    paths.extend(
        state
            .rules
            .iter()
            .map(|r| PathBuf::from(&r.destination_path)),
    );
    if let Some(inbox) = &state.inbox {
        paths.push(PathBuf::from(&inbox.path));
    }
    Ok(paths)
}
fn scope(engine: &InboxEngine, path: &Path, roots: &[PathBuf]) -> AppResult<()> {
    if !roots.iter().any(|r| path.starts_with(r)) {
        return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
    }
    let canonical = dunce::canonicalize(path)?;
    if canonical != path {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    let directory = if std::fs::symlink_metadata(path)?.is_dir() {
        path
    } else {
        path.parent()
            .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?
    };
    engine.access.resolve(directory)?;
    validate_directory(directory)?;
    Ok(())
}
fn cancelled(engine: &InboxEngine) -> AppResult<()> {
    if engine.cancelled.load(Ordering::Relaxed) {
        Err(AppError::new("OPERATION_CANCELLED"))
    } else {
        Ok(())
    }
}
pub fn preview(engine: &InboxEngine, request: MetadataRequest) -> AppResult<OrganizationPlan> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    if request.paths.is_empty() || request.paths.len() > 100_000 {
        return Err(AppError::new("INVALID_TRANSFER"));
    }
    engine.cancelled.store(false, Ordering::Relaxed);
    let roots = roots(engine)?;
    let mut paths = Vec::new();
    let mut stack: Vec<_> = request.paths.iter().map(PathBuf::from).collect();
    let mut seen = HashSet::new();
    let mut unreadable = 0;
    while let Some(path) = stack.pop() {
        cancelled(engine)?;
        if !seen.insert(path_key(&path)) {
            continue;
        }
        if seen.len() > 100_000 {
            return Err(AppError::new("INVALID_TRANSFER"));
        }
        scope(engine, &path, &roots)?;
        if path
            .components()
            .any(|c| c.as_os_str() == ".metaflow-recovery")
        {
            continue;
        }
        let metadata = std::fs::symlink_metadata(&path)?;
        if metadata.is_dir() {
            validate_directory(&path)?;
            for entry in std::fs::read_dir(&path)? {
                cancelled(engine)?;
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => {
                        unreadable += 1;
                        continue;
                    }
                };
                let child = entry.path();
                if child.file_name().is_some_and(|n| n == ".metaflow-recovery") {
                    continue;
                }
                let metadata = match std::fs::symlink_metadata(&child) {
                    Ok(m) => m,
                    Err(_) => {
                        unreadable += 1;
                        continue;
                    }
                };
                if metadata.is_dir() {
                    if request.recursive && validate_directory(&child).is_ok() {
                        stack.push(child);
                    }
                } else if move_service::regular_file(&child).is_ok() {
                    stack.push(child);
                } else {
                    unreadable += 1;
                }
            }
        } else {
            move_service::regular_file(&path)?;
            paths.push(path);
        }
        if paths.len() + stack.len() > 100_000 {
            return Err(AppError::new("INVALID_TRANSFER"));
        }
    }
    paths.sort();
    let mut items = Vec::new();
    let mut identities = HashSet::new();
    for path in paths {
        cancelled(engine)?;
        let stamp = move_service::stamp(&move_service::regular_file(&path)?);
        let mut item = PlanItem {
            source_path: path_text(&path)?,
            destination_path: path_text(&path)?,
            rule_name: "Modificación = creación".into(),
            date_source: DateSource::Created,
            date_used: stamp.created_at.unwrap_or(0),
            stamp,
            conflict: false,
            action: "dates".into(),
            hash: String::new(),
            duplicates: Vec::new(),
            existing: None,
            backup: false,
            entry_kind: "file".into(),
            identity: String::new(),
            rule_id: String::new(),
            recovery_parent: None,
            required_existing: None,
            date_change: None,
            error: None,
        };
        let inspected = (|| -> AppResult<()> {
            let file = dates::open(&path)?;
            item.stamp = move_service::stamp(&file.metadata()?);
            item.date_used = item
                .stamp
                .created_at
                .ok_or_else(|| AppError::new("INVALID_DATE"))?;
            item.identity = move_service::identity(&file)?;
            let current = dates::read(&file)?;
            if current.created == 0 {
                return Err(AppError::new("INVALID_DATE"));
            }
            item.date_change = Some(DateChange {
                created_ticks: current.created.to_string(),
                modified_before_ticks: current.modified.to_string(),
                modified_after_ticks: current.created.to_string(),
            });
            if current.created == current.modified || !identities.insert(item.identity.clone()) {
                item.action = "skip".into();
            }
            Ok(())
        })();
        if let Err(error) = inspected {
            item.action = "skip".into();
            item.error = Some(error.code.into());
        }
        items.push(item);
    }
    let mut state = engine.lock()?;
    let plan = OrganizationPlan {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        items,
        unmatched_count: 0,
        revision: state.revision,
        origin: "metadata".into(),
        unreadable_count: unreadable,
    };
    state.plan = Some(plan.clone());
    Ok(plan)
}
pub fn execute(
    engine: &InboxEngine,
    id: &str,
    progress: impl Fn(BatchProgress),
) -> AppResult<Operation> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let plan = operations::take_plan(engine, id, "metadata")?;
    let roots = roots(engine)?;
    operations::execute(engine, &plan, progress, |i| {
        scope(engine, Path::new(&i.source_path), &roots)?;
        operations::source(engine, Path::new(&i.source_path))
    })
}
fn ticks(item: &HistoryItem) -> AppResult<(u64, u64, u64)> {
    let change = item
        .date_change
        .as_ref()
        .ok_or_else(|| AppError::new("INVALID_DATE"))?;
    let parse = |s: &str| s.parse::<u64>().map_err(|_| AppError::new("INVALID_DATE"));
    Ok((
        parse(&change.created_ticks)?,
        parse(&change.modified_before_ticks)?,
        parse(&change.modified_after_ticks)?,
    ))
}
fn checked_file(item: &HistoryItem, expected_modified: u64) -> AppResult<std::fs::File> {
    let path = Path::new(&item.source_path);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
    validate_directory(parent)?;
    if dunce::canonicalize(path)? != path || dunce::canonicalize(parent)? != parent {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    let file = dates::open(path)?;
    let (created, _, _) = ticks(item)?;
    let current = dates::read(&file)?;
    if file.metadata()?.len() != item.stamp.size
        || move_service::identity(&file)? != item.identity
        || current.created != created
        || current.modified != expected_modified
    {
        return Err(AppError::new("FILE_CHANGED"));
    }
    Ok(file)
}
pub fn execute_item(engine: &InboxEngine, item: &mut HistoryItem) -> AppResult<String> {
    let (_, before, after) = ticks(item)?;
    let file = checked_file(item, before)?;
    item.status = "pending".into();
    history_repository::update_item(&engine.db, item)?;
    dates::set_modified(&file, after)?;
    Ok(item.identity.clone())
}
pub fn undo_item(engine: &InboxEngine, item: &mut HistoryItem) -> AppResult<String> {
    let (_, before, after) = ticks(item)?;
    let file = checked_file(item, after)?;
    item.status = "undo-pending".into();
    item.error = None;
    history_repository::update_item(&engine.db, item)?;
    dates::set_modified(&file, before)?;
    Ok(item.identity.clone())
}
pub fn recover_item(item: &mut HistoryItem) {
    if item.status == "planned" {
        item.status = "failed".into();
        item.error = Some("INTERRUPTED_OPERATION".into());
        return;
    }
    let undo = item.status == "undo-pending";
    let result = (|| -> AppResult<bool> {
        let (_, before, after) = ticks(item)?;
        if checked_file(item, if undo { before } else { after }).is_ok() {
            return Ok(true);
        }
        checked_file(item, if undo { after } else { before })?;
        Ok(false)
    })();
    match result {
        Ok(true) => {
            item.status = if undo { "undone" } else { "completed" }.into();
            item.error = None;
        }
        Ok(false) => {
            item.status = if undo { "completed" } else { "failed" }.into();
            item.error = Some("INTERRUPTED_OPERATION".into());
        }
        Err(_) => {
            item.status = "recovery-required".into();
            item.error = Some("INTERRUPTED_OPERATION".into());
        }
    }
}
