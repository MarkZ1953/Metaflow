use crate::{
    domain::organization::*,
    errors::{AppError, AppResult},
    services::{
        date_service,
        inbox_service::{validate_directory, InboxEngine},
        move_service,
    },
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[cfg(test)]
pub fn preview(engine: &InboxEngine, policy: ConflictPolicy) -> AppResult<OrganizationPlan> {
    preview_with_options(engine, policy, "skip", &std::collections::BTreeMap::new())
}
pub fn preview_with_options(
    engine: &InboxEngine,
    policy: ConflictPolicy,
    duplicate_action: &str,
    resolutions: &std::collections::BTreeMap<String, IssueResolution>,
) -> AppResult<OrganizationPlan> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    engine
        .cancelled
        .store(false, std::sync::atomic::Ordering::Relaxed);
    let (inbox, files, revision) = {
        let state = engine.lock()?;
        (
            state
                .inbox
                .clone()
                .ok_or_else(|| AppError::new("INBOX_REQUIRED"))?,
            state
                .candidates
                .values()
                .map(|c| c.file.clone())
                .collect::<Vec<_>>(),
            state.revision,
        )
    };
    let configuration = crate::database::repositories::rename_repository::load(&engine.db)?;
    let mut items = Vec::new();
    let mut unmatched_count = 0;
    for file in files {
        if file.status != "matched" {
            unmatched_count += 1;
            continue;
        }
        let source = Path::new(&file.path);
        validate_source(source, Path::new(&inbox.path))?;
        let mut target = PathBuf::from(
            file.destination_path
                .as_ref()
                .ok_or_else(|| AppError::new("INVALID_RULE"))?,
        );
        let rule_id = file
            .rule_id
            .clone()
            .ok_or_else(|| AppError::new("INVALID_RULE"))?;
        let rule_name = file
            .rule_name
            .clone()
            .ok_or_else(|| AppError::new("INVALID_RULE"))?;
        let date_used = file
            .date_used
            .ok_or_else(|| AppError::new("INVALID_DATE"))?;
        if let Some(preset) = crate::services::rename_engine::selected(&configuration, &rule_id) {
            target.set_file_name(crate::services::rename_engine::generate(
                preset,
                &file.name,
                &rule_name,
                date_used,
                items.len() + 1,
            )?);
        }
        let parent = target
            .parent()
            .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
        let (resolved, _) = engine.access.resolve(parent)?;
        validate_directory(&resolved)?;
        if resolved != parent {
            return Err(AppError::new("FOLDER_CHANGED"));
        }
        let mut item = crate::services::file_operation_service::plan_item(
            engine, source, &target, "move", false,
        )?;
        if item.stamp != file.stamp {
            return Err(AppError::new("FILE_CHANGED"));
        }
        item.rule_id = rule_id;
        item.rule_name = rule_name;
        item.date_source = file
            .date_source
            .ok_or_else(|| AppError::new("INVALID_RULE"))?;
        item.date_used = date_used;
        items.push(item);
    }
    if items.is_empty() {
        return Err(AppError::new("NO_MATCHED_FILES"));
    }
    let (items, unreadable_count) = crate::services::file_operation_service::resolve_items(
        engine,
        items,
        policy,
        duplicate_action,
        resolutions,
    )?;
    let plan = OrganizationPlan {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        items,
        unmatched_count,
        revision,
        origin: "inbox".into(),
        unreadable_count,
    };
    engine.lock()?.plan = Some(plan.clone());
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
    let (plan, inbox, rules) = {
        let mut state = engine.lock()?;
        let plan = state
            .plan
            .take()
            .ok_or_else(|| AppError::new("PLAN_EXPIRED"))?;
        if plan.origin != "inbox"
            || plan.id != id
            || plan.revision != state.revision
            || chrono::Utc::now().timestamp_millis() - plan.created_at > 600_000
        {
            return Err(AppError::new("PLAN_EXPIRED"));
        }
        (
            plan,
            state
                .inbox
                .clone()
                .ok_or_else(|| AppError::new("INBOX_REQUIRED"))?,
            state.rules.clone(),
        )
    };
    crate::services::file_operation_service::execute(engine, &plan, progress, |planned| {
        if planned.backup {
            return crate::services::file_operation_service::source(
                engine,
                Path::new(&planned.source_path),
            );
        }
        let source = Path::new(&planned.source_path);
        validate_source(source, Path::new(&inbox.path))?;
        let metadata = move_service::regular_file(source)?;
        let mut current = InboxFile {
            path: planned.source_path.clone(),
            name: source
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| AppError::new("UNSUPPORTED_PATH"))?
                .into(),
            extension: String::new(),
            stamp: move_service::stamp(&metadata),
            accessed_at: move_service::millis(metadata.accessed()),
            status: "ready".into(),
            rule_id: None,
            rule_name: None,
            destination_path: None,
            date_source: None,
            date_used: None,
            error: None,
        };
        date_service::evaluate(&mut current, &rules);
        if current.rule_id.as_deref() != Some(&planned.rule_id)
            || current.date_used != Some(planned.date_used)
        {
            return Err(AppError::new("FILE_CHANGED"));
        }
        Ok(())
    })
}

pub fn operation_status(items: &[HistoryItem]) -> &'static str {
    if items.iter().any(|i| i.status == "recovery-required") {
        "recovery-required"
    } else if items
        .iter()
        .any(|i| matches!(i.status.as_str(), "failed" | "cancelled") || i.error.is_some())
    {
        "partial"
    } else if items.iter().any(|i| i.status == "undone")
        && items
            .iter()
            .all(|i| matches!(i.status.as_str(), "undone" | "skipped"))
    {
        "undone"
    } else {
        "completed"
    }
}
pub fn validate_source(path: &Path, root: &Path) -> AppResult<()> {
    validate_directory(root)?;
    if path.parent() != Some(root) || dunce::canonicalize(path)? != path {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    move_service::regular_file(path)?;
    Ok(())
}
pub fn path_key(path: &Path) -> String {
    #[cfg(windows)]
    {
        path.to_string_lossy().to_lowercase()
    }
    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}
pub fn available_name(path: &Path, reserved: &HashSet<String>) -> AppResult<PathBuf> {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::new("UNSUPPORTED_PATH"))?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    for number in 1..100_000 {
        let candidate = path.with_file_name(format!("{stem} ({number}){extension}"));
        if !candidate.try_exists()? && !reserved.contains(&path_key(&candidate)) {
            return Ok(candidate);
        }
    }
    Err(AppError::new("DESTINATION_EXISTS"))
}
