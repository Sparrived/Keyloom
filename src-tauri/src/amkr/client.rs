use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};

use super::AmkrConnection;

#[derive(Debug, Default, Serialize)]
pub struct AmkrNativeEndpointSummary {
    pub supported: u64,
    pub fallback: u64,
    pub unknown: u64,
}

fn deserialize_native_endpoint_summary<'de, D>(
    deserializer: D,
) -> Result<Option<AmkrNativeEndpointSummary>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    let Some(states) = value.as_object() else {
        return Ok(None);
    };
    let mut summary = AmkrNativeEndpointSummary::default();
    for state in states.values() {
        let supported = match state {
            serde_json::Value::Bool(value) => Some(*value),
            serde_json::Value::Object(value) => {
                value.get("supported").and_then(serde_json::Value::as_bool)
            }
            _ => None,
        };
        match supported {
            Some(true) => summary.supported += 1,
            Some(false) => summary.fallback += 1,
            None => summary.unknown += 1,
        }
    }
    Ok(Some(summary))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrHealth {
    pub status: String,
    #[serde(default)]
    pub version: Option<String>,
    pub local_auth_enabled: bool,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub config_path: Option<String>,
    #[serde(default)]
    pub local_api_key_fingerprint: Option<String>,
    #[serde(default)]
    pub visitor_feature_installed: bool,
    #[serde(default)]
    pub visitor_access_enabled: bool,
    #[serde(default)]
    pub visitor_key_count: u64,
    #[serde(
        default,
        deserialize_with = "deserialize_native_endpoint_summary",
        rename(
            deserialize = "native_endpoint_states",
            serialize = "native_endpoint_summary"
        ),
        skip_serializing_if = "Option::is_none"
    )]
    pub native_endpoint_summary: Option<AmkrNativeEndpointSummary>,
    #[serde(default)]
    pub unified_model: Option<AmkrUnifiedModel>,
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
    #[serde(default)]
    pub current_rpm: u64,
    #[serde(default)]
    pub current_tpm: u64,
    #[serde(default)]
    pub router_status: Option<String>,
    #[serde(default)]
    pub active_requests: u64,
    #[serde(default)]
    pub caller_types: BTreeMap<String, AmkrUsageStats>,
    #[serde(default)]
    pub models: BTreeMap<String, AmkrUsageStats>,
    #[serde(default)]
    pub keys: BTreeMap<String, BTreeMap<String, AmkrUsageStats>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrSettings {
    pub host: String,
    pub port: u16,
    pub request_timeout: f64,
    pub stream_first_byte_timeout: f64,
    pub stream_idle_timeout: f64,
    pub max_retries: u32,
    pub local_auth_enabled: bool,
    pub local_api_key_fingerprint: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrSettingsResponse {
    pub config_revision: String,
    pub settings: AmkrSettings,
}

#[derive(Debug, Serialize)]
pub struct AmkrSettingsUpdate {
    pub config_revision: String,
    pub host: String,
    pub port: u16,
    pub request_timeout: f64,
    pub stream_first_byte_timeout: f64,
    pub stream_idle_timeout: f64,
    pub max_retries: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrLocalApiKeyResponse {
    pub config_revision: String,
    pub local_api_key: String,
    pub local_api_key_fingerprint: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrUpdateCheck {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: Option<String>,
    pub source: Option<String>,
    pub artifact_url: Option<String>,
    pub artifact_sha256: Option<String>,
    pub update_available: bool,
    pub error: Option<String>,
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
    #[serde(default)]
    pub routes: BTreeMap<String, String>,
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
    #[serde(default)]
    pub targets: Vec<AmkrRouteTarget>,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub routing_mode: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrModelKey {
    pub name: String,
    #[serde(default)]
    pub base_url: Option<String>,
    pub enabled: bool,
    pub allow_visitor: bool,
    pub api_key_fingerprint: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrModel {
    pub id: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub routing_mode: String,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    pub visitor_available: bool,
    #[serde(default)]
    pub keys: Vec<AmkrModelKey>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrModelsResponse {
    #[serde(default)]
    pub models: Vec<AmkrModel>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrUnifiedTarget {
    pub model: String,
    #[serde(default)]
    pub key: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrUnifiedPlan {
    pub primary: AmkrUnifiedTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<AmkrUnifiedTarget>,
}

#[derive(Debug, Serialize)]
pub struct AmkrUnifiedModel {
    pub default: AmkrUnifiedPlan,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<AmkrUnifiedPlan>,
}

impl<'de> Deserialize<'de> for AmkrUnifiedModel {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RawUnifiedModel {
            #[serde(default)]
            default: Option<AmkrUnifiedPlan>,
            #[serde(default)]
            image: Option<AmkrUnifiedPlan>,
            #[serde(default)]
            model: Option<String>,
            #[serde(default)]
            key: Option<String>,
            #[serde(default)]
            image_model: Option<String>,
            #[serde(default)]
            image_key: Option<String>,
        }

        let raw = RawUnifiedModel::deserialize(deserializer)?;
        if let Some(default) = raw.default {
            return Ok(Self {
                default,
                image: raw.image,
            });
        }
        let model = raw
            .model
            .ok_or_else(|| serde::de::Error::custom("统一模型缺少 default 或 model"))?;
        Ok(Self {
            default: AmkrUnifiedPlan {
                primary: AmkrUnifiedTarget {
                    model,
                    key: raw.key,
                },
                fallback: None,
            },
            image: raw.image_model.map(|model| AmkrUnifiedPlan {
                primary: AmkrUnifiedTarget {
                    model,
                    key: raw.image_key,
                },
                fallback: None,
            }),
        })
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrUnifiedModelResponse {
    #[serde(default)]
    pub unified_model: Option<AmkrUnifiedModel>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrRoutesResponse {
    pub config_revision: String,
    pub routes: Vec<AmkrRoute>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrConfigExport {
    pub config_revision: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrConfigImportResult {
    pub config_revision: String,
    pub imported: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrProbeStart {
    pub probe_id: String,
    pub status: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrProbeResult {
    pub status: String,
    pub provider: String,
    pub key: String,
    pub endpoint: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub latency_ms: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AmkrProbe {
    pub probe_id: String,
    pub status: String,
    pub provider: String,
    #[serde(default)]
    pub results: Vec<AmkrProbeResult>,
    #[serde(default)]
    pub error: Option<String>,
}

pub fn get_health(connection: &AmkrConnection) -> Result<AmkrHealth, String> {
    get_json(connection, "/health", "健康状态")
}

pub fn get_metrics(connection: &AmkrConnection) -> Result<AmkrMetrics, String> {
    get_json(connection, "/metrics?hours=1", "指标")
}

pub fn get_settings(connection: &AmkrConnection) -> Result<AmkrSettingsResponse, String> {
    get_json(connection, "/api/settings", "设置")
}

pub fn update_settings(
    connection: &AmkrConnection,
    settings: &AmkrSettingsUpdate,
) -> Result<AmkrSettingsResponse, String> {
    request_json(
        connection,
        "PUT",
        "/api/settings",
        "更新设置",
        Some(
            serde_json::to_value(settings)
                .map_err(|error| format!("无法序列化 AMKR 设置: {error}"))?,
        ),
        &[200],
    )
}

pub fn regenerate_local_api_key(
    connection: &AmkrConnection,
    config_revision: &str,
) -> Result<AmkrLocalApiKeyResponse, String> {
    request_json(
        connection,
        "POST",
        "/api/settings/local-api-key",
        "重置本地鉴权",
        Some(serde_json::json!({ "config_revision": config_revision })),
        &[200],
    )
}

pub fn check_update(connection: &AmkrConnection) -> Result<AmkrUpdateCheck, String> {
    request_json(
        connection,
        "POST",
        "/api/update/check",
        "检查更新",
        None,
        &[200],
    )
}

pub fn get_providers(connection: &AmkrConnection) -> Result<AmkrProvidersResponse, String> {
    get_json(connection, "/api/providers", "供应商")
}

pub fn get_routes(connection: &AmkrConnection) -> Result<AmkrRoutesResponse, String> {
    get_json(connection, "/api/routes", "模型路由")
}

pub fn get_models(connection: &AmkrConnection) -> Result<AmkrModelsResponse, String> {
    get_json(connection, "/api/models", "模型")
}

pub fn update_model_reasoning_effort(
    connection: &AmkrConnection,
    model_id: &str,
    reasoning_effort: Option<&str>,
) -> Result<AmkrModel, String> {
    request_json(
        connection,
        "PUT",
        &format!("/api/models/{}", encode_path_segment(model_id)),
        "更新模型推理强度",
        Some(serde_json::json!({ "reasoning_effort": reasoning_effort })),
        &[200],
    )
}

pub fn get_unified_model(connection: &AmkrConnection) -> Result<AmkrUnifiedModelResponse, String> {
    get_json(connection, "/api/unified-model", "统一模型")
}

pub fn update_unified_model(
    connection: &AmkrConnection,
    unified_model: &AmkrUnifiedModel,
) -> Result<AmkrUnifiedModelResponse, String> {
    let primary = &unified_model.default.primary;
    let payload = if unified_model.default.fallback.is_some()
        || unified_model
            .image
            .as_ref()
            .is_some_and(|plan| plan.fallback.is_some())
    {
        serde_json::json!({
            "default": unified_model.default,
            "image": unified_model.image,
        })
    } else {
        let mut payload = serde_json::json!({
            "model": primary.model,
            "key": primary.key,
        });
        if let Some(image) = &unified_model.image {
            payload["image_model"] = serde_json::Value::String(image.primary.model.clone());
            payload["image_key"] = image
                .primary
                .key
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null);
        } else {
            payload["image_model"] = serde_json::Value::Null;
            payload["image_key"] = serde_json::Value::Null;
        }
        payload
    };
    request_json(
        connection,
        "PUT",
        "/api/unified-model",
        "更新统一模型",
        Some(payload),
        &[200],
    )
}

pub fn delete_unified_model(connection: &AmkrConnection) -> Result<(), String> {
    let _: serde_json::Value = request_json(
        connection,
        "DELETE",
        "/api/unified-model",
        "停用统一模型",
        None,
        &[204],
    )?;
    Ok(())
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
    routes: BTreeMap<String, String>,
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
            "routes": routes,
        }),
        &[200],
    )
}

pub fn delete_provider(
    connection: &AmkrConnection,
    config_revision: &str,
    id: &str,
) -> Result<(), String> {
    request_empty(
        connection,
        "DELETE",
        &format!("/api/providers/{}", encode_path_segment(id)),
        "删除供应商",
        serde_json::json!({ "config_revision": config_revision }),
        &[204],
    )
}

pub fn create_provider_key(
    connection: &AmkrConnection,
    config_revision: &str,
    provider_id: &str,
    name: &str,
    api_key: &str,
    allow_visitor: bool,
) -> Result<(), String> {
    request_empty(
        connection,
        "POST",
        &format!("/api/providers/{}/keys", encode_path_segment(provider_id)),
        "创建 Key",
        serde_json::json!({ "config_revision": config_revision, "name": name, "api_key": api_key, "allow_visitor": allow_visitor }),
        &[201],
    )
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

pub fn create_pool(
    connection: &AmkrConnection,
    config_revision: &str,
    provider_id: &str,
    name: &str,
    keys: Vec<String>,
    models: Vec<String>,
) -> Result<(), String> {
    request_empty(
        connection,
        "POST",
        &format!("/api/providers/{}/pools", encode_path_segment(provider_id)),
        "创建模型池",
        serde_json::json!({ "config_revision": config_revision, "name": name, "keys": keys, "models": models }),
        &[201],
    )
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

pub fn create_route(
    connection: &AmkrConnection,
    config_revision: &str,
    aliases: Vec<String>,
    routing_mode: Option<String>,
) -> Result<(), String> {
    request_empty(
        connection,
        "POST",
        "/api/routes",
        "创建模型路由",
        serde_json::json!({
            "config_revision": config_revision,
            "aliases": aliases,
            "routing_mode": routing_mode
        }),
        &[201],
    )
}

pub fn export_config(connection: &AmkrConnection) -> Result<AmkrConfigExport, String> {
    request_json(
        connection,
        "POST",
        "/api/config/export",
        "导出配置",
        None,
        &[200],
    )
}
pub fn import_config(
    connection: &AmkrConnection,
    config_revision: &str,
    config: serde_json::Value,
) -> Result<AmkrConfigImportResult, String> {
    request_json(
        connection,
        "POST",
        "/api/config/import",
        "导入配置",
        Some(serde_json::json!({"config_revision": config_revision, "config": config})),
        &[200],
    )
}

pub fn probe_keys(
    connection: &AmkrConnection,
    provider_id: &str,
    keys: Vec<String>,
    timeout_seconds: f64,
) -> Result<AmkrProbeStart, String> {
    request_json(
        connection,
        "POST",
        "/api/probes/keys",
        "探测 Key",
        Some(serde_json::json!({
            "provider_id": provider_id,
            "keys": keys,
            "timeout_seconds": timeout_seconds,
        })),
        &[202],
    )
}

pub fn probe_pools(
    connection: &AmkrConnection,
    provider_id: &str,
    pools: Vec<String>,
    timeout_seconds: f64,
) -> Result<AmkrProbeStart, String> {
    request_json(
        connection,
        "POST",
        "/api/probes/pools",
        "探测模型池",
        Some(serde_json::json!({
            "provider_id": provider_id,
            "pools": pools,
            "timeout_seconds": timeout_seconds,
        })),
        &[202],
    )
}

pub fn get_probe(connection: &AmkrConnection, probe_id: &str) -> Result<AmkrProbe, String> {
    get_json(
        connection,
        &format!("/api/probes/{}", encode_path_segment(probe_id)),
        "探测状态",
    )
}

pub fn cancel_probe(connection: &AmkrConnection, probe_id: &str) -> Result<AmkrProbe, String> {
    request_json(
        connection,
        "POST",
        &format!("/api/probes/{}/cancel", encode_path_segment(probe_id)),
        "取消探测",
        None,
        &[200],
    )
}

pub fn delete_route(
    connection: &AmkrConnection,
    config_revision: &str,
    id: &str,
) -> Result<(), String> {
    request_empty(
        connection,
        "DELETE",
        &format!("/api/routes/{}", encode_path_segment(id)),
        "删除模型路由",
        serde_json::json!({ "config_revision": config_revision }),
        &[204],
    )
}

pub fn update_route(
    connection: &AmkrConnection,
    config_revision: &str,
    route_id: &str,
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

fn request_empty(
    connection: &AmkrConnection,
    method: &str,
    path: &str,
    label: &str,
    payload: serde_json::Value,
    success_statuses: &[u16],
) -> Result<(), String> {
    let _: serde_json::Value = request_json(
        connection,
        method,
        path,
        label,
        Some(payload),
        success_statuses,
    )?;
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
        .map(|value| {
            format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                value.len()
            )
        })
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
