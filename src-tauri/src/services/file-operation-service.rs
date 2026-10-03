//! Shared durable executor for Inbox and Workspace. Each preview is single use.
use crate::{
    database::repositories::history_repository,
    domain::organization::*,
    errors::{AppError, AppResult},
    services::{
        access_service::path_text,
        inbox_service::{validate_directory, InboxEngine},
        move_service, organizer_service,
    },
};
use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};

pub fn recovery_path(path: &Path, id: &str) -> AppResult<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
    validate_directory(parent)?;
    let recovery = parent.join(".metaflow-recovery");
    if !recovery.try_exists()? {
        std::fs::create_dir(&recovery)?;
    }
    validate_directory(&recovery)?;
    if dunce::canonicalize(&recovery)? != recovery {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    Ok(recovery.join(id))
}
pub fn execute(
    engine: &InboxEngine,
    plan: &OrganizationPlan,
    progress: impl Fn(BatchProgress),
    validate: impl Fn(&PlanItem) -> AppResult<()>,
) -> AppResult<Operation> {
    execute_with_keeper_check(engine, plan, progress, validate, |_| Ok(()))
}
/// Additional review facts are checked while the executor holds the keeper exclusively.
pub fn execute_with_keeper_check(
    engine: &InboxEngine,
    plan: &OrganizationPlan,
    progress: impl Fn(BatchProgress),
    validate: impl Fn(&PlanItem) -> AppResult<()>,
    check_keeper: impl Fn(&File) -> AppResult<()>,
) -> AppResult<Operation> {
    engine.cancelled.store(false, Ordering::Relaxed);
    let mut operation = Operation {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "processing".into(),
        items: Vec::new(),
    };
    for planned in &plan.items {
        operation.items.push(HistoryItem {
            date_change: planned.date_change.clone(),
            id: uuid::Uuid::new_v4().to_string(),
            operation_id: operation.id.clone(),
            source_path: planned.source_path.clone(),
            destination_path: planned.destination_path.clone(),
            rule_name: planned.rule_name.clone(),
            date_source: planned.date_source.clone(),
            date_used: planned.date_used,
            stamp: planned.stamp.clone(),
            hash: planned.hash.clone(),
            identity: planned.identity.clone(),
            status: if planned.action == "skip" {
                "skipped"
            } else {
                "planned"
            }
            .into(),
            error: planned.error.clone(),
            kind: planned.action.clone(),
            undo_path: None,
            entry_kind: planned.entry_kind.clone(),
            recovery_parent: planned.recovery_parent.clone(),
        });
    }
    // The whole batch is persisted before the first filesystem mutation.
    history_repository::create(&engine.db, &operation)?;
    let total_bytes = plan
        .items
        .iter()
        .filter(|i| i.action != "skip" && i.action != "dates")
        .fold(0u64, |sum, i| sum.saturating_add(i.stamp.size));
    let mut completed_bytes = 0u64;
    progress(BatchProgress {
        completed_bytes,
        total_bytes,
        current_name: String::new(),
        operation_id: operation.id.clone(),
        completed: 0,
        total: plan.items.len(),
        phase: plan
            .items
            .iter()
            .find(|i| i.action != "skip")
            .map(|i| i.action.clone())
            .unwrap_or_else(|| "move".into()),
    });
    for (index, (item, planned)) in operation.items.iter_mut().zip(&plan.items).enumerate() {
        let current_name = Path::new(&item.source_path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        progress(BatchProgress {
            operation_id: operation.id.clone(),
            completed: index,
            total: plan.items.len(),
            phase: item.kind.clone(),
            completed_bytes,
            total_bytes,
            current_name: current_name.clone(),
        });
        if item.status == "skipped" {
        } else if engine.cancelled.load(Ordering::Relaxed) {
            item.status = "cancelled".into();
        } else {
            let result = (|| -> AppResult<String> {
                if item.entry_kind == "directory" {
                    return super::folder_operation_service::execute_item(engine, item);
                }
                if planned.backup {
                    if super::media_classification_service::is_protected_hash(
                        engine,
                        &planned.hash,
                    )? {
                        return Err(AppError::new("MEDIA_PROTECTED"));
                    }
                    let recovery = Path::new(&planned.destination_path)
                        .parent()
                        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
                    let parent = recovery
                        .parent()
                        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
                    engine.access.resolve(parent)?;
                    if !recovery.try_exists()? {
                        std::fs::create_dir(recovery)?;
                    }
                    validate_directory(recovery)?;
                }
                validate(planned)?;
                if item.kind == "dates" {
                    return super::metadata_service::execute_item(engine, item);
                }
                let _keeper = if let Some(existing) = &planned.required_existing {
                    let mut keeper = move_service::open_locked(Path::new(&existing.path), false)?;
                    if move_service::stamp(&keeper.metadata()?) != existing.stamp
                        || Some(move_service::hash(&mut keeper)?) != existing.hash
                    {
                        return Err(AppError::new("FILE_CHANGED"));
                    }
                    check_keeper(&keeper)?;
                    Some(keeper)
                } else {
                    None
                };
                let source = Path::new(&item.source_path);
                let target = Path::new(&item.destination_path);
                let parent = target
                    .parent()
                    .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
                let (resolved, _) = engine.access.resolve(parent)?;
                validate_directory(&resolved)?;
                if resolved != parent || dunce::canonicalize(source)? != source {
                    return Err(AppError::new("FOLDER_CHANGED"));
                }
                let mut file = move_service::open_locked(source, item.kind != "copy")?;
                if move_service::stamp(&file.metadata()?) != item.stamp
                    || move_service::identity(&file)? != item.identity
                    || move_service::hash(&mut file)? != item.hash
                {
                    return Err(AppError::new("FILE_CHANGED"));
                }
                // Never enter pending before the destination vacancy check: a late conflict is not a partial write.
                if target.try_exists()? {
                    return Err(AppError::new("DESTINATION_EXISTS"));
                }
                item.status = "pending".into();
                history_repository::update_item(&engine.db, item)?;
                let identity = move_service::transfer_locked(
                    source,
                    target,
                    &mut file,
                    &item.hash,
                    item.kind == "copy",
                    &|bytes| {
                        progress(BatchProgress {
                            operation_id: operation.id.clone(),
                            completed: index,
                            total: plan.items.len(),
                            phase: item.kind.clone(),
                            completed_bytes: completed_bytes.saturating_add(bytes),
                            total_bytes,
                            current_name: current_name.clone(),
                        });
                    },
                )?;
                drop(file);
                Ok(identity)
            })();
            match result {
                Ok(identity) => {
                    item.identity = identity;
                    item.status = "completed".into();
                }
                Err(error) => {
                    item.status =
                        if item.status == "pending" && Path::new(&item.destination_path).exists() {
                            "recovery-required"
                        } else {
                            "failed"
                        }
                        .into();
                    item.error = Some(error.code.into());
                    engine.log(error.code, 1);
                    if item.entry_kind == "directory" {
                        engine.cancelled.store(true, Ordering::Relaxed);
                    }
                }
            }
        }
        history_repository::update_item(&engine.db, item)?;
        if item.status == "completed" && item.kind != "dates" {
            completed_bytes = completed_bytes.saturating_add(item.stamp.size);
        }
        progress(BatchProgress {
            completed_bytes,
            total_bytes,
            current_name,
            operation_id: operation.id.clone(),
            completed: index + 1,
            total: plan.items.len(),
            phase: item.kind.clone(),
        });
    }
    operation.status = organizer_service::operation_status(&operation.items).into();
    history_repository::finish(&engine.db, &operation.id, &operation.status)?;
    Ok(operation)
}
pub fn take_plan(engine: &InboxEngine, id: &str, origin: &str) -> AppResult<OrganizationPlan> {
    let mut state = engine.lock()?;
    let plan = state
        .plan
        .take()
        .ok_or_else(|| AppError::new("PLAN_EXPIRED"))?;
    if plan.id != id
        || plan.origin != origin
        || plan.revision != state.revision
        || chrono::Utc::now().timestamp_millis() - plan.created_at > 600_000
    {
        return Err(AppError::new("PLAN_EXPIRED"));
    }
    Ok(plan)
}
pub fn source(engine: &InboxEngine, path: &Path) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
    let (resolved, _) = engine.access.resolve(parent)?;
    validate_directory(&resolved)?;
    if resolved != parent || dunce::canonicalize(path)? != path {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    move_service::regular_file(path)?;
    Ok(())
}
pub fn plan_item(
    engine: &InboxEngine,
    source: &Path,
    target: &Path,
    action: &str,
    conflict: bool,
) -> AppResult<PlanItem> {
    self::source(engine, source)?;
    let mut file = move_service::open_locked(source, false)?;
    let stamp = move_service::stamp(&file.metadata()?);
    Ok(PlanItem {
        date_change: None,
        error: None,
        source_path: path_text(source)?,
        destination_path: path_text(target)?,
        rule_name: String::new(),
        date_source: DateSource::Modified,
        date_used: stamp.modified_at.unwrap_or(0),
        stamp,
        conflict,
        action: action.into(),
        hash: move_service::hash(&mut file)?,
        identity: move_service::identity(&file)?,
        rule_id: String::new(),
        duplicates: Vec::new(),
        existing: None,
        backup: false,
        entry_kind: "file".into(),
        recovery_parent: None,
        required_existing: None,
    })
}
pub fn resolve_items(
    engine: &InboxEngine,
    base: Vec<PlanItem>,
    policy: ConflictPolicy,
    duplicate_action: &str,
    resolutions: &std::collections::BTreeMap<String, IssueResolution>,
) -> AppResult<(Vec<PlanItem>, usize)> {
    use super::{
        duplicate_service::DuplicateIndex,
        organizer_service::{available_name, path_key},
    };
    use std::collections::HashSet;
    let excluded = base
        .iter()
        .map(|i| path_key(Path::new(&i.source_path)))
        .collect();
    let mut index = DuplicateIndex::collect(engine, &excluded)?;
    let mut reserved = HashSet::new();
    let mut retired = HashSet::new();
    let mut items: Vec<PlanItem> = Vec::new();
    for mut item in base {
        let resolution = resolutions.get(&item.source_path);
        let mut policy = resolution
            .and_then(|r| r.conflict_policy.clone())
            .unwrap_or(policy.clone());
        let duplicate_action = resolution
            .and_then(|r| r.duplicate_action.as_deref())
            .unwrap_or(duplicate_action);
        if !matches!(
            duplicate_action,
            "skip" | "keep-existing" | "keep-both" | "keep-incoming" | "replace-existing"
        ) {
            return Err(AppError::new("INVALID_TRANSFER"));
        }
        item.duplicates = index
            .find(engine, &item)?
            .into_iter()
            .filter(|f| !retired.contains(&path_key(Path::new(&f.path))))
            .collect();
        for previous in &items {
            if !previous.backup && previous.action != "skip" && previous.hash == item.hash {
                item.duplicates.push(FileComparison {
                    path: previous.destination_path.clone(),
                    stamp: previous.stamp.clone(),
                    hash: Some(previous.hash.clone()),
                    planned: true,
                });
            }
        }
        let mut target = PathBuf::from(&item.destination_path);
        let exists = target.try_exists()?;
        item.conflict = exists || reserved.contains(&path_key(&target));
        item.existing = if exists {
            Some(super::duplicate_service::comparison(&target)?)
        } else {
            None
        };
        let mut backup_paths = Vec::new();
        if !item.duplicates.is_empty() {
            match duplicate_action {
                "skip" | "keep-existing" => item.action = "skip".into(),
                "keep-both" => policy = ConflictPolicy::KeepBoth,
                "keep-incoming" | "replace-existing" => {
                    if item.duplicates.iter().any(|f| f.planned) {
                        return Err(AppError::new("DUPLICATE_ACTION_UNAVAILABLE"));
                    }
                    if duplicate_action == "replace-existing" {
                        target = PathBuf::from(&item.duplicates[0].path);
                        backup_paths.push(target.clone());
                    } else {
                        backup_paths.extend(item.duplicates.iter().map(|f| PathBuf::from(&f.path)));
                    }
                }
                _ => unreachable!(),
            }
        }
        if item.action != "skip" && (target.try_exists()? || reserved.contains(&path_key(&target)))
        {
            if backup_paths.contains(&target) {
            } else {
                match policy {
                    ConflictPolicy::Skip => item.action = "skip".into(),
                    ConflictPolicy::KeepBoth => target = available_name(&target, &reserved)?,
                    ConflictPolicy::Replace => {
                        if reserved.contains(&path_key(&target)) {
                            return Err(AppError::new("TARGET_RESERVED"));
                        }
                        backup_paths.push(target.clone());
                    }
                }
            }
        }
        if item.action != "skip" {
            backup_paths.sort();
            backup_paths.dedup();
            for path in backup_paths {
                if !retired.insert(path_key(&path)) {
                    continue;
                }
                let backup_path = path
                    .parent()
                    .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?
                    .join(".metaflow-recovery")
                    .join(uuid::Uuid::new_v4().to_string());
                let mut backup = plan_item(engine, &path, &backup_path, "move", false)?;
                backup.backup = true;
                backup.rule_name = "Respaldo antes de reemplazar".into();
                items.push(backup);
            }
            reserved.insert(path_key(&target));
        }
        item.destination_path = path_text(&target)?;
        items.push(item);
    }
    Ok((items, index.unreadable))
}
