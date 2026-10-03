use super::organization::FileComparison;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ComparisonKind {
    Exact,
    Similar,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReviewComparison {
    pub id: String,
    pub left: FileComparison,
    pub right: FileComparison,
    pub kind: ComparisonKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReviewScan {
    pub session_id: String,
    pub comparisons: Vec<DuplicateReviewComparison>,
    pub unreadable_count: usize,
    pub ignored_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageThumbnail {
    pub data_url: String,
    /// Oriented original dimensions, useful for choosing the higher resolution copy.
    pub width: u32,
    pub height: u32,
}
