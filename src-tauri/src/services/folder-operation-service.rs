use crate::{
    database::repositories::{history_repository, workspace_repository},
    domain::organization::*,
    errors::{AppError, AppResult},
    services::{
        access_service::path_text,
        inbox_service::{validate_directory, InboxEngine},
        move_service, workspace_service,
    },
};
use std::{
    fs::File,
    path::{Path, PathBuf},
};
fn locked_directory(path: &Path, delete: bool) -> AppResult<File> {
    validate_directory(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::{Foundation::GENERIC_READ, Storage::FileSystem::*};
        let file = std::fs::OpenOptions::new()
            .read(true)
            .access_mode(GENERIC_READ | if delete { DELETE } else { 0 })
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        Ok(file)
    }
    #[cfg(not(windows))]
    {
        let _ = delete;
        Err(AppError::new("UNSUPPORTED_PLATFORM"))
    }
}
pub fn directory_identity(path: &Path) -> AppResult<String> {
    move_service::identity(&locked_directory(path, false)?)
}
pub fn remove_empty(path: &Path, identity: &str) -> AppResult<()> {
    let file = locked_directory(path, true)?;
    if move_service::identity(&file)? != identity {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    if std::fs::read_dir(path)?.next().is_some() {
        return Err(AppError::new("DIRECTORY_NOT_EMPTY"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::*;
        let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
        // SAFETY: owned directory handle, sized structure, Windows rejects nonempty directories atomically.
        if unsafe {
            SetFileInformationByHandle(
                file.as_raw_handle(),
                FileDispositionInfo,
                (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        drop(file);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(AppError::new("UNSUPPORTED_PLATFORM"))
    }
}
pub fn protected(engine: &InboxEngine, path: &Path) -> AppResult<()> {
    let state = engine.lock()?;
    if state
        .inbox
        .as_ref()
        .is_some_and(|i| Path::new(&i.path).starts_with(path))
        || state
            .rules
            .iter()
            .any(|r| Path::new(&r.destination_path).starts_with(path))
    {
        return Err(AppError::new("FOLDER_USED_BY_CONFIGURATION"));
    }
    Ok(())
}
pub fn item(source: &Path, target: &Path, action: &str) -> AppResult<PlanItem> {
    validate_directory(source)?;
    let identity = directory_identity(source)?;
    Ok(PlanItem {
        date_change: None,
        error: None,
        source_path: path_text(source)?,
        destination_path: path_text(target)?,
        rule_name: String::new(),
        date_source: DateSource::Modified,
        date_used: move_service::millis(std::fs::metadata(source)?.modified()).unwrap_or(0),
        stamp: FileStamp {
            size: 0,
            modified_at: None,
            created_at: None,
        },
        conflict: false,
        action: action.into(),
        hash: String::new(),
        identity,
        rule_id: String::new(),
        duplicates: Vec::new(),
        existing: None,
        backup: false,
        entry_kind: "directory".into(),
        recovery_parent: None,
        required_existing: None,
    })
}
pub struct FolderContents {
    pub directories: Vec<PlanItem>,
    pub files: Vec<(PathBuf, PathBuf)>,
}
pub fn collect(engine: &InboxEngine, source: &Path, target: &Path) -> AppResult<FolderContents> {
    workspace_service::directory(engine, source)?;
    if target.starts_with(source) {
        return Err(AppError::new("FOLDER_INTO_ITSELF"));
    }
    let mut directories = Vec::new();
    let mut files = Vec::new();
    let mut stack = vec![(source.to_path_buf(), target.to_path_buf())];
    while let Some((from, to)) = stack.pop() {
        if engine.cancelled.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(AppError::new("OPERATION_CANCELLED"));
        }
        workspace_service::directory(engine, &from)?;
        directories.push(item(&from, &to, "mkdir")?);
        let mut entries = std::fs::read_dir(&from)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            let target = to.join(entry.file_name());
            if path.file_name().is_some_and(|n| n == ".metaflow-recovery") {
                return Err(AppError::new("RECOVERY_FOLDER_PRESENT"));
            }
            if std::fs::symlink_metadata(&path)?.is_dir() {
                validate_directory(&path)?;
                stack.push((path, target));
            } else {
                move_service::regular_file(&path)?;
                files.push((path, target));
            }
            if directories.len() + files.len() > 100_000 {
                return Err(AppError::new("INVALID_TRANSFER"));
            }
        }
    }
    Ok(FolderContents { directories, files })
}
pub fn execute_item(engine: &InboxEngine, item: &mut HistoryItem) -> AppResult<String> {
    let source = Path::new(&item.source_path);
    let target = Path::new(&item.destination_path);
    if item.kind == "mkdir" {
        validate_directory(source)?;
        if directory_identity(source)? != item.identity {
            return Err(AppError::new("FOLDER_CHANGED"));
        }
        let parent = target
            .parent()
            .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
        let (canonical, _) = engine.access.resolve(parent)?;
        if canonical != parent {
            return Err(AppError::new("FOLDER_CHANGED"));
        }
        if target.try_exists()? {
            return Err(AppError::new("DESTINATION_EXISTS"));
        }
        item.status = "pending".into();
        history_repository::update_item(&engine.db, item)?;
        std::fs::create_dir(target)?;
        directory_identity(target)
    } else {
        workspace_service::directory(engine, source)?;
        protected(engine, source)?;
        if directory_identity(source)? != item.identity {
            return Err(AppError::new("FOLDER_CHANGED"));
        }
        // A partially transferred folder, or new files arriving meanwhile, is never recursively deleted.
        if std::fs::read_dir(source)?.next().is_some() {
            return Err(AppError::new("DIRECTORY_NOT_EMPTY"));
        }
        item.status = "pending".into();
        history_repository::update_item(&engine.db, item)?;
        remove_empty(source, &item.identity)?;
        Ok(item.identity.clone())
    }
}
pub fn update_references(engine: &InboxEngine, operation: &Operation, undo: bool) -> AppResult<()> {
    // Completed removal of the original root (last step) commits navigation reference changes.
    let mut paths = Vec::new();
    for item in &operation.items {
        if item.entry_kind == "directory"
            && item.kind == "rmdir"
            && item.status == if undo { "undone" } else { "completed" }
        {
            let marker = format!("workspace-reference:{}:{}", item.id, item.status);
            let applied = engine.db.with(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM settings WHERE key=?1",
                    [&marker],
                    |r| r.get::<_, i64>(0),
                )? != 0)
            })?;
            if !applied {
                paths.push((
                    item.source_path.clone(),
                    item.destination_path.clone(),
                    marker,
                ));
            }
        }
    }
    // Only outermost moved directories are needed; remap child favorites as well.
    paths.sort_by_key(|(from, _, _)| from.len());
    let mut covered: Vec<String> = Vec::new();
    for (from, to, marker) in paths {
        if covered.iter().any(|p| Path::new(&from).starts_with(p)) {
            engine.db.with(|c| {
                c.execute(
                    "INSERT OR IGNORE INTO settings VALUES (?1,'applied')",
                    [&marker],
                )?;
                Ok(())
            })?;
            continue;
        }
        covered.push(from.clone());
        let (from, to) = if undo { (to, from) } else { (from, to) };
        workspace_repository::remap(&engine.db, Path::new(&from), Path::new(&to))?;
        let _ = engine.access.grant(Path::new(&to));
        engine.db.with(|c| {
            c.execute(
                "INSERT OR IGNORE INTO settings VALUES (?1,'applied')",
                [&marker],
            )?;
            Ok(())
        })?;
    }
    Ok(())
}
