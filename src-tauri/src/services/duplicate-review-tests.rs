use super::{
    access_service::FolderAccess, duplicate_review_service as review, history_service,
    inbox_service::InboxEngine, workspace_service,
};
use crate::{database::Database, domain::duplicate_review::ComparisonKind};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageFormat, Rgb, RgbImage,
};
use std::path::{Path, PathBuf};

struct Fixture {
    engine: InboxEngine,
    root: PathBuf,
    database_path: PathBuf,
    _folder: tempfile::TempDir,
}
impl Fixture {
    fn new() -> Self {
        let folder = tempfile::tempdir().unwrap();
        let parent = dunce::canonicalize(folder.path()).unwrap();
        let root = parent.join("files");
        std::fs::create_dir(&root).unwrap();
        let database_path = parent.join("history.sqlite");
        let engine = InboxEngine::open(
            Database::open(&database_path).unwrap(),
            FolderAccess::default(),
            parent.join("log.txt"),
        )
        .unwrap();
        workspace_service::add(&engine, &root).unwrap();
        Self {
            engine,
            root,
            database_path,
            _folder: folder,
        }
    }
    fn png(&self, name: &str, width: u32, height: u32) -> PathBuf {
        let path = self.root.join(name);
        scene(width, height).save(&path).unwrap();
        path
    }
    fn restarted(&self) -> InboxEngine {
        let engine = InboxEngine::open(
            Database::open(&self.database_path).unwrap(),
            FolderAccess::default(),
            self.root.parent().unwrap().join("restart.log"),
        )
        .unwrap();
        workspace_service::restore(&engine).unwrap();
        engine
    }
}
fn scene(width: u32, height: u32) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |x, y| {
        let a = x * 255 / width;
        let b = y * 255 / height;
        if x > width / 4 && x < width * 3 / 4 && y > height / 3 && y < height * 2 / 3 {
            Rgb([240, 60, 40])
        } else {
            Rgb([a as u8, b as u8, ((a + b) / 2) as u8])
        }
    }))
}
fn jpeg(path: &Path, image: &DynamicImage, quality: u8) {
    let file = std::fs::File::create(path).unwrap();
    JpegEncoder::new_with_quality(file, quality)
        .encode_image(image)
        .unwrap();
}
fn thumbnail_pixels(data: &str) -> DynamicImage {
    let bytes = STANDARD
        .decode(data.strip_prefix("data:image/jpeg;base64,").unwrap())
        .unwrap();
    image::load_from_memory_with_format(&bytes, ImageFormat::Jpeg).unwrap()
}

#[test]
fn visual_review_small_exact_groups_keep_all_pairs_and_thumbnail_is_native_bounded() {
    let f = Fixture::new();
    let first = f.png("first.png", 1600, 800);
    std::fs::copy(&first, f.root.join("second.png")).unwrap();
    std::fs::copy(&first, f.root.join("third.png")).unwrap();
    let before = std::fs::read(&first).unwrap();
    let scan = review::scan(&f.engine, false).unwrap();
    assert_eq!(scan.comparisons.len(), 3);
    assert!(!scan.truncated);
    assert!(scan
        .comparisons
        .iter()
        .all(|pair| pair.kind == ComparisonKind::Exact));
    let pair = &scan.comparisons[0];
    let thumbnail = review::thumbnail(&f.engine, &scan.session_id, &pair.id, "left").unwrap();
    assert_eq!((thumbnail.width, thumbnail.height), (1600, 800));
    let pixels = thumbnail_pixels(&thumbnail.data_url);
    assert_eq!((pixels.width(), pixels.height()), (1280, 640));
    assert_eq!(
        std::fs::read(first).unwrap(),
        before,
        "preview cannot alter image contents"
    );
    let second = review::thumbnail(&f.engine, &scan.session_id, &pair.id, "right").unwrap();
    assert_eq!(thumbnail.data_url, second.data_url);
}

#[test]
fn visually_similar_resolution_and_compression_are_suggestions_not_exact_duplicates() {
    let f = Fixture::new();
    let first = f.png("original.png", 600, 400);
    let compressed = f.root.join("smaller.jpg");
    let original = image::open(&first).unwrap();
    jpeg(
        &compressed,
        &original.resize_exact(300, 200, FilterType::Triangle),
        65,
    );
    DynamicImage::ImageRgb8(RgbImage::from_pixel(300, 200, Rgb([10, 20, 240])))
        .save(f.root.join("different.png"))
        .unwrap();
    assert!(review::scan(&f.engine, false)
        .unwrap()
        .comparisons
        .is_empty());
    let scan = review::scan(&f.engine, true).unwrap();
    assert_eq!(scan.comparisons.len(), 1, "{:?}", scan);
    let pair = &scan.comparisons[0];
    assert_eq!(pair.kind, ComparisonKind::Similar);
    assert_ne!(pair.left.hash, pair.right.hash);
    assert!(pair.left.path.ends_with("original.png") || pair.right.path.ends_with("original.png"));
    assert!(pair.left.path.ends_with("smaller.jpg") || pair.right.path.ends_with("smaller.jpg"));
}

#[cfg(windows)]
#[test]
fn removing_exact_representative_preserves_its_other_copies_visual_comparisons() {
    let f = Fixture::new();
    let first = f.png("a-original.png", 300, 200);
    let second = f.root.join("b-identical.png");
    std::fs::copy(&first, &second).unwrap();
    let smaller = f.root.join("c-smaller.jpg");
    jpeg(
        &smaller,
        &image::open(&first)
            .unwrap()
            .resize_exact(150, 100, FilterType::Triangle),
        70,
    );
    let scan = review::scan(&f.engine, true).unwrap();
    assert_eq!(scan.comparisons.len(), 3, "{:?}", scan);
    assert_eq!(
        scan.comparisons
            .iter()
            .filter(|pair| pair.kind == ComparisonKind::Similar)
            .count(),
        2
    );
    assert!(!scan.truncated);
    let exact = scan
        .comparisons
        .iter()
        .find(|pair| pair.kind == ComparisonKind::Exact)
        .unwrap();
    let removed = &exact.left.path;
    let operation = review::remove(&f.engine, &scan.session_id, &exact.id, "left", |_| {}).unwrap();
    assert_eq!(operation.status, "completed");
    let remaining = scan
        .comparisons
        .iter()
        .find(|pair| &pair.left.path != removed && &pair.right.path != removed)
        .unwrap();
    assert_eq!(remaining.kind, ComparisonKind::Similar);
    assert!(review::thumbnail(&f.engine, &scan.session_id, &remaining.id, "left").is_ok());
    assert!(review::thumbnail(&f.engine, &scan.session_id, &remaining.id, "right").is_ok());
    let deletion =
        review::remove(&f.engine, &scan.session_id, &remaining.id, "right", |_| {}).unwrap();
    assert_eq!(deletion.status, "completed");
}

#[cfg(windows)]
#[test]
fn keeper_replacement_after_journaling_is_rejected_under_executor_exclusive_handle() {
    use super::file_date_service;
    use std::{
        os::windows::io::AsRawHandle,
        sync::atomic::{AtomicBool, Ordering},
    };
    use windows_sys::Win32::{Foundation::FILETIME, Storage::FileSystem::SetFileTime};
    let f = Fixture::new();
    let a = f.root.join("a.txt");
    let b = f.root.join("b.txt");
    std::fs::write(&a, b"valuable content").unwrap();
    std::fs::copy(&a, &b).unwrap();
    let scan = review::scan(&f.engine, false).unwrap();
    let pair = &scan.comparisons[0];
    let keeper = Path::new(&pair.right.path);
    let handle = file_date_service::open(keeper).unwrap();
    let dates = file_date_service::read(&handle).unwrap();
    drop(handle);
    let replaced = AtomicBool::new(false);
    let operation = review::remove(&f.engine, &scan.session_id, &pair.id, "left", |_| {
        if !replaced.swap(true, Ordering::Relaxed) {
            std::fs::rename(keeper, f.root.parent().unwrap().join("old-keeper.txt")).unwrap();
            std::fs::write(keeper, b"valuable content").unwrap();
            let handle = file_date_service::open(keeper).unwrap();
            let created = FILETIME {
                dwLowDateTime: dates.created as u32,
                dwHighDateTime: (dates.created >> 32) as u32,
            };
            let modified = FILETIME {
                dwLowDateTime: dates.modified as u32,
                dwHighDateTime: (dates.modified >> 32) as u32,
            };
            // SAFETY: fixture handle is live; the FILETIME structs outlive this call.
            assert_ne!(
                unsafe {
                    SetFileTime(
                        handle.as_raw_handle(),
                        &created,
                        std::ptr::null(),
                        &modified,
                    )
                },
                0
            );
        }
    })
    .unwrap();
    assert_eq!(operation.status, "partial", "{:?}", operation);
    assert_eq!(operation.items[0].status, "failed");
    assert_eq!(operation.items[0].error.as_deref(), Some("FILE_CHANGED"));
    assert!(Path::new(&pair.left.path).exists());
    assert!(keeper.exists());
}

#[test]
fn native_image_limits_reject_huge_declared_dimensions_before_pixel_allocation() {
    let f = Fixture::new();
    let image = f.png("huge.png", 4, 4);
    let mut bytes = std::fs::read(&image).unwrap();
    bytes[16..20].copy_from_slice(&1_000_000u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&1_000_000u32.to_be_bytes());
    let mut crc = u32::MAX;
    for byte in &bytes[12..29] {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    bytes[29..33].copy_from_slice(&(!crc).to_be_bytes());
    std::fs::write(&image, bytes).unwrap();
    std::fs::copy(&image, f.root.join("same-huge.png")).unwrap();
    let scan = review::scan(&f.engine, false).unwrap();
    assert_eq!(scan.comparisons.len(), 1);
    let error = review::thumbnail(&f.engine, &scan.session_id, &scan.comparisons[0].id, "left")
        .unwrap_err();
    assert!(matches!(
        error.code,
        "IMAGE_TOO_LARGE" | "UNSUPPORTED_IMAGE"
    ));
}

#[test]
fn jpeg_exif_orientation_is_normalized_before_preview() {
    let f = Fixture::new();
    let path = f.root.join("rotated.jpg");
    jpeg(&path, &scene(200, 100), 90);
    let encoded = std::fs::read(&path).unwrap();
    let tiff = [
        0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    let mut exif = b"Exif\0\0".to_vec();
    exif.extend(tiff);
    let mut oriented = encoded[..2].to_vec();
    oriented.extend([0xff, 0xe1]);
    oriented.extend(((exif.len() + 2) as u16).to_be_bytes());
    oriented.extend(exif);
    oriented.extend(&encoded[2..]);
    std::fs::write(&path, oriented).unwrap();
    std::fs::copy(&path, f.root.join("same.jpg")).unwrap();
    let scan = review::scan(&f.engine, false).unwrap();
    let thumbnail =
        review::thumbnail(&f.engine, &scan.session_id, &scan.comparisons[0].id, "left").unwrap();
    assert_eq!((thumbnail.width, thumbnail.height), (100, 200));
    let pixels = thumbnail_pixels(&thumbnail.data_url);
    assert_eq!((pixels.width(), pixels.height()), (100, 200));
}

#[test]
fn dismissals_persist_are_pair_specific_and_changed_content_reappears() {
    let f = Fixture::new();
    let a = f.root.join("a.txt");
    let b = f.root.join("b.txt");
    std::fs::write(&a, b"same original bytes").unwrap();
    std::fs::copy(&a, &b).unwrap();
    let scan = review::scan(&f.engine, false).unwrap();
    review::dismiss(&f.engine, &scan.session_id, &scan.comparisons[0].id).unwrap();
    let restarted = f.restarted();
    let hidden = review::scan(&restarted, false).unwrap();
    assert!(hidden.comparisons.is_empty());
    assert_eq!(hidden.ignored_count, 1);
    std::fs::copy(&a, f.root.join("c.txt")).unwrap();
    let new_file = review::scan(&restarted, false).unwrap();
    assert_eq!(
        new_file.comparisons.len(),
        2,
        "new copies need fresh review"
    );
    assert_eq!(new_file.ignored_count, 1);
    std::fs::write(&a, b"different current bytes").unwrap();
    std::fs::write(&b, b"different current bytes").unwrap();
    let changed = review::scan(&restarted, false).unwrap();
    assert_eq!(changed.comparisons.len(), 1);
    assert_eq!(changed.ignored_count, 0);
    review::dismiss(&restarted, &changed.session_id, &changed.comparisons[0].id).unwrap();
    review::reset_dismissals(&restarted).unwrap();
    assert_eq!(
        review::scan(&restarted, false).unwrap().comparisons.len(),
        1
    );
}

#[cfg(windows)]
#[test]
fn cached_thumbnail_and_removal_revalidate_hash_even_if_size_and_timestamp_are_restored() {
    use super::file_date_service;
    let f = Fixture::new();
    let path = f.png("a.png", 100, 50);
    std::fs::copy(&path, f.root.join("b.png")).unwrap();
    let scan = review::scan(&f.engine, false).unwrap();
    let pair = &scan.comparisons[0];
    review::thumbnail(&f.engine, &scan.session_id, &pair.id, "left").unwrap();
    let file = file_date_service::open(&path).unwrap();
    let original_dates = file_date_service::read(&file).unwrap();
    drop(file);
    let mut bytes = std::fs::read(&path).unwrap();
    let index = bytes.len() / 2;
    bytes[index] ^= 1;
    std::fs::write(&path, bytes).unwrap();
    let file = file_date_service::open(&path).unwrap();
    file_date_service::set_modified(&file, original_dates.modified).unwrap();
    drop(file);
    assert_eq!(
        review::thumbnail(&f.engine, &scan.session_id, &pair.id, "left")
            .unwrap_err()
            .code,
        "FILE_CHANGED"
    );
    assert_eq!(
        review::remove(&f.engine, &scan.session_id, &pair.id, "left", |_| {})
            .unwrap_err()
            .code,
        "FILE_CHANGED"
    );
    assert!(path.exists());
    assert!(f.root.join("b.png").exists());
    assert!(!f.root.join(".metaflow-recovery").exists());
}

#[cfg(windows)]
#[test]
fn remove_either_side_advances_without_rescan_and_history_undo_restores_contents() {
    let f = Fixture::new();
    for name in ["a.txt", "b.txt", "c.txt"] {
        std::fs::write(f.root.join(name), b"valuable original content").unwrap();
    }
    let scan = review::scan(&f.engine, false).unwrap();
    assert_eq!(scan.comparisons.len(), 3);
    let pair = &scan.comparisons[0];
    let removed_path = pair.left.path.clone();
    let operation = review::remove(&f.engine, &scan.session_id, &pair.id, "left", |_| {}).unwrap();
    assert_eq!(operation.status, "completed", "{:?}", operation);
    assert!(!Path::new(&removed_path).exists());
    assert!(Path::new(&pair.right.path).exists());
    assert_eq!(
        std::fs::read(&operation.items[0].destination_path).unwrap(),
        b"valuable original content"
    );
    assert_eq!(
        review::thumbnail(&f.engine, &scan.session_id, &pair.id, "right")
            .unwrap_err()
            .code,
        "DUPLICATE_REVIEW_EXPIRED"
    );
    let remaining = scan
        .comparisons
        .iter()
        .find(|p| p.left.path != removed_path && p.right.path != removed_path)
        .unwrap();
    let second =
        review::remove(&f.engine, &scan.session_id, &remaining.id, "right", |_| {}).unwrap();
    assert_eq!(second.status, "completed", "{:?}", second);
    assert!(Path::new(&remaining.left.path).exists());
    history_service::undo(&f.engine, &second.id, |_| {}).unwrap();
    let restored = history_service::undo(&f.engine, &operation.id, |_| {}).unwrap();
    assert_eq!(restored.status, "undone");
    for name in ["a.txt", "b.txt", "c.txt"] {
        assert_eq!(
            std::fs::read(f.root.join(name)).unwrap(),
            b"valuable original content"
        );
    }
}

#[cfg(windows)]
#[test]
fn visually_similar_remove_guards_a_distinct_keeper_and_is_reversible() {
    let f = Fixture::new();
    let first = f.png("original.png", 300, 200);
    let smaller = f.root.join("smaller.jpg");
    jpeg(
        &smaller,
        &image::open(&first)
            .unwrap()
            .resize_exact(150, 100, FilterType::Triangle),
        70,
    );
    let first_bytes = std::fs::read(&first).unwrap();
    let smaller_bytes = std::fs::read(&smaller).unwrap();
    let scan = review::scan(&f.engine, true).unwrap();
    assert_eq!(scan.comparisons.len(), 1, "{:?}", scan);
    let pair = &scan.comparisons[0];
    assert_eq!(pair.kind, ComparisonKind::Similar);
    assert_ne!(pair.left.hash, pair.right.hash);
    let deleting_side = if pair.left.path == smaller.to_str().unwrap() {
        "left"
    } else {
        "right"
    };
    let operation =
        review::remove(&f.engine, &scan.session_id, &pair.id, deleting_side, |_| {}).unwrap();
    assert_eq!(operation.status, "completed", "{:?}", operation);
    assert!(!smaller.exists());
    assert_eq!(std::fs::read(&first).unwrap(), first_bytes);
    assert!(
        review::scan(&f.engine, true)
            .unwrap()
            .comparisons
            .is_empty(),
        "backups must stay outside scans"
    );
    assert_eq!(
        history_service::undo(&f.engine, &operation.id, |_| {})
            .unwrap()
            .status,
        "undone"
    );
    assert_eq!(std::fs::read(&smaller).unwrap(), smaller_bytes);
}

#[test]
fn sessions_expire_on_new_scan_and_root_removal_and_reject_forged_ids() {
    let f = Fixture::new();
    let path = f.png("a.png", 40, 20);
    std::fs::copy(&path, f.root.join("b.png")).unwrap();
    let first = review::scan(&f.engine, false).unwrap();
    assert_eq!(
        review::thumbnail(&f.engine, &first.session_id, "C:\\private.jpg", "left")
            .unwrap_err()
            .code,
        "DUPLICATE_REVIEW_EXPIRED"
    );
    assert_eq!(
        review::thumbnail(
            &f.engine,
            &first.session_id,
            &first.comparisons[0].id,
            "other"
        )
        .unwrap_err()
        .code,
        "INVALID_TRANSFER"
    );
    let second = review::scan(&f.engine, false).unwrap();
    assert_eq!(
        review::thumbnail(
            &f.engine,
            &first.session_id,
            &first.comparisons[0].id,
            "left"
        )
        .unwrap_err()
        .code,
        "DUPLICATE_REVIEW_EXPIRED"
    );
    let workspace =
        crate::database::repositories::workspace_repository::load(&f.engine.db).unwrap();
    workspace_service::remove(&f.engine, &workspace.roots[0].id).unwrap();
    assert_eq!(
        review::thumbnail(
            &f.engine,
            &second.session_id,
            &second.comparisons[0].id,
            "left"
        )
        .unwrap_err()
        .code,
        "DUPLICATE_REVIEW_EXPIRED"
    );
    assert!(path.exists());
}

#[test]
fn huge_exact_groups_use_bounded_catalog_and_report_truncation() {
    let f = Fixture::new();
    for index in 0..201 {
        std::fs::write(f.root.join(format!("copy-{index:03}.txt")), b"same bytes").unwrap();
    }
    let scan = review::scan(&f.engine, false).unwrap();
    assert!(scan.truncated);
    assert_eq!(
        scan.comparisons.len(),
        399,
        "linear anchor+neighbor catalog"
    );
    let anchor = &scan.comparisons[0].left.path;
    assert!(scan
        .comparisons
        .iter()
        .any(|p| &p.left.path != anchor && &p.right.path != anchor));
}

#[test]
fn corrupt_or_non_raster_images_do_not_escape_native_decoding_or_abort_exact_scan() {
    let f = Fixture::new();
    std::fs::write(
        f.root.join("fake.png"),
        b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>",
    )
    .unwrap();
    std::fs::copy(f.root.join("fake.png"), f.root.join("same.png")).unwrap();
    let scan = review::scan(&f.engine, true).unwrap();
    assert_eq!(scan.comparisons.len(), 1);
    assert_eq!(scan.comparisons[0].kind, ComparisonKind::Exact);
    assert!(scan.unreadable_count > 0);
    assert_eq!(
        review::thumbnail(&f.engine, &scan.session_id, &scan.comparisons[0].id, "left")
            .unwrap_err()
            .code,
        "UNSUPPORTED_IMAGE"
    );
}
