use crate::{
    domain::file_entry::{Category, DirectoryListing, EntryKind, FileEntry},
    errors::{AppError, AppResult},
    services::{
        access_service::{path_text, FolderAccess},
        file_type_service::detect_type,
    },
};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn read_directory(access: &FolderAccess, requested: &Path) -> AppResult<DirectoryListing> {
    let _scan_guard = access.lock_scan()?; // At most one disk scan at a time.
    let (directory, root) = access.resolve(requested)?;
    let mut entries = Vec::new();
    let mut unreadable_count = 0;
    for entry in fs::read_dir(&directory)? {
        let result = entry
            .map_err(AppError::from)
            .and_then(|entry| read_entry(&entry.path(), &root));
        match result {
            Ok(Some(entry)) => entries.push(entry),
            Ok(None) => {}
            Err(_) => unreadable_count += 1,
        }
    }
    access.resolve(&directory)?; // Do not return a read after its authorization was revoked.
    Ok(DirectoryListing {
        path: path_text(&directory)?,
        root_path: path_text(&root)?,
        parent_path: directory
            .parent()
            .filter(|parent| directory != root && parent.starts_with(&root))
            .map(path_text)
            .transpose()?,
        entries,
        unreadable_count,
        scanned_at: timestamp(Ok(SystemTime::now())).unwrap_or_default(),
    })
}

fn read_entry(path: &Path, root: &Path) -> AppResult<Option<FileEntry>> {
    let metadata = fs::symlink_metadata(path)?;
    let is_link = is_link(&metadata);
    let kind = if is_link {
        EntryKind::Symlink
    } else if metadata.is_dir() {
        EntryKind::Directory
    } else if metadata.is_file() {
        EntryKind::File
    } else {
        return Ok(None);
    }; // No pipes, sockets or devices.
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::new("UNSUPPORTED_PATH"))?
        .to_owned();
    let (mime_type, type_source, category) = match kind {
        EntryKind::Directory => (None, "unknown".to_owned(), Category::Folder),
        EntryKind::Symlink => (None, "unknown".to_owned(), Category::Other),
        EntryKind::File => {
            // An entry replaced with a link must not be read outside the authorized root.
            let canonical = dunce::canonicalize(path)?;
            if !canonical.starts_with(root) {
                return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
            }
            detect_type(path)
        }
    };
    Ok(Some(FileEntry {
        path: path_text(path)?,
        relative_path: path_text(
            path.strip_prefix(root)
                .map_err(|_| AppError::new("FOLDER_NOT_AUTHORIZED"))?,
        )?,
        extension: if kind == EntryKind::Directory {
            String::new()
        } else {
            path.extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase()
        },
        hidden: is_hidden(&metadata, &name),
        name,
        size: if kind == EntryKind::File {
            Some(metadata.len())
        } else {
            None
        },
        kind,
        mime_type,
        type_source,
        category,
        created_at: timestamp(metadata.created()),
        modified_at: timestamp(metadata.modified()),
        accessed_at: timestamp(metadata.accessed()),
        readonly: metadata.permissions().readonly(),
    }))
}

fn timestamp(time: std::io::Result<SystemTime>) -> Option<u64> {
    time.ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // Includes junctions and reparse points.
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn is_hidden(metadata: &fs::Metadata, name: &str) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        name.starts_with('.') || metadata.file_attributes() & 0x2 != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        name.starts_with('.')
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_is_shallow_and_preserves_basic_information() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("note.txt"), "hello").unwrap();
        fs::write(root.path().join(".hidden"), "private").unwrap();
        fs::create_dir(root.path().join("child")).unwrap();
        fs::write(root.path().join("child").join("nested.txt"), "nested").unwrap();
        let access = FolderAccess::default();
        let grant = access.grant(root.path()).unwrap();
        let listing = read_directory(&access, Path::new(&grant.path)).unwrap();
        assert_eq!(listing.entries.len(), 3);
        assert!(listing.parent_path.is_none());
        let file = listing
            .entries
            .iter()
            .find(|file| file.name == "note.txt")
            .unwrap();
        assert_eq!(file.size, Some(5));
        assert_eq!(file.category, Category::Document);
        assert!(listing.entries.iter().any(|file| file.hidden));
        let child = read_directory(&access, &Path::new(&grant.path).join("child")).unwrap();
        assert_eq!(child.entries.len(), 1);
        assert_eq!(child.parent_path, Some(grant.path));
    }
}
