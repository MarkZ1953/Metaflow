use crate::{
    database::repositories::rename_repository,
    domain::rename::*,
    errors::{AppError, AppResult},
    services::{inbox_service::InboxEngine, rename_engine},
};
use tauri::State;
#[tauri::command]
pub async fn get_rename_configuration(
    state: State<'_, InboxEngine>,
) -> AppResult<RenameConfiguration> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || rename_repository::load(&engine.db))
        .await
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn save_rename_configuration(
    configuration: RenameConfiguration,
    state: State<'_, InboxEngine>,
) -> AppResult<RenameConfiguration> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = engine
            .operation_gate
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        rename_engine::validate(&configuration)?;
        rename_repository::save(&engine.db, &configuration)?;
        let mut runtime = engine.lock()?;
        runtime.revision += 1;
        runtime.plan = None;
        Ok(configuration)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
#[tauri::command]
pub async fn preview_filename(
    preset: RenamePreset,
    original: String,
    period: String,
    date: i64,
    state: State<'_, InboxEngine>,
) -> AppResult<String> {
    let _ = state;
    tauri::async_runtime::spawn_blocking(move || {
        rename_engine::generate(&preset, &original, &period, date, 1)
    })
    .await
    .map_err(|_| AppError::new("INTERNAL_ERROR"))?
}
