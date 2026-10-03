use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    pub id: String,
    pub path: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DateSource {
    Created,
    Modified,
    Accessed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DateRule {
    pub id: String,
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    pub destination_path: String,
    pub date_source: DateSource,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub size: u64,
    pub modified_at: Option<i64>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InboxFile {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub stamp: FileStamp,
    pub accessed_at: Option<i64>,
    pub status: String,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    pub destination_path: Option<String>,
    pub date_source: Option<DateSource>,
    pub date_used: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxSnapshot {
    pub inbox: Option<Inbox>,
    pub rules: Vec<DateRule>,
    pub files: Vec<InboxFile>,
    pub watcher_status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictPolicy {
    Skip,
    KeepBoth,
    Replace,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileComparison {
    pub path: String,
    pub stamp: FileStamp,
    pub hash: Option<String>,
    #[serde(default)]
    pub planned: bool,
}
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueResolution {
    pub conflict_policy: Option<ConflictPolicy>,
    pub duplicate_action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub date_change: Option<super::metadata::DateChange>,
    pub error: Option<String>,
    pub source_path: String,
    pub destination_path: String,
    pub rule_name: String,
    pub date_source: DateSource,
    pub date_used: i64,
    pub stamp: FileStamp,
    pub conflict: bool,
    pub action: String,
    pub hash: String,
    pub duplicates: Vec<FileComparison>,
    pub existing: Option<FileComparison>,
    pub backup: bool,
    pub entry_kind: String,
    #[serde(skip)]
    pub recovery_parent: Option<String>,
    #[serde(skip)]
    pub required_existing: Option<FileComparison>,
    #[serde(skip)]
    pub identity: String,
    #[serde(skip)]
    pub rule_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationPlan {
    pub id: String,
    pub created_at: i64,
    pub items: Vec<PlanItem>,
    pub unmatched_count: usize,
    #[serde(skip)]
    pub revision: u64,
    #[serde(skip)]
    pub origin: String,
    pub unreadable_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    #[serde(default)]
    pub date_change: Option<super::metadata::DateChange>,
    pub id: String,
    pub operation_id: String,
    pub source_path: String,
    pub destination_path: String,
    pub rule_name: String,
    pub date_source: DateSource,
    pub date_used: i64,
    pub stamp: FileStamp,
    pub hash: String,
    pub identity: String,
    pub status: String,
    pub error: Option<String>,
    #[serde(default = "move_kind")]
    pub kind: String,
    #[serde(default)]
    pub undo_path: Option<String>,
    #[serde(default = "file_kind")]
    pub entry_kind: String,
    #[serde(default)]
    pub recovery_parent: Option<String>,
}
fn move_kind() -> String {
    "move".into()
}
fn file_kind() -> String {
    "file".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub created_at: i64,
    pub status: String,
    pub items: Vec<HistoryItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchProgress {
    pub operation_id: String,
    pub completed: usize,
    pub total: usize,
    pub phase: String,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub current_name: String,
}
