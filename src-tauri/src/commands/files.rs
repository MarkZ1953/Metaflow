use crate::{
    domain::file_entry::DirectoryListing,
    errors::{AppError, AppResult},
    services::{access_service::FolderAccess, file_service},
};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn read_directory(
    path: String,
    access: State<'_, FolderAccess>,
) -> AppResult<DirectoryListing> {
    let access = access.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        file_service::read_directory(&access, &PathBuf::from(path))
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
