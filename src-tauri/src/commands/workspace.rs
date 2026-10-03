use crate::{
    database::repositories::workspace_repository,
    domain::{organization::*, workspace::*},
    errors::{AppError, AppResult},
    services::{inbox_service::InboxEngine, transfer_service, workspace_service},
};
use std::path::Path;
use tauri::{Emitter, State};
use tauri_plugin_dialog::DialogExt;
#[tauri::command]
pub async fn get_folder_properties(
    path: String,
    state: State<'_, InboxEngine>,
) -> AppResult<FolderProperties> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        workspace_service::properties(&engine, Path::new(&path))
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub async fn get_workspace(state: State<'_, InboxEngine>) -> AppResult<Workspace> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || workspace_repository::load(&engine.db))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn add_workspace_folder(
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Workspace> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Agregar carpeta al Workspace")
            .blocking_pick_folder();
        if let Some(selected) = selected {
            workspace_service::add(
                &engine,
                &selected
                    .into_path()
                    .map_err(|_| AppError::new("UNSUPPORTED_PATH"))?,
            )
        } else {
            workspace_repository::load(&engine.db)
        }
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn remove_workspace_folder(
    id: String,
    state: State<'_, InboxEngine>,
) -> AppResult<Workspace> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || workspace_service::remove(&engine, &id))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn set_workspace_favorite(
    path: String,
    enabled: bool,
    state: State<'_, InboxEngine>,
) -> AppResult<Workspace> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        workspace_service::favorite(&engine, Path::new(&path), enabled)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn create_workspace_folder(
    parent: String,
    name: String,
    state: State<'_, InboxEngine>,
) -> AppResult<String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        workspace_service::new_folder(&engine, Path::new(&parent), &name)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn open_file_location(path: String, state: State<'_, InboxEngine>) -> AppResult<()> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        let folder = if path.is_dir() {
            path
        } else {
            path.parent()
                .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?
        };
        let (resolved, _) = engine.access.resolve(folder)?;
        crate::services::inbox_service::validate_directory(&resolved)?;
        #[cfg(windows)]
        {
            std::process::Command::new("explorer.exe")
                .arg(resolved)
                .spawn()?;
        }
        Ok(())
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn preview_transfer(
    request: TransferRequest,
    state: State<'_, InboxEngine>,
) -> AppResult<OrganizationPlan> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || transfer_service::preview(&engine, request))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn execute_transfer(
    plan_id: String,
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<Operation> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = transfer_service::execute(&engine, &plan_id, |progress| {
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
