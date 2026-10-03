use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataRequest {
    pub paths: Vec<String>,
    pub recursive: bool,
}

// Decimal strings preserve Windows' 100 ns precision in JSON/JavaScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateChange {
    pub created_ticks: String,
    pub modified_before_ticks: String,
    pub modified_after_ticks: String,
}
