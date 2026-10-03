use crate::{
    domain::organization::*,
    errors::{AppError, AppResult},
    services::{duplicate_service, file_operation_service, inbox_service::InboxEngine},
};
use tauri::{Emitter, State};
#[tauri::command]
pub async fn scan_duplicates(
    state: State<'_, InboxEngine>,
) -> AppResult<duplicate_service::DuplicateScan> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || duplicate_service::scan(&engine))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn preview_duplicate_cleanup(
    keeper: String,
    members: Vec<String>,
    hash: String,
    state: State<'_, InboxEngine>,
) -> AppResult<OrganizationPlan> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        duplicate_service::preview_cleanup(&engine, &keeper, members, &hash)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn execute_duplicate_cleanup(
    plan_id: String,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Operation> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = {
            let _gate = engine
                .operation_gate
                .lock()
                .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
            let plan = file_operation_service::take_plan(&engine, &plan_id, "duplicates")?;
            file_operation_service::execute(
                &engine,
                &plan,
                |p| {
                    let _ = app.emit("operation-progress", p);
                },
                |item| {
                    file_operation_service::source(&engine, std::path::Path::new(&item.source_path))
                },
            )
        };
        let _ = engine.reconcile();
        let _ = app.emit("inbox-changed", ());
        let _ = app.emit("workspace-changed", ());
        result
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
