use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::thread;

use crate::windows_service::{ServiceAction, TaskCommandResult, WINDOWS_TASK_NAME};
#[test]
fn discover_amkr_returns_connection_metadata_without_the_api_key() {
    let path = std::env::temp_dir().join("keyloom-host-config.json");
    fs::write(
        &path,
        r#"{
          "host": "127.0.0.2",
          "port": 18900,
          "local_api_key": "amkr-local-key",
          "metrics_db_path": "C:/amkr/metrics.sqlite3",
          "log_file_path": "C:/amkr/router.log"
        }"#,
    )
    .unwrap();

    let metadata = crate::discover_amkr_from_paths(Some(&path), &path).unwrap();

    assert_eq!(metadata.config_path, path.to_string_lossy());
    assert_eq!(metadata.base_url, "http://127.0.0.2:18900");
    assert_eq!(
        metadata.metrics_db_path.as_deref(),
        Some("C:/amkr/metrics.sqlite3")
    );
    assert_eq!(
        metadata.log_file_path.as_deref(),
        Some("C:/amkr/router.log")
    );
    assert!(metadata.auth_enabled);

    fs::remove_file(path).unwrap();
}

#[test]
fn discovers_runtime_settings_without_returning_the_local_api_key() {
    let path = std::env::temp_dir().join("keyloom-runtime-settings-config.json");
    fs::write(
        &path,
        r#"{
          "host": "127.0.0.3",
          "port": 19001,
          "local_api_key": "secret-not-returned",
          "request_timeout": 42.5,
          "stream_first_byte_timeout": 55,
          "stream_idle_timeout": 91.5,
          "max_retries": 4
        }"#,
    )
    .unwrap();

    let metadata = crate::discover_amkr_from_paths(Some(&path), &path).unwrap();

    assert_eq!(metadata.host, "127.0.0.3");
    assert_eq!(metadata.port, 19001);
    assert_eq!(metadata.request_timeout, Some(42.5));
    assert_eq!(metadata.stream_first_byte_timeout, Some(55.0));
    assert_eq!(metadata.stream_idle_timeout, Some(91.5));
    assert_eq!(metadata.max_retries, Some(4));
    fs::remove_file(path).unwrap();
}

#[test]
fn exposes_a_default_config_location_under_local_app_data() {
    let path = crate::default_config_path();

    assert!(path.ends_with(Path::new("AutoModelKeyRouter").join("router-config.json")));
}

#[test]
fn returns_a_safe_health_status_for_the_discovered_instance() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 1024];
        stream.read(&mut buffer).unwrap();
        let body = r#"{"status":"ok","local_auth_enabled":true}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    let path = std::env::temp_dir().join("keyloom-health-config.json");
    fs::write(
        &path,
        format!(
            r#"{{"host":"127.0.0.1","port":{},"local_api_key":"secret"}}"#,
            address.port()
        ),
    )
    .unwrap();

    let health = crate::get_amkr_health_from_paths(Some(&path), &path).unwrap();

    assert_eq!(health.status, "ok");
    assert!(health.local_auth_enabled);
    server.join().unwrap();
    fs::remove_file(path).unwrap();
}

#[test]
fn returns_metrics_for_the_discovered_instance() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 1024];
        stream.read(&mut buffer).unwrap();
        assert!(String::from_utf8_lossy(&buffer).starts_with("GET /metrics?hours=1 "));
        let body = r#"{"total":{"requests":1428,"successes":1400,"failures":28,"prompt_tokens":1840000,"completion_tokens":1000000,"total_tokens":2840000,"cached_tokens":1251200,"cached_token_rate":0.68,"avg_duration_ms":1200}}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    let path = std::env::temp_dir().join("keyloom-metrics-config.json");
    fs::write(
        &path,
        format!(
            r#"{{"host":"127.0.0.1","port":{},"local_api_key":"secret"}}"#,
            address.port()
        ),
    )
    .unwrap();

    let metrics = crate::get_amkr_metrics_from_paths(Some(&path), &path).unwrap();

    assert_eq!(metrics.total.requests, 1428);
    assert_eq!(metrics.total.successes, Some(1400));
    assert_eq!(metrics.total.failures, Some(28));
    assert_eq!(metrics.total.prompt_tokens, Some(1_840_000));
    assert_eq!(metrics.total.completion_tokens, Some(1_000_000));
    assert_eq!(metrics.total.total_tokens, 2_840_000);
    assert_eq!(metrics.total.cached_tokens, Some(1_251_200));
    assert_eq!(metrics.total.cached_token_rate, 0.68);
    assert_eq!(metrics.total.avg_duration_ms, 1200);
    server.join().unwrap();
    fs::remove_file(path).unwrap();
}

#[test]
fn executes_service_actions_only_for_the_discovered_config_path() {
    let path = std::env::temp_dir().join("keyloom-service-config.json");
    fs::write(&path, r#"{"host":"127.0.0.1","port":18900}"#).unwrap();

    let results = crate::execute_amkr_service_from_paths(
        ServiceAction::Start,
        Some(&path),
        &path,
        |command| {
            assert_eq!(command, ["schtasks", "/Run", "/TN", WINDOWS_TASK_NAME]);
            Ok(TaskCommandResult {
                command: command.to_vec(),
                exit_code: 0,
                stdout: String::new(),
                stderr: String::new(),
            })
        },
    )
    .unwrap();

    assert_eq!(results.len(), 1);
    fs::remove_file(path).unwrap();
}

#[test]
fn runs_registered_task_actions_without_a_config_file() {
    let missing = std::env::temp_dir().join("keyloom-missing-service-config.json");
    let _ = fs::remove_file(&missing);

    let results =
        crate::execute_amkr_service_from_paths(ServiceAction::Start, None, &missing, |command| {
            assert_eq!(command, ["schtasks", "/Run", "/TN", WINDOWS_TASK_NAME]);
            Ok(TaskCommandResult {
                command: command.to_vec(),
                exit_code: 0,
                stdout: String::new(),
                stderr: String::new(),
            })
        })
        .unwrap();

    assert_eq!(results.len(), 1);
}

#[test]
fn reads_only_the_tail_of_the_discovered_amkr_log() {
    let log_path = std::env::temp_dir().join("keyloom-activity.log");
    let config_path = std::env::temp_dir().join("keyloom-activity-config.json");
    fs::write(&log_path, format!("{}\nlatest event", "x".repeat(70_000))).unwrap();
    fs::write(
        &config_path,
        format!(
            r#"{{"log_file_path":"{}"}}"#,
            log_path.to_string_lossy().replace('\\', "\\\\")
        ),
    )
    .unwrap();

    let tail = crate::read_amkr_log_tail_from_paths(Some(&config_path), &config_path).unwrap();

    assert!(tail.ends_with("latest event"));
    assert!(tail.len() <= 65_536);
    fs::remove_file(config_path).unwrap();
    fs::remove_file(log_path).unwrap();
}
