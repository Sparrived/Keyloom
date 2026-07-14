use std::fs;
use std::path::Path;

use super::{discover_from_paths, DiscoveryError};

fn write_config(path: &Path, port: u16) {
    fs::write(
        path,
        format!(
            r#"{{
              "host": "127.0.0.2",
              "port": {port},
              "local_api_key": "amkr-local-key",
              "metrics_db_path": "C:/amkr/metrics.sqlite3",
              "log_file_path": "C:/amkr/router.log"
            }}"#,
        ),
    )
    .unwrap();
}

#[test]
fn reads_connection_details_from_an_existing_amkr_config() {
    let path = std::env::temp_dir().join("keyloom-discovery-config.json");
    write_config(&path, 18900);

    let instance = discover_from_paths(Some(&path), &path).unwrap();
    let connection = instance.connection;

    assert_eq!(connection.base_url, "http://127.0.0.2:18900");
    assert_eq!(connection.local_api_key.as_deref(), Some("amkr-local-key"));
    assert_eq!(
        connection.metrics_db_path.as_deref(),
        Some("C:/amkr/metrics.sqlite3")
    );
    assert_eq!(
        connection.log_file_path.as_deref(),
        Some("C:/amkr/router.log")
    );

    fs::remove_file(path).unwrap();
}

#[test]
fn falls_back_to_the_default_config_path_when_no_explicit_path_is_selected() {
    let root = std::env::temp_dir().join("keyloom-default-discovery");
    let default_path = root.join("router-config.json");
    fs::create_dir_all(&root).unwrap();
    write_config(&default_path, 18900);

    let instance = discover_from_paths(None, &default_path).unwrap();

    assert_eq!(instance.config_path, default_path);
    assert_eq!(instance.connection.base_url, "http://127.0.0.2:18900");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn falls_back_to_the_default_config_when_the_selected_path_is_unavailable() {
    let root = std::env::temp_dir().join("keyloom-explicit-fallback-discovery");
    let selected_path = root.join("missing-config.json");
    let default_path = root.join("router-config.json");
    fs::create_dir_all(&root).unwrap();
    write_config(&default_path, 19000);

    let instance = discover_from_paths(Some(&selected_path), &default_path).unwrap();

    assert_eq!(instance.config_path, default_path);
    assert_eq!(instance.connection.base_url, "http://127.0.0.2:19000");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_a_missing_config_without_creating_one() {
    let path = std::env::temp_dir().join("keyloom-missing-config.json");
    let _ = fs::remove_file(&path);

    let error = discover_from_paths(None, &path).unwrap_err();

    assert!(matches!(error, DiscoveryError::NotFound(found) if found == path));
    assert!(!path.exists());
}
