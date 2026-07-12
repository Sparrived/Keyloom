use std::fs;

use super::discover_from_config;

#[test]
fn reads_connection_details_from_an_existing_amkr_config() {
    let path = std::env::temp_dir().join("keyloom-discovery-config.json");
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

    let connection = discover_from_config(&path).unwrap();

    assert_eq!(connection.base_url, "http://127.0.0.2:18900");
    assert_eq!(connection.local_api_key.as_deref(), Some("amkr-local-key"));
    assert_eq!(connection.metrics_db_path.as_deref(), Some("C:/amkr/metrics.sqlite3"));
    assert_eq!(connection.log_file_path.as_deref(), Some("C:/amkr/router.log"));

    fs::remove_file(path).unwrap();
}

