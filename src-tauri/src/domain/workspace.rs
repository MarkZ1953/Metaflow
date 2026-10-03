use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRoot {
    pub id: String,
    pub path: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub roots: Vec<WorkspaceRoot>,
    pub favorites: Vec<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub sources: Vec<String>,
    pub destination: String,
    pub mode: String,
    pub policy: super::organization::ConflictPolicy,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub period: String,
    #[serde(default = "skip_duplicates")]
    pub duplicate_action: String,
    #[serde(default)]
    pub resolutions: std::collections::BTreeMap<String, super::organization::IssueResolution>,
    #[serde(default)]
    pub folder_name: Option<String>,
}
fn skip_duplicates() -> String {
    "skip".into()
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderProperties {
    pub path: String,
    pub name: String,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub accessed_at: Option<i64>,
    pub readonly: bool,
}
