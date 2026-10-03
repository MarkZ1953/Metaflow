use crate::{
    domain::file_entry::AuthorizedFolder,
    errors::{AppError, AppResult},
};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, RwLock},
};

/// Grants can only be added by the native folder picker, never by a frontend path argument.
#[derive(Clone, Default)]
pub struct FolderAccess {
    roots: Arc<RwLock<Vec<PathBuf>>>,
    scan_gate: Arc<Mutex<()>>,
}

impl FolderAccess {
    pub fn lock_scan(&self) -> AppResult<MutexGuard<'_, ()>> {
        self.scan_gate
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))
    }

    pub fn grant(&self, path: &Path) -> AppResult<AuthorizedFolder> {
        let canonical = dunce::canonicalize(path)?;
        if !canonical.is_dir() {
            return Err(AppError::new("NOT_A_DIRECTORY"));
        }
        let path_string = path_text(&canonical)?;
        let name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&path_string)
            .to_owned();
        let mut roots = self
            .roots
            .write()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        if !roots.contains(&canonical) {
            roots.push(canonical);
        }
        Ok(AuthorizedFolder {
            path: path_string,
            name,
        })
    }

    pub fn resolve(&self, path: &Path) -> AppResult<(PathBuf, PathBuf)> {
        // Deny ungranted lexical paths before probing their existence.
        let roots = self
            .roots
            .read()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        if !roots.iter().any(|root| path.starts_with(root)) {
            return Err(AppError::new("FOLDER_NOT_AUTHORIZED"));
        }
        let canonical = dunce::canonicalize(path)?;
        // Path-component comparison, not a string prefix. Canonicalization catches .. and links.
        let root = roots
            .iter()
            .filter(|root| canonical.starts_with(root))
            .max_by_key(|root| root.components().count())
            .ok_or_else(|| AppError::new("FOLDER_NOT_AUTHORIZED"))?;
        if !canonical.is_dir() {
            return Err(AppError::new("NOT_A_DIRECTORY"));
        }
        Ok((canonical, root.clone()))
    }

    pub fn revoke(&self, path: &Path) -> AppResult<()> {
        self.roots
            .write()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?
            .retain(|root| root != path);
        Ok(())
    }
}

pub fn path_text(path: &Path) -> AppResult<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| AppError::new("UNSUPPORTED_PATH"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_are_explicit_and_revocable() {
        let root = tempfile::tempdir().unwrap();
        let access = FolderAccess::default();
        assert_eq!(
            access.resolve(root.path()).unwrap_err().code,
            "FOLDER_NOT_AUTHORIZED"
        );
        let grant = access.grant(root.path()).unwrap();
        assert!(access.resolve(Path::new(&grant.path)).is_ok());
        access.revoke(Path::new(&grant.path)).unwrap();
        assert!(access.resolve(Path::new(&grant.path)).is_err());
    }

    #[test]
    fn parent_traversal_and_prefix_siblings_are_rejected() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("allowed");
        let sibling = parent.path().join("allowed-other");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&sibling).unwrap();
        let access = FolderAccess::default();
        let grant = access.grant(&root).unwrap();
        assert_eq!(
            access.resolve(&sibling).unwrap_err().code,
            "FOLDER_NOT_AUTHORIZED"
        );
        assert_eq!(
            access
                .resolve(&Path::new(&grant.path).join(".."))
                .unwrap_err()
                .code,
            "FOLDER_NOT_AUTHORIZED"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cannot_escape_a_grant() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
        let access = FolderAccess::default();
        let grant = access.grant(root.path()).unwrap();
        assert_eq!(
            access
                .resolve(&Path::new(&grant.path).join("escape"))
                .unwrap_err()
                .code,
            "FOLDER_NOT_AUTHORIZED"
        );
    }
}
