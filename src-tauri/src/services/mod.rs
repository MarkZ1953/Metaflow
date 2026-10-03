#[path = "access-service.rs"]
pub mod access_service;
#[path = "classification-ai.rs"]
pub mod classification_ai;
#[path = "classification-ocr.rs"]
pub mod classification_ocr;
#[path = "date-service.rs"]
pub mod date_service;
#[path = "duplicate-review-service.rs"]
pub mod duplicate_review_service;
#[cfg(test)]
#[path = "duplicate-review-tests.rs"]
mod duplicate_review_tests;
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
#[path = "media-classification-service.rs"]
pub mod media_classification_service;
#[cfg(test)]
#[path = "media-classification-tests.rs"]
mod media_classification_tests;
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
