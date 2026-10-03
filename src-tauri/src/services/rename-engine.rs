//! One pure filename engine, shared by ingestion, transfers and future Bulk Rename.
use crate::{
    domain::rename::*,
    errors::{AppError, AppResult},
    services::workspace_service::validate_name,
};
use chrono::{Local, TimeZone};
use std::path::Path;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

pub fn validate(configuration: &RenameConfiguration) -> AppResult<()> {
    let mut ids = std::collections::HashSet::new();
    if configuration.presets.len() > 200 {
        return Err(AppError::new("INVALID_PRESET"));
    }
    for preset in &configuration.presets {
        if preset.id.is_empty()
            || !ids.insert(&preset.id)
            || preset.name.trim().is_empty()
            || preset.name.len() > 120
            || preset.format.len() > 240
            || !matches!(
                preset.letter_case.as_str(),
                "unchanged" | "lower" | "upper" | "title"
            )
            || !matches!(
                preset.space_replacement.as_str(),
                "unchanged" | "dash" | "underscore"
            )
        {
            return Err(AppError::new("INVALID_PRESET"));
        }
        generate(preset, "Example.pdf", "Periodo 3", 1_789_992_000_000, 1)?;
    }
    for id in configuration
        .inbox_preset_id
        .iter()
        .chain(configuration.rule_presets.values())
    {
        if !ids.contains(id) {
            return Err(AppError::new("INVALID_PRESET"));
        }
    }
    Ok(())
}
pub fn selected<'a>(
    configuration: &'a RenameConfiguration,
    rule_id: &str,
) -> Option<&'a RenamePreset> {
    let id = configuration
        .rule_presets
        .get(rule_id)
        .or(configuration.inbox_preset_id.as_ref())?;
    configuration.presets.iter().find(|p| &p.id == id)
}
pub fn generate(
    preset: &RenamePreset,
    original: &str,
    period: &str,
    date: i64,
    counter: usize,
) -> AppResult<String> {
    let source = Path::new(original);
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::new("INVALID_NAME"))?;
    let date = Local
        .timestamp_millis_opt(date)
        .single()
        .ok_or_else(|| AppError::new("INVALID_DATE"))?;
    let mut rest = preset.format.as_str();
    let mut output = String::new();
    while let Some(index) = rest.find('{') {
        let literal = &rest[..index];
        if literal.contains('}') {
            return Err(AppError::new("INVALID_PRESET"));
        }
        output.push_str(literal);
        let end = rest[index + 1..]
            .find('}')
            .ok_or_else(|| AppError::new("INVALID_PRESET"))?
            + index
            + 1;
        let token = &rest[index + 1..end];
        let value = match token {
            "name" => stem.into(),
            "period" => period.into(),
            "year" => date.format("%Y").to_string(),
            "month" => date.format("%m").to_string(),
            "day" => date.format("%d").to_string(),
            "counter" => counter.to_string(),
            _ => {
                if let Some(format) = token.strip_prefix("date:") {
                    let format = match format {
                        "yyyy-MM-dd" => "%Y-%m-%d",
                        "yyyyMMdd" => "%Y%m%d",
                        "yyyy-MM" => "%Y-%m",
                        "dd-MM-yyyy" => "%d-%m-%Y",
                        _ => return Err(AppError::new("INVALID_PRESET")),
                    };
                    date.format(format).to_string()
                } else if let Some(padding) = token.strip_prefix("counter:") {
                    if padding.is_empty()
                        || padding.len() > 8
                        || !padding.chars().all(|c| c.is_ascii_digit())
                    {
                        return Err(AppError::new("INVALID_PRESET"));
                    }
                    format!("{counter:0width$}", width = padding.len())
                } else {
                    return Err(AppError::new("INVALID_PRESET"));
                }
            }
        };
        output.push_str(&value);
        rest = &rest[end + 1..];
    }
    if rest.contains('}') {
        return Err(AppError::new("INVALID_PRESET"));
    }
    output.push_str(rest);
    if preset.remove_accents {
        output = output.nfd().filter(|c| !is_combining_mark(*c)).collect();
    }
    output = match preset.letter_case.as_str() {
        "lower" => output.to_lowercase(),
        "upper" => output.to_uppercase(),
        "title" => {
            let mut begin = true;
            output
                .chars()
                .flat_map(|c| {
                    let text = if begin {
                        c.to_uppercase().collect::<String>()
                    } else {
                        c.to_lowercase().collect()
                    };
                    begin = !c.is_alphanumeric();
                    text.chars().collect::<Vec<_>>()
                })
                .collect()
        }
        _ => output,
    };
    output = output
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .collect();
    if preset.collapse_spaces {
        output = output.split_whitespace().collect::<Vec<_>>().join(" ");
    }
    output = output.trim().trim_end_matches('.').into();
    if preset.space_replacement != "unchanged" {
        let replacement = if preset.space_replacement == "dash" {
            '-'
        } else {
            '_'
        };
        output = output
            .chars()
            .map(|c| if c.is_whitespace() { replacement } else { c })
            .collect();
    }
    if output.is_empty() {
        return Err(AppError::new("INVALID_NAME"));
    }
    if let Some(extension) = source.extension().and_then(|s| s.to_str()) {
        if !extension.is_empty() {
            output.push('.');
            output.push_str(extension);
        }
    }
    validate_name(&output)?;
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn preset(format: &str) -> RenamePreset {
        RenamePreset {
            id: "university".into(),
            name: "Universidad".into(),
            format: format.into(),
            letter_case: "lower".into(),
            space_replacement: "dash".into(),
            collapse_spaces: true,
            remove_accents: true,
        }
    }
    #[test]
    fn requested_names_and_counters() {
        let date = Local
            .with_ymd_and_hms(2026, 9, 21, 12, 0, 0)
            .unwrap()
            .timestamp_millis();
        assert_eq!(
            generate(
                &preset("{period}_{date:yyyy-MM-dd}_{name}"),
                "Tarea Final Programación.pdf",
                "Periodo 3",
                date,
                1
            )
            .unwrap(),
            "periodo-3_2026-09-21_tarea-final-programacion.pdf"
        );
        assert_eq!(
            generate(
                &preset("{date:yyyyMMdd}_{counter:0001}"),
                "Photo.JPG",
                "",
                date,
                12
            )
            .unwrap(),
            "20260921_0012.JPG"
        );
    }
    #[test]
    fn rejects_traversal_devices_and_unknown_tokens() {
        for format in ["{unknown}", "CON", "{date:%n}", "", "{name"] {
            assert!(
                generate(&preset(format), "ok.txt", "", 0, 1).is_err(),
                "{format}"
            );
        }
        assert!(!generate(&preset("../{name}"), "ok.txt", "", 0, 1)
            .unwrap()
            .contains('/'));
    }
    #[test]
    fn unicode_title_and_space_cleanup() {
        let mut p = preset("{name}");
        p.letter_case = "title".into();
        p.space_replacement = "underscore".into();
        assert_eq!(
            generate(&p, "  álgebra   FINAL .pdf", "", 0, 1).unwrap(),
            "Algebra_Final.pdf"
        );
    }
}
