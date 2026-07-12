use std::fmt;
use std::fs;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, PartialEq, Eq)]
pub struct AmkrConnection {
    pub base_url: String,
    pub local_api_key: Option<String>,
    pub metrics_db_path: Option<String>,
    pub log_file_path: Option<String>,
}

#[derive(Debug)]
pub enum DiscoveryError {
    Read(std::io::Error),
    Parse(serde_json::Error),
}

impl fmt::Display for DiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
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

#[cfg(test)]
mod discovery_tests;
