#[path = "access-service.rs"]
pub mod access_service;
#[path = "date-service.rs"]
pub mod date_service;
#[path = "duplicate-service.rs"]
pub mod duplicate_service;
#[path = "file-date-service.rs"]
pub mod file_date_service;
#[path = "file-operation-service.rs"]
pub mod file_operation_service;
#[path = "file-service.rs"]
pub mod file_service;
#[path = "file-type-service.rs"]
pub mod file_type_service;
#[path = "folder-operation-service.rs"]
pub mod folder_operation_service;
#[path = "history-service.rs"]
pub mod history_service;
#[path = "inbox-service.rs"]
pub mod inbox_service;
#[path = "metadata-service.rs"]
pub mod metadata_service;
#[cfg(test)]
#[path = "metadata-tests.rs"]
mod metadata_tests;
#[path = "move-service.rs"]
pub mod move_service;
#[path = "organizer-service.rs"]
pub mod organizer_service;
#[path = "rename-engine.rs"]
pub mod rename_engine;
#[path = "transfer-service.rs"]
pub mod transfer_service;
#[cfg(test)]
#[path = "transfer-tests.rs"]
mod transfer_tests;
#[path = "watcher-service.rs"]
pub mod watcher_service;
#[cfg(test)]
#[path = "workflow-tests.rs"]
mod workflow_tests;
#[path = "workspace-service.rs"]
pub mod workspace_service;
