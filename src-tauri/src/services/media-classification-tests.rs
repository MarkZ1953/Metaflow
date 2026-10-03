use super::{
    access_service::FolderAccess, history_service, media_classification_service as media,
    workspace_service,
};
use crate::{
    database::Database,
    domain::{
        media_classification::{
            AnalysisMode, DetectionSettings, MediaCategory, MediaScan, MediaScanOptions,
            Sensitivity,
        },
        organization::ConflictPolicy,
        workspace::TransferRequest,
    },
    services::inbox_service::InboxEngine,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use std::path::{Path, PathBuf};

struct Fixture {
    engine: InboxEngine,
    root: PathBuf,
    database: PathBuf,
    _temporary: tempfile::TempDir,
}
impl Fixture {
    fn new() -> Self {
        // Native parent-directory pinning requests a read-data handle. Place
        // fixture ancestors in the workspace, where the test sandbox grants it.
        let base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".verification/media-tests");
        std::fs::create_dir_all(&base).unwrap();
        let temporary = tempfile::tempdir_in(base).unwrap();
        let parent = dunce::canonicalize(temporary.path()).unwrap();
        let root = parent.join("photos");
        std::fs::create_dir(&root).unwrap();
        let database = parent.join("state.sqlite");
        let engine = InboxEngine::open(
            Database::open(&database).unwrap(),
            FolderAccess::default(),
            parent.join("log.txt"),
        )
        .unwrap();
        workspace_service::add(&engine, &root).unwrap();
        Self {
            engine,
            root,
            database,
            _temporary: temporary,
        }
    }
    fn png(&self, name: &str, color: [u8; 3]) -> PathBuf {
        let path = self.root.join(name);
        DynamicImage::ImageRgb8(RgbImage::from_fn(1600, 800, |x, y| {
            if x % 100 < 50 && y % 100 < 50 {
                Rgb(color)
            } else {
                Rgb([200, 200, 200])
            }
        }))
        .save(&path)
        .unwrap();
        seed_cache(&self.engine, &path, "people");
        path
    }
    fn scan(&self) -> crate::domain::media_classification::MediaScan {
        media::scan(&self.engine, options(), |_| {}).unwrap()
    }
    fn restarted(&self) -> InboxEngine {
        let engine = InboxEngine::open(
            Database::open(&self.database).unwrap(),
            FolderAccess::default(),
            self.root.parent().unwrap().join("restart.log"),
        )
        .unwrap();
        workspace_service::restore(&engine).unwrap();
        engine
    }
}
fn options() -> MediaScanOptions {
    MediaScanOptions {
        folder_path: None,
        folder_paths: None,
        recursive: true,
        include_videos: true,
    }
}
fn selected_options(paths: &[&Path]) -> MediaScanOptions {
    MediaScanOptions {
        folder_paths: Some(
            paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
        ),
        ..options()
    }
}
fn selected_folder(fixture: &Fixture, name: &str) -> PathBuf {
    let path = fixture.root.parent().unwrap().join(name);
    std::fs::create_dir(&path).unwrap();
    fixture.engine.access.grant(&path).unwrap();
    path
}
fn selected_photo(fixture: &Fixture, folder: &Path, name: &str, color: [u8; 3]) -> PathBuf {
    let path = folder.join(name);
    DynamicImage::ImageRgb8(RgbImage::from_pixel(80, 60, Rgb(color)))
        .save(&path)
        .unwrap();
    seed_cache(&fixture.engine, &path, "people");
    path
}
fn seed_cache(engine: &InboxEngine, path: &Path, category: &str) {
    seed_embedding_cache(engine, path, category, Vec::new());
}
fn seed_embedding_cache(engine: &InboxEngine, path: &Path, category: &str, embedding: Vec<f32>) {
    let hash = blake3::hash(&std::fs::read(path).unwrap())
        .to_hex()
        .to_string();
    let settings = media::load_settings(engine).unwrap().settings;
    let key = media::cache_key(&hash, &media::cache_profile(&settings));
    let json = serde_json::json!({"labels":[{"category":category,"score":0.32}],"uncertain":false,"embedding":embedding})
        .to_string();
    engine
        .db
        .with(|db| {
            db.execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
                rusqlite::params![key, json],
            )?;
            Ok(())
        })
        .unwrap();
}

fn transfer_request(
    scan: &MediaScan,
    ids: &[String],
    destination: &Path,
    mode: &str,
    policy: ConflictPolicy,
) -> TransferRequest {
    TransferRequest {
        sources: scan
            .entries
            .iter()
            .filter(|entry| ids.contains(&entry.id))
            .map(|entry| entry.path.clone())
            .collect(),
        destination: destination.to_str().unwrap().into(),
        mode: mode.into(),
        policy,
        preset_id: None,
        period: String::new(),
        duplicate_action: "keep-both".into(),
        resolutions: Default::default(),
        folder_name: None,
    }
}
fn transfer_destination(fixture: &Fixture) -> PathBuf {
    let destination = fixture.root.parent().unwrap().join("saved");
    std::fs::create_dir(&destination).unwrap();
    fixture.engine.access.grant(&destination).unwrap();
    destination
}

fn feature(cosine: f32) -> Vec<f32> {
    let mut embedding = vec![0.0; 512];
    embedding[0] = cosine;
    embedding[1] = (1.0 - cosine * cosine).sqrt();
    embedding
}

#[test]
fn categories_apply_to_identical_copies_survive_restart_and_are_independent_of_preservation() {
    let fixture = Fixture::new();
    let original = fixture.png("a-original.png", [25, 72, 150]);
    std::fs::copy(&original, fixture.root.join("b-copy.png")).unwrap();
    let scan = fixture.scan();
    let ids = [scan.entries[0].id.clone()];
    media::protect(&fixture.engine, &scan.session_id, &ids, true).unwrap();
    let categories = vec![MediaCategory::Screenshots, MediaCategory::Memes];
    let entries = media::set_categories(
        &fixture.engine,
        &scan.session_id,
        &ids,
        Some(categories.clone()),
    )
    .unwrap();
    assert!(entries
        .iter()
        .all(|entry| entry.corrected && entry.protected));
    assert!(entries
        .iter()
        .all(|entry| !entry.learned && !entry.uncertain));
    assert_eq!(
        media::load_settings(&fixture.engine)
            .unwrap()
            .correction_count,
        1
    );
    let restarted = fixture.restarted();
    let scan = media::scan(&restarted, options(), |_| {}).unwrap();
    assert!(scan
        .entries
        .iter()
        .all(|entry| entry.corrected && entry.protected));
    assert!(scan.entries.iter().all(|entry| entry
        .labels
        .iter()
        .map(|label| label.category)
        .collect::<Vec<_>>()
        == categories));
    let entries = media::set_categories(
        &restarted,
        &scan.session_id,
        &[scan.entries[0].id.clone()],
        None,
    )
    .unwrap();
    assert!(entries
        .iter()
        .all(|entry| !entry.corrected && entry.protected));
    assert!(entries
        .iter()
        .all(|entry| entry.labels[0].category == MediaCategory::People));
    assert_eq!(
        media::load_settings(&restarted).unwrap().correction_count,
        0
    );
}

#[test]
fn category_batch_rejects_stale_or_invalid_inputs_before_persisting_any_labels() {
    let fixture = Fixture::new();
    fixture.png("a.png", [31, 41, 51]);
    let second = fixture.png("b.png", [62, 72, 82]);
    let scan = fixture.scan();
    let ids: Vec<_> = scan.entries.iter().map(|entry| entry.id.clone()).collect();
    for categories in [
        Vec::new(),
        vec![MediaCategory::People, MediaCategory::People],
    ] {
        assert_eq!(
            media::set_categories(&fixture.engine, &scan.session_id, &ids, Some(categories))
                .unwrap_err()
                .code,
            "INVALID_MEDIA_CATEGORIES"
        );
    }
    assert_eq!(
        media::set_categories(
            &fixture.engine,
            "expired-session",
            &ids,
            Some(vec![MediaCategory::Animals])
        )
        .unwrap_err()
        .code,
        "CLASSIFICATION_REVIEW_EXPIRED"
    );
    DynamicImage::ImageRgb8(RgbImage::from_pixel(80, 80, Rgb([5, 6, 7])))
        .save(&second)
        .unwrap();
    assert_eq!(
        media::set_categories(
            &fixture.engine,
            &scan.session_id,
            &ids,
            Some(vec![MediaCategory::Animals])
        )
        .unwrap_err()
        .code,
        "FILE_CHANGED"
    );
    assert_eq!(
        media::load_settings(&fixture.engine)
            .unwrap()
            .correction_count,
        0
    );
    seed_cache(&fixture.engine, &second, "people");
    assert!(fixture.scan().entries.iter().all(|entry| !entry.corrected));
}

#[test]
fn close_feedback_examples_improve_suggestions_but_distant_images_and_disabled_learning_do_not() {
    let fixture = Fixture::new();
    let example = fixture.png("a-example.png", [35, 55, 105]);
    let similar = fixture.png("b-similar.png", [45, 65, 115]);
    let distant = fixture.png("c-distant.png", [75, 95, 145]);
    seed_embedding_cache(&fixture.engine, &example, "people", feature(1.0));
    seed_embedding_cache(&fixture.engine, &similar, "people", feature(0.97));
    seed_embedding_cache(&fixture.engine, &distant, "people", feature(0.4));
    let scan = fixture.scan();
    media::set_categories(
        &fixture.engine,
        &scan.session_id,
        &[scan.entries[0].id.clone()],
        Some(vec![MediaCategory::Screenshots]),
    )
    .unwrap();
    let scan = fixture.scan();
    assert!(scan.entries[0].corrected);
    assert!(scan.entries[1].learned && scan.entries[1].uncertain && !scan.entries[1].corrected);
    assert_eq!(
        scan.entries[1].labels[0].category,
        MediaCategory::Screenshots
    );
    assert!(!scan.entries[2].learned);
    assert_eq!(scan.entries[2].labels[0].category, MediaCategory::People);
    let mut settings = media::load_settings(&fixture.engine).unwrap().settings;
    settings.use_corrections = false;
    media::save_settings(&fixture.engine, settings).unwrap();
    let scan = fixture.scan();
    assert!(
        scan.entries[0].corrected,
        "manual category choices always apply"
    );
    assert!(!scan.entries[1].learned);
    assert_eq!(scan.entries[1].labels[0].category, MediaCategory::People);
}

#[test]
fn opposing_similar_examples_do_not_override_model_categories_and_old_modes_do_not_mix() {
    let fixture = Fixture::new();
    let first = fixture.png("a.png", [14, 34, 74]);
    let second = fixture.png("b.png", [24, 44, 84]);
    let undecided = fixture.png("c.png", [54, 74, 114]);
    for path in [&first, &second, &undecided] {
        seed_embedding_cache(&fixture.engine, path, "people", feature(1.0));
    }
    let scan = fixture.scan();
    media::set_categories(
        &fixture.engine,
        &scan.session_id,
        &[scan.entries[0].id.clone()],
        Some(vec![MediaCategory::Memes]),
    )
    .unwrap();
    media::set_categories(
        &fixture.engine,
        &scan.session_id,
        &[scan.entries[1].id.clone()],
        Some(vec![MediaCategory::Documents]),
    )
    .unwrap();
    let scan = fixture.scan();
    assert!(!scan.entries[2].learned);
    assert_eq!(scan.entries[2].labels[0].category, MediaCategory::People);
    media::set_categories(
        &fixture.engine,
        &scan.session_id,
        &[scan.entries[1].id.clone()],
        None,
    )
    .unwrap();
    assert!(fixture.scan().entries[2].learned);
    let mut settings = media::load_settings(&fixture.engine).unwrap().settings;
    settings.analysis_mode = AnalysisMode::Fast;
    media::save_settings(&fixture.engine, settings).unwrap();
    for path in [&first, &second, &undecided] {
        seed_embedding_cache(&fixture.engine, path, "people", feature(1.0));
    }
    let scan = fixture.scan();
    assert!(scan.entries[0].corrected);
    assert!(
        !scan.entries[2].learned,
        "features from distinct analysis modes do not mix"
    );
}

#[test]
fn forgetting_examples_restores_live_model_suggestions_without_removing_keep_marks() {
    let fixture = Fixture::new();
    let first = fixture.png("a.png", [112, 74, 34]);
    let second = fixture.png("b.png", [142, 84, 44]);
    seed_embedding_cache(&fixture.engine, &first, "people", feature(1.0));
    seed_embedding_cache(&fixture.engine, &second, "people", feature(0.98));
    let scan = fixture.scan();
    let ids = [scan.entries[0].id.clone()];
    media::protect(&fixture.engine, &scan.session_id, &ids, true).unwrap();
    media::set_categories(
        &fixture.engine,
        &scan.session_id,
        &ids,
        Some(vec![MediaCategory::Animals]),
    )
    .unwrap();
    let scan = fixture.scan();
    assert!(scan.entries[1].learned);
    let reset = media::clear_corrections(&fixture.engine).unwrap();
    assert_eq!(reset.configuration.correction_count, 0);
    assert_eq!(reset.entries.len(), 2);
    assert!(reset.entries.iter().all(|entry| !entry.corrected
        && !entry.learned
        && entry.labels[0].category == MediaCategory::People));
    assert!(reset.entries[0].protected);
    assert!(!fixture.scan().entries[1].learned);
}

#[test]
fn detection_settings_survive_restart_and_cache_changes_require_fresh_inference() {
    let fixture = Fixture::new();
    let photo = fixture.png("photo.png", [18, 38, 58]);
    assert_eq!(
        media::load_settings(&fixture.engine).unwrap().settings,
        DetectionSettings::default()
    );
    assert_eq!(
        fixture.scan().entries[0].labels[0].category,
        MediaCategory::People
    );
    let settings = DetectionSettings {
        sensitivity: Sensitivity::Broad,
        analysis_mode: AnalysisMode::Fast,
        read_text: false,
        use_corrections: false,
    };
    media::save_settings(&fixture.engine, settings.clone()).unwrap();
    assert_eq!(
        media::load_settings(&fixture.restarted()).unwrap().settings,
        settings
    );
    assert_eq!(
        media::scan(&fixture.engine, options(), |_| {})
            .unwrap_err()
            .code,
        "MEDIA_MODEL_INVALID",
        "a cache from the previous configuration cannot satisfy this scan"
    );
    seed_cache(&fixture.engine, &photo, "animals");
    assert_eq!(
        fixture.scan().entries[0].labels[0].category,
        MediaCategory::Animals
    );
    assert!(serde_json::from_value::<DetectionSettings>(serde_json::json!({"sensitivity":"unsafe", "analysisMode":"fast", "readText":true,"useCorrections":true})).is_err());
}

#[cfg(windows)]
#[test]
fn classification_transfer_moves_kept_photos_and_videos_without_adding_scan_roots_and_can_undo() {
    let fixture = Fixture::new();
    let photo = fixture.png("a-photo.png", [31, 82, 156]);
    let video = fixture.root.join("b-video.mp4");
    std::fs::write(&video, b"cached video transfer fixture").unwrap();
    seed_cache(&fixture.engine, &video, "people");
    fixture.png("c-remains.png", [44, 71, 212]);
    let photo_before = std::fs::read(&photo).unwrap();
    let scan = fixture.scan();
    let ids: Vec<_> = scan.entries[..2]
        .iter()
        .map(|entry| entry.id.clone())
        .collect();
    media::protect(&fixture.engine, &scan.session_id, &ids, true).unwrap();
    let destination = transfer_destination(&fixture);
    let roots_before =
        crate::database::repositories::workspace_repository::load(&fixture.engine.db).unwrap();
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::KeepBoth),
    )
    .unwrap();
    assert!(photo.exists() && video.exists());
    assert!(std::fs::read_dir(&destination).unwrap().next().is_none());
    let result =
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {}).unwrap();
    assert_eq!(result.operation.status, "completed");
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].name, "c-remains.png");
    assert!(!photo.exists() && !video.exists());
    assert_eq!(
        std::fs::read(destination.join("a-photo.png")).unwrap(),
        photo_before
    );
    assert_eq!(
        std::fs::read(destination.join("b-video.mp4")).unwrap(),
        b"cached video transfer fixture"
    );
    let updated = media::protect(
        &fixture.engine,
        &scan.session_id,
        &[result.entries[0].id.clone()],
        true,
    )
    .unwrap();
    assert_eq!(
        updated.len(),
        1,
        "subsequent protection cannot resurrect moved entries"
    );
    assert_eq!(
        crate::database::repositories::workspace_repository::load(&fixture.engine.db)
            .unwrap()
            .roots
            .len(),
        roots_before.roots.len()
    );
    assert_eq!(
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {})
            .unwrap_err()
            .code,
        "PLAN_EXPIRED"
    );
    let undone = history_service::undo(&fixture.engine, &result.operation.id, |_| {}).unwrap();
    assert_eq!(undone.status, "undone");
    assert_eq!(std::fs::read(photo).unwrap(), photo_before);
    assert!(video.exists());
    assert!(fixture.scan().entries.iter().all(|entry| entry.protected));
}

#[cfg(windows)]
#[test]
fn classification_transfer_copy_keeps_gallery_entries_and_filename_conflicts_keep_both_files() {
    let fixture = Fixture::new();
    let photo = fixture.png("same.png", [31, 92, 56]);
    let scan = fixture.scan();
    let ids = vec![scan.entries[0].id.clone()];
    let destination = transfer_destination(&fixture);
    let existing = destination.join("same.png");
    std::fs::write(&existing, b"existing precious content").unwrap();
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "copy", ConflictPolicy::KeepBoth),
    )
    .unwrap();
    assert!(plan.items[0].conflict);
    assert_ne!(Path::new(&plan.items[0].destination_path), existing);
    let result =
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {}).unwrap();
    assert_eq!(result.operation.status, "completed");
    assert_eq!(result.entries[0].id, ids[0]);
    assert!(photo.exists());
    assert_eq!(
        std::fs::read(&existing).unwrap(),
        b"existing precious content"
    );
    assert_eq!(
        std::fs::read(&result.operation.items[0].destination_path).unwrap(),
        std::fs::read(&photo).unwrap()
    );
    assert!(media::protect(&fixture.engine, &scan.session_id, &ids, true).unwrap()[0].protected);
    assert_eq!(
        history_service::undo(&fixture.engine, &result.operation.id, |_| {})
            .unwrap()
            .status,
        "undone"
    );
    assert!(photo.exists() && existing.exists());
}

#[test]
fn classification_transfer_rejects_ungranted_destinations_and_paths_outside_the_selection() {
    let fixture = Fixture::new();
    let photo = fixture.png("photo.png", [41, 32, 156]);
    let scan = fixture.scan();
    let ids = vec![scan.entries[0].id.clone()];
    let ungranted = fixture.root.parent().unwrap().join("ungranted");
    std::fs::create_dir(&ungranted).unwrap();
    assert_eq!(
        media::preview_transfer(
            &fixture.engine,
            &scan.session_id,
            &ids,
            transfer_request(&scan, &ids, &ungranted, "move", ConflictPolicy::KeepBoth)
        )
        .unwrap_err()
        .code,
        "FOLDER_NOT_AUTHORIZED"
    );
    let destination = transfer_destination(&fixture);
    let mut request = transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::KeepBoth);
    request.sources[0] = fixture.root.join("unselected.png").to_str().unwrap().into();
    assert_eq!(
        media::preview_transfer(&fixture.engine, &scan.session_id, &ids, request)
            .unwrap_err()
            .code,
        "INVALID_TRANSFER"
    );
    let mut request = transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::KeepBoth);
    request.duplicate_action = "keep-incoming".into();
    assert_eq!(
        media::preview_transfer(&fixture.engine, &scan.session_id, &ids, request)
            .unwrap_err()
            .code,
        "INVALID_TRANSFER"
    );
    assert!(photo.exists());
}

#[test]
fn classification_transfer_rejects_edits_at_preview_and_preflights_all_files_again_before_execution(
) {
    let fixture = Fixture::new();
    let first = fixture.png("a.png", [43, 28, 115]);
    let second = fixture.png("b.png", [86, 61, 215]);
    let scan = fixture.scan();
    let ids: Vec<_> = scan.entries.iter().map(|entry| entry.id.clone()).collect();
    let destination = transfer_destination(&fixture);
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::KeepBoth),
    )
    .unwrap();
    std::fs::write(&second, b"changed after review").unwrap();
    assert_eq!(
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {})
            .unwrap_err()
            .code,
        "FILE_CHANGED"
    );
    assert!(first.exists() && second.exists());
    assert!(std::fs::read_dir(&destination).unwrap().next().is_none());
    assert!(
        crate::database::repositories::history_repository::list(&fixture.engine.db)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        media::preview_transfer(
            &fixture.engine,
            &scan.session_id,
            &ids,
            transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::KeepBoth)
        )
        .unwrap_err()
        .code,
        "FILE_CHANGED"
    );
}

#[cfg(windows)]
#[test]
fn classification_transfer_partial_failure_retains_failed_files_in_native_session() {
    let fixture = Fixture::new();
    let first = fixture.png("a.png", [63, 78, 125]);
    let second = fixture.png("b.png", [136, 11, 245]);
    let scan = fixture.scan();
    let ids: Vec<_> = scan.entries.iter().map(|entry| entry.id.clone()).collect();
    let destination = transfer_destination(&fixture);
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::KeepBoth),
    )
    .unwrap();
    let introduced = std::cell::Cell::new(false);
    let result = media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |progress| {
        if progress.completed == 1 && !introduced.replace(true) {
            std::fs::write(destination.join("b.png"), b"arrived during transfer").unwrap();
        }
    })
    .unwrap();
    assert_eq!(result.operation.status, "partial");
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].name, "b.png");
    assert!(!first.exists() && second.exists());
    assert_eq!(
        std::fs::read(destination.join("b.png")).unwrap(),
        b"arrived during transfer"
    );
    let updated = media::protect(
        &fixture.engine,
        &scan.session_id,
        &[result.entries[0].id.clone()],
        true,
    )
    .unwrap();
    assert_eq!(updated.len(), 1);
    assert_eq!(
        result.operation.items[1].error.as_deref(),
        Some("DESTINATION_EXISTS")
    );
}

#[test]
fn classification_transfer_preview_is_bound_to_current_session_and_destination_grant() {
    let fixture = Fixture::new();
    let photo = fixture.png("photo.png", [143, 58, 25]);
    let scan = fixture.scan();
    let ids = vec![scan.entries[0].id.clone()];
    let destination = transfer_destination(&fixture);
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::KeepBoth),
    )
    .unwrap();
    fixture.engine.access.revoke(&destination).unwrap();
    assert_eq!(
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {})
            .unwrap_err()
            .code,
        "FOLDER_NOT_AUTHORIZED"
    );
    fixture.engine.access.grant(&destination).unwrap();
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::KeepBoth),
    )
    .unwrap();
    let next_scan = fixture.scan();
    assert_eq!(
        media::execute_transfer(&fixture.engine, &next_scan.session_id, &plan.id, |_| {})
            .unwrap_err()
            .code,
        "PLAN_EXPIRED"
    );
    assert!(photo.exists());
}

#[cfg(windows)]
#[test]
fn classification_transfer_replacement_backs_up_existing_photo_and_protection_blocks_retirement() {
    let fixture = Fixture::new();
    let incoming = fixture.png("same.png", [213, 158, 25]);
    let incoming_before = std::fs::read(&incoming).unwrap();
    let destination = transfer_destination(&fixture);
    workspace_service::add(&fixture.engine, &destination).unwrap();
    let existing = destination.join("same.png");
    DynamicImage::ImageRgb8(RgbImage::from_pixel(64, 32, Rgb([18, 46, 125])))
        .save(&existing)
        .unwrap();
    seed_cache(&fixture.engine, &existing, "people");
    let existing_before = std::fs::read(&existing).unwrap();
    let scan = fixture.scan();
    let incoming_id = scan
        .entries
        .iter()
        .find(|entry| Path::new(&entry.path) == incoming)
        .unwrap()
        .id
        .clone();
    let existing_id = scan
        .entries
        .iter()
        .find(|entry| Path::new(&entry.path) == existing)
        .unwrap()
        .id
        .clone();
    let ids = vec![incoming_id.clone()];
    media::protect(
        &fixture.engine,
        &scan.session_id,
        std::slice::from_ref(&existing_id),
        true,
    )
    .unwrap();
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::Replace),
    )
    .unwrap();
    assert!(plan.items[0].backup);
    assert!(!destination.join(".metaflow-recovery").exists());
    let blocked =
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {}).unwrap();
    assert_ne!(blocked.operation.status, "completed");
    assert_eq!(
        blocked.operation.items[0].error.as_deref(),
        Some("MEDIA_PROTECTED")
    );
    assert_eq!(blocked.entries.len(), 2);
    assert_eq!(std::fs::read(&existing).unwrap(), existing_before);
    assert_eq!(std::fs::read(&incoming).unwrap(), incoming_before);
    media::protect(&fixture.engine, &scan.session_id, &[existing_id], false).unwrap();
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "move", ConflictPolicy::Replace),
    )
    .unwrap();
    let result =
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {}).unwrap();
    assert_eq!(result.operation.status, "completed");
    assert!(
        result.entries.is_empty(),
        "the retired destination entry cannot retain stale scan facts"
    );
    assert_eq!(std::fs::read(&existing).unwrap(), incoming_before);
    assert_eq!(
        history_service::undo(&fixture.engine, &result.operation.id, |_| {})
            .unwrap()
            .status,
        "undone"
    );
    assert_eq!(std::fs::read(incoming).unwrap(), incoming_before);
    assert_eq!(std::fs::read(existing).unwrap(), existing_before);
}

#[test]
fn classification_cached_scan_is_read_only_and_preview_is_bounded_native_jpeg() {
    let fixture = Fixture::new();
    let original = fixture.png("vacaciones ñ.png", [150, 80, 35]);
    let before = std::fs::read(&original).unwrap();
    std::fs::write(fixture.root.join("notes.txt"), b"not media").unwrap();
    let recovery = fixture.root.join(".metaflow-recovery");
    std::fs::create_dir(&recovery).unwrap();
    std::fs::copy(&original, recovery.join("hidden.png")).unwrap();
    let scan = fixture.scan();
    assert_eq!(scan.entries.len(), 1);
    assert_eq!(scan.skipped_count, 1);
    assert_eq!(scan.entries[0].status, "classified");
    assert!(!scan.entries[0].protected);
    let preview = media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id).unwrap();
    assert_eq!(preview.frames.len(), 1);
    assert_eq!(
        (preview.frames[0].width, preview.frames[0].height),
        (1600, 800)
    );
    assert!(preview.frames[0].at_seconds.is_none());
    let bytes = STANDARD
        .decode(
            preview.frames[0]
                .data_url
                .strip_prefix("data:image/jpeg;base64,")
                .unwrap(),
        )
        .unwrap();
    let thumbnail = image::load_from_memory_with_format(&bytes, ImageFormat::Jpeg).unwrap();
    assert_eq!((thumbnail.width(), thumbnail.height()), (1024, 512));
    assert_eq!(std::fs::read(&original).unwrap(), before);
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id)
            .unwrap()
            .frames[0]
            .data_url,
        preview.frames[0].data_url
    );
}

#[test]
fn preservation_is_persistent_content_based_and_updates_all_identical_copies() {
    let fixture = Fixture::new();
    let original = fixture.png("first.png", [45, 160, 10]);
    let copy = fixture.root.join("copy.png");
    std::fs::copy(&original, &copy).unwrap();
    let scan = fixture.scan();
    assert_eq!(scan.entries.len(), 2);
    let updated = media::protect(
        &fixture.engine,
        &scan.session_id,
        &[scan.entries[0].id.clone()],
        true,
    )
    .unwrap();
    assert!(updated.iter().all(|e| e.protected));
    let restarted = fixture.restarted();
    let scan = media::scan(&restarted, options(), |_| {}).unwrap();
    assert!(scan.entries.iter().all(|e| e.protected));
    let hash = blake3::hash(&std::fs::read(&original).unwrap())
        .to_hex()
        .to_string();
    assert!(media::is_protected_hash(&restarted, &hash).unwrap());
    let updated = media::protect(
        &restarted,
        &scan.session_id,
        &[scan.entries[0].id.clone()],
        false,
    )
    .unwrap();
    assert!(updated.iter().all(|e| !e.protected));
    assert!(!media::is_protected_hash(&restarted, &hash).unwrap());
}

#[test]
fn replacing_content_cannot_inherit_preservation_or_model_cache() {
    let fixture = Fixture::new();
    let original = fixture.png("photo.png", [200, 20, 10]);
    let scan = fixture.scan();
    media::protect(
        &fixture.engine,
        &scan.session_id,
        &[scan.entries[0].id.clone()],
        true,
    )
    .unwrap();
    DynamicImage::ImageRgb8(RgbImage::from_pixel(80, 80, Rgb([10, 150, 200])))
        .save(&original)
        .unwrap();
    seed_cache(&fixture.engine, &original, "animals");
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id)
            .unwrap_err()
            .code,
        "FILE_CHANGED"
    );
    let scan = fixture.scan();
    assert!(!scan.entries[0].protected);
    assert_eq!(
        scan.entries[0].labels[0].category,
        crate::domain::media_classification::MediaCategory::Animals
    );
}

#[test]
fn classification_never_grants_arbitrary_paths_and_old_or_fabricated_ids_expire() {
    let fixture = Fixture::new();
    fixture.png("photo.png", [45, 30, 180]);
    let scan = fixture.scan();
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, "../../state.sqlite")
            .unwrap_err()
            .code,
        "CLASSIFICATION_REVIEW_EXPIRED"
    );
    assert_eq!(
        media::protect(&fixture.engine, &scan.session_id, &[], true)
            .unwrap_err()
            .code,
        "INVALID_MEDIA_SELECTION"
    );
    let new_scan = fixture.scan();
    assert_ne!(scan.session_id, new_scan.session_id);
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id)
            .unwrap_err()
            .code,
        "CLASSIFICATION_REVIEW_EXPIRED"
    );
    let outside = fixture.root.parent().unwrap().join("outside");
    std::fs::create_dir(&outside).unwrap();
    fixture.engine.access.grant(&outside).unwrap();
    let error = media::scan(
        &fixture.engine,
        MediaScanOptions {
            folder_path: Some(outside.to_string_lossy().into_owned()),
            ..options()
        },
        |_| {},
    )
    .unwrap_err();
    assert_eq!(
        error.code, "FOLDER_NOT_AUTHORIZED",
        "a transient folder grant is not a persisted review root"
    );
}

#[test]
fn folder_selection_and_non_recursive_scan_respect_user_scope() {
    let fixture = Fixture::new();
    fixture.png("root.png", [200, 90, 20]);
    let child = fixture.root.join("album");
    std::fs::create_dir(&child).unwrap();
    let photo = child.join("child.png");
    std::fs::copy(fixture.root.join("root.png"), &photo).unwrap();
    let scan = media::scan(
        &fixture.engine,
        MediaScanOptions {
            recursive: false,
            ..options()
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(scan.entries.len(), 1);
    let scan = media::scan(
        &fixture.engine,
        MediaScanOptions {
            folder_path: Some(child.to_string_lossy().into_owned()),
            ..options()
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(scan.entries.len(), 1);
    assert!(scan.entries[0].path.ends_with("child.png"));
}

#[test]
fn selected_folders_are_temporary_bounded_scopes_and_do_not_expand_workspace_scans() {
    let fixture = Fixture::new();
    let unrelated = fixture.png("workspace-only.png", [110, 40, 70]);
    let first = selected_folder(&fixture, "chosen-first");
    let second = selected_folder(&fixture, "chosen-second");
    let child = first.join("album");
    std::fs::create_dir(&child).unwrap();
    selected_photo(&fixture, &first, "first.png", [15, 25, 35]);
    selected_photo(&fixture, &child, "child.png", [45, 55, 65]);
    selected_photo(&fixture, &second, "second.png", [75, 85, 95]);
    let before =
        crate::database::repositories::workspace_repository::load(&fixture.engine.db).unwrap();
    let scan = media::scan(
        &fixture.engine,
        selected_options(&[&second, &first, &child, &first]),
        |_| {},
    )
    .unwrap();
    assert_eq!(
        scan.entries.len(),
        3,
        "overlapping folders cannot duplicate media"
    );
    assert!(scan
        .entries
        .iter()
        .all(|entry| entry.path != unrelated.to_string_lossy()));
    for entry in &scan.entries {
        assert!(media::preview(&fixture.engine, &scan.session_id, &entry.id).is_ok());
    }
    let ids = vec![scan.entries[0].id.clone()];
    let entries = media::protect(&fixture.engine, &scan.session_id, &ids, true).unwrap();
    assert!(entries[0].protected);
    let entries = media::set_categories(
        &fixture.engine,
        &scan.session_id,
        &ids,
        Some(vec![MediaCategory::Animals]),
    )
    .unwrap();
    assert!(entries[0].corrected && entries[0].protected);
    media::set_categories(&fixture.engine, &scan.session_id, &ids, None).unwrap();
    media::protect(&fixture.engine, &scan.session_id, &ids, false).unwrap();
    let after =
        crate::database::repositories::workspace_repository::load(&fixture.engine.db).unwrap();
    assert_eq!(before.roots.len(), after.roots.len());
    assert_eq!(before.roots[0].path, after.roots[0].path);

    let nonrecursive = media::scan(
        &fixture.engine,
        MediaScanOptions {
            recursive: false,
            ..selected_options(&[&first, &child, &second, &first])
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(
        nonrecursive.entries.len(),
        3,
        "explicit child survives nonrecursive scope"
    );
    let nonrecursive_parent = media::scan(
        &fixture.engine,
        MediaScanOptions {
            recursive: false,
            ..selected_options(&[&first])
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(nonrecursive_parent.entries.len(), 1);
    let workspace = fixture.scan();
    assert_eq!(workspace.entries.len(), 1);
    assert_eq!(workspace.entries[0].path, unrelated.to_string_lossy());
}

#[test]
fn invalid_selected_scopes_never_fall_back_to_workspace_or_discard_current_review() {
    let fixture = Fixture::new();
    fixture.png("workspace-only.png", [170, 50, 60]);
    let chosen = selected_folder(&fixture, "chosen");
    selected_photo(&fixture, &chosen, "selected.png", [80, 90, 100]);
    let scan = media::scan(&fixture.engine, selected_options(&[&chosen]), |_| {}).unwrap();
    let ungranted = fixture.root.parent().unwrap().join("fabricated");
    std::fs::create_dir(&ungranted).unwrap();
    let recovery = chosen.join(".metaflow-recovery");
    std::fs::create_dir(&recovery).unwrap();
    let too_many = vec![chosen.to_string_lossy().into_owned(); media::MAX_SCAN_FOLDERS + 1];
    let invalid = [
        (selected_options(&[]), "INVALID_CLASSIFICATION_FOLDERS"),
        (
            MediaScanOptions {
                folder_paths: Some(too_many),
                ..options()
            },
            "INVALID_CLASSIFICATION_FOLDERS",
        ),
        (
            MediaScanOptions {
                folder_path: Some(chosen.to_string_lossy().into_owned()),
                ..selected_options(&[&chosen])
            },
            "INVALID_CLASSIFICATION_FOLDERS",
        ),
        (selected_options(&[&ungranted]), "FOLDER_NOT_AUTHORIZED"),
        (
            selected_options(&[&chosen, &ungranted]),
            "FOLDER_NOT_AUTHORIZED",
        ),
        (selected_options(&[&recovery]), "FOLDER_NOT_AUTHORIZED"),
        (
            selected_options(&[&chosen.join("..")]),
            "FOLDER_NOT_AUTHORIZED",
        ),
    ];
    for (options, code) in invalid {
        assert_eq!(
            media::scan(&fixture.engine, options, |_| {})
                .unwrap_err()
                .code,
            code
        );
        assert!(media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id).is_ok());
    }
}

#[cfg(windows)]
#[test]
fn selected_folder_review_supports_copy_move_and_reversible_removal_without_workspace_roots() {
    let fixture = Fixture::new();
    let chosen = selected_folder(&fixture, "chosen");
    let original = selected_photo(&fixture, &chosen, "selected.png", [110, 120, 130]);
    let survivor = selected_photo(&fixture, &chosen, "survivor.png", [140, 150, 160]);
    let destination = transfer_destination(&fixture);
    let scan = media::scan(&fixture.engine, selected_options(&[&chosen]), |_| {}).unwrap();
    let ids = vec![scan.entries[0].id.clone()];
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "copy", ConflictPolicy::KeepBoth),
    )
    .unwrap();
    let copied =
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {}).unwrap();
    assert_eq!(copied.operation.status, "completed");
    assert_eq!(copied.entries.len(), 2);
    assert!(original.exists() && destination.join("selected.png").exists());
    let moved_destination = selected_folder(&fixture, "moved-destination");
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(
            &scan,
            &ids,
            &moved_destination,
            "move",
            ConflictPolicy::KeepBoth,
        ),
    )
    .unwrap();
    let moved =
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {}).unwrap();
    assert_eq!(moved.operation.status, "completed");
    assert_eq!(moved.entries.len(), 1);
    assert!(!original.exists() && moved_destination.join("selected.png").exists());
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &ids[0])
            .unwrap_err()
            .code,
        "CLASSIFICATION_REVIEW_EXPIRED"
    );
    let operation = media::remove(
        &fixture.engine,
        &scan.session_id,
        &[moved.entries[0].id.clone()],
        |_| {},
    )
    .unwrap();
    assert_eq!(operation.status, "completed");
    assert!(!survivor.exists());
    let restarted = fixture.restarted();
    assert_eq!(
        restarted.access.resolve(&chosen).unwrap_err().code,
        "FOLDER_NOT_AUTHORIZED",
        "temporary scan grants are not restored at startup"
    );
    history_service::undo(&restarted, &operation.id, |_| {}).unwrap();
    assert!(survivor.exists());
    assert!(
        fixture.scan().entries.is_empty(),
        "picker and transfer grants stay outside Workspace"
    );
}

#[test]
fn revoking_selected_access_blocks_review_and_workspace_changes_expire_selected_sessions() {
    let fixture = Fixture::new();
    let chosen = selected_folder(&fixture, "chosen");
    let photo = selected_photo(&fixture, &chosen, "selected.png", [180, 190, 200]);
    let scan = media::scan(&fixture.engine, selected_options(&[&chosen]), |_| {}).unwrap();
    let ids = vec![scan.entries[0].id.clone()];
    let destination = transfer_destination(&fixture);
    let plan = media::preview_transfer(
        &fixture.engine,
        &scan.session_id,
        &ids,
        transfer_request(&scan, &ids, &destination, "copy", ConflictPolicy::KeepBoth),
    )
    .unwrap();
    fixture.engine.access.revoke(&chosen).unwrap();
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &ids[0])
            .unwrap_err()
            .code,
        "FOLDER_NOT_AUTHORIZED"
    );
    assert_eq!(
        media::protect(&fixture.engine, &scan.session_id, &ids, true)
            .unwrap_err()
            .code,
        "FOLDER_NOT_AUTHORIZED"
    );
    assert_eq!(
        media::set_categories(
            &fixture.engine,
            &scan.session_id,
            &ids,
            Some(vec![MediaCategory::Animals])
        )
        .unwrap_err()
        .code,
        "FOLDER_NOT_AUTHORIZED"
    );
    assert_eq!(
        media::remove(&fixture.engine, &scan.session_id, &ids, |_| {})
            .unwrap_err()
            .code,
        "FOLDER_NOT_AUTHORIZED"
    );
    assert_eq!(
        media::execute_transfer(&fixture.engine, &scan.session_id, &plan.id, |_| {})
            .unwrap_err()
            .code,
        "FOLDER_NOT_AUTHORIZED"
    );
    assert!(photo.exists() && !destination.join("selected.png").exists());
    fixture.engine.access.grant(&chosen).unwrap();
    let scan = media::scan(&fixture.engine, selected_options(&[&chosen]), |_| {}).unwrap();
    let workspace =
        crate::database::repositories::workspace_repository::load(&fixture.engine.db).unwrap();
    workspace_service::remove(&fixture.engine, &workspace.roots[0].id).unwrap();
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id)
            .unwrap_err()
            .code,
        "CLASSIFICATION_REVIEW_EXPIRED"
    );
    let scan = media::scan(&fixture.engine, selected_options(&[&chosen]), |_| {}).unwrap();
    assert_eq!(
        scan.entries.len(),
        1,
        "explicit folders work with no Workspace roots"
    );
    assert!(fixture.scan().entries.is_empty());
}

#[test]
fn cancellation_preserves_completed_classifications_as_a_reviewable_session() {
    let fixture = Fixture::new();
    fixture.png("a.png", [20, 80, 160]);
    fixture.png("b.png", [100, 40, 30]);
    fixture.png("c.png", [15, 100, 30]);
    let scan = media::scan(&fixture.engine, options(), |progress| {
        if progress.phase == "classifying" && progress.completed == 1 {
            fixture
                .engine
                .cancelled
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
    })
    .unwrap();
    assert!(scan.cancelled);
    assert_eq!(scan.entries.len(), 1);
    // A new UI command clears cancellation at dispatch, before waiting on the
    // operation gate. The service itself must retain a queued cancellation.
    fixture
        .engine
        .cancelled
        .store(false, std::sync::atomic::Ordering::Relaxed);
    assert!(media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id).is_ok());
}

#[test]
fn a_scan_cancelled_before_acquiring_the_gate_does_not_reactivate_itself() {
    let fixture = Fixture::new();
    fixture.png("photo.png", [20, 40, 120]);
    let gate = fixture.engine.operation_gate.lock().unwrap();
    let engine = fixture.engine.clone();
    let worker = std::thread::spawn(move || media::scan(&engine, options(), |_| {}));
    fixture
        .engine
        .cancelled
        .store(true, std::sync::atomic::Ordering::Relaxed);
    drop(gate);
    let scan = worker.join().unwrap().unwrap();
    assert!(scan.cancelled);
    assert!(scan.entries.is_empty());
}

#[test]
fn protected_selection_rejects_entire_retirement_batch_before_any_files_move() {
    let fixture = Fixture::new();
    let first = fixture.png("a.png", [15, 90, 220]);
    let second = fixture.png("b.png", [240, 100, 20]);
    let scan = fixture.scan();
    media::protect(
        &fixture.engine,
        &scan.session_id,
        &[scan.entries[1].id.clone()],
        true,
    )
    .unwrap();
    let error = media::remove(
        &fixture.engine,
        &scan.session_id,
        &scan
            .entries
            .iter()
            .map(|e| e.id.clone())
            .collect::<Vec<_>>(),
        |_| {},
    )
    .unwrap_err();
    assert_eq!(error.code, "MEDIA_PROTECTED");
    assert!(first.exists() && second.exists());
    assert!(!fixture.root.join(".metaflow-recovery").exists());
    assert!(
        crate::database::repositories::history_repository::list(&fixture.engine.db)
            .unwrap()
            .is_empty()
    );
}

#[cfg(windows)]
#[test]
fn reviewed_media_retirement_is_journaled_reversible_and_excluded_from_future_scans() {
    let fixture = Fixture::new();
    let first = fixture.png("first.png", [210, 190, 20]);
    let second = fixture.png("second.png", [50, 220, 60]);
    let before = std::fs::read(&first).unwrap();
    let scan = fixture.scan();
    let operation = media::remove(
        &fixture.engine,
        &scan.session_id,
        &[scan.entries[0].id.clone()],
        |_| {},
    )
    .unwrap();
    assert_eq!(operation.status, "completed");
    assert!(!first.exists());
    assert!(second.exists());
    let recovery = PathBuf::from(&operation.items[0].destination_path);
    assert!(recovery.parent().unwrap().ends_with(".metaflow-recovery"));
    assert_eq!(std::fs::read(&recovery).unwrap(), before);
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id)
            .unwrap_err()
            .code,
        "CLASSIFICATION_REVIEW_EXPIRED"
    );
    assert!(media::preview(&fixture.engine, &scan.session_id, &scan.entries[1].id).is_ok());
    assert_eq!(fixture.scan().entries.len(), 1);
    let undone = history_service::undo(&fixture.engine, &operation.id, |_| {}).unwrap();
    assert_eq!(undone.status, "undone");
    assert_eq!(std::fs::read(&first).unwrap(), before);
    assert!(!recovery.exists());
}

#[test]
fn cached_preview_still_rehashes_and_rejects_a_same_length_edit() {
    let fixture = Fixture::new();
    let path = fixture.png("first.png", [190, 200, 70]);
    let scan = fixture.scan();
    let entry = &scan.entries[0];
    media::preview(&fixture.engine, &scan.session_id, &entry.id).unwrap();
    let mut bytes = std::fs::read(&path).unwrap();
    let index = bytes.len() / 2;
    bytes[index] ^= 1;
    std::fs::write(&path, bytes).unwrap();
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &entry.id)
            .unwrap_err()
            .code,
        "FILE_CHANGED"
    );
    assert_eq!(
        media::protect(
            &fixture.engine,
            &scan.session_id,
            std::slice::from_ref(&entry.id),
            true
        )
        .unwrap_err()
        .code,
        "FILE_CHANGED"
    );
}

#[test]
fn fabricated_cached_image_cannot_bypass_native_decode_limits() {
    let fixture = Fixture::new();
    let path = fixture.root.join("malformed.png");
    std::fs::write(&path, b"this is not an image").unwrap();
    seed_cache(&fixture.engine, &path, "other");
    let scan = fixture.scan();
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id)
            .unwrap_err()
            .code,
        "UNSUPPORTED_IMAGE"
    );
}

#[test]
fn decoded_dimensions_are_checked_before_allocating_oversized_bitmap() {
    let fixture = Fixture::new();
    let path = fixture.root.join("wide.bmp");
    let mut bytes = vec![0u8; 54];
    bytes[..2].copy_from_slice(b"BM");
    bytes[2..6].copy_from_slice(&54u32.to_le_bytes());
    bytes[10..14].copy_from_slice(&54u32.to_le_bytes());
    bytes[14..18].copy_from_slice(&40u32.to_le_bytes());
    bytes[18..22].copy_from_slice(&20_000u32.to_le_bytes());
    bytes[22..26].copy_from_slice(&1u32.to_le_bytes());
    bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&24u16.to_le_bytes());
    std::fs::write(&path, bytes).unwrap();
    seed_cache(&fixture.engine, &path, "other");
    let scan = fixture.scan();
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &scan.entries[0].id)
            .unwrap_err()
            .code,
        "IMAGE_TOO_LARGE"
    );
}

#[cfg(windows)]
#[test]
fn preserved_content_also_blocks_duplicate_review_retirement_until_unprotected() {
    use super::duplicate_review_service;
    let fixture = Fixture::new();
    let original = fixture.png("a.png", [230, 100, 50]);
    let copy = fixture.root.join("b.png");
    std::fs::copy(&original, &copy).unwrap();
    let classified = fixture.scan();
    media::protect(
        &fixture.engine,
        &classified.session_id,
        std::slice::from_ref(&classified.entries[0].id),
        true,
    )
    .unwrap();
    let duplicates = duplicate_review_service::scan(&fixture.engine, false).unwrap();
    assert_eq!(duplicates.comparisons.len(), 1);
    let pair = &duplicates.comparisons[0];
    assert_eq!(
        duplicate_review_service::remove(
            &fixture.engine,
            &duplicates.session_id,
            &pair.id,
            "left",
            |_| {}
        )
        .unwrap_err()
        .code,
        "MEDIA_PROTECTED"
    );
    assert!(original.exists() && copy.exists());
    media::protect(
        &fixture.engine,
        &classified.session_id,
        std::slice::from_ref(&classified.entries[0].id),
        false,
    )
    .unwrap();
    let operation = duplicate_review_service::remove(
        &fixture.engine,
        &duplicates.session_id,
        &pair.id,
        "left",
        |_| {},
    )
    .unwrap();
    assert_eq!(operation.status, "completed");
    history_service::undo(&fixture.engine, &operation.id, |_| {}).unwrap();
    assert!(original.exists() && copy.exists());
}

#[cfg(windows)]
#[test]
fn preserving_multiple_hard_links_holds_shared_read_guards_without_self_conflicts() {
    let fixture = Fixture::new();
    let original = fixture.png("a.png", [20, 150, 230]);
    std::fs::hard_link(&original, fixture.root.join("b.png")).unwrap();
    let scan = fixture.scan();
    assert_eq!(scan.entries.len(), 2);
    let selected: Vec<_> = scan.entries.iter().map(|entry| entry.id.clone()).collect();
    let updated = media::protect(&fixture.engine, &scan.session_id, &selected, true).unwrap();
    assert!(updated.iter().all(|entry| entry.protected));
    let updated = media::protect(&fixture.engine, &scan.session_id, &selected, false).unwrap();
    assert!(updated.iter().all(|entry| !entry.protected));
}

#[cfg(windows)]
#[test]
fn native_video_parent_pins_prevent_reopening_a_replaced_directory() {
    let fixture = Fixture::new();
    let path = fixture.png("photo.png", [50, 30, 20]);
    let guards = media::pin_video_parents(&path).unwrap();
    let renamed = fixture.root.with_file_name("renamed");
    assert!(std::fs::rename(&fixture.root, &renamed).is_err());
    drop(guards);
    std::fs::rename(&fixture.root, &renamed).unwrap();
    std::fs::rename(&renamed, &fixture.root).unwrap();
}

#[cfg(windows)]
#[test]
#[ignore = "requires bundled FFmpeg/FFprobe assets; run for desktop release validation"]
fn media_video_normalizes_verbatim_assets_samples_three_frames_and_rejects_playlists() {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    let mut fixture = Fixture::new();
    // Tauri's Windows resource directory comes from std::fs::canonicalize,
    // which produces a verbatim prefix. Exercise the application's startup
    // normalization before the strict bundled-tool checks and real inference.
    let verbatim_assets = std::fs::canonicalize(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/classification"),
    )
    .unwrap();
    assert!(matches!(
        verbatim_assets.components().next(),
        Some(std::path::Component::Prefix(prefix))
            if matches!(prefix.kind(), std::path::Prefix::VerbatimDisk(_)
                | std::path::Prefix::VerbatimUNC(_, _))
    ));
    fixture.engine.media_assets = crate::normalize_media_assets(verbatim_assets.clone());
    assert_ne!(fixture.engine.media_assets, verbatim_assets);
    assert_eq!(
        fixture.engine.media_assets,
        dunce::canonicalize(&verbatim_assets).unwrap(),
    );
    let path = fixture.root.join("review clip ñ.mp4");
    let status = Command::new(fixture.engine.media_assets.join("ffmpeg.exe"))
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x180:rate=10",
            "-t",
            "3",
            "-an",
            "-c:v",
            "mpeg4",
            "-threads",
            "1",
            "-filter_threads",
            "1",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .status()
        .unwrap();
    assert!(status.success());
    let playlist = fixture.root.join("playlist.mp4");
    std::fs::write(
        &playlist,
        b"#EXTM3U\n#EXTINF:3\nfile:///C:/Windows/win.ini\n",
    )
    .unwrap();
    seed_cache(&fixture.engine, &playlist, "other");
    let scan = fixture.scan();
    let video = scan
        .entries
        .iter()
        .find(|entry| entry.name == "review clip ñ.mp4")
        .unwrap();
    assert_eq!(video.kind, "video");
    assert_eq!(
        video.status, "classified",
        "actual video frames must reach the bundled model"
    );
    assert!(!video.labels.is_empty());
    let preview = media::preview(&fixture.engine, &scan.session_id, &video.id).unwrap();
    assert_eq!(preview.frames.len(), 3);
    for frame in &preview.frames {
        assert_eq!((frame.width, frame.height), (320, 180));
        assert!(frame.data_url.starts_with("data:image/jpeg;base64,"));
    }
    let times: Vec<_> = preview
        .frames
        .iter()
        .map(|f| f.at_seconds.unwrap())
        .collect();
    assert!(times[0] < times[1] && times[1] < times[2]);
    let disguised = scan
        .entries
        .iter()
        .find(|entry| entry.name == "playlist.mp4")
        .unwrap();
    assert_eq!(
        media::preview(&fixture.engine, &scan.session_id, &disguised.id)
            .unwrap_err()
            .code,
        "VIDEO_PREVIEW_FAILED"
    );
    // The input remains byte-for-byte identical after preview and cancellation is reusable.
    let digest = blake3::hash(&std::fs::read(&path).unwrap());
    media::preview(&fixture.engine, &scan.session_id, &video.id).unwrap();
    assert_eq!(blake3::hash(&std::fs::read(&path).unwrap()), digest);
}
