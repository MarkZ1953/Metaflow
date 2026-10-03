//! Progressive checks run in Rust worker threads only, on an explicit preview request.
use crate::{
    database::repositories::workspace_repository,
    domain::organization::*,
    errors::{AppError, AppResult},
    services::{
        access_service::path_text,
        inbox_service::{validate_directory, InboxEngine},
        move_service,
        organizer_service::path_key,
    },
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};
pub struct DuplicateIndex {
    by_size: BTreeMap<u64, Vec<PathBuf>>,
    cache: HashMap<String, FileComparison>,
    pub unreadable: usize,
}
impl DuplicateIndex {
    pub fn collect(engine: &InboxEngine, excluded: &HashSet<String>) -> AppResult<Self> {
        let mut roots: Vec<PathBuf> = workspace_repository::load(&engine.db)?
            .roots
            .iter()
            .map(|r| PathBuf::from(&r.path))
            .collect();
        {
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
        }
        roots.sort();
        roots.dedup();
        let mut scanned = HashSet::new();
        let mut index = Self {
            by_size: BTreeMap::new(),
            cache: HashMap::new(),
            unreadable: 0,
        };
        let mut stack = roots;
        while let Some(directory) = stack.pop() {
            check_cancel(engine)?;
            if !scanned.insert(path_key(&directory)) {
                continue;
            }
            if validate_directory(&directory).is_err() {
                index.unreadable += 1;
                continue;
            }
            if engine.access.resolve(&directory).is_err() {
                index.unreadable += 1;
                continue;
            }
            let entries = match std::fs::read_dir(&directory) {
                Ok(e) => e,
                Err(_) => {
                    index.unreadable += 1;
                    continue;
                }
            };
            for entry in entries {
                check_cancel(engine)?;
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => {
                        index.unreadable += 1;
                        continue;
                    }
                };
                let path = entry.path();
                if path
                    .file_name()
                    .is_some_and(|name| name == ".metaflow-recovery")
                {
                    continue;
                }
                let metadata = match std::fs::symlink_metadata(&path) {
                    Ok(m) => m,
                    Err(_) => {
                        index.unreadable += 1;
                        continue;
                    }
                };
                if metadata.is_dir() {
                    if validate_directory(&path).is_ok() {
                        stack.push(path);
                    }
                    continue;
                }
                if excluded.contains(&path_key(&path)) {
                    continue;
                }
                if move_service::regular_file(&path).is_ok() {
                    index.by_size.entry(metadata.len()).or_default().push(path);
                }
            }
        }
        for paths in index.by_size.values_mut() {
            paths.sort();
            paths.dedup();
        }
        Ok(index)
    }
    pub fn find(
        &mut self,
        engine: &InboxEngine,
        item: &PlanItem,
    ) -> AppResult<Vec<FileComparison>> {
        let Some(paths) = self.by_size.get(&item.stamp.size) else {
            return Ok(Vec::new());
        };
        let mut original = move_service::open_locked(Path::new(&item.source_path), false)?;
        if move_service::stamp(&original.metadata()?) != item.stamp {
            return Err(AppError::new("FILE_CHANGED"));
        }
        let sample = partial_hash(&mut original)?;
        drop(original);
        let mut matches = Vec::new();
        for path in paths {
            check_cancel(engine)?;
            let key = path_key(path);
            if let Some(cached) = self.cache.get(&key) {
                if cached.hash.as_deref() == Some(&item.hash) {
                    matches.push(cached.clone());
                }
                continue;
            }
            let checked = (|| -> AppResult<Option<FileComparison>> {
                let mut file = move_service::open_locked(path, false)?;
                let stamp = move_service::stamp(&file.metadata()?);
                if stamp.size != item.stamp.size || partial_hash(&mut file)? != sample {
                    return Ok(None);
                }
                let hash = move_service::hash(&mut file)?;
                Ok(Some(FileComparison {
                    path: path_text(path)?,
                    stamp,
                    hash: Some(hash),
                    planned: false,
                }))
            })();
            match checked {
                Ok(Some(file)) => {
                    if file.hash.as_deref() == Some(&item.hash) {
                        matches.push(file.clone());
                    }
                    self.cache.insert(key, file);
                }
                Ok(None) => {}
                Err(_) => self.unreadable += 1,
            }
        }
        Ok(matches)
    }
}
fn partial_hash(file: &mut File) -> AppResult<String> {
    let size = file.metadata()?.len();
    let mut digest = blake3::Hasher::new();
    digest.update(&size.to_le_bytes());
    let mut buffer = [0u8; 65536];
    file.seek(SeekFrom::Start(0))?;
    let count = file.read(&mut buffer)?;
    digest.update(&buffer[..count]);
    if size > 65536 {
        file.seek(SeekFrom::End(-65536))?;
        file.read_exact(&mut buffer)?;
        digest.update(&buffer);
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(digest.finalize().to_hex().to_string())
}
pub fn comparison(path: &Path) -> AppResult<FileComparison> {
    let mut file = move_service::open_locked(path, false)?;
    Ok(FileComparison {
        path: path_text(path)?,
        stamp: move_service::stamp(&file.metadata()?),
        hash: Some(move_service::hash(&mut file)?),
        planned: false,
    })
}
fn check_cancel(engine: &InboxEngine) -> AppResult<()> {
    if engine.cancelled.load(Ordering::Relaxed) {
        Err(AppError::new("OPERATION_CANCELLED"))
    } else {
        Ok(())
    }
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub hash: String,
    pub files: Vec<FileComparison>,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateScan {
    pub groups: Vec<DuplicateGroup>,
    pub unreadable_count: usize,
}
pub fn scan(engine: &InboxEngine) -> AppResult<DuplicateScan> {
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    engine.cancelled.store(false, Ordering::Relaxed);
    let mut index = DuplicateIndex::collect(engine, &HashSet::new())?;
    let mut groups = Vec::new();
    for candidates in index.by_size.values().filter(|files| files.len() > 1) {
        let mut samples: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for path in candidates {
            check_cancel(engine)?;
            let digest = (|| -> AppResult<String> {
                partial_hash(&mut move_service::open_locked(path, false)?)
            })();
            match digest {
                Ok(digest) => samples.entry(digest).or_default().push(path.clone()),
                Err(_) => index.unreadable += 1,
            }
        }
        for matches in samples.values().filter(|files| files.len() > 1) {
            let mut confirmed: HashMap<String, Vec<FileComparison>> = HashMap::new();
            for path in matches {
                check_cancel(engine)?;
                match comparison(path) {
                    Ok(file) => confirmed
                        .entry(file.hash.clone().unwrap_or_default())
                        .or_default()
                        .push(file),
                    Err(_) => index.unreadable += 1,
                }
            }
            for (hash, mut files) in confirmed {
                if files.len() > 1 {
                    files.sort_by(|a, b| a.path.cmp(&b.path));
                    groups.push(DuplicateGroup { hash, files });
                }
            }
        }
    }
    groups.sort_by(|a, b| a.hash.cmp(&b.hash));
    Ok(DuplicateScan {
        groups,
        unreadable_count: index.unreadable,
    })
}
pub fn preview_cleanup(
    engine: &InboxEngine,
    keeper: &str,
    members: Vec<String>,
    hash: &str,
) -> AppResult<OrganizationPlan> {
    use super::file_operation_service as operations;
    let _gate = engine
        .operation_gate
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
    if members.len() < 2 || members.len() > 10_000 || !members.iter().any(|p| p == keeper) {
        return Err(AppError::new("INVALID_TRANSFER"));
    }
    let workspace = workspace_repository::load(&engine.db)?;
    let mut roots: Vec<String> = workspace.roots.iter().map(|r| r.path.clone()).collect();
    {
        let state = engine.lock()?;
        roots.extend(state.rules.iter().map(|r| r.destination_path.clone()));
        if let Some(inbox) = &state.inbox {
            roots.push(inbox.path.clone());
        }
    }
    if !roots.iter().any(|r| Path::new(keeper).starts_with(r)) {
        return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
    }
    operations::source(engine, Path::new(keeper))?;
    let retained = comparison(Path::new(keeper))?;
    if retained.hash.as_deref() != Some(hash) {
        return Err(AppError::new("FILE_CHANGED"));
    }
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for member in members {
        let source = Path::new(&member);
        if !roots.iter().any(|r| source.starts_with(r)) {
            return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
        }
        if member == keeper || !seen.insert(path_key(source)) {
            continue;
        }
        let target = source
            .parent()
            .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?
            .join(".metaflow-recovery")
            .join(uuid::Uuid::new_v4().to_string());
        let mut item = operations::plan_item(engine, source, &target, "move", false)?;
        if item.hash != hash {
            return Err(AppError::new("FILE_CHANGED"));
        }
        item.backup = true;
        item.rule_name = "Consolidar duplicados con respaldo".into();
        item.required_existing = Some(retained.clone());
        items.push(item);
    }
    let mut state = engine.lock()?;
    let plan = OrganizationPlan {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        items,
        unmatched_count: 0,
        revision: state.revision,
        origin: "duplicates".into(),
        unreadable_count: 0,
    };
    state.plan = Some(plan.clone());
    Ok(plan)
}
