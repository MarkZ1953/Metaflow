#![cfg(windows)]
use super::{
    access_service::FolderAccess, file_date_service as dates, history_service,
    inbox_service::InboxEngine, metadata_service, move_service, workspace_service,
};
use crate::{
    database::{repositories::history_repository, Database},
    domain::{metadata::MetadataRequest, organization::OrganizationPlan},
};
use std::{
    fs::File,
    os::windows::io::AsRawHandle,
    path::{Path, PathBuf},
};
use windows_sys::Win32::{
    Foundation::FILETIME,
    Storage::FileSystem::{GetFileTime, SetFileTime},
};

// Deliberately keep sub-millisecond precision, which must survive JSON/SQLite and Undo.
const CREATED: u64 = 134_148_389_280_000_017;
const MODIFIED: u64 = 134_345_632_150_000_042;
const ACCESSED: u64 = 134_355_000_000_000_039;
struct Fixture {
    engine: InboxEngine,
    root: PathBuf,
    _directory: tempfile::TempDir,
}
impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("files");
        std::fs::create_dir(&root).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let engine = InboxEngine::open(
            Database::open(&directory.path().join("db.sqlite")).unwrap(),
            FolderAccess::default(),
            directory.path().join("log.txt"),
        )
        .unwrap();
        workspace_service::add(&engine, &root).unwrap();
        Self {
            engine,
            root,
            _directory: directory,
        }
    }
    fn file(&self, name: &str) -> PathBuf {
        let path = self.root.join(name);
        std::fs::write(&path, format!("original bytes of {name}")).unwrap();
        set_dates(&path, CREATED, MODIFIED);
        path
    }
    fn preview(&self, paths: &[PathBuf], recursive: bool) -> OrganizationPlan {
        metadata_service::preview(
            &self.engine,
            MetadataRequest {
                paths: paths
                    .iter()
                    .map(|p| p.to_str().unwrap().to_owned())
                    .collect(),
                recursive,
            },
        )
        .unwrap()
    }
}
fn filetime(ticks: u64) -> FILETIME {
    FILETIME {
        dwLowDateTime: ticks as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    }
}
fn set_dates(path: &Path, created: u64, modified: u64) {
    let file = dates::open(path).unwrap();
    // SAFETY: valid owned test-file handle and correctly laid out FILETIME pointers.
    assert_ne!(
        unsafe {
            SetFileTime(
                file.as_raw_handle(),
                &filetime(created),
                &filetime(ACCESSED),
                &filetime(modified),
            )
        },
        0
    );
}
fn inspect(path: &Path) -> (u64, u64, u64, String, u64) {
    let file = dates::open(path).unwrap();
    let mut access = FILETIME::default();
    // SAFETY: live File handle and initialized output storage.
    assert_ne!(
        unsafe {
            GetFileTime(
                file.as_raw_handle(),
                std::ptr::null_mut(),
                &mut access,
                std::ptr::null_mut(),
            )
        },
        0
    );
    let current = dates::read(&file).unwrap();
    (
        current.created,
        current.modified,
        ((access.dwHighDateTime as u64) << 32) | access.dwLowDateTime as u64,
        move_service::identity(&file).unwrap(),
        file.metadata().unwrap().len(),
    )
}
fn modified(path: &Path) -> u64 {
    inspect(path).1
}

#[test]
fn bulk_dates_preserve_creation_access_identity_contents_and_precise_undo() {
    let f = Fixture::new();
    let mut originals = Vec::new();
    for i in 0..120 {
        let extension = ["jpg", "mp4", "pdf", "txt"][i % 4];
        let path = f.file(&format!("archivo-{i:03}.{extension}"));
        originals.push((path.clone(), inspect(&path)));
    }
    let equal = f.file("ya-coincide.jpg");
    set_dates(&equal, CREATED, CREATED);
    let plan = f.preview(std::slice::from_ref(&f.root), false);
    assert_eq!(plan.items.len(), 121);
    assert_eq!(
        plan.items.iter().filter(|i| i.action == "dates").count(),
        120
    );
    for (path, before) in &originals {
        assert_eq!(&inspect(path), before);
    }
    let op = metadata_service::execute(&f.engine, &plan.id, |p| {
        assert_eq!(p.total_bytes, 0);
        assert_eq!(p.completed_bytes, 0);
    })
    .unwrap();
    assert_eq!(
        op.items.iter().filter(|i| i.status == "completed").count(),
        120
    );
    assert_eq!(op.items.iter().filter(|i| i.status == "skipped").count(), 1);
    for (path, before) in &originals {
        let after = inspect(path);
        assert_eq!(
            after,
            (before.0, before.0, before.2, before.3.clone(), before.4)
        );
    }
    let persisted = history_repository::list(&f.engine.db).unwrap();
    let change = persisted[0].items[0].date_change.as_ref().unwrap();
    assert_eq!(change.created_ticks, CREATED.to_string());
    assert_eq!(change.modified_before_ticks, MODIFIED.to_string());
    assert_eq!(change.modified_after_ticks, CREATED.to_string());
    let undo = history_service::undo(&f.engine, &op.id, |p| assert_eq!(p.total_bytes, 0)).unwrap();
    assert_eq!(
        undo.items.iter().filter(|i| i.status == "undone").count(),
        120
    );
    for (path, before) in originals {
        assert_eq!(&inspect(&path), &before);
        assert_eq!(
            std::fs::read(&path).unwrap(),
            format!(
                "original bytes of {}",
                path.file_name().unwrap().to_str().unwrap()
            )
            .as_bytes()
        );
    }
    assert_eq!(modified(&equal), CREATED);
    assert!(!f.root.join(".metaflow-recovery").exists());
}

#[test]
fn selected_files_and_recursive_folders_deduplicate_and_exclude_recovery() {
    let f = Fixture::new();
    let direct = f.file("direct.jpg");
    std::fs::create_dir(f.root.join("nested")).unwrap();
    let nested = f.file("nested/video.mp4");
    std::fs::create_dir(f.root.join(".metaflow-recovery")).unwrap();
    let recovery = f.file(".metaflow-recovery/precious.txt");
    let direct_plan = f.preview(std::slice::from_ref(&f.root), false);
    assert_eq!(direct_plan.items.len(), 1);
    let recursive = f.preview(&[f.root.clone(), direct.clone()], true);
    assert_eq!(recursive.items.len(), 2);
    let op = metadata_service::execute(&f.engine, &recursive.id, |_| {}).unwrap();
    assert!(op.items.iter().all(|i| i.status == "completed"));
    assert_eq!(modified(&nested), CREATED);
    assert_eq!(modified(&recovery), MODIFIED);
    history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    let selected = f.preview(std::slice::from_ref(&direct), false);
    assert_eq!(selected.items.len(), 1);
    assert_eq!(selected.items[0].source_path, direct.to_str().unwrap());
}

#[test]
fn cancellation_keeps_remaining_dates_and_undo_restores_only_completed_files() {
    let f = Fixture::new();
    let paths: Vec<_> = (0..60)
        .map(|i| f.file(&format!("file-{i:03}.txt")))
        .collect();
    let plan = f.preview(&paths, false);
    let op = metadata_service::execute(&f.engine, &plan.id, |p| {
        if p.completed == 20 {
            f.engine.cancel();
        }
    })
    .unwrap();
    assert_eq!(
        op.items.iter().filter(|i| i.status == "completed").count(),
        20
    );
    assert_eq!(
        op.items.iter().filter(|i| i.status == "cancelled").count(),
        40
    );
    for (i, path) in paths.iter().enumerate() {
        assert_eq!(modified(path), if i < 20 { CREATED } else { MODIFIED });
    }
    history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    for path in paths {
        assert_eq!(modified(&path), MODIFIED);
    }
}

#[test]
fn stale_preview_and_changed_file_during_undo_are_rejected() {
    let f = Fixture::new();
    let path = f.file("photo.jpg");
    let plan = f.preview(std::slice::from_ref(&path), false);
    // A 100ns change would be invisible in the millisecond UI stamp.
    set_dates(&path, CREATED, MODIFIED + 1);
    let op = metadata_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert_eq!(op.items[0].error.as_deref(), Some("FILE_CHANGED"));
    assert_eq!(modified(&path), MODIFIED + 1);
    let plan = f.preview(std::slice::from_ref(&path), false);
    let op = metadata_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    set_dates(&path, CREATED, CREATED + 1);
    let undo = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undo.items[0].error.as_deref(), Some("FILE_CHANGED"));
    assert_eq!(undo.items[0].status, "completed");
    assert_eq!(modified(&path), CREATED + 1);
}

#[test]
fn in_use_file_is_reported_without_blocking_rest_of_batch() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let locked = f.file("locked.mp4");
    let available = f.file("available.jpg");
    let handle = File::options()
        .read(true)
        .share_mode(0)
        .open(&locked)
        .unwrap();
    let plan = f.preview(&[locked.clone(), available.clone()], false);
    let skipped = plan
        .items
        .iter()
        .find(|i| i.source_path == locked.to_str().unwrap())
        .unwrap();
    assert_eq!(skipped.action, "skip");
    assert_eq!(skipped.error.as_deref(), Some("FILE_IN_USE"));
    let op = metadata_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert_eq!(
        op.items.iter().filter(|i| i.status == "completed").count(),
        1
    );
    drop(handle);
    assert_eq!(modified(&locked), MODIFIED);
    assert_eq!(modified(&available), CREATED);
}

#[test]
fn ungranted_paths_and_removed_roots_cannot_change_dates() {
    let f = Fixture::new();
    let outside = tempfile::tempdir().unwrap();
    let request = MetadataRequest {
        paths: vec![outside.path().join("secret.jpg").to_str().unwrap().into()],
        recursive: false,
    };
    assert_eq!(
        metadata_service::preview(&f.engine, request)
            .unwrap_err()
            .code,
        "FOLDER_NOT_AUTHORIZED"
    );
    let path = f.file("photo.jpg");
    let plan = f.preview(std::slice::from_ref(&path), false);
    let root = crate::database::repositories::workspace_repository::load(&f.engine.db)
        .unwrap()
        .roots[0]
        .id
        .clone();
    workspace_service::remove(&f.engine, &root).unwrap();
    assert_eq!(
        metadata_service::execute(&f.engine, &plan.id, |_| {})
            .unwrap_err()
            .code,
        "PLAN_EXPIRED"
    );
    assert_eq!(modified(&path), MODIFIED);
}

#[test]
fn interrupted_date_changes_and_undo_recover_from_durable_timestamps() {
    let f = Fixture::new();
    let paths: Vec<_> = (0..3).map(|i| f.file(&format!("{i}.jpg"))).collect();
    let plan = f.preview(&paths, false);
    let mut op = metadata_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    for item in &mut op.items {
        item.status = "pending".into();
        history_repository::update_item(&f.engine.db, item).unwrap();
    }
    set_dates(&paths[1], CREATED, MODIFIED);
    set_dates(&paths[2], CREATED, MODIFIED + 10);
    history_service::recover(&f.engine).unwrap();
    let recovered = history_repository::list(&f.engine.db).unwrap().remove(0);
    assert_eq!(recovered.items[0].status, "completed");
    assert_eq!(recovered.items[1].status, "failed");
    assert_eq!(recovered.items[2].status, "recovery-required");
    let mut item = recovered.items[0].clone();
    item.status = "undo-pending".into();
    history_repository::update_item(&f.engine.db, &item).unwrap();
    set_dates(&paths[0], CREATED, MODIFIED);
    history_service::recover(&f.engine).unwrap();
    assert_eq!(
        history_repository::list(&f.engine.db).unwrap()[0].items[0].status,
        "undone"
    );
    assert_eq!(modified(&paths[2]), MODIFIED + 10);
}
