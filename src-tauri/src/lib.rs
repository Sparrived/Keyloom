pub mod amkr;
pub mod tray;
pub mod windows_service;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct AmkrMetadata {
    pub config_path: String,
    pub base_url: String,
    pub metrics_db_path: Option<String>,
    pub log_file_path: Option<String>,
    pub auth_enabled: bool,
}

pub fn default_config_path() -> PathBuf {
    let root = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .map(|home| home.join("AppData").join("Local"))
        })
        .unwrap_or_else(|| PathBuf::from("."));

    root.join("AutoModelKeyRouter").join("router-config.json")
}

pub fn discover_amkr(selected_path: Option<&Path>) -> Result<AmkrMetadata, String> {
    let default_path = default_config_path();
    discover_amkr_from_paths(selected_path, &default_path)
}

pub fn discover_amkr_from_paths(
    selected_path: Option<&Path>,
    default_path: &Path,
) -> Result<AmkrMetadata, String> {
    let instance = amkr::discover_from_paths(selected_path, default_path)
        .map_err(|error| error.to_string())?;

    Ok(AmkrMetadata {
        config_path: instance.config_path.to_string_lossy().into_owned(),
        base_url: instance.connection.base_url,
        metrics_db_path: instance.connection.metrics_db_path,
        log_file_path: instance.connection.log_file_path,
        auth_enabled: instance.connection.local_api_key.is_some(),
    })
}

pub fn get_amkr_health(
    selected_path: Option<&Path>,
) -> Result<amkr::client::AmkrHealth, String> {
    let default_path = default_config_path();
    get_amkr_health_from_paths(selected_path, &default_path)
}

pub fn get_amkr_health_from_paths(
    selected_path: Option<&Path>,
    default_path: &Path,
) -> Result<amkr::client::AmkrHealth, String> {
    let instance = amkr::discover_from_paths(selected_path, default_path)
        .map_err(|error| error.to_string())?;
    amkr::client::get_health(&instance.connection)
}

pub fn get_amkr_metrics(
    selected_path: Option<&Path>,
) -> Result<amkr::client::AmkrMetrics, String> {
    let default_path = default_config_path();
    get_amkr_metrics_from_paths(selected_path, &default_path)
}

pub fn get_amkr_providers(
    selected_path: Option<&Path>,
) -> Result<amkr::client::AmkrProvidersResponse, String> {
    let default_path = default_config_path();
    let instance = amkr::discover_from_paths(selected_path, &default_path)
        .map_err(|error| error.to_string())?;
    amkr::client::get_providers(&instance.connection)
}

pub fn get_amkr_routes(
    selected_path: Option<&Path>,
) -> Result<amkr::client::AmkrRoutesResponse, String> {
    let default_path = default_config_path();
    let instance = amkr::discover_from_paths(selected_path, &default_path)
        .map_err(|error| error.to_string())?;
    amkr::client::get_routes(&instance.connection)
}

pub fn get_amkr_models(
    selected_path: Option<&Path>,
) -> Result<amkr::client::AmkrModelsResponse, String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path())
        .map_err(|error| error.to_string())?;
    amkr::client::get_models(&instance.connection)
}

pub fn get_amkr_unified_model(
    selected_path: Option<&Path>,
) -> Result<amkr::client::AmkrUnifiedModelResponse, String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path())
        .map_err(|error| error.to_string())?;
    amkr::client::get_unified_model(&instance.connection)
}

pub fn update_amkr_unified_model(
    selected_path: Option<&Path>,
    unified_model: &amkr::client::AmkrUnifiedModel,
) -> Result<amkr::client::AmkrUnifiedModelResponse, String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path())
        .map_err(|error| error.to_string())?;
    amkr::client::update_unified_model(&instance.connection, unified_model)
}

pub fn delete_amkr_unified_model(selected_path: Option<&Path>) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path())
        .map_err(|error| error.to_string())?;
    amkr::client::delete_unified_model(&instance.connection)
}

pub fn create_amkr_provider(selected_path: Option<&Path>, config_revision: &str, id: &str, base_url: &str) -> Result<amkr::client::AmkrProviderResponse, String> {
    let default_path = default_config_path();
    let instance = amkr::discover_from_paths(selected_path, &default_path).map_err(|error| error.to_string())?;
    amkr::client::create_provider(&instance.connection, config_revision, id, base_url)
}

pub fn update_amkr_provider(selected_path: Option<&Path>, config_revision: &str, provider_id: &str, id: &str, base_url: &str) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::update_provider(&instance.connection, config_revision, provider_id, id, base_url)
}

pub fn delete_amkr_provider(selected_path: Option<&Path>, config_revision: &str, id: &str) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::delete_provider(&instance.connection, config_revision, id)
}

pub fn create_amkr_provider_key(selected_path: Option<&Path>, config_revision: &str, provider_id: &str, name: &str, api_key: &str, allow_visitor: bool) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::create_provider_key(&instance.connection, config_revision, provider_id, name, api_key, allow_visitor)
}

pub fn update_amkr_provider_key(selected_path: Option<&Path>, config_revision: &str, provider_id: &str, key_name: &str, name: &str, api_key: Option<&str>, enabled: bool, allow_visitor: bool) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::update_provider_key(&instance.connection, config_revision, provider_id, key_name, name, api_key, enabled, allow_visitor)
}

pub fn delete_amkr_provider_key(selected_path: Option<&Path>, config_revision: &str, provider_id: &str, key_name: &str) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::delete_provider_key(&instance.connection, config_revision, provider_id, key_name)
}

pub fn create_amkr_pool(selected_path: Option<&Path>, config_revision: &str, provider_id: &str, name: &str, keys: Vec<String>, models: Vec<String>) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::create_pool(&instance.connection, config_revision, provider_id, name, keys, models)
}

pub fn update_amkr_pool(selected_path: Option<&Path>, config_revision: &str, provider_id: &str, pool_name: &str, name: &str, keys: Vec<String>, models: Vec<String>) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::update_pool(&instance.connection, config_revision, provider_id, pool_name, name, keys, models)
}

pub fn delete_amkr_pool(selected_path: Option<&Path>, config_revision: &str, provider_id: &str, pool_name: &str) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::delete_pool(&instance.connection, config_revision, provider_id, pool_name)
}

pub fn create_amkr_route(selected_path: Option<&Path>, config_revision: &str, id: &str, provider: &str, pool: &str, upstream_model: &str, aliases: Vec<String>, routing_mode: Option<String>) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::create_route(&instance.connection, config_revision, id, provider, pool, upstream_model, aliases, routing_mode)
}

pub fn update_amkr_route(selected_path: Option<&Path>, config_revision: &str, route_id: &str, id: &str, targets: Vec<amkr::client::AmkrRouteTarget>, aliases: Vec<String>, routing_mode: Option<String>) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::update_route(&instance.connection, config_revision, route_id, id, targets, aliases, routing_mode)
}

pub fn delete_amkr_route(selected_path: Option<&Path>, config_revision: &str, id: &str) -> Result<(), String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?;
    amkr::client::delete_route(&instance.connection, config_revision, id)
}

pub fn export_amkr_config(selected_path: Option<&Path>) -> Result<amkr::client::AmkrConfigExport, String> { let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?; amkr::client::export_config(&instance.connection) }
pub fn import_amkr_config(selected_path: Option<&Path>, config_revision: &str, config: serde_json::Value) -> Result<amkr::client::AmkrConfigImportResult, String> { let instance = amkr::discover_from_paths(selected_path, &default_config_path()).map_err(|error| error.to_string())?; amkr::client::import_config(&instance.connection, config_revision, config) }

pub fn probe_amkr_keys(
    selected_path: Option<&Path>,
    provider_id: &str,
    keys: Vec<String>,
    timeout_seconds: f64,
) -> Result<amkr::client::AmkrProbeStart, String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path())
        .map_err(|error| error.to_string())?;
    amkr::client::probe_keys(&instance.connection, provider_id, keys, timeout_seconds)
}

pub fn probe_amkr_pools(
    selected_path: Option<&Path>,
    provider_id: &str,
    pools: Vec<String>,
    timeout_seconds: f64,
) -> Result<amkr::client::AmkrProbeStart, String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path())
        .map_err(|error| error.to_string())?;
    amkr::client::probe_pools(&instance.connection, provider_id, pools, timeout_seconds)
}

pub fn get_amkr_probe(
    selected_path: Option<&Path>,
    probe_id: &str,
) -> Result<amkr::client::AmkrProbe, String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path())
        .map_err(|error| error.to_string())?;
    amkr::client::get_probe(&instance.connection, probe_id)
}

pub fn cancel_amkr_probe(
    selected_path: Option<&Path>,
    probe_id: &str,
) -> Result<amkr::client::AmkrProbe, String> {
    let instance = amkr::discover_from_paths(selected_path, &default_config_path())
        .map_err(|error| error.to_string())?;
    amkr::client::cancel_probe(&instance.connection, probe_id)
}

pub fn get_amkr_metrics_from_paths(
    selected_path: Option<&Path>,
    default_path: &Path,
) -> Result<amkr::client::AmkrMetrics, String> {
    let instance = amkr::discover_from_paths(selected_path, default_path)
        .map_err(|error| error.to_string())?;
    amkr::client::get_metrics(&instance.connection)
}

pub fn read_amkr_log_tail(selected_path: Option<&Path>) -> Result<String, String> {
    read_amkr_log_tail_from_paths(selected_path, &default_config_path())
}

pub fn read_amkr_log_tail_from_paths(selected_path: Option<&Path>, default_path: &Path) -> Result<String, String> {
    let instance = amkr::discover_from_paths(selected_path, default_path).map_err(|error| error.to_string())?;
    let log_path = instance.connection.log_file_path.ok_or_else(|| "AMKR 配置未指定日志文件".to_owned())?;
    let mut file = File::open(&log_path).map_err(|error| format!("无法读取 AMKR 日志: {error}"))?;
    let length = file.metadata().map_err(|error| format!("无法读取 AMKR 日志元数据: {error}"))?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(65_536))).map_err(|error| format!("无法定位 AMKR 日志: {error}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|error| format!("无法读取 AMKR 日志: {error}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn execute_amkr_service_from_paths<F>(
    action: windows_service::ServiceAction,
    selected_path: Option<&Path>,
    default_path: &Path,
    runner: F,
) -> Result<Vec<windows_service::TaskCommandResult>, String>
where
    F: FnMut(&[String]) -> Result<windows_service::TaskCommandResult, String>,
{
    let instance = amkr::discover_from_paths(selected_path, default_path)
        .map_err(|error| error.to_string())?;
    windows_service::execute_task_commands(
        action,
        Path::new("amkr"),
        &instance.config_path,
        runner,
    )
}

pub fn run_amkr_service(
    action: windows_service::ServiceAction,
    selected_path: Option<&Path>,
) -> Result<Vec<windows_service::TaskCommandResult>, String> {
    let default_path = default_config_path();
    let instance = amkr::discover_from_paths(selected_path, &default_path)
        .map_err(|error| error.to_string())?;
    windows_service::run_task_action(action, Path::new("amkr"), &instance.config_path)
}

#[cfg(test)]
mod host_tests;

#[cfg(test)]
mod tray_tests;

#[cfg(test)]
mod windows_service_tests;
