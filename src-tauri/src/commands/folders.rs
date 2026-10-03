use crate::{
    domain::file_entry::AuthorizedFolder,
    errors::{AppError, AppResult},
    services::access_service::FolderAccess,
};
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn select_folder(
    app: AppHandle,
    access: State<'_, FolderAccess>,
) -> AppResult<Option<AuthorizedFolder>> {
    let access = access.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Elige una carpeta para explorar en Metaflow")
            .blocking_pick_folder();
        selected
            .map(|file| {
                let path = file
                    .into_path()
                    .map_err(|_| AppError::new("UNSUPPORTED_PATH"))?;
                access.grant(&path)
            })
            .transpose()
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}

#[tauri::command]
pub fn forget_folder(path: String, access: State<'_, FolderAccess>) -> AppResult<()> {
    access.revoke(Path::new(&path))
}
