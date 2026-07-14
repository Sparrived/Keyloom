use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::windows_service::ServiceProgram;

const PACKAGE: &str = "auto-model-key-router";
const REQUIREMENT: &str = "auto-model-key-router[visitor]";
const INITIALIZE_CONFIG_SCRIPT: &str = r#"
import sys
from pathlib import Path
from auto_model_key_router.config import RouterConfig

path = Path(sys.argv[1])
if path.exists():
    raise FileExistsError("staging config already exists")
RouterConfig.load(path)
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ToolInstallation {
    executable: PathBuf,
    python: Option<PathBuf>,
    manager: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AmkrToolStatus {
    pub installed: bool,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub manager: Option<String>,
    pub uv_available: bool,
    pub pipx_available: bool,
    pub diagnostic: Option<String>,
}

pub fn get_status() -> AmkrToolStatus {
    let uv_available = command_available("uv");
    let pipx_available = command_available("pipx");
    let installation = find_installation(uv_available, pipx_available);
    let version = installation
        .as_ref()
        .and_then(|tool| read_version(&tool.executable));
    let diagnostic = if installation.is_none() {
        Some(if uv_available || pipx_available {
            "未安装 AMKR；继续初始化时将自动安装".to_owned()
        } else {
            "未安装 AMKR，且未发现 uv 或 pipx；请先安装 uv".to_owned()
        })
    } else if version.is_none() {
        Some("已发现 AMKR，但无法读取版本".to_owned())
    } else {
        None
    };

    AmkrToolStatus {
        installed: installation.is_some(),
        executable: installation
            .as_ref()
            .map(|tool| tool.executable.to_string_lossy().into_owned()),
        version,
        manager: installation.map(|tool| tool.manager.to_owned()),
        uv_available,
        pipx_available,
        diagnostic,
    }
}

pub fn ensure_installed() -> Result<AmkrToolStatus, String> {
    let status = get_status();
    if status.installed {
        return Ok(status);
    }

    let (program, arguments, manager) = if status.uv_available {
        ("uv", vec!["tool", "install", REQUIREMENT], "uv")
    } else if status.pipx_available {
        ("pipx", vec!["install", REQUIREMENT], "pipx")
    } else {
        return Err("未发现 uv 或 pipx。请先安装 uv，再由 Keyloom 安装 AMKR。".to_owned());
    };
    let output = hidden_command(program)
        .args(&arguments)
        .output()
        .map_err(|error| format!("无法启动 {manager}: {error}"))?;
    ensure_success(output, &format!("通过 {manager} 安装 AMKR"))?;

    let installed = get_status();
    if installed.installed {
        Ok(installed)
    } else {
        Err(format!(
            "{manager} 已完成安装，但 Keyloom 未找到 amkr 可执行文件"
        ))
    }
}

pub fn update() -> Result<AmkrToolStatus, String> {
    let installation = require_installation()?;
    let (program, arguments) = match installation.manager {
        "uv" => ("uv", vec!["tool", "upgrade", PACKAGE]),
        "pipx" => ("pipx", vec!["upgrade", PACKAGE]),
        _ => return Err("当前 AMKR 不是由 uv 或 pipx 管理，无法从 Keyloom 执行更新".to_owned()),
    };
    let output = hidden_command(program)
        .args(&arguments)
        .output()
        .map_err(|error| format!("无法启动 {}: {error}", installation.manager))?;
    ensure_success(output, "更新 AMKR")?;
    Ok(get_status())
}

pub fn service_program() -> Result<ServiceProgram, String> {
    let installation = require_installation()?;
    Ok(ServiceProgram::executable(installation.executable))
}

pub fn python() -> Result<PathBuf, String> {
    require_installation()?
        .python
        .filter(|path| path.is_file())
        .ok_or_else(|| "无法定位 AMKR 工具环境中的 Python，Agent 集成功能不可用".to_owned())
}

pub fn initialize_config(config_path: &Path) -> Result<(), String> {
    if config_path.exists() {
        return Err("默认 AMKR 配置已存在，Keyloom 不会覆盖现有文件".to_owned());
    }
    ensure_installed()?;
    let python = python()?;
    initialize_config_with_runner(config_path, |arguments| {
        let status = hidden_command(&python)
            .args(arguments)
            .status()
            .map_err(|error| format!("无法启动 AMKR 工具环境: {error}"))?;
        Ok(status.code().unwrap_or(-1))
    })
}

fn initialize_config_with_runner<F>(config_path: &Path, runner: F) -> Result<(), String>
where
    F: FnOnce(&[String]) -> Result<i32, String>,
{
    if config_path.exists() {
        return Err("默认 AMKR 配置已存在，Keyloom 不会覆盖现有文件".to_owned());
    }
    let parent = config_path
        .parent()
        .ok_or_else(|| "默认 AMKR 配置路径无效".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建 AMKR 配置目录: {error}"))?;
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法创建配置事务标识: {error}"))?
        .as_nanos();
    let staging = parent.join(format!(
        ".keyloom-config-{}-{token}.tmp",
        std::process::id()
    ));
    let arguments = vec![
        "-I".to_owned(),
        "-c".to_owned(),
        INITIALIZE_CONFIG_SCRIPT.to_owned(),
        staging.to_string_lossy().into_owned(),
    ];

    let result = (|| {
        let exit_code = runner(&arguments)?;
        if exit_code != 0 {
            return Err(format!("AMKR 配置初始化失败（退出码 {exit_code}）"));
        }
        if !staging.is_file() {
            return Err("AMKR 配置初始化未生成配置文件".to_owned());
        }
        fs::hard_link(&staging, config_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "默认 AMKR 配置已被其他进程创建，Keyloom 未覆盖该文件".to_owned()
            } else {
                format!("无法原子发布 AMKR 配置: {error}")
            }
        })
    })();

    if staging.exists() {
        let _ = fs::remove_file(staging);
    }
    result
}

fn require_installation() -> Result<ToolInstallation, String> {
    let uv_available = command_available("uv");
    let pipx_available = command_available("pipx");
    find_installation(uv_available, pipx_available)
        .ok_or_else(|| "未找到 AMKR CLI，请先安装或在 Keyloom 中完成初始化".to_owned())
}

fn find_installation(uv_available: bool, pipx_available: bool) -> Option<ToolInstallation> {
    if uv_available {
        if let (Some(bin), Some(root)) = (
            command_path("uv", &["tool", "dir", "--bin"]),
            command_path("uv", &["tool", "dir"]),
        ) {
            if let (Some(executable), Some(python)) =
                (executable_in(&bin), environment_python(&root.join(PACKAGE)))
            {
                return Some(ToolInstallation {
                    executable,
                    python: Some(python),
                    manager: "uv",
                });
            }
        }
    }
    if pipx_available {
        if let (Some(bin), Some(root)) = (
            command_path("pipx", &["environment", "--value", "PIPX_BIN_DIR"]),
            command_path("pipx", &["environment", "--value", "PIPX_LOCAL_VENVS"]),
        ) {
            if let (Some(executable), Some(python)) =
                (executable_in(&bin), environment_python(&root.join(PACKAGE)))
            {
                return Some(ToolInstallation {
                    executable,
                    python: Some(python),
                    manager: "pipx",
                });
            }
        }
    }

    find_on_path().map(|executable| ToolInstallation {
        python: executable.parent().and_then(|directory| {
            [directory.join("python.exe"), directory.join("python")]
                .into_iter()
                .find(|path| path.is_file())
                .or_else(|| directory.parent().and_then(environment_python))
        }),
        executable,
        manager: "path",
    })
}

fn command_available(program: &str) -> bool {
    hidden_command(program)
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success())
}

fn command_path(program: &str, arguments: &[&str]) -> Option<PathBuf> {
    let output = hidden_command(program).args(arguments).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!value.is_empty()).then(|| PathBuf::from(value))
}

fn executable_in(directory: &Path) -> Option<PathBuf> {
    [
        "amkr.exe",
        "auto-model-key-router.exe",
        "amkr",
        "auto-model-key-router",
    ]
    .into_iter()
    .map(|name| directory.join(name))
    .find(|path| path.is_file())
}

fn environment_python(environment: &Path) -> Option<PathBuf> {
    [
        environment.join("Scripts/python.exe"),
        environment.join("bin/python"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

#[cfg(windows)]
fn find_on_path() -> Option<PathBuf> {
    ["amkr.exe", "auto-model-key-router.exe"]
        .into_iter()
        .find_map(|name| {
            let output = hidden_command("where.exe").arg(name).output().ok()?;
            output.status.success().then(|| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(PathBuf::from)
            })?
        })
}

#[cfg(not(windows))]
fn find_on_path() -> Option<PathBuf> {
    ["amkr", "auto-model-key-router"]
        .into_iter()
        .find_map(|name| {
            let output = hidden_command("which").arg(name).output().ok()?;
            output.status.success().then(|| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(PathBuf::from)
            })?
        })
}

fn read_version(executable: &Path) -> Option<String> {
    let output = hidden_command(executable).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .last()
        .map(str::to_owned)
}

fn ensure_success(output: Output, action: &str) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    let detail = detail.trim();
    Err(if detail.is_empty() {
        format!(
            "{action}失败（退出码 {}）",
            output.status.code().unwrap_or(-1)
        )
    } else {
        format!(
            "{action}失败: {}",
            detail.chars().take(2_000).collect::<String>()
        )
    })
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
    use super::initialize_config_with_runner;

    #[test]
    fn publishes_generated_config_without_overwriting_existing_file() {
        let root = std::env::temp_dir().join(format!("keyloom-tool-config-{}", std::process::id()));
        let config = root.join("router-config.json");
        std::fs::create_dir_all(&root).unwrap();

        initialize_config_with_runner(&config, |arguments| {
            let staging = arguments.last().unwrap();
            std::fs::write(staging, b"{}\n").unwrap();
            Ok(0)
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(&config).unwrap(), "{}\n");

        let error = initialize_config_with_runner(&config, |_| Ok(0)).unwrap_err();
        assert!(error.contains("不会覆盖"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
