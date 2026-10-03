use crate::{
    errors::{AppError, AppResult},
    services::move_service,
};
use std::{fs::File, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileDates {
    pub created: u64,
    pub modified: u64,
}

pub fn open(path: &Path) -> AppResult<File> {
    move_service::regular_file(path)?;
    #[cfg(windows)]
    {
        use std::{
            fs::OpenOptions,
            os::windows::fs::{MetadataExt, OpenOptionsExt},
        };
        use windows_sys::Win32::Storage::FileSystem::*;
        // No permission to write file contents or delete the file is requested.
        let file = OpenOptions::new()
            .read(true)
            // Read-data access makes Windows sharing checks exclude active content readers/writers.
            // No content is read; this handle is used only for identity, size and timestamps.
            .access_mode(FILE_READ_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES)
            .share_mode(0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(AppError::new("UNSUPPORTED_FILE"));
        }
        Ok(file)
    }
    #[cfg(not(windows))]
    Err(AppError::new("UNSUPPORTED_PLATFORM"))
}

pub fn read(file: &File) -> AppResult<FileDates> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::FILETIME, Storage::FileSystem::GetFileTime};
        let mut created = FILETIME::default();
        let mut modified = FILETIME::default();
        // SAFETY: the live File owns the handle; output structures have the required layout.
        if unsafe {
            GetFileTime(
                file.as_raw_handle(),
                &mut created,
                std::ptr::null_mut(),
                &mut modified,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let ticks = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
        Ok(FileDates {
            created: ticks(created),
            modified: ticks(modified),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        Err(AppError::new("UNSUPPORTED_PLATFORM"))
    }
}

pub fn set_modified(file: &File, ticks: u64) -> AppResult<()> {
    if ticks == 0 || ticks >= i64::MAX as u64 {
        return Err(AppError::new("INVALID_DATE"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::FILETIME, Storage::FileSystem::SetFileTime};
        let modified = FILETIME {
            dwLowDateTime: ticks as u32,
            dwHighDateTime: (ticks >> 32) as u32,
        };
        // SAFETY: only last-write time is supplied; creation/access and contents are untouched.
        if unsafe {
            SetFileTime(
                file.as_raw_handle(),
                std::ptr::null(),
                std::ptr::null(),
                &modified,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        if read(file)?.modified != ticks {
            return Err(AppError::new("TIMESTAMP_PRECISION"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        Err(AppError::new("UNSUPPORTED_PLATFORM"))
    }
}
