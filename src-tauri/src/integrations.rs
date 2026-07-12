use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct AgentIntegrationStatus {
    pub agent: String,
    pub display_name: String,
    pub target_path: String,
    pub target_exists: bool,
    pub backup_available: bool,
    pub mode: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BackupState {
    agent: Option<String>,
    target_path: Option<String>,
    mode: Option<String>,
}

fn agent_display_name(agent: &str) -> Option<&'static str> {
    match agent {
        "claude-code" => Some("Claude Code"),
        "codex" => Some("Codex"),
        _ => None,
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn target_path(agent: &str) -> Result<PathBuf, String> {
    agent_display_name(agent).ok_or_else(|| format!("不支持的集成: {agent}"))?;
    match agent {
        "claude-code" => Ok(std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join(".claude"))
            .join("settings.json")),
        "codex" => Ok(std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join(".codex"))
            .join("config.toml")),
        _ => unreachable!(),
    }
}

fn default_backup_path(agent: &str) -> Result<PathBuf, String> {
    agent_display_name(agent).ok_or_else(|| format!("不支持的集成: {agent}"))?;
    let root = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join("AppData").join("Local"));
    Ok(root
        .join("AutoModelKeyRouter")
        .join("agent-config-backups")
        .join(format!("{agent}.json")))
}

pub fn get_agent_status(agent: &str) -> Result<AgentIntegrationStatus, String> {
    let target = target_path(agent)?;
    let backup = default_backup_path(agent)?;
    get_agent_status_from_paths(agent, &target, &backup)
}

pub fn get_agent_status_from_paths(
    agent: &str,
    target: &Path,
    backup: &Path,
) -> Result<AgentIntegrationStatus, String> {
    let display_name = agent_display_name(agent)
        .ok_or_else(|| format!("不支持的集成: {agent}"))?;
    let mut backup_available = false;
    let mut mode = None;
    if let Ok(raw) = fs::read_to_string(backup) {
        if let Ok(state) = serde_json::from_str::<BackupState>(&raw) {
            let target_text = target.to_string_lossy();
            let target_matches = state.target_path.as_deref() == Some(target_text.as_ref());
            if state.agent.as_deref() == Some(agent) && target_matches {
                backup_available = true;
                mode = state.mode;
            }
        }
    }
    Ok(AgentIntegrationStatus {
        agent: agent.to_owned(),
        display_name: display_name.to_owned(),
        target_path: target.to_string_lossy().into_owned(),
        target_exists: target.is_file(),
        backup_available,
        mode,
    })
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use super::get_agent_status_from_paths;

    #[test]
    fn reports_unmanaged_and_managed_agent_config_without_secrets() {
        let root = std::env::temp_dir().join("keyloom-agent-status");
        let target = root.join("settings.json");
        let backup = root.join("claude-code.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&target, br#"{"env":{"ANTHROPIC_AUTH_TOKEN":"secret"}}"#).unwrap();

        let unmanaged = get_agent_status_from_paths("claude-code", &target, &backup).unwrap();
        assert!(unmanaged.target_exists);
        assert!(!unmanaged.backup_available);

        fs::write(
            &backup,
            format!(
                r#"{{"agent":"claude-code","target_path":{:?},"mode":"unified-model","local_api_key":"secret"}}"#,
                target.to_string_lossy()
            ),
        )
        .unwrap();
        let managed = get_agent_status_from_paths("claude-code", &target, &backup).unwrap();
        assert!(managed.backup_available);
        assert_eq!(managed.mode.as_deref(), Some("unified-model"));
        assert!(!serde_json::to_string(&managed).unwrap().contains("secret"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unknown_agent_names() {
        let error = get_agent_status_from_paths(
            "unknown",
            Path::new("target.json"),
            Path::new("backup.json"),
        )
        .unwrap_err();
        assert!(error.contains("不支持的集成"));
    }
}
