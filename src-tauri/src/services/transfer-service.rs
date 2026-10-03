use crate::{
    database::repositories::workspace_repository,
    domain::{organization::*, workspace::TransferRequest},
    errors::{AppError, AppResult},
    services::{
        file_operation_service as operations, folder_operation_service as folders,
        inbox_service::InboxEngine,
        organizer_service::{available_name, path_key},
        workspace_service,
    },
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};
pub fn preview(engine: &InboxEngine, request: TransferRequest) -> AppResult<OrganizationPlan> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    if request.sources.is_empty()
        || request.sources.len() > 10_000
        || !matches!(request.mode.as_str(), "move" | "copy")
        || (request.folder_name.is_some() && request.sources.len() != 1)
    {
        return Err(AppError::new("INVALID_TRANSFER"));
    }
    let parent = workspace_service::directory(engine, Path::new(&request.destination))?;
    let workspace = workspace_repository::load(&engine.db)?;
    let configuration = crate::database::repositories::rename_repository::load(&engine.db)?;
    let preset = request
        .preset_id
        .as_ref()
        .map(|id| {
            configuration
                .presets
                .iter()
                .find(|p| &p.id == id)
                .ok_or_else(|| AppError::new("INVALID_PRESET"))
        })
        .transpose()?;
    engine
        .cancelled
        .store(false, std::sync::atomic::Ordering::Relaxed);
    let mut seen = HashSet::new();
    let mut selected_dirs: Vec<PathBuf> = Vec::new();
    let mut reserved = HashSet::new();
    let mut directories = Vec::new();
    let mut removals = Vec::new();
    let mut skipped = Vec::new();
    let mut pairs = Vec::new();
    let mut sources = request.sources.clone();
    sources.sort_by_key(|s| Path::new(s).components().count());
    for source in sources {
        let source = PathBuf::from(source);
        if !workspace.roots.iter().any(|r| source.starts_with(&r.path)) {
            return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
        }
        if !seen.insert(path_key(&source)) || selected_dirs.iter().any(|p| source.starts_with(p)) {
            continue;
        }
        let mut target = parent.join(
            source
                .file_name()
                .ok_or_else(|| AppError::new("INVALID_NAME"))?,
        );
        if std::fs::symlink_metadata(&source)?.is_dir() {
            workspace_service::directory(engine, &source)?;
            if request.mode == "move" {
                folders::protected(engine, &source)?;
            }
            if let Some(name) = &request.folder_name {
                workspace_service::validate_name(name)?;
                target.set_file_name(name);
            }
            if target.starts_with(&source) {
                return Err(AppError::new("FOLDER_INTO_ITSELF"));
            }
            if target.try_exists()? || reserved.contains(&path_key(&target)) {
                match request.policy {
                    ConflictPolicy::Skip => {
                        let mut item = folders::item(&source, &target, "skip")?;
                        item.conflict = true;
                        skipped.push(item);
                        continue;
                    }
                    ConflictPolicy::KeepBoth => target = available_name(&target, &reserved)?,
                    ConflictPolicy::Replace => return Err(AppError::new("FOLDER_CONFLICT")),
                }
            }
            selected_dirs.push(source.clone());
            reserved.insert(path_key(&target));
            let folders::FolderContents {
                directories: tree,
                files,
            } = folders::collect(engine, &source, &target)?;
            if request.mode == "move" {
                removals.extend(tree.iter().rev().map(|i| {
                    let mut i = i.clone();
                    i.action = "rmdir".into();
                    i
                }));
            }
            directories.extend(tree);
            pairs.extend(files);
        } else {
            workspace_service::directory(
                engine,
                source
                    .parent()
                    .ok_or_else(|| AppError::new("INVALID_TRANSFER"))?,
            )?;
            pairs.push((source, target));
        }
    }
    let mut items = Vec::new();
    for (source, mut target) in pairs {
        if let Some(preset) = preset {
            let date = super::move_service::stamp(&super::move_service::regular_file(&source)?)
                .modified_at
                .ok_or_else(|| AppError::new("INVALID_DATE"))?;
            target.set_file_name(super::rename_engine::generate(
                preset,
                source
                    .file_name()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| AppError::new("INVALID_NAME"))?,
                &request.period,
                date,
                items.len() + 1,
            )?);
        }
        if target == source {
            return Err(AppError::new("SAME_DESTINATION"));
        }
        let mut item = operations::plan_item(engine, &source, &target, &request.mode, false)?;
        if selected_dirs.iter().any(|p| source.starts_with(p)) {
            item.recovery_parent = Some(request.destination.clone());
        }
        items.push(item);
    }
    let (items, unreadable_count) = operations::resolve_items(
        engine,
        items,
        request.policy,
        &request.duplicate_action,
        &request.resolutions,
    )?;
    directories.extend(items);
    directories.extend(removals);
    directories.extend(skipped);
    let mut state = engine.lock()?;
    let plan = OrganizationPlan {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        items: directories,
        unmatched_count: 0,
        revision: state.revision,
        origin: "workspace".into(),
        unreadable_count,
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
    let plan = operations::take_plan(engine, id, "workspace")?;
    let operation = operations::execute(engine, &plan, progress, |item| {
        if item.backup {
            return operations::source(engine, Path::new(&item.source_path));
        }
        workspace_service::directory(
            engine,
            Path::new(&item.source_path)
                .parent()
                .ok_or_else(|| AppError::new("INVALID_TRANSFER"))?,
        )?;
        workspace_service::directory(
            engine,
            Path::new(&item.destination_path)
                .parent()
                .ok_or_else(|| AppError::new("INVALID_TRANSFER"))?,
        )?;
        Ok(())
    })?;
    folders::update_references(engine, &operation, false)?;
    Ok(operation)
}
