use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentIntegrationStatus {
    pub agent: String,
    pub display_name: String,
    pub target_path: String,
    pub target_exists: bool,
    pub backup_available: bool,
    pub current_is_applied: bool,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentOperation {
    Status,
    Configure,
    Rollback,
}

impl AgentOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::Configure => "configure",
            Self::Rollback => "rollback",
        }
    }
}

const AGENT_BRIDGE_SCRIPT: &str = r#"
import json
import sys
from pathlib import Path
from auto_model_key_router.agent_config import agent_display_name, configure_agent, get_agent_config_status, rollback_agent
from auto_model_key_router.config import RouterConfig

operation, agent, config_path, mode = sys.argv[1:5]
if operation == "configure":
    configure_agent(agent, RouterConfig.load(Path(config_path)), mode=mode)
elif operation == "rollback":
    rollback_agent(agent)
elif operation != "status":
    raise ValueError("unsupported integration operation")
status = get_agent_config_status(agent)
print(json.dumps({
    "agent": agent,
    "display_name": agent_display_name(agent),
    "target_path": str(status.target_path),
    "target_exists": status.target_path.is_file(),
    "backup_available": status.backup_available,
    "current_is_applied": status.current_is_applied,
    "mode": status.mode,
}, ensure_ascii=True))
"#;

#[derive(Debug, Deserialize)]
struct BackupState {
    agent: Option<String>,
    target_path: Option<String>,
    mode: Option<String>,
    version: Option<u64>,
    applied_sha256: Option<String>,
    extra_targets: Option<Vec<ExtraBackupState>>,
}

#[derive(Debug, Deserialize)]
struct ExtraBackupState {
    target_path: Option<String>,
    applied_sha256: Option<String>,
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

fn backup_mode(state: &BackupState) -> Option<String> {
    match state.mode.as_deref() {
        Some("native" | "unified-model") => state.mode.clone(),
        None if state.version == Some(1) => Some("unified-model".to_owned()),
        _ => None,
    }
}

fn file_matches_hash(path: &Path, expected_sha256: Option<&String>) -> bool {
    let Some(expected_sha256) = expected_sha256 else {
        return false;
    };
    fs::read(path)
        .map(|content| format!("{:x}", Sha256::digest(content)) == *expected_sha256)
        .unwrap_or(false)
}

fn extra_targets_are_applied(state: &BackupState) -> bool {
    let Some(extra_targets) = &state.extra_targets else {
        return true;
    };
    extra_targets.iter().all(|target| {
        let Some(path) = target.target_path.as_deref() else {
            return false;
        };
        file_matches_hash(Path::new(path), target.applied_sha256.as_ref())
    })
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
    let display_name = agent_display_name(agent).ok_or_else(|| format!("不支持的集成: {agent}"))?;
    let mut backup_available = false;
    let mut mode = None;
    let mut current_is_applied = false;
    if let Ok(raw) = fs::read_to_string(backup) {
        if let Ok(state) = serde_json::from_str::<BackupState>(&raw) {
            let target_text = target.to_string_lossy();
            let target_matches = state.target_path.as_deref() == Some(target_text.as_ref());
            if state.agent.as_deref() == Some(agent) && target_matches {
                backup_available = true;
                current_is_applied = target.is_file()
                    && file_matches_hash(target, state.applied_sha256.as_ref())
                    && extra_targets_are_applied(&state);
                if current_is_applied {
                    mode = backup_mode(&state);
                }
            }
        }
    }
    Ok(AgentIntegrationStatus {
        agent: agent.to_owned(),
        display_name: display_name.to_owned(),
        target_path: target.to_string_lossy().into_owned(),
        target_exists: target.is_file(),
        backup_available,
        current_is_applied,
        mode,
    })
}

fn agent_bridge_arguments(
    operation: AgentOperation,
    agent: &str,
    config_path: Option<&Path>,
    mode: Option<&str>,
) -> Result<Vec<String>, String> {
    agent_display_name(agent).ok_or_else(|| format!("不支持的集成: {agent}"))?;
    if operation == AgentOperation::Configure {
        if !matches!(mode, Some("native" | "unified-model")) {
            return Err("集成模式必须是 native 或 unified-model".to_owned());
        }
        if config_path.is_none() {
            return Err("应用集成时必须指定 AMKR 配置路径".to_owned());
        }
    }
    Ok(vec![
        "-I".to_owned(),
        "-c".to_owned(),
        AGENT_BRIDGE_SCRIPT.to_owned(),
        operation.as_str().to_owned(),
        agent.to_owned(),
        config_path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        mode.unwrap_or_default().to_owned(),
    ])
}

fn parse_agent_bridge_output(
    exit_code: i32,
    stdout: &str,
    stderr: &str,
) -> Result<AgentIntegrationStatus, String> {
    if exit_code != 0 {
        let line = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("未知错误")
            .trim();
        let diagnostic = line
            .rsplit_once(": ")
            .map(|(_, message)| message)
            .unwrap_or(line);
        return Err(format!(
            "AMKR 集成操作失败: {}",
            diagnostic.chars().take(400).collect::<String>()
        ));
    }
    let payload = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "AMKR 集成操作没有返回状态".to_owned())?;
    serde_json::from_str(payload).map_err(|_| "AMKR 集成状态响应无效".to_owned())
}

fn run_agent_operation(
    python: &Path,
    operation: AgentOperation,
    agent: &str,
    config_path: Option<&Path>,
    mode: Option<&str>,
) -> Result<AgentIntegrationStatus, String> {
    let arguments = agent_bridge_arguments(operation, agent, config_path, mode)?;
    let output = hidden_command(python)
        .args(arguments)
        .output()
        .map_err(|error| format!("无法启动 AMKR 工具环境: {error}"))?;
    parse_agent_bridge_output(
        output.status.code().unwrap_or(-1),
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    )
}

pub fn get_agent_status_with_runtime(
    python: &Path,
    agent: &str,
) -> Result<AgentIntegrationStatus, String> {
    run_agent_operation(python, AgentOperation::Status, agent, None, None)
}

pub fn configure_agent_with_runtime(
    python: &Path,
    config_path: &Path,
    agent: &str,
    mode: &str,
) -> Result<AgentIntegrationStatus, String> {
    run_agent_operation(
        python,
        AgentOperation::Configure,
        agent,
        Some(config_path),
        Some(mode),
    )
}

pub fn rollback_agent_with_runtime(
    python: &Path,
    agent: &str,
) -> Result<AgentIntegrationStatus, String> {
    run_agent_operation(python, AgentOperation::Rollback, agent, None, None)
}

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use sha2::Digest;

    use super::{
        agent_bridge_arguments, get_agent_status_from_paths, parse_agent_bridge_output,
        AgentOperation,
    };

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
                r#"{{"version":2,"agent":"claude-code","target_path":{:?},"mode":"unified-model","applied_sha256":"{:x}","local_api_key":"secret"}}"#,
                target.to_string_lossy(),
                sha2::Sha256::digest(fs::read(&target).unwrap())
            ),
        )
        .unwrap();
        let managed = get_agent_status_from_paths("claude-code", &target, &backup).unwrap();
        assert!(managed.backup_available);
        assert!(managed.current_is_applied);
        assert_eq!(managed.mode.as_deref(), Some("unified-model"));
        assert!(!serde_json::to_string(&managed).unwrap().contains("secret"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_unmanaged_when_applied_hashes_do_not_match() {
        let root = std::env::temp_dir().join("keyloom-agent-status-hash-mismatch");
        let target = root.join("config.toml");
        let auth = root.join("auth.json");
        let backup = root.join("codex.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&target, b"model_provider = \"OpenAI\"\n").unwrap();
        fs::write(&auth, b"{\"OPENAI_API_KEY\":\"managed\"}\n").unwrap();

        fs::write(
            &backup,
            format!(
                r#"{{"version":2,"agent":"codex","target_path":{:?},"mode":"native","applied_sha256":"{:x}","extra_targets":[{{"target_path":{:?},"applied_sha256":"bad"}}]}}"#,
                target.to_string_lossy(),
                sha2::Sha256::digest(fs::read(&target).unwrap()),
                auth.to_string_lossy()
            ),
        )
        .unwrap();

        let status = get_agent_status_from_paths("codex", &target, &backup).unwrap();
        assert!(status.backup_available);
        assert!(!status.current_is_applied);
        assert_eq!(status.mode, None);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_legacy_matching_backup_as_unified_model_mode() {
        let root = std::env::temp_dir().join("keyloom-agent-status-legacy");
        let target = root.join("config.toml");
        let backup = root.join("codex.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&target, b"model = \"router/unified\"\n").unwrap();

        fs::write(
            &backup,
            format!(
                r#"{{"version":1,"agent":"codex","target_path":{:?},"applied_sha256":"{:x}"}}"#,
                target.to_string_lossy(),
                sha2::Sha256::digest(fs::read(&target).unwrap())
            ),
        )
        .unwrap();

        let status = get_agent_status_from_paths("codex", &target, &backup).unwrap();
        assert!(status.current_is_applied);
        assert_eq!(status.mode.as_deref(), Some("unified-model"));

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

    #[test]
    fn builds_a_tool_environment_bridge_command_without_configuration_secrets() {
        let arguments = agent_bridge_arguments(
            AgentOperation::Configure,
            "claude-code",
            Some(Path::new("C:/AMKR/router-config.json")),
            Some("native"),
        )
        .unwrap();

        assert_eq!(arguments[0..2], ["-I", "-c"]);
        assert_eq!(
            arguments[3..],
            [
                "configure",
                "claude-code",
                "C:/AMKR/router-config.json",
                "native"
            ]
        );
        assert!(arguments[2].contains("configure_agent"));
        assert!(!arguments.join(" ").contains("local-api-key"));
    }

    #[test]
    fn parses_only_the_safe_status_line_and_keeps_actionable_errors() {
        let status = parse_agent_bridge_output(
            0,
            "warning\n{\"agent\":\"codex\",\"display_name\":\"Codex\",\"target_path\":\"C:/Users/test/.codex/config.toml\",\"target_exists\":true,\"backup_available\":true,\"current_is_applied\":true,\"mode\":\"unified-model\",\"local_api_key\":\"secret\"}\n",
            "",
        )
        .unwrap();

        assert!(status.current_is_applied);
        assert_eq!(status.mode.as_deref(), Some("unified-model"));
        assert!(!serde_json::to_string(&status).unwrap().contains("secret"));

        let error = parse_agent_bridge_output(
            1,
            "",
            "Traceback omitted\nauto_model_key_router.agent_config.AgentConfigError: 请先配置 unified-model",
        )
        .unwrap_err();
        assert_eq!(error, "AMKR 集成操作失败: 请先配置 unified-model");
    }
}
