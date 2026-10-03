use super::organization::FileStamp;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum MediaCategory {
    People,
    Animals,
    Screenshots,
    Memes,
    Documents,
    Landscapes,
    Objects,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaLabel {
    pub category: MediaCategory,
    /// Relative model affinity. This is not a calibrated probability.
    pub score: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub stamp: FileStamp,
    pub kind: String,
    pub labels: Vec<MediaLabel>,
    pub uncertain: bool,
    pub protected: bool,
    pub corrected: bool,
    pub learned: bool,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaScanOptions {
    pub folder_path: Option<String>,
    /// Explicit picker-granted folders. An empty selection must not fall back to Workspace.
    pub folder_paths: Option<Vec<String>>,
    pub recursive: bool,
    pub include_videos: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaScan {
    pub session_id: String,
    pub entries: Vec<MediaEntry>,
    pub unreadable_count: usize,
    pub skipped_count: usize,
    pub truncated: bool,
    pub cancelled: bool,
    pub model_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaScanProgress {
    pub completed: usize,
    pub total: usize,
    pub current_name: String,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFrame {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub at_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPreview {
    pub frames: Vec<MediaFrame>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransferResult {
    pub operation: super::organization::Operation,
    pub entries: Vec<MediaEntry>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Sensitivity {
    Conservative,
    #[default]
    Balanced,
    Broad,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisMode {
    Fast,
    #[default]
    Thorough,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectionSettings {
    pub sensitivity: Sensitivity,
    pub analysis_mode: AnalysisMode,
    pub read_text: bool,
    pub use_corrections: bool,
}
impl Default for DetectionSettings {
    fn default() -> Self {
        Self {
            sensitivity: Sensitivity::Balanced,
            analysis_mode: AnalysisMode::Thorough,
            read_text: true,
            use_corrections: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionConfiguration {
    pub settings: DetectionSettings,
    pub correction_count: usize,
    pub ocr_available: bool,
    pub ocr_languages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCorrectionsReset {
    pub configuration: DetectionConfiguration,
    pub entries: Vec<MediaEntry>,
}
