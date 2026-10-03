#![cfg(test)]
use super::{
    access_service::FolderAccess, history_service, inbox_service::InboxEngine, move_service,
    organizer_service,
};
use crate::{
    database::{repositories::history_repository, Database},
    domain::organization::*,
};
use chrono::{Local, TimeZone};
use std::{path::PathBuf, time::Duration};

struct Fixture {
    engine: InboxEngine,
    inbox: PathBuf,
    destination: PathBuf,
    source: PathBuf,
    // Drop SQLite handles before removing the temporary directory on Windows.
    _directory: tempfile::TempDir,
}
fn fixture() -> Fixture {
    let directory = tempfile::tempdir().expect("temp");
    let inbox = directory.path().join("inbox");
    let destination = directory.path().join("periodo-3");
    std::fs::create_dir(&inbox).expect("inbox");
    std::fs::create_dir(&destination).expect("destination");
    let inbox = dunce::canonicalize(inbox).expect("canonical inbox");
    let destination = dunce::canonicalize(destination).expect("canonical destination");
    let source = inbox.join("tarea-1.pdf");
    std::fs::write(&source, b"%PDF-1.7\nexample assignment").expect("source");
    let modified = Local
        .with_ymd_and_hms(2026, 9, 21, 14, 6, 55)
        .single()
        .expect("date")
        .timestamp_millis();
    std::fs::File::options()
        .write(true)
        .open(&source)
        .expect("file")
        .set_modified(std::time::UNIX_EPOCH + Duration::from_millis(modified as u64))
        .expect("time");
    let db = Database::open(&directory.path().join("test.sqlite")).expect("db");
    let access = FolderAccess::default();
    access.grant(&destination).expect("grant");
    let engine = InboxEngine::open(db, access, directory.path().join("test.log")).expect("engine");
    engine.set_inbox(&inbox).expect("configure");
    engine
        .save_rules(vec![DateRule {
            id: "period-3".into(),
            name: "Periodo 3".into(),
            start_date: "2026-08-01".into(),
            end_date: "2026-11-30".into(),
            destination_path: destination.to_string_lossy().into_owned(),
            date_source: DateSource::Modified,
            enabled: true,
        }])
        .expect("rule");
    Fixture {
        _directory: directory,
        engine,
        inbox,
        destination,
        source,
    }
}
fn ready(f: &Fixture) {
    f.engine.reconcile().expect("scan");
    for candidate in f.engine.lock().expect("state").candidates.values_mut() {
        candidate.unchanged_since = std::time::Instant::now() - Duration::from_secs(4);
    }
    f.engine.reconcile().expect("stable scan");
}
#[test]
fn ingestion_uses_shared_rename_preset_and_undo_restores_original_name() {
    use crate::domain::rename::*;
    let f = fixture();
    ready(&f);
    let configuration = RenameConfiguration {
        presets: vec![RenamePreset {
            id: "university".into(),
            name: "Universidad".into(),
            format: "{period}_{date:yyyy-MM-dd}_{name}".into(),
            letter_case: "lower".into(),
            space_replacement: "dash".into(),
            collapse_spaces: true,
            remove_accents: true,
        }],
        inbox_preset_id: Some("university".into()),
        rule_presets: std::collections::BTreeMap::new(),
    };
    super::rename_engine::validate(&configuration).unwrap();
    crate::database::repositories::rename_repository::save(&f.engine.db, &configuration).unwrap();
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).unwrap();
    assert_eq!(
        PathBuf::from(&plan.items[0].destination_path)
            .file_name()
            .unwrap(),
        "periodo-3_2026-09-21_tarea-1.pdf"
    );
    let operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).unwrap();
    assert!(f
        .destination
        .join("periodo-3_2026-09-21_tarea-1.pdf")
        .exists());
    history_service::undo(&f.engine, &operation.id, |_| {}).unwrap();
    assert!(f.source.exists());
}
#[test]
fn configuration_persists_and_duplicate_scans_do_not_duplicate_files() {
    let f = fixture();
    ready(&f);
    f.engine.reconcile().expect("repeat");
    assert_eq!(f.engine.snapshot().expect("snapshot").files.len(), 1);
    let loaded = InboxEngine::open(
        f.engine.db.clone(),
        FolderAccess::default(),
        f._directory.path().join("second.log"),
    )
    .expect("reload");
    assert_eq!(loaded.snapshot().expect("snapshot").rules.len(), 1);
    assert_eq!(
        loaded
            .snapshot()
            .expect("snapshot")
            .inbox
            .expect("inbox")
            .path,
        f.inbox.to_string_lossy()
    );
}
#[test]
fn growing_and_temporary_files_wait() {
    let f = fixture();
    f.engine.reconcile().expect("scan");
    std::fs::write(&f.source, b"more content still copying").expect("grow");
    f.engine.reconcile().expect("scan");
    assert_eq!(
        f.engine.snapshot().expect("snapshot").files[0].status,
        "waiting-for-stability"
    );
    let temporary = f.inbox.join("download.crdownload");
    std::fs::write(temporary, b"partial").expect("temp");
    ready(&f);
    assert_eq!(
        f.engine
            .snapshot()
            .expect("snapshot")
            .files
            .iter()
            .find(|f| f.name.ends_with("crdownload"))
            .expect("temporary")
            .status,
        "waiting-for-stability"
    );
}

#[test]
fn historical_filesystem_dates_before_1970_can_match_rules() {
    let f = fixture();
    let time = Local
        .with_ymd_and_hms(1960, 9, 21, 14, 6, 55)
        .single()
        .expect("date")
        .timestamp_millis();
    std::fs::File::options()
        .write(true)
        .open(&f.source)
        .expect("file")
        .set_modified(std::time::UNIX_EPOCH - Duration::from_millis(time.unsigned_abs()))
        .expect("historical date");
    let mut rules = f.engine.snapshot().expect("snapshot").rules;
    rules[0].start_date = "1960-08-01".into();
    rules[0].end_date = "1960-11-30".into();
    f.engine.save_rules(rules).expect("rule");
    ready(&f);
    let files = f.engine.snapshot().expect("snapshot").files;
    assert_eq!(files[0].status, "matched");
    assert_eq!(files[0].date_used, Some(time));
}
#[cfg(windows)]
#[test]
fn preview_move_history_and_undo_round_trip() {
    let f = fixture();
    ready(&f);
    let snapshot = f.engine.snapshot().expect("snapshot");
    assert_eq!(snapshot.files[0].rule_name.as_deref(), Some("Periodo 3"));
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("preview");
    assert!(f.source.exists());
    let operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).expect("execute");
    assert_eq!(operation.items[0].status, "completed");
    assert!(!f.source.exists());
    assert!(f.destination.join("tarea-1.pdf").exists());
    let undone = history_service::undo(&f.engine, &operation.id, |_| {}).expect("undo");
    assert_eq!(undone.items[0].status, "undone");
    assert!(f.source.exists());
    assert!(!f.destination.join("tarea-1.pdf").exists());
    assert_eq!(
        history_repository::list(&f.engine.db).expect("history")[0].status,
        "undone"
    );
}
#[cfg(windows)]
#[test]
fn content_change_after_preview_and_occupied_undo_paths_are_safe() {
    let f = fixture();
    ready(&f);
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("preview");
    std::fs::write(&f.source, b"changed after review").expect("change");
    let operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).expect("batch");
    assert_eq!(operation.items[0].error.as_deref(), Some("FILE_CHANGED"));
    assert!(f.source.exists());
    assert!(!f.destination.join("tarea-1.pdf").exists());
    // Restore a qualifying timestamp and analyze the new file before creating another plan.
    std::fs::File::options()
        .write(true)
        .open(&f.source)
        .expect("open")
        .set_modified(
            std::time::UNIX_EPOCH
                + Duration::from_millis(
                    Local
                        .with_ymd_and_hms(2026, 9, 21, 14, 6, 55)
                        .single()
                        .expect("date")
                        .timestamp_millis() as u64,
                ),
        )
        .expect("time");
    ready(&f);
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("preview");
    let operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).expect("move");
    std::fs::write(&f.source, b"new file at original path").expect("collision");
    let undone = history_service::undo(&f.engine, &operation.id, |_| {}).expect("undo");
    assert_eq!(undone.items[0].error.as_deref(), Some("DESTINATION_EXISTS"));
    assert_eq!(
        std::fs::read(&f.source).expect("source"),
        b"new file at original path"
    );
    assert!(f.destination.join("tarea-1.pdf").exists());
}
#[cfg(windows)]
#[test]
fn keep_both_and_late_conflicts_never_overwrite() {
    let f = fixture();
    ready(&f);
    let target = f.destination.join("tarea-1.pdf");
    std::fs::write(&target, b"existing").expect("collision");
    let skipped = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("skip");
    assert_eq!(skipped.items[0].action, "skip");
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::KeepBoth).expect("both");
    assert!(plan.items[0].destination_path.ends_with("tarea-1 (1).pdf"));
    std::fs::write(&plan.items[0].destination_path, b"late collision").expect("late");
    let operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).expect("batch");
    assert_eq!(
        operation.items[0].error.as_deref(),
        Some("DESTINATION_EXISTS")
    );
    assert_eq!(std::fs::read(&target).expect("original"), b"existing");
    assert!(f.source.exists());
}
#[cfg(windows)]
#[test]
fn changed_destination_cannot_be_undone() {
    let f = fixture();
    ready(&f);
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("preview");
    let operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).expect("move");
    std::fs::write(
        &operation.items[0].destination_path,
        b"edited in another app",
    )
    .expect("edit");
    let undone = history_service::undo(&f.engine, &operation.id, |_| {}).expect("undo");
    assert_eq!(undone.items[0].error.as_deref(), Some("FILE_CHANGED"));
    assert!(!f.source.exists());
}
#[test]
fn changing_configuration_invalidates_reviewed_plan() {
    let f = fixture();
    ready(&f);
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("preview");
    let rules = f.engine.snapshot().expect("snapshot").rules;
    f.engine.save_rules(rules).expect("save");
    assert_eq!(
        organizer_service::execute(&f.engine, &plan.id, |_| {})
            .expect_err("stale")
            .code,
        "PLAN_EXPIRED"
    );
    assert!(f.source.exists());
}
#[cfg(windows)]
#[test]
fn interrupted_pending_move_is_reconciled_without_deleting_files() {
    let f = fixture();
    ready(&f);
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("preview");
    let mut operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).expect("move");
    operation.items[0].status = "pending".into();
    history_repository::update_item(&f.engine.db, &operation.items[0])
        .expect("simulate interruption");
    history_service::recover(&f.engine).expect("recover");
    assert_eq!(
        history_repository::list(&f.engine.db).expect("history")[0].items[0].status,
        "completed"
    );
    assert!(f.destination.join("tarea-1.pdf").exists());
}
#[cfg(windows)]
#[test]
fn cancellation_happens_between_files_and_preserves_remaining_sources() {
    let f = fixture();
    std::fs::copy(&f.source, f.inbox.join("tarea-2.pdf")).expect("copy");
    // Copy may use a current timestamp: explicitly set the matching date.
    let first = std::fs::metadata(&f.source)
        .expect("metadata")
        .modified()
        .expect("modified");
    std::fs::File::options()
        .write(true)
        .open(f.inbox.join("tarea-2.pdf"))
        .expect("open")
        .set_modified(first)
        .expect("time");
    ready(&f);
    let plan = organizer_service::preview_with_options(
        &f.engine,
        ConflictPolicy::Skip,
        "keep-both",
        &std::collections::BTreeMap::new(),
    )
    .expect("preview");
    let operation = organizer_service::execute(&f.engine, &plan.id, |p| {
        if p.completed == 1 {
            f.engine.cancel();
        }
    })
    .expect("move");
    assert_eq!(
        operation
            .items
            .iter()
            .filter(|i| i.status == "completed")
            .count(),
        1
    );
    assert_eq!(
        operation
            .items
            .iter()
            .filter(|i| i.status == "cancelled")
            .count(),
        1
    );
}
#[cfg(windows)]
#[test]
fn hash_rejects_modified_content_even_if_size_and_timestamp_are_restored() {
    let f = fixture();
    ready(&f);
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("preview");
    let modified = std::fs::metadata(&f.source)
        .expect("metadata")
        .modified()
        .expect("modified");
    let bytes = std::fs::read(&f.source).expect("read");
    std::fs::write(&f.source, vec![b'x'; bytes.len()]).expect("edit");
    std::fs::File::options()
        .write(true)
        .open(&f.source)
        .expect("open")
        .set_modified(modified)
        .expect("time");
    let operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).expect("batch");
    assert_eq!(operation.items[0].error.as_deref(), Some("FILE_CHANGED"));
    let mut file = move_service::open_locked(&f.source, false).expect("lock");
    assert_eq!(
        move_service::stamp(&file.metadata().expect("metadata")),
        plan.items[0].stamp
    );
    assert_ne!(
        move_service::hash(&mut file).expect("hash"),
        plan.items[0].hash
    );
}

#[cfg(windows)]
#[test]
fn requested_150_file_batch_classifies_moves_and_undoes_all_three_periods() {
    let f = fixture();
    // Replace the one-file fixture with exactly 150 generated assignments.
    std::fs::remove_file(&f.source).expect("remove generated fixture");
    let mut rules = Vec::new();
    let mut destinations = Vec::new();
    for (n, start, end) in [
        (1, "2026-02-01", "2026-04-30"),
        (2, "2026-05-01", "2026-07-31"),
        (3, "2026-08-01", "2026-11-30"),
    ] {
        let destination = f._directory.path().join(format!("batch-period-{n}"));
        std::fs::create_dir(&destination).expect("destination");
        let grant = f.engine.access.grant(&destination).expect("grant");
        rules.push(DateRule {
            id: format!("period-{n}"),
            name: format!("Periodo {n}"),
            start_date: start.into(),
            end_date: end.into(),
            destination_path: grant.path.clone(),
            date_source: DateSource::Modified,
            enabled: true,
        });
        destinations.push(PathBuf::from(grant.path));
    }
    f.engine.save_rules(rules).expect("save");
    for number in 1..=150 {
        let path = f.inbox.join(format!("tarea-{number:03}.pdf"));
        std::fs::write(&path, format!("%PDF-1.7\nassignment {number}")).expect("write");
        let month = if number <= 42 {
            3
        } else if number <= 93 {
            6
        } else {
            9
        };
        let date = Local
            .with_ymd_and_hms(2026, month, 21, 14, 6, 55)
            .single()
            .expect("date");
        std::fs::File::options()
            .write(true)
            .open(path)
            .expect("open")
            .set_modified(
                std::time::UNIX_EPOCH + Duration::from_millis(date.timestamp_millis() as u64),
            )
            .expect("date");
    }
    ready(&f);
    let snapshot = f.engine.snapshot().expect("snapshot");
    for (name, count) in [("Periodo 1", 42), ("Periodo 2", 51), ("Periodo 3", 57)] {
        assert_eq!(
            snapshot
                .files
                .iter()
                .filter(|file| file.rule_name.as_deref() == Some(name))
                .count(),
            count
        );
    }
    let plan = organizer_service::preview(&f.engine, ConflictPolicy::Skip).expect("preview");
    assert_eq!(plan.items.len(), 150);
    let operation = organizer_service::execute(&f.engine, &plan.id, |_| {}).expect("move");
    assert_eq!(
        operation
            .items
            .iter()
            .filter(|i| i.status == "completed")
            .count(),
        150
    );
    assert_eq!(std::fs::read_dir(&f.inbox).expect("inbox").count(), 0);
    for (path, count) in destinations.iter().zip([42, 51, 57]) {
        assert_eq!(std::fs::read_dir(path).expect("destination").count(), count);
    }
    let undone = history_service::undo(&f.engine, &operation.id, |_| {}).expect("undo");
    assert_eq!(
        undone.items.iter().filter(|i| i.status == "undone").count(),
        150
    );
    assert_eq!(std::fs::read_dir(&f.inbox).expect("inbox").count(), 150);
    for item in &undone.items {
        let mut file = move_service::open_locked(std::path::Path::new(&item.source_path), false)
            .expect("restored file");
        assert_eq!(move_service::hash(&mut file).expect("hash"), item.hash);
    }
}

#[cfg(windows)]
#[test]
fn locked_files_have_bounded_retries_and_can_be_retried_after_copy_finishes() {
    let f = fixture();
    let copying = std::fs::OpenOptions::new()
        .write(true)
        .open(&f.source)
        .expect("copy handle");
    ready(&f);
    for _ in 0..10 {
        f.engine.reconcile().expect("retry");
    }
    let failed = f.engine.snapshot().expect("snapshot");
    assert_eq!(failed.files[0].status, "failed");
    assert_eq!(failed.files[0].error.as_deref(), Some("FILE_IN_USE"));
    assert_eq!(
        f.engine
            .lock()
            .expect("state")
            .candidates
            .values()
            .next()
            .expect("candidate")
            .retries,
        8
    );
    drop(copying);
    f.engine.retry().expect("retry request");
    ready(&f);
    assert_eq!(
        f.engine.snapshot().expect("snapshot").files[0].status,
        "matched"
    );
}
