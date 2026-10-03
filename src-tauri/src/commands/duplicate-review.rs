use crate::{
    domain::{
        duplicate_review::{DuplicateReviewScan, ImageThumbnail},
        organization::Operation,
    },
    errors::{AppError, AppResult},
    services::{duplicate_review_service as review, inbox_service::InboxEngine},
};
use tauri::{Emitter, State};

#[tauri::command]
pub async fn scan_duplicate_review(
    include_similar: bool,
    state: State<'_, InboxEngine>,
) -> AppResult<DuplicateReviewScan> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || review::scan(&engine, include_similar))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn preview_duplicate_image(
    session_id: String,
    comparison_id: String,
    side: String,
    state: State<'_, InboxEngine>,
) -> AppResult<ImageThumbnail> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        review::thumbnail(&engine, &session_id, &comparison_id, &side)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn dismiss_duplicate_comparison(
    session_id: String,
    comparison_id: String,
    state: State<'_, InboxEngine>,
) -> AppResult<()> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        review::dismiss(&engine, &session_id, &comparison_id)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn reset_duplicate_dismissals(state: State<'_, InboxEngine>) -> AppResult<()> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || review::reset_dismissals(&engine))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn remove_duplicate_file(
    session_id: String,
    comparison_id: String,
    side: String,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Operation> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = review::remove(&engine, &session_id, &comparison_id, &side, |p| {
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
