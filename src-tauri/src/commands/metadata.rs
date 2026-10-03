use crate::{
    domain::{metadata::MetadataRequest, organization::*},
    errors::{AppError, AppResult},
    services::{inbox_service::InboxEngine, metadata_service},
};
use tauri::{Emitter, State};

#[tauri::command]
pub async fn preview_file_dates(
    request: MetadataRequest,
    state: State<'_, InboxEngine>,
) -> AppResult<OrganizationPlan> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || metadata_service::preview(&engine, request))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn execute_file_dates(
    plan_id: String,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Operation> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = metadata_service::execute(&engine, &plan_id, |p| {
            let _ = app.emit("operation-progress", p);
        });
        let _ = engine.reconcile();
        let _ = app.emit("inbox-changed", ());
        let _ = app.emit("workspace-changed", ());
        result
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
