use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePreset {
    pub id: String,
    pub name: String,
    pub format: String,
    pub letter_case: String,
    pub space_replacement: String,
    pub collapse_spaces: bool,
    pub remove_accents: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameConfiguration {
    pub presets: Vec<RenamePreset>,
    pub inbox_preset_id: Option<String>,
    pub rule_presets: BTreeMap<String, String>,
}
