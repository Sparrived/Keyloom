use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use super::client::{create_provider, create_provider_key, export_config, get_health, get_providers, get_routes, import_config};
use super::AmkrConnection;

#[test]
fn reads_a_healthy_local_amkr_response_without_exposing_the_auth_key() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 1024];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(request.starts_with("GET /health HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer local-api-key"));

        let body = r#"{"status":"ok","local_auth_enabled":true}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let health = get_health(&AmkrConnection {
        base_url: format!("http://{address}"),
        local_api_key: Some("local-api-key".to_owned()),
        metrics_db_path: None,
        log_file_path: None,
    })
    .unwrap();

    assert_eq!(health.status, "ok");
    assert!(health.local_auth_enabled);
    server.join().unwrap();
}

#[test]
fn reads_redacted_provider_configuration_with_local_authentication() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 2048];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(request.starts_with("GET /api/providers HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer local-api-key"));

        let body = r#"{"config_revision":"revision-a","providers":[{"id":"a.example.test","base_url":"https://a.example.test","keys":[{"name":"key-a","enabled":true,"allow_visitor":false,"api_key_fingerprint":"65bbff9a6cb9"}],"pools":[{"name":"model-a","keys":["key-a"],"models":["model-a"]}],"routes":{}}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let response = get_providers(&AmkrConnection {
        base_url: format!("http://{address}"),
        local_api_key: Some("local-api-key".to_owned()),
        metrics_db_path: None,
        log_file_path: None,
    })
    .unwrap();

    assert_eq!(response.config_revision, "revision-a");
    assert_eq!(response.providers.len(), 1);
    assert_eq!(response.providers[0].id, "a.example.test");
    assert_eq!(response.providers[0].keys[0].api_key_fingerprint, "65bbff9a6cb9");
    server.join().unwrap();
}

#[test]
fn reads_model_routes_with_their_provider_targets() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 2048];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(request.starts_with("GET /api/routes HTTP/1.1"));

        let body = r#"{"config_revision":"revision-a","routes":[{"id":"model-a","targets":[{"provider":"a.example.test","pool":"model-a","upstream_model":"upstream-a"}],"aliases":["alias-a"],"routing_mode":"priority"}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let response = get_routes(&AmkrConnection {
        base_url: format!("http://{address}"),
        local_api_key: None,
        metrics_db_path: None,
        log_file_path: None,
    })
    .unwrap();

    assert_eq!(response.routes[0].id, "model-a");
    assert_eq!(response.routes[0].targets[0].provider, "a.example.test");
    assert_eq!(response.routes[0].aliases, ["alias-a"]);
    server.join().unwrap();
}

#[test]
fn creates_provider_with_a_revision_and_local_authentication() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 2048];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(request.starts_with("POST /api/providers HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer local-api-key"));
        assert!(request.contains("\"config_revision\":\"revision-a\""));
        assert!(request.contains("\"id\":\"b.example.test\""));
        assert!(request.contains("\"base_url\":\"https://b.example.test\""));

        let body = r#"{"config_revision":"revision-b","provider":{"id":"b.example.test","base_url":"https://b.example.test","keys":[],"pools":[]}}"#;
        write!(
            stream,
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let response = create_provider(
        &AmkrConnection {
            base_url: format!("http://{address}"),
            local_api_key: Some("local-api-key".to_owned()),
            metrics_db_path: None,
            log_file_path: None,
        },
        "revision-a",
        "b.example.test",
        "https://b.example.test",
    )
    .unwrap();

    assert_eq!(response.config_revision, "revision-b");
    assert_eq!(response.provider.id, "b.example.test");
    server.join().unwrap();
}

#[test]
fn creates_a_provider_key_with_local_authentication_and_revision() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 2048];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(request.starts_with("POST /api/providers/a.example.test/keys HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer local-api-key"));
        assert!(request.contains("\"config_revision\":\"revision-a\""));
        assert!(request.contains("\"name\":\"key-b\""));
        assert!(request.contains("\"allow_visitor\":true"));
        write!(stream, "HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });

    create_provider_key(
        &AmkrConnection { base_url: format!("http://{address}"), local_api_key: Some("local-api-key".to_owned()), metrics_db_path: None, log_file_path: None },
        "revision-a", "a.example.test", "key-b", "upstream-secret", true,
    ).unwrap();
    server.join().unwrap();
}

#[test]
fn transfers_config_with_local_authentication_and_revision() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        for (expected_path, response_body) in [
            ("POST /api/config/export HTTP/1.1", r#"{"config_revision":"revision-a","config":{"providers":{}}}"#),
            ("POST /api/config/import HTTP/1.1", r#"{"config_revision":"revision-b","config":{"providers":{}}}"#),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 2048];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.starts_with(expected_path));
            assert!(request.contains("Authorization: Bearer local-api-key"));
            if expected_path.contains("import") {
                assert!(request.contains("\"config_revision\":\"revision-a\""));
                assert!(request.contains("\"providers\":{}"));
            }
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response_body.len(), response_body).unwrap();
        }
    });
    let connection = AmkrConnection { base_url: format!("http://{address}"), local_api_key: Some("local-api-key".to_owned()), metrics_db_path: None, log_file_path: None };
    let exported = export_config(&connection).unwrap();
    assert_eq!(exported.config_revision, "revision-a");
    let imported = import_config(&connection, &exported.config_revision, exported.config).unwrap();
    assert_eq!(imported.config_revision, "revision-b");
    server.join().unwrap();
}
