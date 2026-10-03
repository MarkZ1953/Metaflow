use super::{
    access_service::FolderAccess, history_service, inbox_service::InboxEngine, transfer_service,
    workspace_service,
};
use crate::{
    database::{repositories::workspace_repository, Database},
    domain::{organization::ConflictPolicy, workspace::TransferRequest},
};
use std::path::{Path, PathBuf};
struct Fixture {
    engine: InboxEngine,
    a: PathBuf,
    b: PathBuf,
    _a: tempfile::TempDir,
    _b: tempfile::TempDir,
}
impl Fixture {
    fn new() -> Self {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir_in(std::env::current_dir().unwrap()).unwrap();
        let ap = dunce::canonicalize(a.path()).unwrap();
        let bp = dunce::canonicalize(b.path()).unwrap();
        let engine = InboxEngine::open(
            Database::open(&ap.join("db.sqlite")).unwrap(),
            FolderAccess::default(),
            ap.join("log.txt"),
        )
        .unwrap();
        workspace_service::add(&engine, &ap).unwrap();
        workspace_service::add(&engine, &bp).unwrap();
        Self {
            engine,
            a: ap,
            b: bp,
            _a: a,
            _b: b,
        }
    }
    fn plan(
        &self,
        sources: Vec<String>,
        mode: &str,
    ) -> crate::domain::organization::OrganizationPlan {
        transfer_service::preview(
            &self.engine,
            TransferRequest {
                sources,
                destination: self.b.to_str().unwrap().into(),
                mode: mode.into(),
                policy: ConflictPolicy::KeepBoth,
                preset_id: None,
                period: String::new(),
                duplicate_action: "keep-both".into(),
                resolutions: std::collections::BTreeMap::new(),
                folder_name: None,
            },
        )
        .unwrap()
    }
}
#[test]
fn independent_roots_persist_and_removal_keeps_contents() {
    let f = Fixture::new();
    std::fs::write(f.a.join("precious.txt"), b"keep").unwrap();
    let workspace = workspace_repository::load(&f.engine.db).unwrap();
    assert_eq!(workspace.roots.len(), 2);
    workspace_service::favorite(&f.engine, &f.b, true).unwrap();
    let restarted = InboxEngine::open(
        f.engine.db.clone(),
        FolderAccess::default(),
        f.a.join("log2.txt"),
    )
    .unwrap();
    workspace_service::restore(&restarted).unwrap();
    assert!(restarted.access.resolve(&f.b).is_ok());
    workspace_service::remove(&f.engine, &workspace.roots[0].id).unwrap();
    assert!(f.a.join("precious.txt").exists());
    assert!(workspace_service::directory(&f.engine, &f.a).is_err());
    assert_eq!(
        workspace_repository::load(&f.engine.db).unwrap().favorites,
        vec![f.b.to_str().unwrap()]
    );
}
#[test]
fn copy_between_volumes_and_undo_preserves_original_and_copy_in_recovery() {
    let f = Fixture::new();
    let from = f.a.join("copy.txt");
    std::fs::write(&from, b"content").unwrap();
    let plan = f.plan(vec![from.to_str().unwrap().into()], "copy");
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert_eq!(op.items[0].status, "completed");
    assert!(from.exists());
    assert!(f.b.join("copy.txt").exists());
    std::fs::write(&from, b"changed original afterwards").unwrap();
    let undo = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undo.items[0].status, "undone", "{:?}", undo.items[0]);
    assert!(!f.b.join("copy.txt").exists());
    assert_eq!(std::fs::read(from).unwrap(), b"changed original afterwards");
    let recovered = undo.items[0].undo_path.as_ref().unwrap();
    assert!(
        Path::new(recovered).exists(),
        "recovery missing: {recovered}; actual files: {:?}",
        std::fs::read_dir(f.b.join(".metaflow-recovery"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect::<Vec<_>>()
    );
    assert_eq!(std::fs::read(recovered).unwrap(), b"content");
}
#[test]
fn batch_move_cancel_and_undo_between_roots() {
    let f = Fixture::new();
    let mut sources = Vec::new();
    for i in 0..100 {
        let path = f.a.join(format!("file-{i}.txt"));
        std::fs::write(&path, format!("content-{i}")).unwrap();
        sources.push(path.to_str().unwrap().into());
    }
    let plan = f.plan(sources.clone(), "move");
    let op = transfer_service::execute(&f.engine, &plan.id, |p| {
        if p.completed == 30 {
            f.engine.cancel();
        }
    })
    .unwrap();
    assert_eq!(
        op.items.iter().filter(|i| i.status == "completed").count(),
        30
    );
    assert_eq!(
        op.items.iter().filter(|i| i.status == "cancelled").count(),
        70
    );
    history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    for source in sources {
        assert!(Path::new(&source).exists());
    }
}
#[test]
fn stale_plan_removed_roots_and_undo_conflict_are_safe() {
    let f = Fixture::new();
    let from = f.a.join("move.txt");
    std::fs::write(&from, b"source").unwrap();
    let plan = f.plan(vec![from.to_str().unwrap().into()], "move");
    let roots = workspace_repository::load(&f.engine.db).unwrap().roots;
    workspace_service::remove(&f.engine, &roots[1].id).unwrap();
    assert!(transfer_service::execute(&f.engine, &plan.id, |_| {}).is_err());
    assert!(from.exists());
    workspace_service::add(&f.engine, &f.b).unwrap();
    let plan = f.plan(vec![from.to_str().unwrap().into()], "move");
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    std::fs::write(&from, b"new source").unwrap();
    let undo = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undo.items[0].error.as_deref(), Some("DESTINATION_EXISTS"));
    assert_eq!(std::fs::read(&from).unwrap(), b"new source");
    assert!(f.b.join("move.txt").exists());
}
#[test]
fn duplicates_with_different_names_and_same_name_with_different_bytes() {
    let f = Fixture::new();
    let from = f.a.join("incoming.txt");
    std::fs::write(&from, b"same data").unwrap();
    std::fs::create_dir(f.b.join("nested")).unwrap();
    let existing = f.b.join("nested/different-name.txt");
    std::fs::write(&existing, b"same data").unwrap();
    let plan = f.plan(vec![from.to_str().unwrap().into()], "move");
    assert_eq!(plan.items[0].duplicates.len(), 1);
    assert_eq!(Path::new(&plan.items[0].duplicates[0].path), existing);
    assert!(!plan.items[0].conflict);
    std::fs::write(f.b.join("incoming.txt"), b"otherdata").unwrap();
    let plan = f.plan(vec![from.to_str().unwrap().into()], "copy");
    assert!(plan.items[0].conflict);
    assert_eq!(plan.items[0].duplicates.len(), 1);
    assert_ne!(
        plan.items[0].hash,
        plan.items[0]
            .existing
            .as_ref()
            .unwrap()
            .hash
            .as_ref()
            .unwrap()
            .as_str()
    );
}
#[test]
fn equal_partial_hash_requires_full_blake3_confirmation() {
    let f = Fixture::new();
    let from = f.a.join("a.bin");
    let mut bytes = vec![0u8; 200_000];
    std::fs::write(&from, &bytes).unwrap();
    bytes[100_000] = 1;
    std::fs::write(f.b.join("b.bin"), bytes).unwrap();
    let plan = f.plan(vec![from.to_str().unwrap().into()], "move");
    assert!(plan.items[0].duplicates.is_empty());
}
#[test]
fn replacing_name_conflict_keeps_backup_and_undo_restores_both_files() {
    let f = Fixture::new();
    let from = f.a.join("same.txt");
    let to = f.b.join("same.txt");
    std::fs::write(&from, b"incoming content").unwrap();
    std::fs::write(&to, b"existing content").unwrap();
    let mut request = TransferRequest {
        sources: vec![from.to_str().unwrap().into()],
        destination: f.b.to_str().unwrap().into(),
        mode: "move".into(),
        policy: ConflictPolicy::Replace,
        preset_id: None,
        period: String::new(),
        duplicate_action: "keep-both".into(),
        resolutions: Default::default(),
        folder_name: None,
    };
    let plan = transfer_service::preview(&f.engine, request.clone()).unwrap();
    assert_eq!(plan.items.len(), 2);
    assert!(plan.items[0].backup);
    assert!(
        !f.b.join(".metaflow-recovery").exists(),
        "preview must not mutate folders"
    );
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert_eq!(std::fs::read(&to).unwrap(), b"incoming content");
    assert_eq!(
        std::fs::read(&op.items[0].destination_path).unwrap(),
        b"existing content"
    );
    let undone = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undone.status, "undone");
    assert_eq!(std::fs::read(&from).unwrap(), b"incoming content");
    assert_eq!(std::fs::read(&to).unwrap(), b"existing content");
    request.mode = "copy".into();
    let plan = transfer_service::preview(&f.engine, request).unwrap();
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    let undone = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undone.status, "undone");
    assert_eq!(std::fs::read(to).unwrap(), b"existing content");
    assert!(from.exists());
}
#[test]
fn duplicate_skip_and_keep_incoming_are_explicit_and_reversible() {
    let f = Fixture::new();
    let from = f.a.join("incoming.txt");
    let existing = f.b.join("old-name.txt");
    std::fs::write(&from, b"identical").unwrap();
    std::fs::write(&existing, b"identical").unwrap();
    let mut request = TransferRequest {
        sources: vec![from.to_str().unwrap().into()],
        destination: f.b.to_str().unwrap().into(),
        mode: "move".into(),
        policy: ConflictPolicy::Skip,
        preset_id: None,
        period: String::new(),
        duplicate_action: "skip".into(),
        resolutions: Default::default(),
        folder_name: None,
    };
    let plan = transfer_service::preview(&f.engine, request.clone()).unwrap();
    assert_eq!(plan.items[0].action, "skip");
    assert!(from.exists());
    assert!(existing.exists());
    request.duplicate_action = "keep-incoming".into();
    let plan = transfer_service::preview(&f.engine, request).unwrap();
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert!(f.b.join("incoming.txt").exists());
    assert!(!existing.exists());
    assert_eq!(
        std::fs::read(&op.items[0].destination_path).unwrap(),
        b"identical"
    );
    history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert!(from.exists());
    assert!(existing.exists());
}
#[test]
fn nested_and_empty_folders_move_copy_and_undo_between_volumes() {
    let f = Fixture::new();
    let source = f.a.join("courses");
    std::fs::create_dir_all(source.join("empty")).unwrap();
    std::fs::create_dir_all(source.join("nested/deeper")).unwrap();
    std::fs::write(source.join("nested/deeper/task.txt"), b"course content").unwrap();
    let plan = f.plan(vec![source.to_str().unwrap().into()], "move");
    assert!(plan.items.iter().any(|i| i.action == "mkdir"));
    assert!(plan.items.iter().any(|i| i.action == "rmdir"));
    assert!(!f.b.join("courses").exists());
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert_eq!(op.status, "completed", "{:?}", op);
    assert!(!source.exists());
    assert_eq!(
        std::fs::read(f.b.join("courses/nested/deeper/task.txt")).unwrap(),
        b"course content"
    );
    assert!(f.b.join("courses/empty").is_dir());
    let undo = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undo.status, "undone", "{:?}", undo);
    assert!(source.join("empty").is_dir());
    assert!(source.join("nested/deeper/task.txt").is_file());
    assert!(!f.b.join("courses").exists());
    let plan = f.plan(vec![source.to_str().unwrap().into()], "copy");
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert_eq!(op.status, "completed", "{:?}", op);
    let undo = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undo.status, "undone", "{:?}", undo);
    assert!(source.join("nested/deeper/task.txt").exists());
    assert!(!f.b.join("courses").exists());
    assert!(f.b.join(".metaflow-recovery").exists());
}
#[test]
fn folder_move_keeps_new_files_and_copy_undo_keeps_unrelated_destination_files() {
    let f = Fixture::new();
    let source = f.a.join("folder");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("a.txt"), b"a").unwrap();
    let plan = f.plan(vec![source.to_str().unwrap().into()], "move");
    let op = transfer_service::execute(&f.engine, &plan.id, |p| {
        if p.completed == 2 {
            std::fs::write(source.join("arrived.txt"), b"new").unwrap();
        }
    })
    .unwrap();
    assert_eq!(op.status, "partial");
    assert_eq!(std::fs::read(source.join("arrived.txt")).unwrap(), b"new");
    assert!(f.b.join("folder/a.txt").exists());
    let source2 = f.a.join("copy-folder");
    std::fs::create_dir(&source2).unwrap();
    std::fs::write(source2.join("b.txt"), b"b").unwrap();
    let plan = f.plan(vec![source2.to_str().unwrap().into()], "copy");
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    std::fs::write(f.b.join("copy-folder/unrelated.txt"), b"keep").unwrap();
    let undo = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undo.status, "partial");
    assert_eq!(
        std::fs::read(f.b.join("copy-folder/unrelated.txt")).unwrap(),
        b"keep"
    );
}
#[test]
fn folder_rename_is_previewed_and_undo_restores_name() {
    let f = Fixture::new();
    let source = f.a.join("before");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("a.txt"), b"a").unwrap();
    let request = TransferRequest {
        sources: vec![source.to_str().unwrap().into()],
        destination: f.a.to_str().unwrap().into(),
        mode: "move".into(),
        policy: ConflictPolicy::Skip,
        preset_id: None,
        period: String::new(),
        duplicate_action: "keep-both".into(),
        resolutions: Default::default(),
        folder_name: Some("after".into()),
    };
    let plan = transfer_service::preview(&f.engine, request).unwrap();
    let op = transfer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert_eq!(op.status, "completed");
    assert!(f.a.join("after/a.txt").exists());
    history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert!(source.join("a.txt").exists());
    assert!(!f.a.join("after").exists());
}
#[test]
fn five_thousand_files_use_one_batch_report_bytes_and_undo_all() {
    let f = Fixture::new();
    let mut sources = Vec::new();
    let mut expected_bytes = 0u64;
    for i in 0..5_000 {
        let path = f.a.join(format!("batch-{i:04}.txt"));
        let bytes = format!("batch item {i}: unique content");
        expected_bytes += bytes.len() as u64;
        std::fs::write(&path, bytes).unwrap();
        sources.push(path.to_str().unwrap().to_string());
    }
    let plan = f.plan(sources.clone(), "move");
    assert_eq!(plan.items.len(), 5_000);
    let completed = std::cell::Cell::new(0);
    let bytes = std::cell::Cell::new(0);
    let op = transfer_service::execute(&f.engine, &plan.id, |p| {
        completed.set(p.completed);
        bytes.set(p.completed_bytes);
        assert_eq!(p.total_bytes, expected_bytes);
    })
    .unwrap();
    assert_eq!(op.status, "completed");
    assert_eq!(completed.get(), 5_000);
    assert_eq!(bytes.get(), expected_bytes);
    let undone = history_service::undo(&f.engine, &op.id, |_| {}).unwrap();
    assert_eq!(undone.status, "undone");
    for (i, source) in sources.iter().enumerate() {
        assert_eq!(
            std::fs::read(source).unwrap(),
            format!("batch item {i}: unique content").as_bytes()
        );
        assert!(!f.b.join(format!("batch-{i:04}.txt")).exists());
    }
}

#[test]
fn duplicate_scan_cleanup_and_undo_preserve_every_content() {
    use super::{duplicate_service, file_operation_service};
    let f = Fixture::new();
    let keeper = f.a.join("keep.txt");
    let other = f.b.join("different-name.txt");
    std::fs::write(&keeper, b"same content").unwrap();
    std::fs::write(&other, b"same content").unwrap();
    let scan = duplicate_service::scan(&f.engine).unwrap();
    assert_eq!(scan.groups.len(), 1);
    assert_eq!(scan.groups[0].files.len(), 2);
    let plan = duplicate_service::preview_cleanup(
        &f.engine,
        keeper.to_str().unwrap(),
        scan.groups[0]
            .files
            .iter()
            .map(|i| i.path.clone())
            .collect(),
        &scan.groups[0].hash,
    )
    .unwrap();
    assert!(!f.b.join(".metaflow-recovery").exists());
    let plan = file_operation_service::take_plan(&f.engine, &plan.id, "duplicates").unwrap();
    let operation = file_operation_service::execute(&f.engine, &plan, |_| {}, |_| Ok(())).unwrap();
    assert_eq!(operation.status, "completed");
    assert_eq!(std::fs::read(&keeper).unwrap(), b"same content");
    assert!(!other.exists());
    assert_eq!(
        std::fs::read(&operation.items[0].destination_path).unwrap(),
        b"same content"
    );
    assert!(
        duplicate_service::scan(&f.engine)
            .unwrap()
            .groups
            .is_empty(),
        "recovery copies must not be included in scans"
    );
    let undo = history_service::undo(&f.engine, &operation.id, |_| {}).unwrap();
    assert_eq!(undo.status, "undone");
    assert_eq!(std::fs::read(&other).unwrap(), b"same content");
}

#[test]
fn changed_keeper_after_review_prevents_duplicate_retirement() {
    use super::{duplicate_service, file_operation_service};
    let f = Fixture::new();
    let keeper = f.a.join("keep.txt");
    let other = f.b.join("other.txt");
    std::fs::write(&keeper, b"identical").unwrap();
    std::fs::write(&other, b"identical").unwrap();
    let scan = duplicate_service::scan(&f.engine).unwrap();
    let plan = duplicate_service::preview_cleanup(
        &f.engine,
        keeper.to_str().unwrap(),
        vec![
            keeper.to_str().unwrap().into(),
            other.to_str().unwrap().into(),
        ],
        &scan.groups[0].hash,
    )
    .unwrap();
    std::fs::write(&keeper, b"new content").unwrap();
    let plan = file_operation_service::take_plan(&f.engine, &plan.id, "duplicates").unwrap();
    let operation = file_operation_service::execute(&f.engine, &plan, |_| {}, |_| Ok(())).unwrap();
    assert_eq!(operation.items[0].error.as_deref(), Some("FILE_CHANGED"));
    assert_eq!(std::fs::read(&other).unwrap(), b"identical");
    assert_eq!(std::fs::read(&keeper).unwrap(), b"new content");
}

#[test]
fn folder_root_and_favorites_remap_survive_restart_and_undo() {
    use super::{file_operation_service, folder_operation_service};
    let f = Fixture::new();
    let source = f.a.join("course");
    std::fs::create_dir_all(source.join("notes")).unwrap();
    std::fs::write(source.join("notes/task.txt"), b"task").unwrap();
    workspace_service::add(&f.engine, &source).unwrap();
    workspace_service::favorite(&f.engine, &source.join("notes"), true).unwrap();
    let plan = f.plan(vec![source.to_str().unwrap().into()], "move");
    // Simulate a crash after the filesystem journal completes and before reference remapping.
    let plan = file_operation_service::take_plan(&f.engine, &plan.id, "workspace").unwrap();
    let operation = file_operation_service::execute(&f.engine, &plan, |_| {}, |_| Ok(())).unwrap();
    assert_eq!(operation.status, "completed");
    let restarted = InboxEngine::open(
        f.engine.db.clone(),
        FolderAccess::default(),
        f.a.join("restart.log"),
    )
    .unwrap();
    workspace_service::restore(&restarted).unwrap();
    let target = f.b.join("course");
    let workspace = workspace_repository::load(&restarted.db).unwrap();
    assert!(workspace.roots.iter().any(|r| Path::new(&r.path) == target));
    assert_eq!(
        workspace.favorites,
        vec![target.join("notes").to_str().unwrap()]
    );
    // Replaying applied markers is idempotent.
    folder_operation_service::update_references(&restarted, &operation, false).unwrap();
    let undo = history_service::undo(&restarted, &operation.id, |_| {}).unwrap();
    assert_eq!(undo.status, "undone", "{:?}", undo);
    let workspace = workspace_repository::load(&restarted.db).unwrap();
    assert!(workspace.roots.iter().any(|r| Path::new(&r.path) == source));
    assert_eq!(
        workspace.favorites,
        vec![source.join("notes").to_str().unwrap()]
    );
    workspace_service::restore(&restarted).unwrap();
    assert!(source.join("notes/task.txt").exists());
}

#[test]
fn version_one_database_migrates_without_losing_history_or_configuration() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("legacy.sqlite");
    {
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(include_str!("../database/migrations/001-initial.sql"))
            .unwrap();
        c.execute(
            "INSERT INTO settings VALUES ('legacy-setting','preserved')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO operations VALUES ('old-operation',1,'completed')",
            [],
        )
        .unwrap();
        let payload = serde_json::json!({
            "id":"old-item", "operationId":"old-operation", "sourcePath":"C:\\old.txt", "destinationPath":"F:\\old.txt",
            "ruleName":"Periodo 3", "dateSource":"modified", "dateUsed":1,
            "stamp":{"size":4,"modifiedAt":1,"createdAt":1}, "hash":"digest", "identity":"old-id", "status":"completed", "error":null
        });
        c.execute(
            "INSERT INTO operation_items VALUES ('old-item','old-operation',0,?1)",
            [payload.to_string()],
        )
        .unwrap();
    }
    for _ in 0..2 {
        let db = Database::open(&path).unwrap();
        assert!(workspace_repository::load(&db).unwrap().roots.is_empty());
        let history = crate::database::repositories::history_repository::list(&db).unwrap();
        assert_eq!(history[0].items[0].kind, "move");
        assert_eq!(history[0].items[0].entry_kind, "file");
        db.with(|c| {
            assert_eq!(
                c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))?,
                2
            );
            assert_eq!(
                c.pragma_query_value(None, "foreign_keys", |r| r.get::<_, i64>(0))?,
                1
            );
            assert_eq!(
                c.query_row(
                    "SELECT value FROM settings WHERE key='legacy-setting'",
                    [],
                    |r| r.get::<_, String>(0)
                )?,
                "preserved"
            );
            Ok(())
        })
        .unwrap();
    }
}
