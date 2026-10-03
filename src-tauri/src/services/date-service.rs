use crate::{
    domain::organization::{DateRule, DateSource, InboxFile},
    errors::{AppError, AppResult},
};
use chrono::{Local, NaiveDate, TimeZone};
use std::collections::HashSet;

pub fn validate_rules(rules: &[DateRule]) -> AppResult<()> {
    if rules.len() > 200 {
        return Err(AppError::new("INVALID_RULE"));
    }
    let mut ids = HashSet::new();
    let mut ranges = Vec::new();
    for rule in rules {
        if rule.id.is_empty()
            || !ids.insert(&rule.id)
            || rule.name.trim().is_empty()
            || rule.name.len() > 120
        {
            return Err(AppError::new("INVALID_RULE"));
        }
        let start = parse_day(&rule.start_date)?;
        let end = parse_day(&rule.end_date)?;
        if start > end {
            return Err(AppError::new("INVALID_DATE"));
        }
        if rule.enabled {
            if ranges.iter().any(|(a, b)| start <= *b && end >= *a) {
                return Err(AppError::new("RULE_CONFLICT"));
            }
            ranges.push((start, end));
        }
    }
    Ok(())
}
fn parse_day(text: &str) -> AppResult<NaiveDate> {
    if text.len() != 10 {
        return Err(AppError::new("INVALID_DATE"));
    }
    NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| AppError::new("INVALID_DATE"))
}
pub fn selected_date(file: &InboxFile, source: &DateSource) -> Option<i64> {
    match source {
        DateSource::Created => file.stamp.created_at,
        DateSource::Modified => file.stamp.modified_at,
        DateSource::Accessed => file.accessed_at,
    }
}
pub fn evaluate(file: &mut InboxFile, rules: &[DateRule]) {
    file.rule_id = None;
    file.rule_name = None;
    file.destination_path = None;
    file.date_used = None;
    file.date_source = None;
    file.error = None;
    let mut matched: Option<(&DateRule, i64)> = None;
    for rule in rules.iter().filter(|r| r.enabled) {
        let Some(timestamp) = selected_date(file, &rule.date_source) else {
            continue;
        };
        let Some(date) = Local
            .timestamp_millis_opt(timestamp)
            .single()
            .map(|d| d.date_naive())
        else {
            continue;
        };
        let (Ok(start), Ok(end)) = (parse_day(&rule.start_date), parse_day(&rule.end_date)) else {
            continue;
        };
        if date >= start && date <= end {
            if matched.is_some() {
                file.status = "needs-review".into();
                file.error = Some("MULTIPLE_RULE_MATCHES".into());
                return;
            }
            matched = Some((rule, timestamp));
        }
    }
    if let Some((rule, timestamp)) = matched {
        file.rule_id = Some(rule.id.clone());
        file.rule_name = Some(rule.name.clone());
        file.destination_path = Some(
            std::path::Path::new(&rule.destination_path)
                .join(&file.name)
                .to_string_lossy()
                .into_owned(),
        );
        file.date_source = Some(rule.date_source.clone());
        file.date_used = Some(timestamp);
        file.status = "matched".into();
    } else {
        file.status = "needs-review".into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::organization::FileStamp;
    fn rule(id: &str, start: &str, end: &str) -> DateRule {
        DateRule {
            id: id.into(),
            name: id.into(),
            start_date: start.into(),
            end_date: end.into(),
            destination_path: "D:/Universidad/Periodo 3".into(),
            date_source: DateSource::Modified,
            enabled: true,
        }
    }
    #[test]
    fn requested_example_and_inclusive_days() {
        let rules = vec![
            rule("Periodo 1", "2026-02-01", "2026-04-30"),
            rule("Periodo 2", "2026-05-01", "2026-07-31"),
            rule("Periodo 3", "2026-08-01", "2026-11-30"),
        ];
        for (y, m, d, h) in [(2026, 9, 21, 14), (2026, 8, 1, 0), (2026, 11, 30, 23)] {
            let mut file = InboxFile {
                path: "D:/Metaflow/Inbox/tarea-1.pdf".into(),
                name: "tarea-1.pdf".into(),
                extension: "pdf".into(),
                stamp: FileStamp {
                    size: 10,
                    created_at: Some(
                        Local
                            .with_ymd_and_hms(2026, 2, 6, 19, 13, 48)
                            .single()
                            .expect("date")
                            .timestamp_millis(),
                    ),
                    modified_at: Some(
                        Local
                            .with_ymd_and_hms(y, m, d, h, 59, 59)
                            .single()
                            .expect("date")
                            .timestamp_millis(),
                    ),
                },
                accessed_at: None,
                status: "ready".into(),
                rule_id: None,
                rule_name: None,
                destination_path: None,
                date_source: None,
                date_used: None,
                error: None,
            };
            evaluate(&mut file, &rules);
            assert_eq!(file.rule_name.as_deref(), Some("Periodo 3"));
            assert!(file
                .destination_path
                .expect("destination")
                .ends_with("tarea-1.pdf"));
        }
    }
    #[test]
    fn overlaps_and_invalid_calendar_dates_are_rejected() {
        assert_eq!(
            validate_rules(&[
                rule("a", "2026-01-01", "2026-04-30"),
                rule("b", "2026-04-30", "2026-06-01")
            ])
            .expect_err("overlap")
            .code,
            "RULE_CONFLICT"
        );
        assert!(validate_rules(&[rule("a", "2026-02-30", "2026-04-30")]).is_err());
    }
    #[test]
    fn different_date_sources_cannot_silently_choose_between_multiple_matches() {
        let mut created = rule("created-period", "2026-02-01", "2026-04-30");
        created.date_source = DateSource::Created;
        let rules = vec![created, rule("modified-period", "2026-08-01", "2026-11-30")];
        validate_rules(&rules).expect("disjoint ranges");
        let mut file = InboxFile {
            path: "inbox/tarea.pdf".into(),
            name: "tarea.pdf".into(),
            extension: "pdf".into(),
            stamp: FileStamp {
                size: 10,
                created_at: Some(
                    Local
                        .with_ymd_and_hms(2026, 2, 6, 19, 13, 48)
                        .single()
                        .expect("date")
                        .timestamp_millis(),
                ),
                modified_at: Some(
                    Local
                        .with_ymd_and_hms(2026, 9, 21, 14, 6, 55)
                        .single()
                        .expect("date")
                        .timestamp_millis(),
                ),
            },
            accessed_at: None,
            status: "ready".into(),
            rule_id: None,
            rule_name: None,
            destination_path: None,
            date_source: None,
            date_used: None,
            error: None,
        };
        evaluate(&mut file, &rules);
        assert_eq!(file.status, "needs-review");
        assert!(file.destination_path.is_none());
        assert_eq!(file.error.as_deref(), Some("MULTIPLE_RULE_MATCHES"));
    }
}
