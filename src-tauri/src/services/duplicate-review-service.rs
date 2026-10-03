//! Explicit, bounded visual review. Perceptual matches never become automatic removals.
use crate::{
    database::repositories::workspace_repository,
    domain::{duplicate_review::*, organization::*},
    errors::{AppError, AppResult},
    services::{
        access_service::path_text,
        file_operation_service as operations,
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
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs::File,
    io::{Cursor, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
};

const MAX_FILES: usize = 100_000;
const MAX_ENTRIES: usize = 200_000;
const MAX_IMAGES: usize = 10_000;
const MAX_COMPARISONS: usize = 20_000;
const MAX_PAIR_ATTEMPTS: usize = 100_000;
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DECODED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_AXIS: u32 = 16_384;
const MAX_THUMBNAIL_CACHE_BYTES: usize = 8 * 1024 * 1024;
const MAX_THUMBNAIL_CACHE_ITEMS: usize = 16;
const DISMISSAL_PREFIX: &str = "duplicate-review-dismissal:";

#[derive(Clone)]
struct RecordedFile {
    comparison: FileComparison,
    identity: String,
    timestamps: (u64, u64),
}
#[derive(Clone)]
struct RecordedPair {
    public: DuplicateReviewComparison,
    left: RecordedFile,
    right: RecordedFile,
    dismissal_key: String,
}
struct ReviewSession {
    id: String,
    revision: u64,
    pairs: BTreeMap<String, RecordedPair>,
    thumbnails: HashMap<String, ImageThumbnail>,
    thumbnail_order: VecDeque<String>,
    thumbnail_bytes: usize,
}
/// Holds one explicit scan, never accepts a frontend filesystem path as a preview grant.
#[derive(Default)]
pub struct ReviewRegistry {
    session: Option<ReviewSession>,
}

struct Candidate {
    path: PathBuf,
    stamp: FileStamp,
}
struct Collected {
    files: Vec<Candidate>,
    unreadable: usize,
    truncated: bool,
}

fn cancel(engine: &InboxEngine) -> AppResult<()> {
    if engine.cancelled.load(Ordering::Relaxed) {
        Err(AppError::new("OPERATION_CANCELLED"))
    } else {
        Ok(())
    }
}
fn roots(engine: &InboxEngine) -> AppResult<Vec<PathBuf>> {
    let mut roots: Vec<PathBuf> = workspace_repository::load(&engine.db)?
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
fn is_recovery(path: &Path) -> bool {
    path.components().any(|part| {
        part.as_os_str()
            .to_str()
            .is_some_and(|s| s.eq_ignore_ascii_case(".metaflow-recovery"))
    })
}
fn scope(engine: &InboxEngine, path: &Path, roots: &[PathBuf]) -> AppResult<()> {
    // Reject unconfigured lexical paths before checking their existence.
    if is_recovery(path) || !roots.iter().any(|root| path.starts_with(root)) {
        return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
    }
    operations::source(engine, path)
}
fn collect(engine: &InboxEngine, roots: &[PathBuf]) -> AppResult<Collected> {
    let mut result = Collected {
        files: Vec::new(),
        unreadable: 0,
        truncated: false,
    };
    let mut stack = roots.to_vec();
    let mut scanned = HashSet::new();
    let mut seen_files = HashSet::new();
    let mut entries_seen = 0;
    'directories: while let Some(directory) = stack.pop() {
        cancel(engine)?;
        if !scanned.insert(path_key(&directory)) || is_recovery(&directory) {
            continue;
        }
        if validate_directory(&directory).is_err()
            || engine.access.resolve(&directory).is_err()
            || !dunce::canonicalize(&directory).is_ok_and(|p| p == directory)
        {
            result.unreadable += 1;
            continue;
        }
        let entries = match std::fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(_) => {
                result.unreadable += 1;
                continue;
            }
        };
        for entry in entries {
            cancel(engine)?;
            entries_seen += 1;
            if entries_seen > MAX_ENTRIES || result.files.len() >= MAX_FILES {
                result.truncated = true;
                break 'directories;
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
                Ok(metadata) => metadata,
                Err(_) => {
                    result.unreadable += 1;
                    continue;
                }
            };
            if metadata.is_dir() {
                if validate_directory(&path).is_ok() {
                    stack.push(path);
                } else {
                    result.unreadable += 1;
                }
            } else if move_service::regular_file(&path).is_ok()
                && seen_files.insert(path_key(&path))
            {
                result.files.push(Candidate {
                    stamp: move_service::stamp(&metadata),
                    path,
                });
            }
        }
    }
    result.files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
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
fn partial(file: &mut File) -> AppResult<String> {
    let size = file.metadata()?.len();
    let mut digest = blake3::Hasher::new();
    digest.update(&size.to_le_bytes());
    let mut buffer = [0u8; 65_536];
    let count = file.read(&mut buffer)?;
    digest.update(&buffer[..count]);
    if size > 65_536 {
        file.seek(SeekFrom::End(-65_536))?;
        file.read_exact(&mut buffer)?;
        digest.update(&buffer);
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(digest.finalize().to_hex().to_string())
}
fn precise_timestamps(metadata: &std::fs::Metadata) -> (u64, u64) {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        (metadata.creation_time(), metadata.last_write_time())
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        // The public stamp remains checked on every platform. Native Windows
        // FILETIMEs additionally distinguish changes below millisecond precision.
        (0, 0)
    }
}
fn open_candidate(
    engine: &InboxEngine,
    candidate: &Candidate,
    roots: &[PathBuf],
) -> AppResult<File> {
    scope(engine, &candidate.path, roots)?;
    let file = move_service::open_locked(&candidate.path, false)?;
    if move_service::stamp(&file.metadata()?) != candidate.stamp {
        return Err(AppError::new("FILE_CHANGED"));
    }
    if dunce::canonicalize(&candidate.path)? != candidate.path {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    Ok(file)
}
fn record(
    engine: &InboxEngine,
    candidate: &Candidate,
    roots: &[PathBuf],
) -> AppResult<RecordedFile> {
    let mut file = open_candidate(engine, candidate, roots)?;
    Ok(RecordedFile {
        comparison: FileComparison {
            path: path_text(&candidate.path)?,
            stamp: candidate.stamp.clone(),
            hash: Some(hash(engine, &mut file)?),
            planned: false,
        },
        identity: move_service::identity(&file)?,
        timestamps: precise_timestamps(&file.metadata()?),
    })
}

fn dismissal_key(left: &RecordedFile, right: &RecordedFile) -> AppResult<String> {
    let signature = |file: &RecordedFile| {
        (
            path_key(Path::new(&file.comparison.path)),
            file.comparison.stamp.clone(),
            file.comparison.hash.clone(),
            file.identity.clone(),
            file.timestamps,
        )
    };
    let mut files = vec![signature(left), signature(right)];
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let digest = blake3::hash(&serde_json::to_vec(&files)?);
    Ok(format!("{DISMISSAL_PREFIX}{}", digest.to_hex()))
}
fn dismissed(engine: &InboxEngine) -> AppResult<HashSet<String>> {
    engine.db.with(|db| {
        let mut statement = db.prepare("SELECT key FROM settings WHERE key LIKE ?1")?;
        let rows = statement.query_map([format!("{DISMISSAL_PREFIX}%")], |row| row.get(0))?;
        Ok(rows.collect::<Result<HashSet<_>, _>>()?)
    })
}
struct PairBuilder {
    pairs: Vec<RecordedPair>,
    ignored: usize,
    attempts: usize,
    keys: HashSet<String>,
    dismissed: HashSet<String>,
    truncated: bool,
}
impl PairBuilder {
    fn add(
        &mut self,
        left: &RecordedFile,
        right: &RecordedFile,
        kind: ComparisonKind,
    ) -> AppResult<bool> {
        if self.pairs.len() >= MAX_COMPARISONS || self.attempts >= MAX_PAIR_ATTEMPTS {
            self.truncated = true;
            return Ok(false);
        }
        let key = dismissal_key(left, right)?;
        if !self.keys.insert(key.clone()) {
            return Ok(true);
        }
        self.attempts += 1;
        if self.dismissed.contains(&key) {
            self.ignored += 1;
            return Ok(true);
        }
        self.pairs.push(RecordedPair {
            public: DuplicateReviewComparison {
                id: uuid::Uuid::new_v4().to_string(),
                left: left.comparison.clone(),
                right: right.comparison.clone(),
                kind,
            },
            left: left.clone(),
            right: right.clone(),
            dismissal_key: key,
        });
        Ok(true)
    }
}
fn exact_pairs(
    engine: &InboxEngine,
    files: &[Candidate],
    roots: &[PathBuf],
    builder: &mut PairBuilder,
    records: &mut HashMap<String, RecordedFile>,
    unreadable: &mut usize,
) -> AppResult<()> {
    let mut sizes: BTreeMap<u64, Vec<&Candidate>> = BTreeMap::new();
    for candidate in files {
        sizes
            .entry(candidate.stamp.size)
            .or_default()
            .push(candidate);
    }
    'sizes: for candidates in sizes.values().filter(|files| files.len() > 1) {
        let mut samples: BTreeMap<String, Vec<&Candidate>> = BTreeMap::new();
        for candidate in candidates {
            cancel(engine)?;
            match open_candidate(engine, candidate, roots).and_then(|mut f| partial(&mut f)) {
                Ok(sample) => samples.entry(sample).or_default().push(candidate),
                Err(_) => *unreadable += 1,
            }
        }
        for matches in samples.values().filter(|files| files.len() > 1) {
            let mut confirmed: BTreeMap<String, Vec<RecordedFile>> = BTreeMap::new();
            for candidate in matches {
                cancel(engine)?;
                match record(engine, candidate, roots) {
                    Ok(record) => {
                        records.insert(path_key(&candidate.path), record.clone());
                        confirmed
                            .entry(record.comparison.hash.clone().unwrap_or_default())
                            .or_default()
                            .push(record);
                    }
                    Err(error) if error.code == "OPERATION_CANCELLED" => return Err(error),
                    Err(_) => *unreadable += 1,
                }
            }
            for group in confirmed.values().filter(|files| files.len() > 1) {
                if group.len() <= 200 {
                    for (index, left) in group.iter().enumerate() {
                        for right in &group[index + 1..] {
                            cancel(engine)?;
                            if !builder.add(left, right, ComparisonKind::Exact)? {
                                break 'sizes;
                            }
                        }
                    }
                } else {
                    // Keep a linear catalog for very large identical groups. Neighbor pairs
                    // still allow useful review when the first anchor is removed.
                    builder.truncated = true;
                    for right in &group[1..] {
                        if !builder.add(&group[0], right, ComparisonKind::Exact)? {
                            break 'sizes;
                        }
                    }
                    for pair in group[1..].windows(2) {
                        if !builder.add(&pair[0], &pair[1], ComparisonKind::Exact)? {
                            break 'sizes;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn image_extension(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| {
        matches!(
            s.to_ascii_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "ico"
        )
    })
}
fn read_bytes(engine: &InboxEngine, file: &mut File) -> AppResult<Vec<u8>> {
    if file.metadata()?.len() > MAX_IMAGE_BYTES {
        return Err(AppError::new("IMAGE_TOO_LARGE"));
    }
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 131_072];
    file.seek(SeekFrom::Start(0))?;
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
    // Decoder allocation limits are best effort; these explicit checks bound the
    // output even for formats that do not enforce the allocator limit themselves.
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
fn flattened(image: &DynamicImage) -> RgbImage {
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let pixel = rgba.get_pixel(x, y).0;
        let alpha = u16::from(pixel[3]);
        Rgb(std::array::from_fn(|c| {
            ((u16::from(pixel[c]) * alpha + 255 * (255 - alpha)) / 255) as u8
        }))
    })
}
struct Fingerprint {
    phash: u64,
    dhash: u64,
    colors: Vec<u8>,
    aspect: f64,
}
struct ImageCandidate {
    files: Vec<RecordedFile>,
    fingerprint: Arc<Fingerprint>,
}
fn fingerprint(image: &DynamicImage) -> Fingerprint {
    let normalized =
        DynamicImage::ImageRgb8(flattened(&image.resize_exact(32, 32, FilterType::Triangle)));
    let gray = normalized.to_luma8();
    let mut cosine = [[0.0; 32]; 8];
    for (frequency, row) in cosine.iter_mut().enumerate() {
        for (position, value) in row.iter_mut().enumerate() {
            *value =
                ((2 * position + 1) as f64 * frequency as f64 * std::f64::consts::PI / 64.0).cos();
        }
    }
    let mut horizontal = [[0.0; 8]; 32];
    for (y, row) in horizontal.iter_mut().enumerate() {
        for (frequency, value) in row.iter_mut().enumerate() {
            *value = (0..32)
                .map(|x| {
                    f64::from(gray.get_pixel(x, y as u32).0[0]) * cosine[frequency][x as usize]
                })
                .sum();
        }
    }
    let mut coefficients = Vec::with_capacity(63);
    for (vertical_frequency, row) in cosine.iter().enumerate() {
        for (horizontal_frequency, _) in horizontal[0].iter().enumerate() {
            if vertical_frequency == 0 && horizontal_frequency == 0 {
                continue;
            }
            coefficients.push(
                (0..32)
                    .map(|y| horizontal[y][horizontal_frequency] * row[y])
                    .sum::<f64>(),
            );
        }
    }
    let mut ordered = coefficients.clone();
    ordered.sort_by(f64::total_cmp);
    let median = ordered[ordered.len() / 2];
    let phash = coefficients
        .iter()
        .enumerate()
        .fold(0u64, |hash, (index, coefficient)| {
            hash | (u64::from(*coefficient > median) << index)
        });
    let gradient = normalized
        .resize_exact(9, 8, FilterType::Triangle)
        .to_luma8();
    let mut dhash = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            if gradient.get_pixel(x, y).0[0] > gradient.get_pixel(x + 1, y).0[0] {
                dhash |= 1u64 << (y * 8 + x);
            }
        }
    }
    Fingerprint {
        phash,
        dhash,
        colors: normalized
            .resize_exact(16, 16, FilterType::Triangle)
            .to_rgb8()
            .into_raw(),
        aspect: f64::from(image.width()) / f64::from(image.height()),
    }
}
fn similar(left: &Fingerprint, right: &Fingerprint) -> bool {
    let aspect_difference = (left.aspect - right.aspect).abs() / left.aspect.max(right.aspect);
    if aspect_difference > 0.04
        || (left.phash ^ right.phash).count_ones() > 16
        || (left.dhash ^ right.dhash).count_ones() > 14
    {
        return false;
    }
    let difference: u64 = left
        .colors
        .iter()
        .zip(&right.colors)
        .map(|(a, b)| u64::from(a.abs_diff(*b)))
        .sum();
    difference <= left.colors.len() as u64 * 24
}
#[derive(Default)]
struct HashTree {
    nodes: Vec<HashNode>,
}
struct HashNode {
    hash: u64,
    candidates: Vec<usize>,
    children: BTreeMap<u32, usize>,
}
impl HashTree {
    fn insert(&mut self, hash: u64, candidate: usize) {
        if self.nodes.is_empty() {
            self.nodes.push(HashNode {
                hash,
                candidates: vec![candidate],
                children: BTreeMap::new(),
            });
            return;
        }
        let mut current = 0;
        loop {
            let distance = (self.nodes[current].hash ^ hash).count_ones();
            if distance == 0 {
                self.nodes[current].candidates.push(candidate);
                return;
            }
            if let Some(next) = self.nodes[current].children.get(&distance) {
                current = *next;
            } else {
                let index = self.nodes.len();
                self.nodes[current].children.insert(distance, index);
                self.nodes.push(HashNode {
                    hash,
                    candidates: vec![candidate],
                    children: BTreeMap::new(),
                });
                return;
            }
        }
    }
    fn nearby(&self, hash: u64, remaining_nodes: &mut usize) -> Option<Vec<usize>> {
        if self.nodes.is_empty() {
            return Some(Vec::new());
        }
        let mut result = Vec::new();
        let mut stack = vec![0];
        while let Some(current) = stack.pop() {
            if *remaining_nodes == 0 {
                return None;
            }
            *remaining_nodes -= 1;
            let node = &self.nodes[current];
            let distance = (node.hash ^ hash).count_ones();
            if distance <= 16 {
                result.extend(&node.candidates);
            }
            for (_, index) in node
                .children
                .range(distance.saturating_sub(16)..=distance.saturating_add(16))
            {
                stack.push(*index);
            }
        }
        result.sort_unstable();
        Some(result)
    }
}
fn similar_pairs(
    engine: &InboxEngine,
    files: &[Candidate],
    roots: &[PathBuf],
    builder: &mut PairBuilder,
    records: &mut HashMap<String, RecordedFile>,
    unreadable: &mut usize,
) -> AppResult<()> {
    let mut images: Vec<ImageCandidate> = Vec::new();
    let mut known: HashMap<String, usize> = HashMap::new();
    for (inspected, candidate) in files
        .iter()
        .filter(|c| image_extension(&c.path))
        .enumerate()
    {
        cancel(engine)?;
        if inspected >= MAX_IMAGES || builder.pairs.len() >= MAX_COMPARISONS {
            builder.truncated = true;
            break;
        }
        let checked = (|| -> AppResult<(RecordedFile, Vec<u8>)> {
            let mut file = open_candidate(engine, candidate, roots)?;
            let bytes = read_bytes(engine, &mut file)?;
            let digest = blake3::hash(&bytes).to_hex().to_string();
            let record = RecordedFile {
                comparison: FileComparison {
                    path: path_text(&candidate.path)?,
                    stamp: candidate.stamp.clone(),
                    hash: Some(digest),
                    planned: false,
                },
                identity: move_service::identity(&file)?,
                timestamps: precise_timestamps(&file.metadata()?),
            };
            if records
                .get(&path_key(&candidate.path))
                .is_some_and(|before| {
                    before.identity != record.identity
                        || before.comparison.hash != record.comparison.hash
                })
            {
                return Err(AppError::new("FILE_CHANGED"));
            }
            Ok((record, bytes))
        })();
        let (record, bytes) = match checked {
            Ok(checked) => checked,
            Err(error) if error.code == "OPERATION_CANCELLED" => return Err(error),
            Err(_) => {
                *unreadable += 1;
                continue;
            }
        };
        let content_hash = record.comparison.hash.clone().unwrap_or_default();
        // Exact copies already have their own pair catalog and need only one decode.
        if let Some(index) = known.get(&content_hash) {
            images[*index].files.push(record);
            continue;
        }
        let image = match decode(&bytes) {
            Ok(image) => image,
            Err(_) => {
                *unreadable += 1;
                continue;
            }
        };
        cancel(engine)?;
        let feature = Arc::new(fingerprint(&image));
        known.insert(content_hash, images.len());
        records.insert(path_key(&candidate.path), record.clone());
        images.push(ImageCandidate {
            files: vec![record],
            fingerprint: feature,
        });
    }
    // Decode once per content hash, then expand each visual relationship to its
    // copies. Removing either representative must not hide surviving comparisons.
    let mut tree = HashTree::default();
    let mut evaluations = 0;
    let mut remaining_nodes = 1_000_000;
    for (index, candidate) in images.iter().enumerate() {
        cancel(engine)?;
        let Some(nearby) = tree.nearby(candidate.fingerprint.phash, &mut remaining_nodes) else {
            builder.truncated = true;
            break;
        };
        for other in nearby {
            cancel(engine)?;
            if evaluations >= MAX_PAIR_ATTEMPTS {
                builder.truncated = true;
                return Ok(());
            }
            evaluations += 1;
            if similar(&candidate.fingerprint, &images[other].fingerprint) {
                for left in &images[other].files {
                    for right in &candidate.files {
                        cancel(engine)?;
                        if !builder.add(left, right, ComparisonKind::Similar)? {
                            return Ok(());
                        }
                    }
                }
            }
        }
        tree.insert(candidate.fingerprint.phash, index);
    }
    Ok(())
}

pub fn scan(engine: &InboxEngine, include_similar: bool) -> AppResult<DuplicateReviewScan> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    engine.cancelled.store(false, Ordering::Relaxed);
    // Starting a scan expires the old image grants even when the new scan is cancelled.
    engine
        .duplicate_reviews
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
        .session = None;
    let roots = roots(engine)?;
    let collected = collect(engine, &roots)?;
    let mut unreadable = collected.unreadable;
    let mut records = HashMap::new();
    let mut builder = PairBuilder {
        pairs: Vec::new(),
        ignored: 0,
        attempts: 0,
        keys: HashSet::new(),
        dismissed: dismissed(engine)?,
        truncated: collected.truncated,
    };
    exact_pairs(
        engine,
        &collected.files,
        &roots,
        &mut builder,
        &mut records,
        &mut unreadable,
    )?;
    if include_similar {
        similar_pairs(
            engine,
            &collected.files,
            &roots,
            &mut builder,
            &mut records,
            &mut unreadable,
        )?;
    }
    cancel(engine)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let result = DuplicateReviewScan {
        session_id: session_id.clone(),
        comparisons: builder.pairs.iter().map(|p| p.public.clone()).collect(),
        unreadable_count: unreadable,
        ignored_count: builder.ignored,
        truncated: builder.truncated,
    };
    let session = ReviewSession {
        id: session_id,
        revision: engine.lock()?.revision,
        pairs: builder
            .pairs
            .into_iter()
            .map(|p| (p.public.id.clone(), p))
            .collect(),
        thumbnails: HashMap::new(),
        thumbnail_order: VecDeque::new(),
        thumbnail_bytes: 0,
    };
    engine
        .duplicate_reviews
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
        .session = Some(session);
    Ok(result)
}

fn snapshot(
    engine: &InboxEngine,
    session_id: &str,
    comparison_id: &str,
) -> AppResult<RecordedPair> {
    let revision = engine.lock()?.revision;
    let registry = engine
        .duplicate_reviews
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let session = registry
        .session
        .as_ref()
        .filter(|s| s.id == session_id && s.revision == revision)
        .ok_or_else(|| AppError::new("DUPLICATE_REVIEW_EXPIRED"))?;
    session
        .pairs
        .get(comparison_id)
        .cloned()
        .ok_or_else(|| AppError::new("DUPLICATE_REVIEW_EXPIRED"))
}
fn side<'a>(pair: &'a RecordedPair, side: &str) -> AppResult<(&'a RecordedFile, &'a RecordedFile)> {
    match side {
        "left" => Ok((&pair.left, &pair.right)),
        "right" => Ok((&pair.right, &pair.left)),
        _ => Err(AppError::new("INVALID_TRANSFER")),
    }
}
fn checked_file(engine: &InboxEngine, record: &RecordedFile, roots: &[PathBuf]) -> AppResult<File> {
    let path = Path::new(&record.comparison.path);
    scope(engine, path, roots)?;
    let file = move_service::open_locked(path, false)?;
    if move_service::stamp(&file.metadata()?) != record.comparison.stamp
        || move_service::identity(&file)? != record.identity
        || precise_timestamps(&file.metadata()?) != record.timestamps
    {
        return Err(AppError::new("FILE_CHANGED"));
    }
    if dunce::canonicalize(path)? != path {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    Ok(file)
}
pub fn thumbnail(
    engine: &InboxEngine,
    session_id: &str,
    comparison_id: &str,
    selected_side: &str,
) -> AppResult<ImageThumbnail> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    engine.cancelled.store(false, Ordering::Relaxed);
    let pair = snapshot(engine, session_id, comparison_id)?;
    let (record, _) = side(&pair, selected_side)?;
    let roots = roots(engine)?;
    let mut file = checked_file(engine, record, &roots)?;
    let bytes = read_bytes(engine, &mut file)?;
    let digest = blake3::hash(&bytes).to_hex().to_string();
    if record.comparison.hash.as_deref() != Some(&digest) {
        return Err(AppError::new("FILE_CHANGED"));
    }
    drop(file);
    let cached = {
        let registry = engine
            .duplicate_reviews
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        registry
            .session
            .as_ref()
            .and_then(|s| s.thumbnails.get(&digest))
            .cloned()
    };
    if let Some(cached) = cached {
        return Ok(cached);
    }
    let decoded = decode(&bytes)?;
    cancel(engine)?;
    let resized = if decoded.width() > 1280 || decoded.height() > 1280 {
        Some(decoded.resize(1280, 1280, FilterType::Triangle))
    } else {
        None
    };
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 84)
        .encode_image(&DynamicImage::ImageRgb8(flattened(
            resized.as_ref().unwrap_or(&decoded),
        )))
        .map_err(|_| AppError::new("UNSUPPORTED_IMAGE"))?;
    let thumbnail = ImageThumbnail {
        data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)),
        width: decoded.width(),
        height: decoded.height(),
    };
    let mut registry = engine
        .duplicate_reviews
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    if let Some(session) = registry.session.as_mut().filter(|s| s.id == session_id) {
        while session.thumbnails.len() >= MAX_THUMBNAIL_CACHE_ITEMS
            || session
                .thumbnail_bytes
                .saturating_add(thumbnail.data_url.len())
                > MAX_THUMBNAIL_CACHE_BYTES
        {
            let Some(oldest) = session.thumbnail_order.pop_front() else {
                break;
            };
            if let Some(old) = session.thumbnails.remove(&oldest) {
                session.thumbnail_bytes =
                    session.thumbnail_bytes.saturating_sub(old.data_url.len());
            }
        }
        if thumbnail.data_url.len() <= MAX_THUMBNAIL_CACHE_BYTES {
            session.thumbnail_bytes += thumbnail.data_url.len();
            session.thumbnail_order.push_back(digest.clone());
            session.thumbnails.insert(digest, thumbnail.clone());
        }
    }
    Ok(thumbnail)
}
pub fn dismiss(engine: &InboxEngine, session_id: &str, comparison_id: &str) -> AppResult<()> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    let pair = snapshot(engine, session_id, comparison_id)?;
    let roots = roots(engine)?;
    // This non-mutating choice checks IDs/stamps; subsequent scans recompute content
    // hashes, so an edited or replaced file cannot inherit this dismissal.
    drop(checked_file(engine, &pair.left, &roots)?);
    drop(checked_file(engine, &pair.right, &roots)?);
    engine.db.with(|db| {
        db.execute(
            "INSERT OR REPLACE INTO settings (key,value) VALUES (?1,'1')",
            [&pair.dismissal_key],
        )?;
        Ok(())
    })?;
    let mut registry = engine
        .duplicate_reviews
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    if let Some(session) = registry.session.as_mut() {
        session.pairs.remove(comparison_id);
    }
    Ok(())
}
pub fn reset_dismissals(engine: &InboxEngine) -> AppResult<()> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    engine.db.with(|db| {
        db.execute(
            "DELETE FROM settings WHERE key LIKE ?1",
            [format!("{DISMISSAL_PREFIX}%")],
        )?;
        Ok(())
    })?;
    engine
        .duplicate_reviews
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?
        .session = None;
    Ok(())
}
pub fn remove(
    engine: &InboxEngine,
    session_id: &str,
    comparison_id: &str,
    selected_side: &str,
    progress: impl Fn(BatchProgress),
) -> AppResult<Operation> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    engine.cancelled.store(false, Ordering::Relaxed);
    let pair = snapshot(engine, session_id, comparison_id)?;
    let (retiring, keeper) = side(&pair, selected_side)?;
    if let Some(hash) = &retiring.comparison.hash {
        if super::media_classification_service::is_protected_hash(engine, hash)? {
            return Err(AppError::new("MEDIA_PROTECTED"));
        }
    }
    let roots = roots(engine)?;
    for record in [retiring, keeper] {
        let mut file = checked_file(engine, record, &roots)?;
        if record.comparison.hash.as_deref() != Some(&hash(engine, &mut file)?) {
            return Err(AppError::new("FILE_CHANGED"));
        }
    }
    let source = Path::new(&retiring.comparison.path);
    let destination = source
        .parent()
        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?
        .join(".metaflow-recovery")
        .join(uuid::Uuid::new_v4().to_string());
    let plan = OrganizationPlan {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        items: vec![PlanItem {
            date_change: None,
            error: None,
            source_path: retiring.comparison.path.clone(),
            destination_path: path_text(&destination)?,
            rule_name: match pair.public.kind {
                ComparisonKind::Exact => "Eliminar duplicado con respaldo",
                ComparisonKind::Similar => "Eliminar imagen revisada con respaldo",
            }
            .into(),
            date_source: DateSource::Modified,
            date_used: retiring.comparison.stamp.modified_at.unwrap_or(0),
            stamp: retiring.comparison.stamp.clone(),
            conflict: false,
            action: "move".into(),
            hash: retiring
                .comparison
                .hash
                .clone()
                .ok_or_else(|| AppError::new("FILE_CHANGED"))?,
            identity: retiring.identity.clone(),
            duplicates: Vec::new(),
            existing: None,
            backup: true,
            entry_kind: "file".into(),
            recovery_parent: None,
            required_existing: Some(keeper.comparison.clone()),
            rule_id: String::new(),
        }],
        unmatched_count: 0,
        revision: engine.lock()?.revision,
        origin: "duplicate-review".into(),
        unreadable_count: 0,
    };
    let operation = operations::execute_with_keeper_check(
        engine,
        &plan,
        progress,
        |item| {
            scope(engine, Path::new(&item.source_path), &roots)?;
            scope(engine, Path::new(&keeper.comparison.path), &roots)
        },
        |file| {
            if move_service::identity(file)? != keeper.identity
                || precise_timestamps(&file.metadata()?) != keeper.timestamps
            {
                Err(AppError::new("FILE_CHANGED"))
            } else {
                Ok(())
            }
        },
    )?;
    if operation
        .items
        .iter()
        .any(|item| item.status == "completed")
    {
        let mut registry = engine
            .duplicate_reviews
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        if let Some(session) = registry.session.as_mut().filter(|s| s.id == session_id) {
            let removed = path_key(source);
            session.pairs.retain(|_, p| {
                path_key(Path::new(&p.left.comparison.path)) != removed
                    && path_key(Path::new(&p.right.comparison.path)) != removed
            });
        }
    }
    Ok(operation)
}
