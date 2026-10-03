use crate::{
    domain::organization::{DateRule, InboxSnapshot},
    errors::{AppError, AppResult},
    services::inbox_service::InboxEngine,
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn get_inbox(state: State<'_, InboxEngine>) -> AppResult<InboxSnapshot> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.snapshot())
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn choose_inbox(
    app: tauri::AppHandle,
    state: State<'_, InboxEngine>,
) -> AppResult<InboxSnapshot> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path) = app
            .dialog()
            .file()
            .set_title("Choose your Metaflow Inbox")
            .blocking_pick_folder()
        {
            engine.set_inbox(
                &path
                    .into_path()
                    .map_err(|_| AppError::new("UNSUPPORTED_PATH"))?,
            )?;
        }
        engine.snapshot()
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn save_date_rules(
    rules: Vec<DateRule>,
    state: State<'_, InboxEngine>,
) -> AppResult<InboxSnapshot> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.save_rules(rules)?;
        engine.snapshot()
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn retry_inbox(state: State<'_, InboxEngine>) -> AppResult<InboxSnapshot> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.retry()?;
        engine.snapshot()
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
