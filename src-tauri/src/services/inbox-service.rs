use crate::{
    database::{repositories::configuration_repository, Database},
    domain::organization::*,
    errors::{AppError, AppResult},
    services::{
        access_service::{path_text, FolderAccess},
        date_service, move_service,
    },
};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub struct Candidate {
    pub file: InboxFile,
    pub unchanged_since: Instant,
    pub retries: u8,
}
pub struct Runtime {
    pub inbox: Option<Inbox>,
    pub rules: Vec<DateRule>,
    pub revision: u64,
    pub candidates: BTreeMap<String, Candidate>,
    pub plan: Option<OrganizationPlan>,
    pub watcher_status: String,
    pub error: Option<String>,
}
#[derive(Clone)]
pub struct InboxEngine {
    pub db: Database,
    pub access: FolderAccess,
    pub runtime: Arc<Mutex<Runtime>>,
    pub operation_gate: Arc<Mutex<()>>,
    pub cancelled: Arc<AtomicBool>,
    pub log_path: PathBuf,
    pub duplicate_reviews: Arc<Mutex<super::duplicate_review_service::ReviewRegistry>>,
    pub media_classifications: Arc<Mutex<super::media_classification_service::MediaRegistry>>,
    pub media_assets: PathBuf,
}
impl InboxEngine {
    pub fn open(db: Database, access: FolderAccess, log_path: PathBuf) -> AppResult<Self> {
        let (inbox, rules) = configuration_repository::load(&db)?;
        if let Some(inbox) = &inbox {
            let _ = access.grant(Path::new(&inbox.path));
        }
        for rule in &rules {
            let _ = access.grant(Path::new(&rule.destination_path));
        }
        date_service::validate_rules(&rules)?;
        Ok(Self {
            db,
            access,
            runtime: Arc::new(Mutex::new(Runtime {
                inbox,
                rules,
                revision: 0,
                candidates: BTreeMap::new(),
                plan: None,
                watcher_status: "starting".into(),
                error: None,
            })),
            operation_gate: Arc::new(Mutex::new(())),
            cancelled: Arc::new(AtomicBool::new(false)),
            log_path,
            duplicate_reviews: Arc::new(Mutex::new(
                super::duplicate_review_service::ReviewRegistry::default(),
            )),
            media_classifications: Arc::new(Mutex::new(
                super::media_classification_service::MediaRegistry::default(),
            )),
            media_assets: PathBuf::new(),
        })
    }
    pub fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Runtime>> {
        self.runtime
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))
    }
    pub fn snapshot(&self) -> AppResult<InboxSnapshot> {
        let state = self.lock()?;
        Ok(InboxSnapshot {
            inbox: state.inbox.clone(),
            rules: state.rules.clone(),
            files: state.candidates.values().map(|c| c.file.clone()).collect(),
            watcher_status: state.watcher_status.clone(),
            error: state.error.clone(),
        })
    }
    pub fn set_inbox(&self, path: &Path) -> AppResult<Inbox> {
        let _gate = self
            .operation_gate
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        let folder = self.access.grant(path)?;
        validate_directory(Path::new(&folder.path))?;
        let mut state = self.lock()?;
        if state
            .rules
            .iter()
            .any(|r| Path::new(&r.destination_path) == Path::new(&folder.path))
        {
            return Err(AppError::new("DESTINATION_IS_INBOX"));
        }
        let inbox = Inbox {
            id: uuid::Uuid::new_v4().to_string(),
            path: folder.path,
            mode: "manual".into(),
        };
        configuration_repository::save_inbox(&self.db, &inbox)?;
        state.inbox = Some(inbox.clone());
        state.candidates.clear();
        state.revision += 1;
        state.plan = None;
        state.error = None;
        Ok(inbox)
    }
    pub fn save_rules(&self, mut rules: Vec<DateRule>) -> AppResult<()> {
        let _gate = self
            .operation_gate
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        date_service::validate_rules(&rules)?;
        let mut state = self.lock()?;
        for rule in &mut rules {
            let (path, _) = self.access.resolve(Path::new(&rule.destination_path))?;
            validate_directory(&path)?;
            if state
                .inbox
                .as_ref()
                .is_some_and(|i| Path::new(&i.path) == path)
            {
                return Err(AppError::new("DESTINATION_IS_INBOX"));
            }
            rule.destination_path = path_text(&path)?;
            rule.name = rule.name.trim().to_owned();
        }
        configuration_repository::save_rules(&self.db, &rules)?;
        state.rules = rules;
        state.revision += 1;
        state.plan = None;
        let rules = state.rules.clone();
        for candidate in state
            .candidates
            .values_mut()
            .filter(|c| matches!(c.file.status.as_str(), "matched" | "needs-review" | "ready"))
        {
            date_service::evaluate(&mut candidate.file, &rules);
        }
        Ok(())
    }
    pub fn retry(&self) -> AppResult<()> {
        let mut state = self.lock()?;
        state.error = None;
        for c in state
            .candidates
            .values_mut()
            .filter(|c| c.file.status == "failed")
        {
            c.retries = 0;
            c.file.status = "waiting-for-stability".into();
            c.file.error = None;
            c.unchanged_since = Instant::now();
        }
        Ok(())
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
    pub fn log(&self, code: &str, count: usize) {
        use std::io::Write;
        // Bounded local log; only event codes and counts, no paths or contents.
        if std::fs::metadata(&self.log_path).is_ok_and(|m| m.len() > 1024 * 1024) {
            let _ = std::fs::write(&self.log_path, []);
        }
        if let Ok(mut log) = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&self.log_path)
        {
            let _ = writeln!(log, "{} {code} {count}", chrono::Utc::now().to_rfc3339());
        }
    }
    pub fn reconcile(&self) -> AppResult<bool> {
        let Ok(_gate) = self.operation_gate.try_lock() else {
            return Ok(false);
        };
        let mut state = self.lock()?;
        let Some(inbox) = state.inbox.clone() else {
            state.watcher_status = "idle".into();
            return Ok(false);
        };
        let root = dunce::canonicalize(&inbox.path)?;
        validate_directory(&root)?;
        if path_text(&root)? != inbox.path {
            return Err(AppError::new("FOLDER_CHANGED"));
        }
        let before: Vec<InboxFile> = state.candidates.values().map(|c| c.file.clone()).collect();
        let mut seen = std::collections::HashSet::new();
        let mut inaccessible = 0;
        let rules = state.rules.clone();
        for entry in std::fs::read_dir(&root)? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    inaccessible += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match move_service::regular_file(&path) {
                Ok(m) => m,
                Err(e) => {
                    if e.code != "UNSUPPORTED_FILE" {
                        inaccessible += 1;
                    }
                    continue;
                }
            };
            let text = match path_text(&path) {
                Ok(t) => t,
                Err(_) => {
                    inaccessible += 1;
                    continue;
                }
            };
            seen.insert(text.clone());
            let current_stamp = move_service::stamp(&metadata);
            let accessed = move_service::millis(metadata.accessed());
            let candidate = state
                .candidates
                .entry(text.clone())
                .or_insert_with(|| Candidate {
                    file: InboxFile {
                        path: text,
                        name: entry.file_name().to_string_lossy().into_owned(),
                        extension: path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_lowercase(),
                        stamp: current_stamp.clone(),
                        accessed_at: accessed,
                        status: "detected".into(),
                        rule_id: None,
                        rule_name: None,
                        destination_path: None,
                        date_source: None,
                        date_used: None,
                        error: None,
                    },
                    unchanged_since: Instant::now(),
                    retries: 0,
                });
            if candidate.file.stamp != current_stamp {
                candidate.file.stamp = current_stamp;
                candidate.unchanged_since = Instant::now();
                candidate.retries = 0;
                candidate.file.status = "detected".into();
                candidate.file.error = None;
                candidate.file.rule_id = None;
                candidate.file.rule_name = None;
                candidate.file.destination_path = None;
            }
            if candidate.file.accessed_at != accessed
                && matches!(candidate.file.status.as_str(), "matched" | "needs-review")
            {
                candidate.file.accessed_at = accessed;
                if rules
                    .iter()
                    .any(|r| r.enabled && r.date_source == DateSource::Accessed)
                {
                    date_service::evaluate(&mut candidate.file, &rules);
                }
            }
            // Already stable files are not reopened by polling, avoiding a self-read loop.
            if matches!(
                candidate.file.status.as_str(),
                "detected" | "waiting-for-stability"
            ) {
                candidate.file.status = "waiting-for-stability".into();
                candidate.file.accessed_at = accessed;
                if candidate.unchanged_since.elapsed() >= Duration::from_secs(3)
                    && !temporary_file(&candidate.file.name)
                {
                    candidate.file.status = "analyzing".into();
                    match move_service::open_locked(&path, false) {
                        Ok(file) => {
                            if move_service::stamp(&file.metadata()?) == candidate.file.stamp {
                                candidate.file.status = "ready".into();
                                date_service::evaluate(&mut candidate.file, &rules);
                            } else {
                                candidate.unchanged_since = Instant::now();
                                candidate.file.status = "waiting-for-stability".into();
                            }
                        }
                        Err(e) => {
                            candidate.retries += 1;
                            candidate.file.status = if candidate.retries >= 8 {
                                "failed"
                            } else {
                                "waiting-for-stability"
                            }
                            .into();
                            candidate.file.error = Some(e.code.into());
                        }
                    }
                }
            }
        }
        state.candidates.retain(|path, _| seen.contains(path));
        state.error = if inaccessible > 0 {
            Some("SOME_FILES_UNREADABLE".into())
        } else {
            None
        };
        let after: Vec<InboxFile> = state.candidates.values().map(|c| c.file.clone()).collect();
        if before != after {
            configuration_repository::update_index(&self.db, &after)?;
            return Ok(true);
        }
        Ok(false)
    }
}
pub fn validate_directory(path: &Path) -> AppResult<()> {
    let m = std::fs::symlink_metadata(path)?;
    if !m.is_dir() || m.file_type().is_symlink() {
        return Err(AppError::new("INVALID_DESTINATION"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err(AppError::new("UNSUPPORTED_FILE"));
        }
    }
    Ok(())
}
fn temporary_file(name: &str) -> bool {
    let name = name.to_lowercase();
    [".part", ".partial", ".crdownload", ".download", ".tmp"]
        .iter()
        .any(|e| name.ends_with(e))
}
