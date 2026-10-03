use crate::{
    domain::{
        file_entry::AuthorizedFolder,
        media_classification::{
            DetectionConfiguration, DetectionSettings, MediaCategory, MediaCorrectionsReset,
            MediaEntry, MediaPreview, MediaScan, MediaScanOptions, MediaTransferResult,
        },
        organization::{Operation, OrganizationPlan},
        workspace::TransferRequest,
    },
    errors::{AppError, AppResult},
    services::{
        inbox_service::{validate_directory, InboxEngine},
        media_classification_service as media,
    },
};
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn select_classification_folders(
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Vec<AuthorizedFolder>> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Elige las carpetas que quieres depurar")
            .blocking_pick_folders()
        else {
            return Ok(Vec::new());
        };
        if selected.is_empty() || selected.len() > media::MAX_SCAN_FOLDERS {
            return Err(AppError::new("INVALID_CLASSIFICATION_FOLDERS"));
        }
        // Only paths returned by this native dialog become grants. Validate the
        // complete selection before adding any access, and never persist roots.
        let paths = selected
            .into_iter()
            .map(|file| {
                let path = file
                    .into_path()
                    .map_err(|_| AppError::new("UNSUPPORTED_PATH"))?;
                validate_directory(&path)?;
                let canonical = dunce::canonicalize(path)?;
                validate_directory(&canonical)?;
                Ok(canonical)
            })
            .collect::<AppResult<Vec<_>>>()?;
        paths.iter().map(|path| engine.access.grant(path)).collect()
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn load_classification_settings(
    state: State<'_, InboxEngine>,
) -> AppResult<DetectionConfiguration> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || media::load_settings(&engine))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn save_classification_settings(
    settings: DetectionSettings,
    state: State<'_, InboxEngine>,
) -> AppResult<DetectionConfiguration> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || media::save_settings(&engine, settings))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn set_classification_categories(
    session_id: String,
    item_ids: Vec<String>,
    categories: Option<Vec<MediaCategory>>,
    state: State<'_, InboxEngine>,
) -> AppResult<Vec<MediaEntry>> {
    let engine = state.inner().clone();
    engine.cancelled.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        media::set_categories(&engine, &session_id, &item_ids, categories)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn clear_classification_corrections(
    state: State<'_, InboxEngine>,
) -> AppResult<MediaCorrectionsReset> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || media::clear_corrections(&engine))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn scan_classification_review(
    folder_path: Option<String>,
    folder_paths: Option<Vec<String>>,
    recursive: bool,
    include_videos: bool,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<MediaScan> {
    let engine = state.inner().clone();
    engine.cancelled.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        media::scan(
            &engine,
            MediaScanOptions {
                folder_path,
                folder_paths,
                recursive,
                include_videos,
            },
            |progress| {
                let _ = app.emit("media-scan-progress", progress);
            },
        )
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn preview_classified_media(
    session_id: String,
    item_id: String,
    state: State<'_, InboxEngine>,
) -> AppResult<MediaPreview> {
    let engine = state.inner().clone();
    engine.cancelled.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || media::preview(&engine, &session_id, &item_id))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn set_classification_protected(
    session_id: String,
    item_ids: Vec<String>,
    protected: bool,
    state: State<'_, InboxEngine>,
) -> AppResult<Vec<MediaEntry>> {
    let engine = state.inner().clone();
    engine.cancelled.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        media::protect(&engine, &session_id, &item_ids, protected)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn remove_classified_files(
    session_id: String,
    item_ids: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Operation> {
    let engine = state.inner().clone();
    engine.cancelled.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let result = media::remove(&engine, &session_id, &item_ids, |progress| {
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
pub async fn preview_classified_transfer(
    session_id: String,
    item_ids: Vec<String>,
    request: TransferRequest,
    state: State<'_, InboxEngine>,
) -> AppResult<OrganizationPlan> {
    let engine = state.inner().clone();
    engine.cancelled.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        media::preview_transfer(&engine, &session_id, &item_ids, request)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn execute_classified_transfer(
    session_id: String,
    plan_id: String,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<MediaTransferResult> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = media::execute_transfer(&engine, &session_id, &plan_id, |progress| {
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
