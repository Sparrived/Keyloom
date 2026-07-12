pub mod client;

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Debug, PartialEq, Eq)]
pub struct AmkrConnection {
    pub base_url: String,
    pub local_api_key: Option<String>,
    pub metrics_db_path: Option<String>,
    pub log_file_path: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct DiscoveredAmkr {
    pub config_path: PathBuf,
    pub connection: AmkrConnection,
}

#[derive(Debug)]
pub enum DiscoveryError {
    NotFound(PathBuf),
    Read(std::io::Error),
    Parse(serde_json::Error),
}

impl fmt::Display for DiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(path) => write!(formatter, "找不到 AMKR 配置: {}", path.display()),
            Self::Read(error) => write!(formatter, "无法读取 AMKR 配置: {error}"),
            Self::Parse(error) => write!(formatter, "AMKR 配置不是有效 JSON: {error}"),
        }
    }
}

impl std::error::Error for DiscoveryError {}

#[derive(Deserialize)]
struct RouterConfigFile {
    host: Option<String>,
    port: Option<u16>,
    local_api_key: Option<String>,
    metrics_db_path: Option<String>,
    log_file_path: Option<String>,
}

pub fn discover_from_config(path: &Path) -> Result<AmkrConnection, DiscoveryError> {
    let config: RouterConfigFile = serde_json::from_str(
        &fs::read_to_string(path).map_err(DiscoveryError::Read)?,
    )
    .map_err(DiscoveryError::Parse)?;

    let host = config.host.unwrap_or_else(|| "127.0.0.1".to_owned());
    let port = config.port.unwrap_or(8000);

    Ok(AmkrConnection {
        base_url: format!("http://{host}:{port}"),
        local_api_key: config.local_api_key.filter(|key| !key.is_empty()),
        metrics_db_path: config.metrics_db_path,
        log_file_path: config.log_file_path,
    })
}

pub fn discover_from_paths(
    selected_path: Option<&Path>,
    default_path: &Path,
) -> Result<DiscoveredAmkr, DiscoveryError> {
    let path = selected_path
        .filter(|path| path.is_file())
        .or_else(|| default_path.is_file().then_some(default_path))
        .ok_or_else(|| DiscoveryError::NotFound(default_path.to_path_buf()))?;

    Ok(DiscoveredAmkr {
        config_path: path.to_path_buf(),
        connection: discover_from_config(path)?,
    })
}

#[cfg(test)]
mod discovery_tests;

#[cfg(test)]
mod client_tests;
