use crate::{
    database::repositories::history_repository,
    domain::organization::*,
    errors::{AppError, AppResult},
    services::{
        inbox_service::{validate_directory, InboxEngine},
        move_service, organizer_service,
    },
};
use std::{
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};

pub fn undo(
    engine: &InboxEngine,
    id: &str,
    progress: impl Fn(BatchProgress),
) -> AppResult<Operation> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let mut operation = history_repository::list(&engine.db)?
        .into_iter()
        .find(|o| o.id == id)
        .ok_or_else(|| AppError::new("OPERATION_NOT_FOUND"))?;
    engine.cancelled.store(false, Ordering::Relaxed);
    let total = operation
        .items
        .iter()
        .filter(|i| i.status == "completed")
        .count();
    let total_bytes = operation
        .items
        .iter()
        .filter(|i| i.status == "completed" && i.kind != "dates")
        .fold(0u64, |sum, i| sum.saturating_add(i.stamp.size));
    let mut completed_bytes = 0u64;
    let mut completed = 0;
    for item in operation
        .items
        .iter_mut()
        .rev()
        .filter(|i| i.status == "completed")
    {
        if engine.cancelled.load(Ordering::Relaxed) {
            break;
        }
        let result = (|| -> AppResult<String> {
            if item.kind == "dates" {
                return super::metadata_service::undo_item(engine, item);
            }
            if item.entry_kind == "directory" {
                let path = if item.kind == "mkdir" {
                    Path::new(&item.destination_path)
                } else {
                    Path::new(&item.source_path)
                };
                let parent = path
                    .parent()
                    .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
                validate_directory(parent)?;
                if dunce::canonicalize(parent)? != parent {
                    return Err(AppError::new("FOLDER_CHANGED"));
                }
                if item.kind == "mkdir" {
                    if super::folder_operation_service::directory_identity(path)? != item.identity {
                        return Err(AppError::new("FOLDER_CHANGED"));
                    }
                    if std::fs::read_dir(path)?.next().is_some() {
                        return Err(AppError::new("DIRECTORY_NOT_EMPTY"));
                    }
                    item.status = "undo-pending".into();
                    history_repository::update_item(&engine.db, item)?;
                    super::folder_operation_service::remove_empty(path, &item.identity)?;
                    return Ok(item.identity.clone());
                }
                if path.try_exists()? {
                    return Err(AppError::new("DESTINATION_EXISTS"));
                }
                item.status = "undo-pending".into();
                history_repository::update_item(&engine.db, item)?;
                std::fs::create_dir(path)?;
                return super::folder_operation_service::directory_identity(path);
            }
            let from = Path::new(&item.destination_path);
            let copy_undo;
            let to = if item.kind == "copy" {
                let recovery_base = item
                    .recovery_parent
                    .as_ref()
                    .map(|p| PathBuf::from(p).join("copy-placeholder"));
                copy_undo = crate::services::file_operation_service::recovery_path(
                    recovery_base.as_deref().unwrap_or(from),
                    &item.id,
                )?;
                item.undo_path = Some(crate::services::access_service::path_text(&copy_undo)?);
                copy_undo.as_path()
            } else {
                Path::new(&item.source_path)
            };
            validate_directory(
                from.parent()
                    .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?,
            )?;
            validate_directory(
                to.parent()
                    .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?,
            )?;
            if dunce::canonicalize(from)? != from
                || dunce::canonicalize(
                    to.parent()
                        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?,
                )? != to
                    .parent()
                    .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?
            {
                return Err(AppError::new("FOLDER_CHANGED"));
            }
            if to.try_exists()? {
                return Err(AppError::new("DESTINATION_EXISTS"));
            }
            let mut file = move_service::open_locked(from, true)?;
            if move_service::stamp(&file.metadata()?) != item.stamp
                || move_service::identity(&file)? != item.identity
                || move_service::hash(&mut file)? != item.hash
            {
                return Err(AppError::new("FILE_CHANGED"));
            }
            item.status = "undo-pending".into();
            item.error = None;
            history_repository::update_item(&engine.db, item)?;
            let identity = move_service::move_locked(from, to, &mut file, &item.hash)?;
            drop(file);
            Ok(identity)
        })();
        match result {
            Ok(identity) => {
                item.identity = identity;
                item.status = "undone".into();
                item.error = None;
            }
            Err(error) => {
                item.status = if item.status == "undo-pending"
                    && Path::new(item.undo_path.as_deref().unwrap_or(&item.source_path)).exists()
                {
                    "recovery-required"
                } else {
                    "completed"
                }
                .into();
                item.error = Some(error.code.into());
                engine.log(error.code, 1);
            }
        }
        history_repository::update_item(&engine.db, item)?;
        completed += 1;
        if item.status == "undone" && item.kind != "dates" {
            completed_bytes = completed_bytes.saturating_add(item.stamp.size);
        }
        progress(BatchProgress {
            completed_bytes,
            total_bytes,
            current_name: Path::new(&item.destination_path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            operation_id: operation.id.clone(),
            completed,
            total,
            phase: "undo".into(),
        });
    }
    operation.status = organizer_service::operation_status(&operation.items).into();
    history_repository::finish(&engine.db, id, &operation.status)?;
    super::folder_operation_service::update_references(engine, &operation, true)?;
    engine.log("UNDO_FINISHED", completed);
    Ok(operation)
}

pub fn recover(engine: &InboxEngine) -> AppResult<()> {
    for mut operation in history_repository::incomplete(&engine.db)? {
        let mut changed = false;
        for item in &mut operation.items {
            if !matches!(item.status.as_str(), "planned" | "pending" | "undo-pending") {
                continue;
            }
            if item.kind == "dates" {
                super::metadata_service::recover_item(item);
                history_repository::update_item(&engine.db, item)?;
                changed = true;
                continue;
            }
            if item.entry_kind == "directory" && item.status != "planned" {
                item.status = "recovery-required".into();
                item.error = Some("INTERRUPTED_OPERATION".into());
                history_repository::update_item(&engine.db, item)?;
                changed = true;
                continue;
            }
            if item.status == "planned" {
                item.status = "failed".into();
                item.error = Some("INTERRUPTED_OPERATION".into());
                history_repository::update_item(&engine.db, item)?;
                changed = true;
                continue;
            }
            let undo = item.status == "undo-pending";
            let (from, to) = if undo {
                (
                    &item.destination_path,
                    item.undo_path.as_ref().unwrap_or(&item.source_path),
                )
            } else {
                (&item.source_path, &item.destination_path)
            };
            let (Ok(source_exists), Ok(target_exists)) =
                (Path::new(from).try_exists(), Path::new(to).try_exists())
            else {
                item.status = "recovery-required".into();
                item.error = Some("INTERRUPTED_OPERATION".into());
                history_repository::update_item(&engine.db, item)?;
                changed = true;
                continue;
            };
            if target_exists && (!source_exists || (!undo && item.kind == "copy")) {
                let target = Path::new(to);
                let checked = (|| -> AppResult<String> {
                    let mut file = move_service::open_locked(target, false)?;
                    if move_service::stamp(&file.metadata()?) != item.stamp
                        || move_service::hash(&mut file)? != item.hash
                    {
                        return Err(AppError::new("FILE_CHANGED"));
                    }
                    move_service::identity(&file)
                })();
                match checked {
                    Ok(identity) => {
                        item.identity = identity;
                        item.status = if undo { "undone" } else { "completed" }.into();
                        item.error = None;
                    }
                    Err(_) => {
                        item.status = "recovery-required".into();
                        item.error = Some("INTERRUPTED_OPERATION".into());
                    }
                }
            } else if source_exists && !target_exists {
                item.status = if undo { "completed" } else { "failed" }.into();
                item.error = Some("INTERRUPTED_OPERATION".into());
            } else {
                item.status = "recovery-required".into();
                item.error = Some("INTERRUPTED_OPERATION".into());
            }
            history_repository::update_item(&engine.db, item)?;
            changed = true;
        }
        if changed {
            operation.status = organizer_service::operation_status(&operation.items).into();
            history_repository::finish(&engine.db, &operation.id, &operation.status)?;
            engine.log("JOURNAL_RECOVERED", 1);
        }
    }
    Ok(())
}
