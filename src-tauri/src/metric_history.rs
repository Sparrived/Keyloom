use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

const SAMPLE_SECONDS: i64 = 15;
const HISTORY_SECONDS: i64 = 10 * 60;
const TOTAL_WINDOW_SECONDS: i64 = 60 * 60;
const RATE_WINDOW_SECONDS: i64 = 60;

#[derive(Debug, PartialEq, Serialize)]
pub struct MetricHistoryPoint {
    pub timestamp_ms: i64,
    pub current_rpm: i64,
    pub current_tpm: i64,
    pub requests: i64,
    pub successes: i64,
    pub failures: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cached_tokens: i64,
    pub cached_token_rate: f64,
    pub avg_duration_ms: i64,
}

#[derive(Debug)]
struct RequestMetric {
    timestamp: i64,
    success: i64,
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
    cached_tokens: i64,
    duration_ms: i64,
}

pub fn read_metric_history(database_path: &Path) -> Result<Vec<MetricHistoryPoint>, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效: {error}"))?
        .as_secs() as i64;
    read_metric_history_at(database_path, now)
}

fn read_metric_history_at(
    database_path: &Path,
    now: i64,
) -> Result<Vec<MetricHistoryPoint>, String> {
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("无法只读打开 AMKR 指标数据库: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|error| format!("无法配置 AMKR 指标数据库读取: {error}"))?;

    let aligned_now = now - now.rem_euclid(SAMPLE_SECONDS);
    let earliest_record = aligned_now - HISTORY_SECONDS - TOTAL_WINDOW_SECONDS;
    let mut statement = connection
        .prepare(
            "SELECT unixepoch(created_at), success, prompt_tokens, completion_tokens, \
                    total_tokens, cached_tokens, duration_ms \
             FROM request_metrics \
             WHERE unixepoch(created_at) >= ?1 AND unixepoch(created_at) <= ?2 \
             ORDER BY created_at",
        )
        .map_err(|error| format!("无法读取 AMKR 指标表: {error}"))?;
    let rows = statement
        .query_map((earliest_record, aligned_now), |row| {
            Ok(RequestMetric {
                timestamp: row.get(0)?,
                success: row.get(1)?,
                prompt_tokens: row.get(2)?,
                completion_tokens: row.get(3)?,
                total_tokens: row.get(4)?,
                cached_tokens: row.get(5)?,
                duration_ms: row.get(6)?,
            })
        })
        .map_err(|error| format!("无法查询 AMKR 历史指标: {error}"))?;
    let records = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("AMKR 历史指标格式无效: {error}"))?;

    Ok((0..=HISTORY_SECONDS / SAMPLE_SECONDS)
        .map(|index| {
            let bucket_end = aligned_now - HISTORY_SECONDS + index * SAMPLE_SECONDS;
            aggregate_bucket(&records, bucket_end)
        })
        .collect())
}

fn aggregate_bucket(records: &[RequestMetric], bucket_end: i64) -> MetricHistoryPoint {
    let totals = records.iter().filter(|record| {
        record.timestamp >= bucket_end - TOTAL_WINDOW_SECONDS && record.timestamp <= bucket_end
    });
    let mut requests = 0;
    let mut successes = 0;
    let mut prompt_tokens = 0;
    let mut completion_tokens = 0;
    let mut total_tokens = 0;
    let mut cached_tokens = 0;
    let mut total_duration_ms = 0;
    for record in totals {
        requests += 1;
        successes += record.success;
        prompt_tokens += record.prompt_tokens;
        completion_tokens += record.completion_tokens;
        total_tokens += record.total_tokens;
        cached_tokens += record.cached_tokens;
        total_duration_ms += record.duration_ms;
    }
    let rate_records = records.iter().filter(|record| {
        record.timestamp >= bucket_end - RATE_WINDOW_SECONDS && record.timestamp <= bucket_end
    });
    let (current_rpm, current_tpm) = rate_records.fold((0, 0), |(rpm, tpm), record| {
        (rpm + 1, tpm + record.total_tokens)
    });

    MetricHistoryPoint {
        timestamp_ms: bucket_end * 1_000,
        current_rpm,
        current_tpm,
        requests,
        successes,
        failures: requests - successes,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cached_tokens,
        cached_token_rate: if prompt_tokens == 0 {
            0.0
        } else {
            cached_tokens as f64 / prompt_tokens as f64
        },
        avg_duration_ms: if requests == 0 {
            0
        } else {
            (total_duration_ms as f64 / requests as f64).round() as i64
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_rolling_history_from_amkr_request_rows() {
        let path = std::env::temp_dir().join(format!(
            "keyloom-metric-history-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE request_metrics (
                created_at TEXT NOT NULL,
                success INTEGER NOT NULL,
                prompt_tokens INTEGER NOT NULL,
                completion_tokens INTEGER NOT NULL,
                total_tokens INTEGER NOT NULL,
                cached_tokens INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL
            );
            INSERT INTO request_metrics VALUES
                ('2026-07-14T11:59:30+00:00', 1, 80, 20, 100, 40, 100),
                ('2026-07-14T11:59:50+00:00', 0, 160, 40, 200, 80, 300);",
            )
            .unwrap();
        drop(connection);

        let now = 1_784_030_400; // 2026-07-14T12:00:00Z
        let history = read_metric_history_at(&path, now).unwrap();
        let latest = history.last().unwrap();

        assert_eq!(history.len(), 41);
        assert_eq!(latest.current_rpm, 2);
        assert_eq!(latest.current_tpm, 300);
        assert_eq!(latest.requests, 2);
        assert_eq!(latest.successes, 1);
        assert_eq!(latest.failures, 1);
        assert_eq!(latest.cached_token_rate, 0.5);
        assert_eq!(latest.avg_duration_ms, 200);

        std::fs::remove_file(path).unwrap();
    }
}
