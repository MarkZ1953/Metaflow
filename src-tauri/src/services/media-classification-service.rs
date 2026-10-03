//! Local classification suggests review categories; it never chooses files to delete.
use crate::{
    database::repositories::workspace_repository,
    domain::{media_classification::*, organization::*, workspace::TransferRequest},
    errors::{AppError, AppResult},
    services::{
        access_service::path_text,
        classification_ai::{self, CategoryScore, Classification, Classifier},
        classification_ocr, file_operation_service as operations,
        inbox_service::{validate_directory, InboxEngine},
        move_service,
        organizer_service::path_key,
    },
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageDecoder, ImageFormat,
    ImageReader, Limits, Rgb, RgbImage,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs::{File, OpenOptions},
    io::{Cursor, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const MAX_FILES: usize = 10_000;
const MAX_ENTRIES: usize = 100_000;
const MAX_BATCH: usize = 1_000;
pub const MAX_SCAN_FOLDERS: usize = 32;
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DECODED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_AXIS: u32 = 16_384;
const MAX_PREVIEW_ITEMS: usize = 8;
const MAX_PREVIEW_BYTES: usize = 8 * 1024 * 1024;
const PROTECTED_PREFIX: &str = "media-protected:";
const CACHE_PREFIX: &str = "media-classification-cache:";
const MAX_PERSISTED_CACHE_ITEMS: i64 = 50_000;
const DETECTION_SETTINGS_KEY: &str = "media-detection-settings";
const CORRECTION_PREFIX: &str = "media-category-correction:";
const MAX_FEEDBACK_EXAMPLES: usize = 256;
const EMBEDDING_DIMENSIONS: usize = 512;

#[derive(Clone)]
struct RecordedMedia {
    public: MediaEntry,
    hash: String,
    identity: String,
    timestamps: (u64, u64),
    baseline: Option<CachedClassification>,
    baseline_error: Option<String>,
}
struct MediaSession {
    id: String,
    revision: u64,
    scope_roots: Vec<PathBuf>,
    entries: BTreeMap<String, RecordedMedia>,
    order: Vec<String>,
    previews: HashMap<String, MediaPreview>,
    preview_order: VecDeque<String>,
    preview_bytes: usize,
    settings: DetectionSettings,
}
struct MediaTransferPreview {
    id: String,
    session_id: String,
    entry_ids: Vec<String>,
    destination: PathBuf,
}
#[derive(Default)]
pub struct MediaRegistry {
    session: Option<MediaSession>,
    transfer: Option<MediaTransferPreview>,
}

#[derive(Clone, Serialize, Deserialize)]
struct CachedClassification {
    labels: Vec<MediaLabel>,
    uncertain: bool,
    embedding: Vec<f32>,
}
#[derive(Serialize, Deserialize)]
struct CategoryCorrection {
    categories: Vec<MediaCategory>,
    model_version: String,
    analysis_mode: AnalysisMode,
    embedding: Vec<f32>,
}
struct Candidate {
    path: PathBuf,
    stamp: FileStamp,
    kind: &'static str,
}
type DecodedVideoFrame = (DynamicImage, f64, (u32, u32));
struct Collected {
    files: Vec<Candidate>,
    unreadable: usize,
    skipped: usize,
    truncated: bool,
    cancelled: bool,
}

fn cancel(engine: &InboxEngine) -> AppResult<()> {
    if engine.cancelled.load(Ordering::Relaxed) {
        Err(AppError::new("OPERATION_CANCELLED"))
    } else {
        Ok(())
    }
}
fn is_recovery(path: &Path) -> bool {
    path.components().any(|p| {
        p.as_os_str()
            .to_str()
            .is_some_and(|s| s.eq_ignore_ascii_case(".metaflow-recovery"))
    })
}
fn managed_roots(engine: &InboxEngine) -> AppResult<Vec<PathBuf>> {
    let mut roots: Vec<_> = workspace_repository::load(&engine.db)?
        .roots
        .into_iter()
        .map(|r| PathBuf::from(r.path))
        .collect();
    let state = engine.lock()?;
    roots.extend(
        state
            .rules
            .iter()
            .map(|r| PathBuf::from(&r.destination_path)),
    );
    if let Some(inbox) = &state.inbox {
        roots.push(PathBuf::from(&inbox.path));
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}
fn scan_roots(engine: &InboxEngine, options: &MediaScanOptions) -> AppResult<Vec<PathBuf>> {
    let explicit = options.folder_paths.as_ref();
    if explicit.is_some_and(|paths| paths.is_empty() || paths.len() > MAX_SCAN_FOLDERS)
        || (explicit.is_some() && options.folder_path.is_some())
    {
        return Err(AppError::new("INVALID_CLASSIFICATION_FOLDERS"));
    }
    let managed = if explicit.is_none() {
        managed_roots(engine)?
    } else {
        Vec::new()
    };
    let Some(paths) = explicit
        .cloned()
        .or_else(|| options.folder_path.as_ref().map(|path| vec![path.clone()]))
    else {
        return Ok(managed);
    };
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        let path = PathBuf::from(path);
        if is_recovery(&path)
            || (explicit.is_none() && !managed.iter().any(|root| path.starts_with(root)))
        {
            return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
        }
        // resolve denies ungranted lexical paths before examining the disk.
        let (canonical, _) = engine.access.resolve(&path)?;
        if canonical != path {
            return Err(AppError::new("FOLDER_CHANGED"));
        }
        validate_directory(&canonical)?;
        if seen.insert(path_key(&canonical)) {
            selected.push(canonical);
        }
    }
    selected.sort();
    if options.recursive {
        // A parent already covers its selected descendants. In a nonrecursive
        // scan both levels must remain, so choosing parent+child includes both.
        let all = selected.clone();
        selected.retain(|path| {
            !all.iter()
                .any(|root| root != path && path.starts_with(root))
        });
    }
    Ok(selected)
}

fn session_roots(engine: &InboxEngine, session_id: &str) -> AppResult<Vec<PathBuf>> {
    let revision = engine.lock()?.revision;
    engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
        .session
        .as_ref()
        .filter(|session| session.id == session_id && session.revision == revision)
        .map(|session| session.scope_roots.clone())
        .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))
}
fn scope(engine: &InboxEngine, path: &Path, roots: &[PathBuf]) -> AppResult<()> {
    if is_recovery(path) || !roots.iter().any(|r| path.starts_with(r)) {
        return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
    }
    operations::source(engine, path)
}
fn media_kind(path: &Path, include_videos: bool) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "ico"
    ) {
        Some("image")
    } else if include_videos
        && matches!(
            extension.as_str(),
            "mp4"
                | "mov"
                | "mkv"
                | "avi"
                | "webm"
                | "m4v"
                | "mpg"
                | "mpeg"
                | "mts"
                | "m2ts"
                | "3gp"
                | "wmv"
        )
    {
        Some("video")
    } else {
        None
    }
}
fn collect(
    engine: &InboxEngine,
    options: &MediaScanOptions,
    authorized: &[PathBuf],
) -> AppResult<Collected> {
    let mut stack = authorized.to_vec();
    let mut result = Collected {
        files: Vec::new(),
        unreadable: 0,
        skipped: 0,
        truncated: false,
        cancelled: false,
    };
    let mut directories = HashSet::new();
    let mut files = HashSet::new();
    let mut seen = 0;
    'walk: while let Some(directory) = stack.pop() {
        if cancel(engine).is_err() {
            result.cancelled = true;
            break;
        }
        if is_recovery(&directory) || !directories.insert(path_key(&directory)) {
            continue;
        }
        if validate_directory(&directory).is_err()
            || engine.access.resolve(&directory).is_err()
            || !dunce::canonicalize(&directory).is_ok_and(|p| p == directory)
        {
            result.unreadable += 1;
            continue;
        }
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                result.unreadable += 1;
                continue;
            }
        };
        for entry in entries {
            if cancel(engine).is_err() {
                result.cancelled = true;
                break 'walk;
            }
            seen += 1;
            if seen > MAX_ENTRIES || result.files.len() >= MAX_FILES {
                result.truncated = true;
                break 'walk;
            }
            let path = match entry {
                Ok(entry) => entry.path(),
                Err(_) => {
                    result.unreadable += 1;
                    continue;
                }
            };
            if is_recovery(&path) {
                continue;
            }
            let metadata = match std::fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => {
                    result.unreadable += 1;
                    continue;
                }
            };
            if metadata.is_dir() {
                if options.recursive && validate_directory(&path).is_ok() {
                    stack.push(path);
                } else if options.recursive {
                    result.unreadable += 1;
                }
            } else if let Some(kind) = media_kind(&path, options.include_videos) {
                if move_service::regular_file(&path).is_err() {
                    result.unreadable += 1;
                    continue;
                }
                if files.insert(path_key(&path)) {
                    result.files.push(Candidate {
                        path,
                        stamp: move_service::stamp(&metadata),
                        kind,
                    });
                }
            } else {
                result.skipped += 1;
            }
        }
    }
    result.files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}
fn timestamps(metadata: &std::fs::Metadata) -> (u64, u64) {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        (metadata.creation_time(), metadata.last_write_time())
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        (0, 0)
    }
}
fn hash(engine: &InboxEngine, file: &mut File) -> AppResult<String> {
    file.seek(SeekFrom::Start(0))?;
    let mut digest = blake3::Hasher::new();
    let mut buffer = [0u8; 131_072];
    loop {
        cancel(engine)?;
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(digest.finalize().to_hex().to_string())
}
fn record(
    engine: &InboxEngine,
    candidate: &Candidate,
    authorized: &[PathBuf],
) -> AppResult<RecordedMedia> {
    scope(engine, &candidate.path, authorized)?;
    let mut file = move_service::open_locked(&candidate.path, false)?;
    if move_service::stamp(&file.metadata()?) != candidate.stamp
        || dunce::canonicalize(&candidate.path)? != candidate.path
    {
        return Err(AppError::new("FILE_CHANGED"));
    }
    let hash = hash(engine, &mut file)?;
    Ok(RecordedMedia {
        public: MediaEntry {
            id: uuid::Uuid::new_v4().to_string(),
            path: path_text(&candidate.path)?,
            name: candidate
                .path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            stamp: candidate.stamp.clone(),
            kind: candidate.kind.into(),
            labels: Vec::new(),
            uncertain: true,
            protected: is_protected_hash(engine, &hash)?,
            corrected: false,
            learned: false,
            status: "error".into(),
            error: None,
        },
        hash,
        identity: move_service::identity(&file)?,
        timestamps: timestamps(&file.metadata()?),
        baseline: None,
        baseline_error: None,
    })
}
fn open_record(
    engine: &InboxEngine,
    record: &RecordedMedia,
    authorized: &[PathBuf],
    shared_read: bool,
) -> AppResult<File> {
    let path = Path::new(&record.public.path);
    scope(engine, path, authorized)?;
    let file = if shared_read {
        open_shared_read(path)?
    } else {
        move_service::open_locked(path, false)?
    };
    if move_service::stamp(&file.metadata()?) != record.public.stamp
        || move_service::identity(&file)? != record.identity
        || timestamps(&file.metadata()?) != record.timestamps
        || dunce::canonicalize(path)? != path
    {
        return Err(AppError::new("FILE_CHANGED"));
    }
    Ok(file)
}
fn open_shared_read(path: &Path) -> AppResult<File> {
    move_service::regular_file(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        // FFmpeg can read the same file; writes, replacements and deletions remain denied.
        options
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(AppError::new("UNSUPPORTED_FILE"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if file.metadata()?.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err(AppError::new("UNSUPPORTED_FILE"));
        }
    }
    Ok(file)
}
pub(super) fn pin_video_parents(path: &Path) -> AppResult<Vec<File>> {
    let mut guards = Vec::new();
    #[cfg(windows)]
    {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        // Subprocesses reopen a native path. Pin every ancestor against renames,
        // not just the source inode, until all FFmpeg/FFprobe reads have ended.
        for directory in path
            .ancestors()
            .skip(1)
            .filter(|p| !p.as_os_str().is_empty())
        {
            validate_directory(directory)?;
            let guard = OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(directory)?;
            let metadata = guard.metadata()?;
            if !metadata.is_dir()
                || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || dunce::canonicalize(directory)? != directory
            {
                return Err(AppError::new("FOLDER_CHANGED"));
            }
            guards.push(guard);
        }
    }
    #[cfg(not(windows))]
    {
        // External decoding needs an adapter that binds subprocess reads to the
        // reviewed inode on platforms where directory handles cannot pin paths.
        let _ = (path, &mut guards);
        return Err(AppError::new("UNSUPPORTED_PLATFORM"));
    }
    #[cfg(windows)]
    Ok(guards)
}
fn checked_video_tool(path: &Path) -> AppResult<()> {
    if !path.is_absolute() || move_service::regular_file(path).is_err() {
        return Err(AppError::new("VIDEO_PREVIEW_UNAVAILABLE"));
    }
    if dunce::canonicalize(path).map_err(|_| AppError::new("VIDEO_PREVIEW_UNAVAILABLE"))? != path {
        return Err(AppError::new("VIDEO_PREVIEW_UNAVAILABLE"));
    }
    Ok(())
}
fn read_image(engine: &InboxEngine, file: &mut File) -> AppResult<Vec<u8>> {
    if file.metadata()?.len() > MAX_IMAGE_BYTES {
        return Err(AppError::new("IMAGE_TOO_LARGE"));
    }
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 131_072];
    loop {
        cancel(engine)?;
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        if bytes.len().saturating_add(count) as u64 > MAX_IMAGE_BYTES {
            return Err(AppError::new("IMAGE_TOO_LARGE"));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    Ok(bytes)
}
fn image_error(error: image::ImageError) -> AppError {
    AppError::new(if matches!(error, image::ImageError::Limits(_)) {
        "IMAGE_TOO_LARGE"
    } else {
        "UNSUPPORTED_IMAGE"
    })
}
fn decode(bytes: &[u8]) -> AppResult<DynamicImage> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| AppError::new("UNSUPPORTED_IMAGE"))?;
    if !matches!(
        reader.format(),
        Some(
            ImageFormat::Jpeg
                | ImageFormat::Png
                | ImageFormat::Gif
                | ImageFormat::WebP
                | ImageFormat::Bmp
                | ImageFormat::Tiff
                | ImageFormat::Ico
        )
    ) {
        return Err(AppError::new("UNSUPPORTED_IMAGE"));
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_AXIS);
    limits.max_image_height = Some(MAX_AXIS);
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(image_error)?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width > MAX_AXIS
        || height > MAX_AXIS
        || u64::from(width) * u64::from(height) > MAX_PIXELS
        || decoder.total_bytes() > MAX_DECODED_BYTES
    {
        return Err(AppError::new("IMAGE_TOO_LARGE"));
    }
    let orientation = decoder.orientation().map_err(image_error)?;
    let mut decoded = DynamicImage::from_decoder(decoder).map_err(image_error)?;
    decoded.apply_orientation(orientation);
    Ok(decoded)
}
fn image_for_record(
    engine: &InboxEngine,
    record: &RecordedMedia,
    authorized: &[PathBuf],
) -> AppResult<DynamicImage> {
    let mut file = open_record(engine, record, authorized, false)?;
    let bytes = read_image(engine, &mut file)?;
    if blake3::hash(&bytes).to_hex().as_str() != record.hash {
        return Err(AppError::new("FILE_CHANGED"));
    }
    decode(&bytes)
}
fn flatten(image: &DynamicImage) -> RgbImage {
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let pixel = rgba.get_pixel(x, y).0;
        let alpha = u16::from(pixel[3]);
        Rgb(std::array::from_fn(|c| {
            ((u16::from(pixel[c]) * alpha + 255 * (255 - alpha)) / 255) as u8
        }))
    })
}
fn frame(
    image: &DynamicImage,
    at_seconds: Option<f64>,
    original: Option<(u32, u32)>,
) -> AppResult<MediaFrame> {
    let resized = image.resize(1024, 1024, FilterType::Triangle);
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 82)
        .encode_image(&DynamicImage::ImageRgb8(flatten(&resized)))
        .map_err(|_| AppError::new("UNSUPPORTED_IMAGE"))?;
    let (width, height) = original.unwrap_or((image.width(), image.height()));
    Ok(MediaFrame {
        data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)),
        width,
        height,
        at_seconds,
    })
}

fn process_output(
    engine: &InboxEngine,
    executable: &Path,
    args: &[std::ffi::OsString],
    cap: usize,
    timeout: Duration,
) -> AppResult<Vec<u8>> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| AppError::new("VIDEO_PREVIEW_FAILED"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::new("VIDEO_PREVIEW_FAILED"))?;
    let overflow = Arc::new(AtomicBool::new(false));
    let output_overflow = overflow.clone();
    let reader = std::thread::spawn(move || -> std::io::Result<Vec<u8>> {
        let mut stdout = stdout;
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 65_536];
        loop {
            let count = stdout.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            if bytes.len().saturating_add(count) > cap {
                output_overflow.store(true, Ordering::Relaxed);
            } else if !output_overflow.load(Ordering::Relaxed) {
                bytes.extend_from_slice(&buffer[..count]);
            }
        }
        Ok(bytes)
    });
    let started = Instant::now();
    let result = loop {
        if engine.cancelled.load(Ordering::Relaxed) {
            break Err(AppError::new("OPERATION_CANCELLED"));
        }
        if overflow.load(Ordering::Relaxed) || started.elapsed() > timeout {
            break Err(AppError::new("VIDEO_PREVIEW_FAILED"));
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err(AppError::new("VIDEO_PREVIEW_FAILED"))
                }
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => break Err(AppError::new("VIDEO_PREVIEW_FAILED")),
        }
    };
    if result.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    let bytes = reader
        .join()
        .map_err(|_| AppError::new("VIDEO_PREVIEW_FAILED"))?
        .map_err(|_| AppError::new("VIDEO_PREVIEW_FAILED"))?;
    result?;
    if overflow.load(Ordering::Relaxed) {
        return Err(AppError::new("VIDEO_PREVIEW_FAILED"));
    }
    Ok(bytes)
}
fn video_frames(
    engine: &InboxEngine,
    record: &RecordedMedia,
    authorized: &[PathBuf],
) -> AppResult<Vec<DecodedVideoFrame>> {
    scope(engine, Path::new(&record.public.path), authorized)?;
    let _directories = pin_video_parents(Path::new(&record.public.path))?;
    let mut guard = open_record(engine, record, authorized, true)?;
    if hash(engine, &mut guard)? != record.hash {
        return Err(AppError::new("FILE_CHANGED"));
    }
    let ffprobe = engine.media_assets.join("ffprobe.exe");
    let ffmpeg = engine.media_assets.join("ffmpeg.exe");
    checked_video_tool(&ffprobe)?;
    checked_video_tool(&ffmpeg)?;
    let os = |s: &str| std::ffi::OsString::from(s);
    // Do not autodetect playlist demuxers from a media-looking filename. Such
    // playlists could otherwise request unrelated local files through file:.
    let extension = Path::new(&record.public.path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let demuxer = match extension.as_str() {
        "mp4" | "mov" | "m4v" | "3gp" => "mov",
        "mkv" | "webm" => "matroska",
        "avi" => "avi",
        "mpg" | "mpeg" => "mpeg",
        "mts" | "m2ts" => "mpegts",
        "wmv" => "asf",
        _ => return Err(AppError::new("VIDEO_PREVIEW_FAILED")),
    };
    let probe = process_output(
        engine,
        &ffprobe,
        &[
            os("-v"),
            os("error"),
            os("-max_alloc"),
            os("268435456"),
            os("-probesize"),
            os("5000000"),
            os("-analyzeduration"),
            os("2000000"),
            os("-max_probe_packets"),
            os("2500"),
            os("-protocol_whitelist"),
            os("file,pipe"),
            os("-f"),
            os(demuxer),
            os("-select_streams"),
            os("v:0"),
            os("-show_entries"),
            os("stream=width,height:format=duration"),
            os("-of"),
            os("json"),
            os("-i"),
            os(&record.public.path),
        ],
        32_768,
        Duration::from_secs(20),
    )?;
    let data: serde_json::Value =
        serde_json::from_slice(&probe).map_err(|_| AppError::new("VIDEO_PREVIEW_FAILED"))?;
    let stream = data["streams"]
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| AppError::new("VIDEO_PREVIEW_FAILED"))?;
    let width = stream["width"]
        .as_u64()
        .ok_or_else(|| AppError::new("VIDEO_PREVIEW_FAILED"))?;
    let height = stream["height"]
        .as_u64()
        .ok_or_else(|| AppError::new("VIDEO_PREVIEW_FAILED"))?;
    if width == 0
        || height == 0
        || width > u64::from(MAX_AXIS)
        || height > u64::from(MAX_AXIS)
        || width * height > MAX_PIXELS
    {
        return Err(AppError::new("IMAGE_TOO_LARGE"));
    }
    let duration = data["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0);
    let times = duration
        .map(|d| [d * 0.1, d * 0.5, d * 0.9])
        .unwrap_or([0.0, 1.0, 2.0]);
    let mut frames = Vec::new();
    for at in times {
        cancel(engine)?;
        let output = process_output(
            engine,
            &ffmpeg,
            &[
                os("-nostdin"),
                os("-hide_banner"),
                os("-loglevel"),
                os("error"),
                os("-protocol_whitelist"),
                os("file,pipe"),
                os("-f"),
                os(demuxer),
                os("-max_alloc"),
                os("268435456"),
                os("-threads"),
                os("2"),
                os("-ss"),
                os(&format!("{at:.3}")),
                os("-i"),
                os(&record.public.path),
                os("-map"),
                os("0:v:0"),
                os("-frames:v"),
                os("1"),
                os("-vf"),
                os("scale=1024:1024:force_original_aspect_ratio=decrease"),
                os("-f"),
                os("image2pipe"),
                os("-vcodec"),
                os("mjpeg"),
                os("pipe:1"),
            ],
            4 * 1024 * 1024,
            Duration::from_secs(25),
        )?;
        if output.is_empty() {
            continue;
        }
        frames.push((decode(&output)?, at, (width as u32, height as u32)));
    }
    if move_service::identity(&guard)? != record.identity
        || move_service::stamp(&guard.metadata()?) != record.public.stamp
        || timestamps(&guard.metadata()?) != record.timestamps
    {
        return Err(AppError::new("FILE_CHANGED"));
    }
    scope(engine, Path::new(&record.public.path), authorized)?;
    if frames.is_empty() {
        return Err(AppError::new("VIDEO_PREVIEW_FAILED"));
    }
    Ok(frames)
}

pub(super) fn cache_profile(settings: &DetectionSettings) -> String {
    let ocr = classification_ocr::availability();
    let fingerprint = serde_json::json!({
        "sensitivity": settings.sensitivity,
        "analysisMode": settings.analysis_mode,
        "readText": settings.read_text,
        "ocrLanguages": if settings.read_text { ocr.languages } else { Vec::new() },
        "ocrAvailable": settings.read_text && ocr.available,
    });
    format!(
        "{}:{}",
        classification_ai::MODEL_VERSION,
        blake3::hash(fingerprint.to_string().as_bytes()).to_hex()
    )
}
pub(super) fn cache_key(hash: &str, profile: &str) -> String {
    format!("{CACHE_PREFIX}{profile}:{hash}")
}
fn valid_embedding(embedding: &[f32]) -> bool {
    embedding.len() == EMBEDDING_DIMENSIONS
        && embedding.iter().all(|v| v.is_finite())
        && (0.98..=1.02).contains(&embedding.iter().map(|v| v * v).sum::<f32>())
}
fn cached(
    engine: &InboxEngine,
    hash: &str,
    profile: &str,
) -> AppResult<Option<CachedClassification>> {
    let value: Option<String> = engine.db.with(|db| {
        Ok(db
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                [cache_key(hash, profile)],
                |r| r.get(0),
            )
            .optional()?)
    })?;
    Ok(value
        .and_then(|v| serde_json::from_str::<CachedClassification>(&v).ok())
        .filter(|c| {
            (c.embedding.is_empty() || valid_embedding(&c.embedding))
                && !c.labels.is_empty()
                && c.labels.len() <= 8
                && c.labels
                    .iter()
                    .all(|label| label.score.is_finite() && (0.0..=1.0).contains(&label.score))
        }))
}
fn save_cache(
    engine: &InboxEngine,
    hash: &str,
    profile: &str,
    classified: &CachedClassification,
) -> AppResult<()> {
    let json = serde_json::to_string(classified)?;
    engine.db.with(|db| {
        db.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
            rusqlite::params![cache_key(hash, profile), json],
        )?;
        Ok(())
    })
}
fn public_classification(classified: Classification) -> AppResult<CachedClassification> {
    if !classified.embedding.is_empty() && !valid_embedding(&classified.embedding) {
        return Err(AppError::new("MEDIA_INFERENCE_FAILED"));
    }
    let mut labels = Vec::new();
    for category in classified.categories {
        let category_enum: MediaCategory =
            serde_json::from_value(serde_json::Value::String(category.clone()))?;
        let score = classified
            .candidates
            .iter()
            .find(|c| c.category == category)
            .map(|c| c.score.clamp(0.0, 1.0))
            .unwrap_or(0.0);
        if !score.is_finite() {
            return Err(AppError::new("MEDIA_INFERENCE_FAILED"));
        }
        labels.push(MediaLabel {
            category: category_enum,
            score,
        });
    }
    if labels.is_empty() {
        labels.push(MediaLabel {
            category: MediaCategory::Other,
            score: 0.0,
        });
    }
    Ok(CachedClassification {
        labels,
        uncertain: classified.uncertain,
        embedding: classified.embedding,
    })
}
fn classify_image(
    classifier: &Classifier,
    image: &DynamicImage,
    settings: &DetectionSettings,
) -> AppResult<Classification> {
    let mut classified = classifier.classify_with_mode(image, settings.analysis_mode)?;
    if settings.read_text {
        // OCR is optional: a missing Windows language pack must not abort visual analysis.
        if let Ok(signals) = classification_ocr::read(image) {
            classification_ocr::boost_text_scores(
                &mut classified.candidates,
                &signals,
                image.width(),
                image.height(),
            );
        }
    }
    let scored = classification_ai::score_categories_with_sensitivity(
        &classified.candidates,
        settings.sensitivity,
    );
    classified.categories = scored.categories;
    classified.uncertain = scored.uncertain;
    Ok(classified)
}
fn classify_video(
    classifier: &Classifier,
    frames: &[DecodedVideoFrame],
    settings: &DetectionSettings,
) -> AppResult<CachedClassification> {
    let mut combined: BTreeMap<String, f32> = BTreeMap::new();
    let mut choices = HashSet::new();
    let mut embedding = vec![0.0; EMBEDDING_DIMENSIONS];
    for (image, _, _) in frames {
        let result = classify_image(classifier, image, settings)?;
        for (combined, feature) in embedding.iter_mut().zip(&result.embedding) {
            *combined += feature;
        }
        for c in result.candidates {
            combined
                .entry(c.category)
                .and_modify(|s| *s = s.max(c.score))
                .or_insert(c.score);
        }
        choices.insert(result.categories);
    }
    let scores: Vec<_> = combined
        .into_iter()
        .map(|(category, score)| CategoryScore { category, score })
        .collect();
    let mut result =
        classification_ai::score_categories_with_sensitivity(&scores, settings.sensitivity);
    result.uncertain |= choices.len() > 1;
    let norm = embedding.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm.is_finite() && norm > f32::EPSILON {
        embedding.iter_mut().for_each(|v| *v /= norm);
        result.embedding = embedding;
    }
    public_classification(result)
}

pub fn load_settings(engine: &InboxEngine) -> AppResult<DetectionConfiguration> {
    let settings = engine.db.with(|db| {
        let value: Option<String> = db
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                [DETECTION_SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value
            .and_then(|value| serde_json::from_str::<DetectionSettings>(&value).ok())
            .unwrap_or_default())
    })?;
    configuration(engine, settings)
}
fn configuration(
    engine: &InboxEngine,
    settings: DetectionSettings,
) -> AppResult<DetectionConfiguration> {
    let correction_count: i64 = engine.db.with(|db| {
        Ok(db.query_row(
            "SELECT COUNT(*) FROM settings WHERE key LIKE ?1",
            [format!("{CORRECTION_PREFIX}%")],
            |row| row.get(0),
        )?)
    })?;
    let ocr = classification_ocr::availability();
    Ok(DetectionConfiguration {
        settings,
        correction_count: correction_count.max(0) as usize,
        ocr_available: ocr.available,
        ocr_languages: ocr.languages,
    })
}
pub fn save_settings(
    engine: &InboxEngine,
    settings: DetectionSettings,
) -> AppResult<DetectionConfiguration> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let json = serde_json::to_string(&settings)?;
    engine.db.with(|db| {
        db.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
            rusqlite::params![DETECTION_SETTINGS_KEY, json],
        )?;
        Ok(())
    })?;
    configuration(engine, settings)
}
fn valid_categories(categories: &[MediaCategory]) -> bool {
    !categories.is_empty()
        && categories.len() <= 8
        && categories.iter().collect::<HashSet<_>>().len() == categories.len()
}
fn valid_correction(correction: &CategoryCorrection) -> bool {
    valid_categories(&correction.categories)
        && (correction.embedding.is_empty() || valid_embedding(&correction.embedding))
}
fn correction_for(engine: &InboxEngine, hash: &str) -> AppResult<Option<CategoryCorrection>> {
    let json: Option<String> = engine.db.with(|db| {
        Ok(db
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                [format!("{CORRECTION_PREFIX}{hash}")],
                |row| row.get(0),
            )
            .optional()?)
    })?;
    Ok(json
        .and_then(|json| serde_json::from_str::<CategoryCorrection>(&json).ok())
        .filter(valid_correction))
}
fn correction_examples(
    engine: &InboxEngine,
    mode: AnalysisMode,
) -> AppResult<Vec<CategoryCorrection>> {
    let values = engine.db.with(|db| {
        let mut statement = db
            .prepare("SELECT value FROM settings WHERE key LIKE ?1 ORDER BY rowid DESC LIMIT ?2")?;
        let values = statement
            .query_map(
                rusqlite::params![
                    format!("{CORRECTION_PREFIX}%"),
                    (MAX_FEEDBACK_EXAMPLES * 4) as i64
                ],
                |row| row.get::<_, String>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(values)
    })?;
    Ok(values
        .into_iter()
        .filter_map(|value| serde_json::from_str::<CategoryCorrection>(&value).ok())
        .filter(|example| {
            valid_correction(example)
                && valid_embedding(&example.embedding)
                && example.model_version == classification_ai::MODEL_VERSION
                && example.analysis_mode == mode
        })
        .take(MAX_FEEDBACK_EXAMPLES)
        .collect())
}
fn same_categories(left: &[MediaCategory], right: &[MediaCategory]) -> bool {
    left.len() == right.len() && left.iter().all(|category| right.contains(category))
}
fn nearest_feedback<'a>(
    embedding: &[f32],
    examples: &'a [CategoryCorrection],
) -> Option<&'a CategoryCorrection> {
    if !valid_embedding(embedding) {
        return None;
    }
    let similarities: Vec<_> = examples
        .iter()
        .filter(|example| example.embedding.len() == embedding.len())
        .map(|example| {
            (
                example,
                embedding
                    .iter()
                    .zip(&example.embedding)
                    .map(|(left, right)| left * right)
                    .sum::<f32>(),
            )
        })
        .collect();
    let (best, score) = similarities
        .iter()
        .max_by(|(_, left), (_, right)| left.total_cmp(right))?;
    if *score < 0.94 {
        return None;
    }
    let opposing = similarities
        .iter()
        .filter(|(example, _)| !same_categories(&example.categories, &best.categories))
        .map(|(_, score)| *score)
        .max_by(f32::total_cmp);
    if opposing.is_some_and(|other| score - other < 0.03) {
        return None;
    }
    Some(best)
}
fn restore_baseline(record: &mut RecordedMedia) {
    record.public.corrected = false;
    record.public.learned = false;
    record.public.labels = record
        .baseline
        .as_ref()
        .map(|baseline| baseline.labels.clone())
        .unwrap_or_default();
    record.public.uncertain = record
        .baseline
        .as_ref()
        .is_none_or(|baseline| baseline.uncertain);
    record.public.status = if record.baseline.is_some() {
        "classified"
    } else {
        "error"
    }
    .into();
    record.public.error = record.baseline_error.clone();
}
fn apply_categories(record: &mut RecordedMedia, categories: &[MediaCategory], manual: bool) {
    record.public.labels = categories
        .iter()
        .map(|category| MediaLabel {
            category: *category,
            // User labels have no model affinity. Do not invent a confidence percentage.
            score: 0.0,
        })
        .collect();
    record.public.corrected = manual;
    record.public.learned = !manual;
    record.public.uncertain = !manual;
    record.public.status = "classified".into();
    record.public.error = None;
}
fn apply_feedback(
    engine: &InboxEngine,
    record: &mut RecordedMedia,
    settings: &DetectionSettings,
    examples: &[CategoryCorrection],
) -> AppResult<()> {
    restore_baseline(record);
    if let Some(correction) = correction_for(engine, &record.hash)? {
        apply_categories(record, &correction.categories, true);
        return Ok(());
    }
    let example = if settings.use_corrections {
        record
            .baseline
            .as_ref()
            .and_then(|baseline| nearest_feedback(&baseline.embedding, examples))
    } else {
        None
    };
    if let Some(example) = example {
        apply_categories(record, &example.categories, false);
    }
    Ok(())
}
fn load_classifier(engine: &InboxEngine) -> AppResult<Classifier> {
    Classifier::load(
        &engine.media_assets.join(classification_ai::MODEL_FILE),
        &engine.media_assets.join(classification_ai::RUNTIME_FILE),
        &engine.media_assets.join(classification_ai::EMBEDDINGS_FILE),
    )
}

pub fn scan(
    engine: &InboxEngine,
    options: MediaScanOptions,
    progress: impl Fn(MediaScanProgress),
) -> AppResult<MediaScan> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let authorized = scan_roots(engine, &options)?;
    {
        let mut registry = engine
            .media_classifications
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        registry.session = None;
        registry.transfer = None;
    }
    let settings = load_settings(engine)?.settings;
    let profile = cache_profile(&settings);
    let mut inference_settings = settings.clone();
    inference_settings.read_text &= classification_ocr::availability().available;
    let examples = if settings.use_corrections {
        correction_examples(engine, settings.analysis_mode)?
    } else {
        Vec::new()
    };
    progress(MediaScanProgress {
        completed: 0,
        total: 0,
        current_name: String::new(),
        phase: "collecting".into(),
    });
    let collected = collect(engine, &options, &authorized)?;
    let mut unreadable = collected.unreadable;
    let mut cancelled = collected.cancelled;
    let total = collected.files.len();
    let mut records = Vec::new();
    let mut classifier = None;
    let mut processed = 0;
    for candidate in &collected.files {
        if cancel(engine).is_err() {
            cancelled = true;
            break;
        }
        progress(MediaScanProgress {
            completed: processed,
            total,
            current_name: candidate
                .path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            phase: "classifying".into(),
        });
        let mut record = match record(engine, candidate, &authorized) {
            Ok(record) => record,
            Err(error) if error.code == "OPERATION_CANCELLED" => {
                cancelled = true;
                break;
            }
            Err(_) => {
                unreadable += 1;
                processed += 1;
                continue;
            }
        };
        let classified = if let Some(cached) = cached(engine, &record.hash, &profile)? {
            Ok(cached)
        } else {
            if classifier.is_none() {
                classifier = Some(load_classifier(engine)?);
            }
            let classifier = classifier
                .as_ref()
                .ok_or_else(|| AppError::new("MEDIA_MODEL_UNAVAILABLE"))?;
            if record.public.kind == "image" {
                image_for_record(engine, &record, &authorized)
                    .and_then(|image| classify_image(classifier, &image, &inference_settings))
                    .and_then(public_classification)
            } else {
                video_frames(engine, &record, &authorized)
                    .and_then(|frames| classify_video(classifier, &frames, &inference_settings))
            }
        };
        match classified {
            Ok(classified) => {
                save_cache(engine, &record.hash, &profile, &classified)?;
                record.baseline = Some(classified);
            }
            Err(error) if error.code == "OPERATION_CANCELLED" => {
                cancelled = true;
                break;
            }
            Err(error) => {
                record.baseline_error = Some(error.code.into());
            }
        }
        apply_feedback(engine, &mut record, &settings, &examples)?;
        records.push(record);
        processed += 1;
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    // Content-addressed suggestions are disposable. Keep preservation decisions
    // separately, so bounding this cache can never remove a Conservar marker.
    engine.db.with(|db| {
        db.execute(
            "DELETE FROM settings WHERE key LIKE ?1 AND rowid NOT IN \
             (SELECT rowid FROM settings WHERE key LIKE ?1 ORDER BY rowid DESC LIMIT ?2)",
            rusqlite::params![format!("{CACHE_PREFIX}%"), MAX_PERSISTED_CACHE_ITEMS],
        )?;
        Ok(())
    })?;
    let result = MediaScan {
        session_id: session_id.clone(),
        entries: records.iter().map(|r| r.public.clone()).collect(),
        unreadable_count: unreadable,
        skipped_count: collected.skipped,
        truncated: collected.truncated,
        cancelled,
        model_version: classification_ai::MODEL_VERSION.into(),
    };
    let session = MediaSession {
        id: session_id,
        revision: engine.lock()?.revision,
        scope_roots: authorized,
        order: records.iter().map(|r| r.public.id.clone()).collect(),
        entries: records
            .into_iter()
            .map(|r| (r.public.id.clone(), r))
            .collect(),
        previews: HashMap::new(),
        preview_order: VecDeque::new(),
        preview_bytes: 0,
        settings,
    };
    engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
        .session = Some(session);
    progress(MediaScanProgress {
        completed: processed,
        total,
        current_name: String::new(),
        phase: if cancelled { "cancelled" } else { "complete" }.into(),
    });
    Ok(result)
}
fn snapshot(
    engine: &InboxEngine,
    session_id: &str,
    entry_ids: &[String],
) -> AppResult<Vec<RecordedMedia>> {
    if entry_ids.is_empty() || entry_ids.len() > MAX_BATCH {
        return Err(AppError::new("INVALID_MEDIA_SELECTION"));
    }
    let revision = engine.lock()?.revision;
    let registry = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let session = registry
        .session
        .as_ref()
        .filter(|s| s.id == session_id && s.revision == revision)
        .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))?;
    let mut seen = HashSet::new();
    let mut records = Vec::new();
    for id in entry_ids {
        if !seen.insert(id) {
            return Err(AppError::new("INVALID_MEDIA_SELECTION"));
        }
        records.push(
            session
                .entries
                .get(id)
                .cloned()
                .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))?,
        );
    }
    Ok(records)
}
fn preview_bytes(preview: &MediaPreview) -> usize {
    preview.frames.iter().map(|f| f.data_url.len()).sum()
}
pub fn preview(engine: &InboxEngine, session_id: &str, entry_id: &str) -> AppResult<MediaPreview> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let record = snapshot(engine, session_id, &[entry_id.into()])?.remove(0);
    let authorized = session_roots(engine, session_id)?;
    let mut file = open_record(engine, &record, &authorized, false)?;
    if hash(engine, &mut file)? != record.hash {
        return Err(AppError::new("FILE_CHANGED"));
    }
    drop(file);
    let cached = {
        let registry = engine
            .media_classifications
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        registry
            .session
            .as_ref()
            .and_then(|s| s.previews.get(&record.hash))
            .cloned()
    };
    if let Some(preview) = cached {
        return Ok(preview);
    }
    let preview = if record.public.kind == "image" {
        MediaPreview {
            frames: vec![frame(
                &image_for_record(engine, &record, &authorized)?,
                None,
                None,
            )?],
        }
    } else {
        MediaPreview {
            frames: video_frames(engine, &record, &authorized)?
                .iter()
                .map(|(image, time, size)| frame(image, Some(*time), Some(*size)))
                .collect::<AppResult<Vec<_>>>()?,
        }
    };
    let bytes = preview_bytes(&preview);
    let mut registry = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    if let Some(session) = registry.session.as_mut().filter(|s| s.id == session_id) {
        while session.previews.len() >= MAX_PREVIEW_ITEMS
            || session.preview_bytes.saturating_add(bytes) > MAX_PREVIEW_BYTES
        {
            let Some(id) = session.preview_order.pop_front() else {
                break;
            };
            if let Some(old) = session.previews.remove(&id) {
                session.preview_bytes = session.preview_bytes.saturating_sub(preview_bytes(&old));
            }
        }
        if bytes <= MAX_PREVIEW_BYTES {
            session.preview_order.push_back(record.hash.clone());
            session.preview_bytes += bytes;
            session.previews.insert(record.hash, preview.clone());
        }
    }
    Ok(preview)
}
pub fn is_protected_hash(engine: &InboxEngine, hash: &str) -> AppResult<bool> {
    engine.db.with(|db| {
        Ok(db.query_row(
            "SELECT EXISTS(SELECT 1 FROM settings WHERE key=?1)",
            [format!("{PROTECTED_PREFIX}{hash}")],
            |r| r.get(0),
        )?)
    })
}
fn transfer_directory(engine: &InboxEngine, path: &Path) -> AppResult<PathBuf> {
    if is_recovery(path) {
        return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
    }
    let (canonical, _) = engine.access.resolve(path)?;
    if canonical != path {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    validate_directory(&canonical)?;
    Ok(canonical)
}

/// Transfer only the immutable files selected from this native classification session.
/// A destination grant from the native folder picker need not become a scan root.
pub fn preview_transfer(
    engine: &InboxEngine,
    session_id: &str,
    entry_ids: &[String],
    request: TransferRequest,
) -> AppResult<OrganizationPlan> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let records = snapshot(engine, session_id, entry_ids)?;
    let safe_duplicate_action =
        |action: &str| matches!(action, "skip" | "keep-existing" | "keep-both");
    let source_paths: HashSet<_> = records.iter().map(|r| &r.public.path).collect();
    if !matches!(request.mode.as_str(), "move" | "copy")
        || request.preset_id.is_some()
        || request.folder_name.is_some()
        || request.sources.len() != source_paths.len()
        || request.sources.iter().collect::<HashSet<_>>() != source_paths
        || !safe_duplicate_action(&request.duplicate_action)
        || request.resolutions.iter().any(|(path, resolution)| {
            !source_paths.contains(path)
                || resolution
                    .duplicate_action
                    .as_deref()
                    .is_some_and(|action| !safe_duplicate_action(action))
        })
    {
        return Err(AppError::new("INVALID_TRANSFER"));
    }
    let destination = transfer_directory(engine, Path::new(&request.destination))?;
    let authorized = session_roots(engine, session_id)?;
    let mut items = Vec::new();
    for record in records {
        let source = Path::new(&record.public.path);
        let target = destination.join(
            source
                .file_name()
                .ok_or_else(|| AppError::new("INVALID_NAME"))?,
        );
        if target == source {
            return Err(AppError::new("SAME_DESTINATION"));
        }
        let mut file = open_record(engine, &record, &authorized, false)?;
        if hash(engine, &mut file)? != record.hash {
            return Err(AppError::new("FILE_CHANGED"));
        }
        items.push(PlanItem {
            date_change: None,
            error: None,
            source_path: record.public.path,
            destination_path: path_text(&target)?,
            rule_name: "Transferir selección de la galería".into(),
            date_source: DateSource::Modified,
            date_used: record.public.stamp.modified_at.unwrap_or(0),
            stamp: record.public.stamp,
            conflict: false,
            action: request.mode.clone(),
            hash: record.hash,
            duplicates: Vec::new(),
            existing: None,
            backup: false,
            entry_kind: "file".into(),
            recovery_parent: None,
            required_existing: None,
            identity: record.identity,
            rule_id: String::new(),
        });
    }
    let (items, unreadable_count) = operations::resolve_items(
        engine,
        items,
        request.policy,
        &request.duplicate_action,
        &request.resolutions,
    )?;
    let mut state = engine.lock()?;
    let plan = OrganizationPlan {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        items,
        unmatched_count: 0,
        revision: state.revision,
        origin: "media-classification-transfer".into(),
        unreadable_count,
    };
    let mut registry = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    registry.transfer = Some(MediaTransferPreview {
        id: plan.id.clone(),
        session_id: session_id.into(),
        entry_ids: entry_ids.to_vec(),
        destination,
    });
    state.plan = Some(plan.clone());
    Ok(plan)
}

pub fn execute_transfer(
    engine: &InboxEngine,
    session_id: &str,
    plan_id: &str,
    progress: impl Fn(BatchProgress),
) -> AppResult<MediaTransferResult> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    engine.cancelled.store(false, Ordering::Relaxed);
    let transfer = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
        .transfer
        .take()
        .filter(|preview| preview.id == plan_id && preview.session_id == session_id)
        .ok_or_else(|| AppError::new("PLAN_EXPIRED"))?;
    let plan = operations::take_plan(engine, plan_id, "media-classification-transfer")?;
    let records = snapshot(engine, session_id, &transfer.entry_ids)?;
    let authorized = session_roots(engine, session_id)?;
    transfer_directory(engine, &transfer.destination)?;
    // Preflight the complete selection against the scan, before any backup or move.
    for record in &records {
        let mut file = open_record(engine, record, &authorized, false)?;
        if hash(engine, &mut file)? != record.hash {
            return Err(AppError::new("FILE_CHANGED"));
        }
    }
    let operation = operations::execute(engine, &plan, progress, |item| {
        transfer_directory(engine, &transfer.destination)?;
        if item.backup {
            if Path::new(&item.source_path).parent() != Some(transfer.destination.as_path()) {
                return Err(AppError::new("INVALID_TRANSFER"));
            }
            return operations::source(engine, Path::new(&item.source_path));
        }
        if Path::new(&item.destination_path).parent() != Some(transfer.destination.as_path()) {
            return Err(AppError::new("INVALID_TRANSFER"));
        }
        let record = records
            .iter()
            .find(|record| record.public.path == item.source_path)
            .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))?;
        open_record(engine, record, &authorized, false)?;
        Ok(())
    })?;
    let moved: HashSet<_> = operation
        .items
        .iter()
        .filter(|item| item.status == "completed" && item.kind == "move")
        .map(|item| item.source_path.as_str())
        .collect();
    let mut registry = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let session = registry
        .session
        .as_mut()
        .filter(|session| session.id == session_id)
        .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))?;
    session
        .entries
        .retain(|_, record| !moved.contains(record.public.path.as_str()));
    session.order.retain(|id| session.entries.contains_key(id));
    Ok(MediaTransferResult {
        operation,
        entries: session
            .order
            .iter()
            .filter_map(|id| session.entries.get(id).map(|record| record.public.clone()))
            .collect(),
    })
}

/// Persist an explicit category label for this content, independently of Conservar.
/// Validation of the complete immutable selection precedes the atomic database update.
pub fn set_categories(
    engine: &InboxEngine,
    session_id: &str,
    entry_ids: &[String],
    categories: Option<Vec<MediaCategory>>,
) -> AppResult<Vec<MediaEntry>> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    if categories
        .as_ref()
        .is_some_and(|value| !valid_categories(value))
    {
        return Err(AppError::new("INVALID_MEDIA_CATEGORIES"));
    }
    let records = snapshot(engine, session_id, entry_ids)?;
    let authorized = session_roots(engine, session_id)?;
    let mut guards = Vec::new();
    for record in &records {
        let mut file = open_record(engine, record, &authorized, true)?;
        if hash(engine, &mut file)? != record.hash {
            return Err(AppError::new("FILE_CHANGED"));
        }
        guards.push(file);
    }
    let settings = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
        .session
        .as_ref()
        .filter(|session| session.id == session_id)
        .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))?
        .settings
        .clone();
    engine.db.with(|db| {
        let transaction = db.transaction()?;
        for record in &records {
            let key = format!("{CORRECTION_PREFIX}{}", record.hash);
            if let Some(categories) = &categories {
                let correction = CategoryCorrection {
                    categories: categories.clone(),
                    model_version: classification_ai::MODEL_VERSION.into(),
                    analysis_mode: settings.analysis_mode,
                    embedding: record
                        .baseline
                        .as_ref()
                        .map(|baseline| baseline.embedding.clone())
                        .unwrap_or_default(),
                };
                transaction.execute(
                    "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
                    rusqlite::params![key, serde_json::to_string(&correction)?],
                )?;
            } else {
                transaction.execute("DELETE FROM settings WHERE key=?1", [key])?;
            }
        }
        transaction.commit()?;
        Ok(())
    })?;
    drop(guards);
    let changed: HashSet<_> = records.iter().map(|record| record.hash.as_str()).collect();
    let examples = if settings.use_corrections {
        correction_examples(engine, settings.analysis_mode)?
    } else {
        Vec::new()
    };
    let mut registry = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let session = registry
        .session
        .as_mut()
        .filter(|session| session.id == session_id)
        .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))?;
    for record in session.entries.values_mut() {
        if changed.contains(record.hash.as_str()) {
            apply_feedback(engine, record, &settings, &examples)?;
        }
    }
    Ok(session
        .order
        .iter()
        .filter_map(|id| session.entries.get(id).map(|record| record.public.clone()))
        .collect())
}

pub fn clear_corrections(engine: &InboxEngine) -> AppResult<MediaCorrectionsReset> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    engine.db.with(|db| {
        db.execute(
            "DELETE FROM settings WHERE key LIKE ?1",
            [format!("{CORRECTION_PREFIX}%")],
        )?;
        Ok(())
    })?;
    let entries = {
        let mut registry = engine
            .media_classifications
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        if let Some(session) = registry.session.as_mut() {
            session.entries.values_mut().for_each(restore_baseline);
            session
                .order
                .iter()
                .filter_map(|id| session.entries.get(id).map(|record| record.public.clone()))
                .collect()
        } else {
            Vec::new()
        }
    };
    Ok(MediaCorrectionsReset {
        configuration: load_settings(engine)?,
        entries,
    })
}

pub fn protect(
    engine: &InboxEngine,
    session_id: &str,
    entry_ids: &[String],
    protected: bool,
) -> AppResult<Vec<MediaEntry>> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let records = snapshot(engine, session_id, entry_ids)?;
    let authorized = session_roots(engine, session_id)?;
    let mut guards = Vec::new();
    for record in &records {
        let mut file = open_record(engine, record, &authorized, true)?;
        if hash(engine, &mut file)? != record.hash {
            return Err(AppError::new("FILE_CHANGED"));
        }
        guards.push(file);
    }
    engine.db.with(|db| {
        let tx = db.transaction()?;
        for record in &records {
            let key = format!("{PROTECTED_PREFIX}{}", record.hash);
            if protected {
                tx.execute(
                    "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,'1')",
                    [key],
                )?;
            } else {
                tx.execute("DELETE FROM settings WHERE key=?1", [key])?;
            }
        }
        tx.commit()?;
        Ok(())
    })?;
    drop(guards);
    let changed: HashSet<_> = records.iter().map(|r| r.hash.as_str()).collect();
    let mut registry = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let session = registry
        .session
        .as_mut()
        .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))?;
    for record in session.entries.values_mut() {
        if changed.contains(record.hash.as_str()) {
            record.public.protected = protected;
        }
    }
    Ok(session
        .order
        .iter()
        .filter_map(|id| session.entries.get(id).map(|r| r.public.clone()))
        .collect())
}
pub fn remove(
    engine: &InboxEngine,
    session_id: &str,
    entry_ids: &[String],
    progress: impl Fn(BatchProgress),
) -> AppResult<Operation> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let records = snapshot(engine, session_id, entry_ids)?;
    let authorized = session_roots(engine, session_id)?;
    // Validate every requested item before journaling or touching any file.
    for record in &records {
        if is_protected_hash(engine, &record.hash)? {
            return Err(AppError::new("MEDIA_PROTECTED"));
        }
        let mut file = open_record(engine, record, &authorized, false)?;
        if hash(engine, &mut file)? != record.hash {
            return Err(AppError::new("FILE_CHANGED"));
        }
    }
    let items = records
        .iter()
        .map(|record| -> AppResult<PlanItem> {
            let source = Path::new(&record.public.path);
            let destination = source
                .parent()
                .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?
                .join(".metaflow-recovery")
                .join(uuid::Uuid::new_v4().to_string());
            Ok(PlanItem {
                date_change: None,
                error: None,
                source_path: record.public.path.clone(),
                destination_path: path_text(&destination)?,
                rule_name: "Eliminar selección revisada con respaldo".into(),
                date_source: DateSource::Modified,
                date_used: record.public.stamp.modified_at.unwrap_or(0),
                stamp: record.public.stamp.clone(),
                conflict: false,
                action: "move".into(),
                hash: record.hash.clone(),
                duplicates: Vec::new(),
                existing: None,
                backup: true,
                entry_kind: "file".into(),
                recovery_parent: None,
                required_existing: None,
                identity: record.identity.clone(),
                rule_id: String::new(),
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let plan = OrganizationPlan {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        items,
        unmatched_count: 0,
        revision: engine.lock()?.revision,
        origin: "media-classification".into(),
        unreadable_count: 0,
    };
    let operation = operations::execute(engine, &plan, progress, |item| {
        scope(engine, Path::new(&item.source_path), &authorized)?;
        if is_protected_hash(engine, &item.hash)? {
            return Err(AppError::new("MEDIA_PROTECTED"));
        }
        let record = records
            .iter()
            .find(|r| r.public.path == item.source_path)
            .ok_or_else(|| AppError::new("CLASSIFICATION_REVIEW_EXPIRED"))?;
        let file = open_record(engine, record, &authorized, false)?;
        drop(file);
        Ok(())
    })?;
    let completed: HashSet<_> = operation
        .items
        .iter()
        .filter(|i| i.status == "completed")
        .map(|i| i.source_path.as_str())
        .collect();
    let mut registry = engine
        .media_classifications
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    if let Some(session) = registry.session.as_mut() {
        session
            .entries
            .retain(|_, r| !completed.contains(r.public.path.as_str()));
        session.order.retain(|id| session.entries.contains_key(id));
    }
    Ok(operation)
}
