use crate::domain::file_entry::Category;
use std::{fs::File, io::Read, path::Path};

pub fn detect_type(path: &Path) -> (Option<String>, String, Category) {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    // Fixed-size signature check: never load an entire file for classification.
    let mut bytes = [0u8; 8192];
    let byte_count = open_without_following_links(path)
        .and_then(|mut file| file.read(&mut bytes))
        .ok();
    let detected = byte_count.and_then(|count| infer::get(&bytes[..count]));
    let (mime, source) = if let Some(kind) = detected {
        (Some(kind.mime_type().to_owned()), "content")
    } else {
        // .ts also names MPEG transport streams. Only use the text interpretation
        // if the bounded sample is readable UTF-8 without binary NUL bytes.
        let is_typescript = matches!(extension.as_str(), "ts" | "tsx")
            && byte_count.is_some_and(|count| {
                !bytes[..count].contains(&0) && std::str::from_utf8(&bytes[..count]).is_ok()
            });
        let guessed_mime = if is_typescript {
            Some("text/plain".to_owned())
        } else {
            mime_guess::from_path(path).first_raw().map(str::to_owned)
        };
        (guessed_mime, "extension")
    };
    let category = classify(mime.as_deref(), &extension);
    let source = if mime.is_none() { "unknown" } else { source };
    (mime, source.to_owned(), category)
}

fn open_without_following_links(path: &Path) -> std::io::Result<File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    options.open(path)
}

pub fn classify(mime: Option<&str>, extension: &str) -> Category {
    // Signature MIME takes priority over a misleading extension.
    if let Some(mime) = mime {
        if mime.starts_with("image/") {
            return Category::Image;
        }
        if mime.starts_with("video/") {
            return Category::Video;
        }
        if mime.starts_with("audio/") {
            return Category::Audio;
        }
        if mime == "application/pdf" {
            return Category::Document;
        }
        if matches!(
            mime,
            "application/zip"
                | "application/x-rar-compressed"
                | "application/vnd.rar"
                | "application/x-7z-compressed"
                | "application/gzip"
                | "application/x-tar"
        ) && !matches!(extension, "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp")
        {
            return Category::Archive;
        }
        if matches!(
            mime,
            "application/vnd.microsoft.portable-executable"
                | "application/x-dosexec"
                | "application/x-executable"
        ) {
            return Category::Executable;
        }
    }
    match extension {
        "doc" | "docx" | "odt" | "txt" | "md" | "rtf" | "pdf" => Category::Document,
        "xls" | "xlsx" | "csv" | "ods" => Category::Spreadsheet,
        "ppt" | "pptx" | "odp" => Category::Presentation,
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" => Category::Archive,
        "js" | "ts" | "jsx" | "tsx" | "py" | "rs" | "java" | "cs" | "cpp" | "c" | "h" | "html"
        | "css" | "json" | "yaml" | "yml" | "toml" | "xml" | "sql" | "sh" | "ps1" => Category::Code,
        "exe" | "msi" | "app" | "dmg" | "deb" | "rpm" => Category::Executable,
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "svg" | "bmp" | "tiff" | "tif" | "heic"
        | "raw" | "avif" => Category::Image,
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" => Category::Video,
        "mp3" | "wav" | "flac" | "m4a" | "ogg" | "aac" => Category::Audio,
        _ => Category::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_signature_overrides_extension() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("pretend.jpg");
        std::fs::write(&path, b"%PDF-1.7\n%").unwrap();
        let (mime, source, category) = detect_type(&path);
        assert_eq!(mime.as_deref(), Some("application/pdf"));
        assert_eq!(source, "content");
        assert_eq!(category, Category::Document);
    }

    #[test]
    fn typescript_text_is_not_confused_with_a_transport_stream() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("source.ts");
        std::fs::write(&path, "export const version = '0.1';\n").unwrap();
        let (mime, source, category) = detect_type(&path);
        assert_eq!(mime.as_deref(), Some("text/plain"));
        assert_eq!(source, "extension");
        assert_eq!(category, Category::Code);
        std::fs::write(&path, b"%PDF-1.7\n%").unwrap();
        assert_eq!(detect_type(&path).2, Category::Document);
    }
}
