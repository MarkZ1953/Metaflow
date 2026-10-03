mod commands;
mod database;
mod domain;
mod errors;
mod services;

use services::access_service::FolderAccess;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(FolderAccess::default())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("METAFLOW_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(directory);
            std::fs::create_dir_all(&directory)?;
            let db = database::Database::open(&directory.join("metaflow.sqlite"))?;
            let engine = services::inbox_service::InboxEngine::open(
                db,
                app.state::<FolderAccess>().inner().clone(),
                directory.join("metaflow.log"),
            )?;
            services::history_service::recover(&engine)?;
            services::workspace_service::restore(&engine)?;
            services::watcher_service::start(engine.clone(), app.handle().clone());
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::folders::select_folder,
            commands::folders::forget_folder,
            commands::files::read_directory,
            commands::inbox::get_inbox,
            commands::inbox::choose_inbox,
            commands::inbox::save_date_rules,
            commands::inbox::retry_inbox,
            commands::organizer::preview_organization,
            commands::organizer::execute_organization,
            commands::organizer::get_history,
            commands::organizer::undo_operation,
            commands::organizer::cancel_operation,
            commands::workspace::get_workspace,
            commands::workspace::add_workspace_folder,
            commands::workspace::remove_workspace_folder,
            commands::workspace::set_workspace_favorite,
            commands::workspace::create_workspace_folder,
            commands::workspace::open_file_location,
            commands::workspace::preview_transfer,
            commands::workspace::execute_transfer,
            commands::workspace::get_folder_properties,
            commands::rename::get_rename_configuration,
            commands::rename::save_rename_configuration,
            commands::rename::preview_filename,
            commands::duplicates::scan_duplicates,
            commands::duplicates::preview_duplicate_cleanup,
            commands::duplicates::execute_duplicate_cleanup,
            commands::metadata::preview_file_dates,
            commands::metadata::execute_file_dates,
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Metaflow");
}
