use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::AmkrConnection;

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrHealth {
    pub status: String,
    pub local_auth_enabled: bool,
    #[serde(default)]
    pub unified_model: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrUsageStats {
    pub requests: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub successes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failures: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u64>,
    pub total_tokens: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_tokens: Option<u64>,
    pub cached_token_rate: f64,
    pub avg_duration_ms: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrMetrics {
    pub total: AmkrUsageStats,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrProviderKey {
    pub name: String,
    pub enabled: bool,
    pub allow_visitor: bool,
    pub api_key_fingerprint: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrProviderPool {
    pub name: String,
    pub keys: Vec<String>,
    pub models: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrProvider {
    pub id: String,
    pub base_url: String,
    #[serde(default)]
    pub keys: Vec<AmkrProviderKey>,
    #[serde(default)]
    pub pools: Vec<AmkrProviderPool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrProvidersResponse {
    pub config_revision: String,
    pub providers: Vec<AmkrProvider>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrProviderResponse {
    pub config_revision: String,
    pub provider: AmkrProvider,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrRouteTarget {
    pub provider: String,
    pub pool: String,
    pub upstream_model: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrRoute {
    pub id: String,
    pub targets: Vec<AmkrRouteTarget>,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub routing_mode: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrRoutesResponse {
    pub config_revision: String,
    pub routes: Vec<AmkrRoute>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrConfigTransfer {
    pub config_revision: String,
    pub config: serde_json::Value,
}

pub fn get_health(connection: &AmkrConnection) -> Result<AmkrHealth, String> {
    get_json(connection, "/health", "健康状态")
}

pub fn get_metrics(connection: &AmkrConnection) -> Result<AmkrMetrics, String> {
    get_json(connection, "/metrics", "指标")
}

pub fn get_providers(connection: &AmkrConnection) -> Result<AmkrProvidersResponse, String> {
    get_json(connection, "/api/providers", "供应商")
}

pub fn get_routes(connection: &AmkrConnection) -> Result<AmkrRoutesResponse, String> {
    get_json(connection, "/api/routes", "模型路由")
}

pub fn create_provider(
    connection: &AmkrConnection,
    config_revision: &str,
    id: &str,
    base_url: &str,
) -> Result<AmkrProviderResponse, String> {
    request_json(
        connection,
        "POST",
        "/api/providers",
        "创建供应商",
        Some(serde_json::json!({
            "config_revision": config_revision,
            "id": id,
            "base_url": base_url,
        })),
        &[201],
    )
}

pub fn update_provider(
    connection: &AmkrConnection,
    config_revision: &str,
    provider_id: &str,
    id: &str,
    base_url: &str,
) -> Result<(), String> {
    request_empty(
        connection,
        "PUT",
        &format!("/api/providers/{}", encode_path_segment(provider_id)),
        "更新供应商",
        serde_json::json!({
            "config_revision": config_revision,
            "id": id,
            "base_url": base_url,
        }),
        &[200],
    )
}

pub fn delete_provider(connection: &AmkrConnection, config_revision: &str, id: &str) -> Result<(), String> {
    request_empty(connection, "DELETE", &format!("/api/providers/{}", encode_path_segment(id)), "删除供应商", serde_json::json!({ "config_revision": config_revision }), &[204])
}

pub fn create_provider_key(connection: &AmkrConnection, config_revision: &str, provider_id: &str, name: &str, api_key: &str, allow_visitor: bool) -> Result<(), String> {
    request_empty(connection, "POST", &format!("/api/providers/{}/keys", encode_path_segment(provider_id)), "创建 Key", serde_json::json!({ "config_revision": config_revision, "name": name, "api_key": api_key, "allow_visitor": allow_visitor }), &[201])
}

pub fn update_provider_key(
    connection: &AmkrConnection,
    config_revision: &str,
    provider_id: &str,
    key_name: &str,
    name: &str,
    api_key: Option<&str>,
    enabled: bool,
    allow_visitor: bool,
) -> Result<(), String> {
    let mut payload = serde_json::json!({
        "config_revision": config_revision,
        "name": name,
        "enabled": enabled,
        "allow_visitor": allow_visitor,
    });
    if let Some(api_key) = api_key.filter(|value| !value.is_empty()) {
        payload["api_key"] = serde_json::Value::String(api_key.to_owned());
    }
    request_empty(
        connection,
        "PUT",
        &format!(
            "/api/providers/{}/keys/{}",
            encode_path_segment(provider_id),
            encode_path_segment(key_name)
        ),
        "更新 Key",
        payload,
        &[200],
    )
}

pub fn delete_provider_key(
    connection: &AmkrConnection,
    config_revision: &str,
    provider_id: &str,
    key_name: &str,
) -> Result<(), String> {
    request_empty(
        connection,
        "DELETE",
        &format!(
            "/api/providers/{}/keys/{}",
            encode_path_segment(provider_id),
            encode_path_segment(key_name)
        ),
        "删除 Key",
        serde_json::json!({ "config_revision": config_revision }),
        &[204],
    )
}

pub fn create_pool(connection: &AmkrConnection, config_revision: &str, provider_id: &str, name: &str, keys: Vec<String>, models: Vec<String>) -> Result<(), String> {
    request_empty(connection, "POST", &format!("/api/providers/{}/pools", encode_path_segment(provider_id)), "创建模型池", serde_json::json!({ "config_revision": config_revision, "name": name, "keys": keys, "models": models }), &[201])
}

pub fn update_pool(
    connection: &AmkrConnection,
    config_revision: &str,
    provider_id: &str,
    pool_name: &str,
    name: &str,
    keys: Vec<String>,
    models: Vec<String>,
) -> Result<(), String> {
    request_empty(
        connection,
        "PUT",
        &format!(
            "/api/providers/{}/pools/{}",
            encode_path_segment(provider_id),
            encode_path_segment(pool_name)
        ),
        "更新模型池",
        serde_json::json!({
            "config_revision": config_revision,
            "name": name,
            "keys": keys,
            "models": models,
        }),
        &[200],
    )
}

pub fn delete_pool(
    connection: &AmkrConnection,
    config_revision: &str,
    provider_id: &str,
    pool_name: &str,
) -> Result<(), String> {
    request_empty(
        connection,
        "DELETE",
        &format!(
            "/api/providers/{}/pools/{}",
            encode_path_segment(provider_id),
            encode_path_segment(pool_name)
        ),
        "删除模型池",
        serde_json::json!({ "config_revision": config_revision }),
        &[204],
    )
}

pub fn create_route(connection: &AmkrConnection, config_revision: &str, id: &str, provider: &str, pool: &str, upstream_model: &str, aliases: Vec<String>, routing_mode: Option<String>) -> Result<(), String> {
    request_empty(connection, "POST", "/api/routes", "创建模型路由", serde_json::json!({ "config_revision": config_revision, "id": id, "targets": [{ "provider": provider, "pool": pool, "upstream_model": upstream_model }], "aliases": aliases, "routing_mode": routing_mode }), &[201])
}

pub fn export_config(connection: &AmkrConnection) -> Result<AmkrConfigTransfer, String> { request_json(connection, "POST", "/api/config/export", "导出配置", None, &[200]) }
pub fn import_config(connection: &AmkrConnection, config_revision: &str, config: serde_json::Value) -> Result<AmkrConfigTransfer, String> { request_json(connection, "POST", "/api/config/import", "导入配置", Some(serde_json::json!({"config_revision": config_revision, "config": config})), &[200]) }

pub fn delete_route(connection: &AmkrConnection, config_revision: &str, id: &str) -> Result<(), String> {
    request_empty(connection, "DELETE", &format!("/api/routes/{}", encode_path_segment(id)), "删除模型路由", serde_json::json!({ "config_revision": config_revision }), &[204])
}

pub fn update_route(
    connection: &AmkrConnection,
    config_revision: &str,
    route_id: &str,
    id: &str,
    targets: Vec<AmkrRouteTarget>,
    aliases: Vec<String>,
    routing_mode: Option<String>,
) -> Result<(), String> {
    request_empty(
        connection,
        "PUT",
        &format!("/api/routes/{}", encode_path_segment(route_id)),
        "更新模型路由",
        serde_json::json!({
            "config_revision": config_revision,
            "id": id,
            "targets": targets,
            "aliases": aliases,
            "routing_mode": routing_mode,
        }),
        &[200],
    )
}

fn encode_path_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push(char::from(HEX[(byte >> 4) as usize]));
            encoded.push(char::from(HEX[(byte & 0x0f) as usize]));
        }
    }
    encoded
}

fn get_json<T: DeserializeOwned>(
    connection: &AmkrConnection,
    path: &str,
    label: &str,
) -> Result<T, String> {
    request_json(connection, "GET", path, label, None, &[200])
}

fn request_empty(connection: &AmkrConnection, method: &str, path: &str, label: &str, payload: serde_json::Value, success_statuses: &[u16]) -> Result<(), String> {
    let _: serde_json::Value = request_json(connection, method, path, label, Some(payload), success_statuses)?;
    Ok(())
}

fn request_json<T: DeserializeOwned>(
    connection: &AmkrConnection,
    method: &str,
    path: &str,
    label: &str,
    payload: Option<serde_json::Value>,
    success_statuses: &[u16],
) -> Result<T, String> {
    let authority = connection
        .base_url
        .strip_prefix("http://")
        .ok_or_else(|| "AMKR 服务地址必须使用本地 HTTP".to_owned())?;
    let address = authority
        .to_socket_addrs()
        .map_err(|error| format!("无法解析 AMKR 服务地址: {error}"))?
        .next()
        .ok_or_else(|| "无法解析 AMKR 服务地址".to_owned())?;
    let timeout = Duration::from_secs(2);
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("无法连接 AMKR 服务: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("无法设置 AMKR 读取超时: {error}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| format!("无法设置 AMKR 写入超时: {error}"))?;

    let authorization = connection
        .local_api_key
        .as_deref()
        .filter(|key| !key.is_empty())
        .map(|key| format!("Authorization: Bearer {key}\r\n"))
        .unwrap_or_default();
    let body = payload
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|error| format!("无法序列化 AMKR {label} 请求: {error}"))?;
    let content_headers = body
        .as_ref()
        .map(|value| format!("Content-Type: application/json\r\nContent-Length: {}\r\n", value.len()))
        .unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {authority}\r\n{authorization}{content_headers}Connection: close\r\n\r\n{}",
        body.as_deref().unwrap_or_default(),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("无法请求 AMKR {label}: {error}"))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("无法读取 AMKR {label}: {error}"))?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| format!("AMKR {label} 响应格式无效"))?;
    let status_code = headers
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok());
    if !status_code.is_some_and(|status| success_statuses.contains(&status)) {
        let detail = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| value.get("detail")?.as_str().map(str::to_owned));
        let status = status_code
            .map(|status| status.to_string())
            .unwrap_or_else(|| "未知".to_owned());
        return Err(match detail {
            Some(detail) => format!("AMKR {label} 请求失败（HTTP {status}）: {detail}"),
            None => format!("AMKR {label} 请求失败（HTTP {status}）"),
        });
    }

    if body.trim().is_empty() {
        return serde_json::from_value(serde_json::Value::Null)
            .map_err(|error| format!("AMKR {label} 响应为空: {error}"));
    }
    serde_json::from_str(body).map_err(|error| format!("AMKR {label} 响应不是有效 JSON: {error}"))
}
