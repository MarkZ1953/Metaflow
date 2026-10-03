//! All mutations go through an exclusive file handle. Destination replacement is never allowed.
use crate::{
    domain::organization::FileStamp,
    errors::{AppError, AppResult},
};
use std::{
    fs::{File, Metadata, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn millis(time: std::io::Result<SystemTime>) -> Option<i64> {
    match time.ok()?.duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).ok(),
        Err(error) => i64::try_from(error.duration().as_millis())
            .ok()
            .map(|value| -value),
    }
}
pub fn stamp(metadata: &Metadata) -> FileStamp {
    FileStamp {
        size: metadata.len(),
        modified_at: millis(metadata.modified()),
        created_at: millis(metadata.created()),
    }
}
pub fn regular_file(path: &Path) -> AppResult<Metadata> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AppError::new("UNSUPPORTED_FILE"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err(AppError::new("UNSUPPORTED_FILE"));
        }
    }
    Ok(metadata)
}
pub fn open_locked(path: &Path, for_move: bool) -> AppResult<File> {
    regular_file(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::{
            Foundation::GENERIC_READ,
            Storage::FileSystem::{DELETE, FILE_FLAG_OPEN_REPARSE_POINT},
        };
        options
            .share_mode(0)
            .access_mode(GENERIC_READ | if for_move { DELETE } else { 0 })
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(not(windows))]
    let _ = for_move;
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AppError::new("UNSUPPORTED_FILE"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err(AppError::new("UNSUPPORTED_FILE"));
        }
    }
    Ok(file)
}
pub fn hash(file: &mut File) -> AppResult<String> {
    file.seek(SeekFrom::Start(0))?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 131072];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(hasher.finalize().to_hex().to_string())
}
pub fn identity(file: &File) -> AppResult<String> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        // SAFETY: a live File owns the handle and info is a correctly sized writable structure.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(format!(
            "{}:{}:{}",
            info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
        ))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let m = file.metadata()?;
        Ok(format!("{}:{}", m.dev(), m.ino()))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = file;
        Err(AppError::new("UNSUPPORTED_PLATFORM"))
    }
}

pub fn move_locked(
    source: &Path,
    destination: &Path,
    file: &mut File,
    expected_hash: &str,
) -> AppResult<String> {
    if destination.try_exists()? {
        return Err(AppError::new("DESTINATION_EXISTS"));
    }
    #[cfg(windows)]
    {
        windows_move(source, destination, file, expected_hash, &|_| {})
    }
    #[cfg(not(windows))]
    {
        // The UI is platform-neutral; a safe platform-specific mutation adapter is required before enabling moves elsewhere.
        let _ = (source, destination, file, expected_hash);
        Err(AppError::new("UNSUPPORTED_PLATFORM"))
    }
}

#[cfg(windows)]
fn windows_move(
    source: &Path,
    destination: &Path,
    file: &mut File,
    expected_hash: &str,
    progress: &impl Fn(u64),
) -> AppResult<String> {
    use std::os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::*;
    // Keep the target directory from being renamed while resolving/using its absolute path.
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
    if dunce::canonicalize(parent)? != parent {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    let _directory = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(parent)?;
    let wide: Vec<u16> = destination.as_os_str().encode_wide().collect();
    let offset = std::mem::offset_of!(FILE_RENAME_INFO, FileName);
    // Include a zero terminator even when the UTF-16 name ends exactly on an alignment boundary.
    let bytes = (offset + (wide.len() + 1) * 2).max(std::mem::size_of::<FILE_RENAME_INFO>());
    // usize storage guarantees structure alignment; trailing filename storage is explicitly allocated.
    let mut storage = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
    let ptr = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    // SAFETY: allocated/aligned buffer fits the header and UTF-16 filename. Replacement remains false.
    unsafe {
        (*ptr).FileNameLength = (wide.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(
            wide.as_ptr(),
            (ptr.cast::<u8>().add(offset)).cast::<u16>(),
            wide.len(),
        );
        if SetFileInformationByHandle(
            file.as_raw_handle(),
            FileRenameInfo,
            ptr.cast(),
            bytes as u32,
        ) != 0
        {
            return identity(file);
        }
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() != Some(17) {
        return Err(error.into());
    }
    let target = windows_copy(source, destination, file, expected_hash, progress)?;
    let target_id = identity(&target)?;
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
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
    // The exclusively owned source is deleted on close, after verified destination durability.
    Ok(target_id)
}

pub fn transfer_locked(
    source: &Path,
    destination: &Path,
    file: &mut File,
    hash: &str,
    copy: bool,
    progress: &impl Fn(u64),
) -> AppResult<String> {
    if destination.try_exists()? {
        return Err(AppError::new("DESTINATION_EXISTS"));
    }
    #[cfg(windows)]
    {
        if copy {
            identity(&windows_copy(source, destination, file, hash, progress)?)
        } else {
            windows_move(source, destination, file, hash, progress)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (source, destination, file, hash, copy, progress);
        Err(AppError::new("UNSUPPORTED_PLATFORM"))
    }
}

#[cfg(windows)]
fn windows_copy(
    source: &Path,
    destination: &Path,
    file: &mut File,
    expected_hash: &str,
    progress: &impl Fn(u64),
) -> AppResult<File> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::{Foundation::GENERIC_READ, Storage::FileSystem::*};
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("INVALID_DESTINATION"))?;
    if dunce::canonicalize(parent)? != parent {
        return Err(AppError::new("FOLDER_CHANGED"));
    }
    let _directory = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(parent)?;
    // Cross-volume copy must not discard alternate streams or filesystem-specific file data.
    ensure_plain_file(source, file)?;
    let mut basic = FILE_BASIC_INFO::default();
    // SAFETY: both structures and the source handle have the documented type and lifetime.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileBasicInfo,
            (&mut basic as *mut FILE_BASIC_INFO).cast(),
            std::mem::size_of::<FILE_BASIC_INFO>() as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut target_options = OpenOptions::new();
    target_options
        .read(true)
        .write(true)
        .create_new(true)
        .share_mode(0)
        .access_mode(GENERIC_READ | windows_sys::Win32::Foundation::GENERIC_WRITE | DELETE);
    let mut target = target_options.open(destination)?;
    // On failure the original is preserved; the pending journal reports any partial copy for recovery.
    file.seek(SeekFrom::Start(0))?;
    use std::io::Write;
    let mut copied = 0u64;
    let mut buffer = [0u8; 1024 * 128];
    let mut emitted = std::time::Instant::now();
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        target.write_all(&buffer[..count])?;
        copied += count as u64;
        if emitted.elapsed() >= std::time::Duration::from_millis(150) {
            progress(copied);
            emitted = std::time::Instant::now();
        }
    }
    if copied != file.metadata()?.len() {
        return Err(AppError::new("INTEGRITY_ERROR"));
    }
    progress(copied);
    target.sync_all()?;
    if hash(&mut target)? != expected_hash {
        return Err(AppError::new("INTEGRITY_ERROR"));
    }
    if unsafe {
        SetFileInformationByHandle(
            target.as_raw_handle(),
            FileBasicInfo,
            (&basic as *const FILE_BASIC_INFO).cast(),
            std::mem::size_of::<FILE_BASIC_INFO>() as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    target.sync_all()?;
    Ok(target)
}

#[cfg(windows)]
fn ensure_plain_file(path: &Path, file: &File) -> AppResult<()> {
    use std::os::windows::{ffi::OsStrExt, fs::MetadataExt};
    use windows_sys::Win32::{Foundation::INVALID_HANDLE_VALUE, Storage::FileSystem::*};
    let flags = file.metadata()?.file_attributes();
    if flags
        & (FILE_ATTRIBUTE_ENCRYPTED
            | FILE_ATTRIBUTE_SPARSE_FILE
            | FILE_ATTRIBUTE_COMPRESSED
            | FILE_ATTRIBUTE_REPARSE_POINT)
        != 0
    {
        return Err(AppError::new("UNSUPPORTED_CROSS_VOLUME"));
    }
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut data = WIN32_FIND_STREAM_DATA::default();
    // SAFETY: null-terminated path and sized output live throughout calls; enumeration is closed.
    let handle = unsafe {
        FindFirstStreamW(
            path.as_ptr(),
            FindStreamInfoStandard,
            (&mut data as *mut WIN32_FIND_STREAM_DATA).cast(),
            0,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        let error = std::io::Error::last_os_error();
        if matches!(error.raw_os_error(), Some(1 | 38 | 87)) {
            return Ok(());
        }
        return Err(error.into());
    }
    let extra =
        unsafe { FindNextStreamW(handle, (&mut data as *mut WIN32_FIND_STREAM_DATA).cast()) } != 0;
    let last = std::io::Error::last_os_error();
    unsafe {
        FindClose(handle);
    }
    if extra {
        return Err(AppError::new("UNSUPPORTED_CROSS_VOLUME"));
    }
    if last.raw_os_error() != Some(38) {
        return Err(last.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn utf16_rename_buffer_has_exact_names_at_every_alignment() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        for length in 1..33 {
            let from = root.join("source.txt");
            let name = format!("á{}", "x".repeat(length));
            let target = root.join(&name);
            std::fs::write(&from, b"exact filename").unwrap();
            let mut file = open_locked(&from, true).unwrap();
            let digest = hash(&mut file).unwrap();
            move_locked(&from, &target, &mut file, &digest).unwrap();
            drop(file);
            assert!(target.exists(), "missing exact UTF-16 name: {name}");
            assert_eq!(std::fs::read(&target).unwrap(), b"exact filename");
        }
    }
    #[cfg(windows)]
    #[test]
    fn locked_move_never_replaces_and_preserves_content() {
        let dir = tempfile::tempdir().expect("temp");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        let a = root.join("a.txt");
        let b = root.join("b.txt");
        std::fs::write(&a, b"original").expect("write");
        std::fs::write(&b, b"existing").expect("write");
        let mut file = open_locked(&a, true).expect("lock");
        let digest = hash(&mut file).expect("hash");
        assert_eq!(
            move_locked(&a, &b, &mut file, &digest)
                .expect_err("conflict")
                .code,
            "DESTINATION_EXISTS"
        );
        assert_eq!(std::fs::read(&b).expect("read"), b"existing");
        let c = root.join("c.txt");
        move_locked(&a, &c, &mut file, &digest).expect("move");
        drop(file);
        assert!(!a.exists());
        assert_eq!(std::fs::read(c).expect("read"), b"original");
    }
    #[cfg(windows)]
    #[test]
    fn active_copy_handle_is_not_ready() {
        let dir = tempfile::tempdir().expect("temp");
        let path = dir.path().join("copy.txt");
        let copying = File::create(&path).expect("create");
        assert_eq!(
            open_locked(&path, false).expect_err("busy").code,
            "FILE_IN_USE"
        );
        drop(copying);
        assert!(open_locked(&path, false).is_ok());
    }
    #[cfg(windows)]
    #[test]
    fn cross_volume_move_preserves_dates_and_bytes() {
        let source_dir = tempfile::tempdir().expect("source directory");
        let target_dir = tempfile::tempdir_in(std::env::current_dir().expect("workspace"))
            .expect("target directory");
        let from = dunce::canonicalize(source_dir.path())
            .expect("canonical")
            .join("cross-volume.txt");
        let to = dunce::canonicalize(target_dir.path())
            .expect("canonical")
            .join("cross-volume.txt");
        std::fs::write(&from, b"verified cross-volume bytes").expect("write");
        let mut file = open_locked(&from, true).expect("lock");
        let before = stamp(&file.metadata().expect("metadata"));
        let digest = hash(&mut file).expect("hash");
        move_locked(&from, &to, &mut file, &digest).expect("cross-volume move");
        drop(file);
        assert!(!from.exists());
        assert_eq!(stamp(&std::fs::metadata(&to).expect("metadata")), before);
        let mut moved = open_locked(&to, true).expect("reverse lock");
        assert_eq!(hash(&mut moved).expect("hash"), digest);
        move_locked(&to, &from, &mut moved, &digest).expect("cross-volume Undo");
        drop(moved);
        assert!(from.exists());
        assert!(!to.exists());
    }
}
