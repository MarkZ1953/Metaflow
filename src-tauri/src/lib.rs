mod commands;
mod database;
mod domain;
mod errors;
mod services;

use services::access_service::FolderAccess;
use tauri::Manager;

pub(crate) fn normalize_media_assets(path: std::path::PathBuf) -> std::path::PathBuf {
    dunce::canonicalize(&path).unwrap_or(path)
}

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
            let mut engine = services::inbox_service::InboxEngine::open(
                db,
                app.state::<FolderAccess>().inner().clone(),
                directory.join("metaflow.log"),
            )?;
            engine.media_assets = app.path().resource_dir()?.join("classification");
            #[cfg(debug_assertions)]
            if !engine
                .media_assets
                .join("vision_model_uint8.onnx")
                .is_file()
            {
                engine.media_assets = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("resources/classification");
            }
            engine.media_assets = normalize_media_assets(engine.media_assets);
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
            commands::duplicate_review::scan_duplicate_review,
            commands::duplicate_review::preview_duplicate_image,
            commands::duplicate_review::dismiss_duplicate_comparison,
            commands::duplicate_review::reset_duplicate_dismissals,
            commands::duplicate_review::remove_duplicate_file,
            commands::metadata::preview_file_dates,
            commands::metadata::execute_file_dates,
            commands::classification::scan_classification_review,
            commands::classification::select_classification_folders,
            commands::classification::load_classification_settings,
            commands::classification::save_classification_settings,
            commands::classification::set_classification_categories,
            commands::classification::clear_classification_corrections,
            commands::classification::preview_classified_media,
            commands::classification::set_classification_protected,
            commands::classification::remove_classified_files,
            commands::classification::preview_classified_transfer,
            commands::classification::execute_classified_transfer,
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Metaflow");
}
