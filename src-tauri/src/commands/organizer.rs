use crate::{
    database::repositories::history_repository,
    domain::organization::*,
    errors::{AppError, AppResult},
    services::{history_service, inbox_service::InboxEngine, organizer_service},
};
use tauri::{Emitter, State};

#[tauri::command]
pub async fn preview_organization(
    policy: ConflictPolicy,
    duplicate_action: Option<String>,
    resolutions: Option<std::collections::BTreeMap<String, IssueResolution>>,
    state: State<'_, InboxEngine>,
) -> AppResult<OrganizationPlan> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        organizer_service::preview_with_options(
            &engine,
            policy,
            duplicate_action.as_deref().unwrap_or("skip"),
            &resolutions.unwrap_or_default(),
        )
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn execute_organization(
    plan_id: String,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Operation> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = organizer_service::execute(&engine, &plan_id, |progress| {
            let _ = app.emit("operation-progress", progress);
        });
        let _ = engine.reconcile();
        let _ = app.emit("inbox-changed", ());
        result
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn get_history(state: State<'_, InboxEngine>) -> AppResult<Vec<Operation>> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || history_repository::list(&engine.db))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn undo_operation(
    operation_id: String,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Operation> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = history_service::undo(&engine, &operation_id, |progress| {
            let _ = app.emit("operation-progress", progress);
        });
        let _ = engine.reconcile();
        let _ = app.emit("inbox-changed", ());
        let _ = app.emit("workspace-changed", ());
        result
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub fn cancel_operation(state: State<'_, InboxEngine>) {
    state.cancel();
}
