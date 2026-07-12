use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use super::client::{
    create_provider, create_provider_key, delete_pool, delete_provider_key, delete_route,
    delete_unified_model, export_config, get_health, get_models, get_probe, get_providers,
    get_routes, get_unified_model, import_config, probe_keys, probe_pools, update_pool,
    update_model_reasoning_effort, update_provider, update_provider_key, update_route,
    update_unified_model, cancel_probe,
    AmkrHealth, AmkrRouteTarget, AmkrUnifiedModel, AmkrUnifiedPlan, AmkrUnifiedTarget,
    AmkrUsageStats,
};
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
fn keeps_new_metric_fields_optional_for_older_amkr_responses() {
    let stats: AmkrUsageStats = serde_json::from_str(
        r#"{"requests":12,"total_tokens":1001,"cached_token_rate":0.325,"avg_duration_ms":450}"#,
    )
    .unwrap();

    assert_eq!(stats.successes, None);
    assert_eq!(stats.failures, None);
    assert_eq!(stats.prompt_tokens, None);
    assert_eq!(stats.completion_tokens, None);
    assert_eq!(stats.cached_tokens, None);
}

#[test]
fn reads_rich_health_capabilities_without_returning_secret_values() {
    let health: AmkrHealth = serde_json::from_str(
        r#"{
          "status":"ok",
          "local_auth_enabled":true,
          "models":["model-a"],
          "local_api_key_fingerprint":"65bbff9a6cb9",
          "visitor_feature_installed":true,
          "visitor_access_enabled":true,
          "visitor_key_count":2,
          "native_endpoint_states":{
            "https://upstream-secret.example|v1/messages":{"supported":true,"reason":"secret-reason"},
            "https://fallback.example|v1/responses":{"supported":false,"reason":"unsupported"},
            "https://legacy.example":true,
            "https://unknown.example":"secret-unknown"
          }
        }"#,
    )
    .unwrap();

    assert_eq!(health.models, ["model-a"]);
    assert_eq!(health.local_api_key_fingerprint.as_deref(), Some("65bbff9a6cb9"));
    assert!(health.visitor_feature_installed);
    assert!(health.visitor_access_enabled);
    assert_eq!(health.visitor_key_count, 2);
    let summary = health.native_endpoint_summary.as_ref().unwrap();
    assert_eq!(summary.supported, 2);
    assert_eq!(summary.fallback, 1);
    assert_eq!(summary.unknown, 1);
    let serialized = serde_json::to_string(&health).unwrap();
    assert!(serialized.contains("native_endpoint_summary"));
    assert!(!serialized.contains("native_endpoint_states"));
    assert!(!serialized.contains("secret"));
}

#[test]
fn normalizes_legacy_flat_unified_model_responses() {
    let response: super::client::AmkrUnifiedModelResponse = serde_json::from_str(
        r#"{"unified_model":{"model":"model-a","key":"key-a","image_model":"image-a","image_key":null}}"#,
    )
    .unwrap();
    let unified = response.unified_model.unwrap();

    assert_eq!(unified.default.primary.model, "model-a");
    assert_eq!(unified.default.primary.key.as_deref(), Some("key-a"));
    assert_eq!(unified.image.unwrap().primary.model, "image-a");

    let health: AmkrHealth = serde_json::from_str(
        r#"{"status":"ok","local_auth_enabled":true,"unified_model":{"model":"model-a","key":null}}"#,
    )
    .unwrap();
    assert_eq!(health.unified_model.unwrap().default.primary.model, "model-a");
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
fn reads_and_updates_the_unified_model_with_an_explicit_automatic_key() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        for (expected, status, body) in [
            (
                "GET /api/models HTTP/1.1",
                "200 OK",
                r#"{"models":[{"id":"model-a","aliases":["alias-a"],"routing_mode":"round_robin","reasoning_effort":null,"visitor_available":false,"keys":[{"name":"key-a","base_url":"https://a.example.test","enabled":true,"allow_visitor":false,"api_key_fingerprint":"65bbff9a6cb9"}]}]}"#,
            ),
            (
                "GET /api/unified-model HTTP/1.1",
                "200 OK",
                r#"{"unified_model":{"default":{"primary":{"model":"model-a","key":"key-a"}}}}"#,
            ),
            (
                "PUT /api/unified-model HTTP/1.1",
                "200 OK",
                r#"{"unified_model":{"default":{"primary":{"model":"model-a","key":null}}}}"#,
            ),
            ("DELETE /api/unified-model HTTP/1.1", "204 No Content", ""),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.starts_with(expected));
            assert!(request.contains("Authorization: Bearer local-api-key"));
            if expected.starts_with("PUT") {
                assert!(request.contains("\"model\":\"model-a\""));
                assert!(request.contains("\"key\":null"));
                assert!(request.contains("\"image_model\":null"));
                assert!(request.contains("\"image_key\":null"));
            }
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
    });
    let connection = AmkrConnection {
        base_url: format!("http://{address}"),
        local_api_key: Some("local-api-key".to_owned()),
        metrics_db_path: None,
        log_file_path: None,
    };

    let models = get_models(&connection).unwrap();
    assert_eq!(models.models[0].keys[0].name, "key-a");
    let current = get_unified_model(&connection).unwrap();
    assert_eq!(current.unified_model.unwrap().default.primary.key.as_deref(), Some("key-a"));
    let updated = update_unified_model(
        &connection,
        &AmkrUnifiedModel {
            default: AmkrUnifiedPlan {
                primary: AmkrUnifiedTarget {
                    model: "model-a".to_owned(),
                    key: None,
                },
                fallback: None,
            },
            image: None,
        },
    )
    .unwrap();
    assert_eq!(updated.unified_model.unwrap().default.primary.key, None);
    delete_unified_model(&connection).unwrap();

    server.join().unwrap();
}

#[test]
fn preserves_unedited_fallback_and_image_plans_when_updating_unified_model() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 4096];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(request.starts_with("PUT /api/unified-model HTTP/1.1"));
        assert!(request.contains("\"default\":{"));
        assert!(request.contains("\"fallback\":{"));
        assert!(request.contains("\"model\":\"backup-a\""));
        assert!(request.contains("\"image\":{"));
        assert!(request.contains("\"model\":\"image-a\""));
        assert!(request.contains("\"key\":\"image-key\""));
        let body = r#"{"unified_model":{"default":{"primary":{"model":"model-b","key":null},"fallback":{"model":"backup-a","key":null}},"image":{"primary":{"model":"image-a","key":"image-key"}}}}"#;
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    });
    let connection = AmkrConnection { base_url: format!("http://{address}"), local_api_key: None, metrics_db_path: None, log_file_path: None };
    let response = update_unified_model(
        &connection,
        &AmkrUnifiedModel {
            default: AmkrUnifiedPlan {
                primary: AmkrUnifiedTarget { model: "model-b".to_owned(), key: None },
                fallback: Some(AmkrUnifiedTarget { model: "backup-a".to_owned(), key: None }),
            },
            image: Some(AmkrUnifiedPlan {
                primary: AmkrUnifiedTarget { model: "image-a".to_owned(), key: Some("image-key".to_owned()) },
                fallback: None,
            }),
        },
    )
    .unwrap();

    assert_eq!(response.unified_model.unwrap().default.fallback.unwrap().model, "backup-a");
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
fn sends_provider_configuration_updates_with_the_current_revision() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        for (expected_path, expected_body) in [
            (
                "PUT /api/providers/a.example.test HTTP/1.1",
                vec![
                    "\"config_revision\":\"revision-a\"",
                    "\"id\":\"b.example.test\"",
                    "\"base_url\":\"https://b.example.test\"",
                ],
            ),
            (
                "PUT /api/providers/b.example.test/keys/key-a HTTP/1.1",
                vec![
                    "\"name\":\"key-b\"",
                    "\"enabled\":false",
                    "\"allow_visitor\":true",
                    "\"api_key\":\"replacement-secret\"",
                ],
            ),
            (
                "PUT /api/providers/b.example.test/pools/pool-a HTTP/1.1",
                vec![
                    "\"name\":\"pool-b\"",
                    "\"keys\":[\"key-b\"]",
                    "\"models\":[\"model-b\"]",
                ],
            ),
            (
                "PUT /api/routes/model-a HTTP/1.1",
                vec![
                    "\"id\":\"model-b\"",
                    "\"aliases\":[\"alias-b\"]",
                    "\"routing_mode\":\"priority\"",
                    "\"provider\":\"b.example.test\"",
                ],
            ),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.starts_with(expected_path));
            assert!(request.contains("Authorization: Bearer local-api-key"));
            for fragment in expected_body {
                assert!(request.contains(fragment), "missing {fragment} in {request}");
            }
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}").unwrap();
        }
    });
    let connection = AmkrConnection {
        base_url: format!("http://{address}"),
        local_api_key: Some("local-api-key".to_owned()),
        metrics_db_path: None,
        log_file_path: None,
    };

    update_provider(&connection, "revision-a", "a.example.test", "b.example.test", "https://b.example.test").unwrap();
    update_provider_key(&connection, "revision-a", "b.example.test", "key-a", "key-b", Some("replacement-secret"), false, true).unwrap();
    update_pool(&connection, "revision-a", "b.example.test", "pool-a", "pool-b", vec!["key-b".to_owned()], vec!["model-b".to_owned()]).unwrap();
    update_route(
        &connection,
        "revision-a",
        "model-a",
        "model-b",
        vec![AmkrRouteTarget {
            provider: "b.example.test".to_owned(),
            pool: "pool-b".to_owned(),
            upstream_model: "upstream-b".to_owned(),
        }],
        vec!["alias-b".to_owned()],
        Some("priority".to_owned()),
    )
    .unwrap();

    server.join().unwrap();
}

#[test]
fn updates_model_reasoning_effort_with_an_encoded_model_id() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 4096];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(request.starts_with("PUT /api/models/model%2Fa HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer local-api-key"));
        assert!(request.contains("\"reasoning_effort\":\"high\""));
        let body = r#"{"id":"model/a","aliases":[],"routing_mode":"round_robin","reasoning_effort":"high","visitor_available":false,"keys":[]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let response = update_model_reasoning_effort(
        &AmkrConnection {
            base_url: format!("http://{address}"),
            local_api_key: Some("local-api-key".to_owned()),
            metrics_db_path: None,
            log_file_path: None,
        },
        "model/a",
        Some("high"),
    )
    .unwrap();

    assert_eq!(response.id, "model/a");
    assert_eq!(response.reasoning_effort.as_deref(), Some("high"));
    server.join().unwrap();
}

#[test]
fn sends_key_and_pool_deletions_with_the_current_revision() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        for expected_path in [
            "DELETE /api/providers/a.example.test/keys/key-a HTTP/1.1",
            "DELETE /api/providers/a.example.test/pools/pool-a HTTP/1.1",
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 2048];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.starts_with(expected_path));
            assert!(request.contains("\"config_revision\":\"revision-a\""));
            write!(stream, "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        }
    });
    let connection = AmkrConnection {
        base_url: format!("http://{address}"),
        local_api_key: None,
        metrics_db_path: None,
        log_file_path: None,
    };

    delete_provider_key(&connection, "revision-a", "a.example.test", "key-a").unwrap();
    delete_pool(&connection, "revision-a", "a.example.test", "pool-a").unwrap();

    server.join().unwrap();
}

#[test]
fn encodes_dynamic_route_ids_as_single_path_segments() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 2048];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(request.starts_with("DELETE /api/routes/model%2Fvision%20latest HTTP/1.1"));
        write!(stream, "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });

    delete_route(
        &AmkrConnection {
            base_url: format!("http://{address}"),
            local_api_key: None,
            metrics_db_path: None,
            log_file_path: None,
        },
        "revision-a",
        "model/vision latest",
    )
    .unwrap();
    server.join().unwrap();
}

#[test]
fn reports_http_status_and_safe_api_detail_for_conflicts() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 2048];
        stream.read(&mut buffer).unwrap();
        let body = r#"{"detail":"配置已被其他客户端修改"}"#;
        write!(
            stream,
            "HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let error = create_provider(
        &AmkrConnection {
            base_url: format!("http://{address}"),
            local_api_key: None,
            metrics_db_path: None,
            log_file_path: None,
        },
        "stale-revision",
        "a.example.test",
        "https://a.example.test",
    )
    .unwrap_err();

    assert!(error.contains("409"));
    assert!(error.contains("配置已被其他客户端修改"));
    server.join().unwrap();
}

#[test]
fn never_reports_structured_validation_details_that_can_echo_api_keys() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 2048];
        stream.read(&mut buffer).unwrap();
        let body = r#"{"detail":[{"loc":["body","api_key"],"input":"upstream-secret"}]}"#;
        write!(
            stream,
            "HTTP/1.1 422 Unprocessable Entity\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let error = create_provider_key(
        &AmkrConnection {
            base_url: format!("http://{address}"),
            local_api_key: None,
            metrics_db_path: None,
            log_file_path: None,
        },
        "revision-a",
        "a.example.test",
        "key-a",
        "upstream-secret",
        false,
    )
    .unwrap_err();

    assert!(error.contains("422"));
    assert!(!error.contains("upstream-secret"));
    server.join().unwrap();
}

#[test]
fn transfers_config_with_local_authentication_and_revision() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        for (expected_path, response_body) in [
            ("POST /api/config/export HTTP/1.1", r#"{"config_revision":"revision-a","config":{"providers":{}}}"#),
            ("POST /api/config/import HTTP/1.1", r#"{"config_revision":"revision-b","imported":true}"#),
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
    assert!(imported.imported);
    server.join().unwrap();
}

#[test]
fn starts_polls_and_cancels_key_and_pool_probes_without_leaking_secrets() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        for (expected, status, body) in [
            (
                "POST /api/probes/keys HTTP/1.1",
                "202 Accepted",
                r#"{"probe_id":"probe-keys","status":"pending"}"#,
            ),
            (
                "POST /api/probes/pools HTTP/1.1",
                "202 Accepted",
                r#"{"probe_id":"probe-pools","status":"pending"}"#,
            ),
            (
                "GET /api/probes/probe-keys HTTP/1.1",
                "200 OK",
                r#"{"probe_id":"probe-keys","status":"complete","provider":"openai","results":[{"status":"ok","provider":"openai","key":"main","endpoint":"https://api.openai.com/v1/models","models":["gpt-4o"],"latency_ms":123,"error":null}],"error":null}"#,
            ),
            (
                "POST /api/probes/probe-keys/cancel HTTP/1.1",
                "200 OK",
                r#"{"probe_id":"probe-keys","status":"cancelled","provider":"openai","results":[],"error":null}"#,
            ),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.starts_with(expected));
            assert!(request.contains("Authorization: Bearer local-api-key"));
            if expected.starts_with("POST /api/probes/keys") {
                assert!(request.contains("\"provider_id\":\"openai\""));
                assert!(request.contains("\"keys\":[\"main\"]"));
                assert!(request.contains("\"timeout_seconds\":7.5"));
            }
            if expected.starts_with("POST /api/probes/pools") {
                assert!(request.contains("\"pools\":[\"default\"]"));
            }
            assert!(!request.contains("upstream-secret"));
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
    });
    let connection = AmkrConnection {
        base_url: format!("http://{address}"),
        local_api_key: Some("local-api-key".to_owned()),
        metrics_db_path: None,
        log_file_path: None,
    };

    let started = probe_keys(&connection, "openai", vec!["main".to_owned()], 7.5).unwrap();
    assert_eq!(started.probe_id, "probe-keys");
    let pool_started = probe_pools(&connection, "openai", vec!["default".to_owned()], 15.0).unwrap();
    assert_eq!(pool_started.status, "pending");
    let completed = get_probe(&connection, "probe-keys").unwrap();
    assert_eq!(completed.results[0].endpoint, "https://api.openai.com/v1/models");
    assert_eq!(completed.results[0].models, ["gpt-4o"]);
    let cancelled = cancel_probe(&connection, "probe-keys").unwrap();
    assert_eq!(cancelled.status, "cancelled");
    server.join().unwrap();
}
