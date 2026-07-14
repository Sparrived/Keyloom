use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::windows_service::ServiceProgram;

const INSTALL_STATE_SCHEMA_VERSION: u32 = 1;
const INSTALL_STATE_OWNER: &str = "com.keyloom.app";
const INITIALIZE_CONFIG_SCRIPT: &str = r#"
import sys
from pathlib import Path
from auto_model_key_router.config import RouterConfig

path = Path(sys.argv[1])
if path.exists():
    raise FileExistsError("staging config already exists")
RouterConfig.load(path)
"#;
const UPDATE_RUNTIME_SCRIPT: &str = r#"
import hashlib
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

runtime = Path(sys.argv[1])
staging = Path(sys.argv[2])
state_staging = Path(sys.argv[3])
artifact_url = sys.argv[4]
expected_sha256 = sys.argv[5]
download_dir = staging.parent / (staging.name + ".download")

for path in (staging, download_dir):
    if path.exists():
        shutil.rmtree(path)
if state_staging.exists():
    state_staging.unlink()
download_dir.mkdir(parents=True)

subprocess.run([
    str(runtime / "python.exe"), "-I", "-m", "pip", "download",
    "--disable-pip-version-check", "--no-deps", "--only-binary=:all:",
    "--dest", str(download_dir), artifact_url,
], check=True)
wheels = list(download_dir.glob("*.whl"))
if len(wheels) != 1:
    raise RuntimeError(f"expected one AMKR wheel, found {len(wheels)}")
wheel = wheels[0]
actual_sha256 = hashlib.sha256(wheel.read_bytes()).hexdigest()
if actual_sha256 != expected_sha256:
    raise RuntimeError("AMKR wheel SHA-256 mismatch")

shutil.copytree(runtime, staging)
staging_python = staging / "python.exe"
subprocess.run([
    str(staging_python), "-I", "-m", "pip", "install",
    "--disable-pip-version-check", "--no-input", "--no-compile", "--upgrade",
    "--target", str(staging / "Lib" / "site-packages"), f"{wheel}[visitor]",
], check=True)
probe = subprocess.run([
    str(staging_python), "-I", "-c",
    "import auto_model_key_router, fastapi, httpx, itsdangerous, pip, uvicorn, json, platform; print(json.dumps(dict(python_version=platform.python_version(), amkr_version=auto_model_key_router.__version__)))",
], check=True, capture_output=True, text=True)
versions = json.loads(probe.stdout.strip())
state_staging.write_text(json.dumps({
    "schema_version": 1,
    "owner": "com.keyloom.app",
    "python_version": versions["python_version"],
    "amkr_version": versions["amkr_version"],
    "amkr_wheel_sha256": actual_sha256,
}, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
shutil.rmtree(download_dir)
"#;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct InstallState {
    schema_version: u32,
    owner: String,
    python_version: String,
    amkr_version: String,
    amkr_wheel_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPaths {
    pub runtime_dir: PathBuf,
    pub state_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RuntimeInstallationStatus {
    pub runtime_dir: String,
    pub state_path: String,
    pub python_available: bool,
    pub pythonw_available: bool,
    pub amkr_package_available: bool,
    pub private_runtime_installed: bool,
    pub rollback_available: bool,
    pub python_version: Option<String>,
    pub amkr_version: Option<String>,
    pub amkr_wheel_sha256: Option<String>,
    pub diagnostic: Option<String>,
}

pub fn install_paths(local_app_data: &Path) -> InstallPaths {
    InstallPaths {
        runtime_dir: local_app_data
            .join("Programs")
            .join("Keyloom")
            .join("runtime"),
        state_path: local_app_data.join("Keyloom").join("install-state.json"),
    }
}

pub fn default_install_paths() -> Option<InstallPaths> {
    std::env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|local_app_data| install_paths(&local_app_data))
}

pub fn get_runtime_installation_status() -> RuntimeInstallationStatus {
    match default_install_paths() {
        Some(paths) => {
            runtime_installation_status_from_paths(&paths.runtime_dir, &paths.state_path)
        }
        None => RuntimeInstallationStatus {
            runtime_dir: String::new(),
            state_path: String::new(),
            python_available: false,
            pythonw_available: false,
            amkr_package_available: false,
            private_runtime_installed: false,
            rollback_available: false,
            python_version: None,
            amkr_version: None,
            amkr_wheel_sha256: None,
            diagnostic: Some("无法确定本机 LOCALAPPDATA 目录".to_owned()),
        },
    }
}

pub fn runtime_installation_status_from_paths(
    runtime_dir: &Path,
    state_path: &Path,
) -> RuntimeInstallationStatus {
    let mut status = detect_private_runtime(runtime_dir, state_path);
    status.rollback_available =
        detect_private_runtime(&previous_path(runtime_dir), &previous_path(state_path))
            .private_runtime_installed;
    status
}

pub fn rollback_private_runtime() -> Result<RuntimeInstallationStatus, String> {
    let paths =
        default_install_paths().ok_or_else(|| "无法确定本机 LOCALAPPDATA 目录".to_owned())?;
    rollback_private_runtime_from_paths(&paths.runtime_dir, &paths.state_path)
}

pub fn update_private_runtime(
    artifact_url: &str,
    artifact_sha256: &str,
) -> Result<RuntimeInstallationStatus, String> {
    validate_update_artifact(artifact_url, artifact_sha256)?;
    let paths =
        default_install_paths().ok_or_else(|| "无法确定本机 LOCALAPPDATA 目录".to_owned())?;
    update_private_runtime_from_paths(
        &paths.runtime_dir,
        &paths.state_path,
        artifact_url,
        artifact_sha256,
    )
}

fn validate_update_artifact(artifact_url: &str, artifact_sha256: &str) -> Result<(), String> {
    if !artifact_url.starts_with("https://files.pythonhosted.org/")
        || !artifact_url.ends_with(".whl")
    {
        return Err("AMKR 更新构件必须是 files.pythonhosted.org 的 HTTPS wheel".to_owned());
    }
    if artifact_sha256.len() != 64
        || !artifact_sha256
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err("AMKR 更新构件缺少有效的 SHA-256".to_owned());
    }
    Ok(())
}

pub fn update_private_runtime_from_paths(
    runtime_dir: &Path,
    state_path: &Path,
    artifact_url: &str,
    artifact_sha256: &str,
) -> Result<RuntimeInstallationStatus, String> {
    validate_update_artifact(artifact_url, artifact_sha256)?;
    let current = detect_private_runtime(runtime_dir, state_path);
    if !current.private_runtime_installed {
        return Err("当前 Keyloom 私有运行时不完整，无法执行安全更新".to_owned());
    }
    if !runtime_dir
        .join("Lib/site-packages/pip/__init__.py")
        .is_file()
    {
        return Err("当前私有运行时不含安全更新器，请先安装最新 Keyloom 安装包".to_owned());
    }

    let staging_runtime = sibling_path(runtime_dir, ".update-staging");
    let staging_state = sibling_path(state_path, ".update-staging");
    let python = runtime_dir.join("python.exe");
    let output = hidden_command(&python)
        .args([
            "-I",
            "-c",
            UPDATE_RUNTIME_SCRIPT,
            &runtime_dir.to_string_lossy(),
            &staging_runtime.to_string_lossy(),
            &staging_state.to_string_lossy(),
            artifact_url,
            &artifact_sha256.to_ascii_lowercase(),
        ])
        .output()
        .map_err(|error| format!("无法启动 AMKR 私有运行时更新器: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "AMKR 私有运行时更新失败: {}",
            detail
                .chars()
                .rev()
                .take(4_000)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
        ));
    }
    if !detect_private_runtime(&staging_runtime, &staging_state).private_runtime_installed {
        return Err("更新后的 AMKR 私有运行时未通过完整性检查".to_owned());
    }
    activate_staged_runtime(runtime_dir, state_path, &staging_runtime, &staging_state)?;
    Ok(runtime_installation_status_from_paths(
        runtime_dir,
        state_path,
    ))
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn sibling_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(suffix);
    PathBuf::from(value)
}

fn activate_staged_runtime(
    runtime_dir: &Path,
    state_path: &Path,
    staging_runtime: &Path,
    staging_state: &Path,
) -> Result<(), String> {
    let previous_runtime = previous_path(runtime_dir);
    let previous_state = previous_path(state_path);
    if previous_runtime.exists() {
        fs::remove_dir_all(&previous_runtime)
            .map_err(|error| format!("无法清理旧运行时回退版本: {error}"))?;
    }
    if previous_state.exists() {
        fs::remove_file(&previous_state)
            .map_err(|error| format!("无法清理旧安装状态回退版本: {error}"))?;
    }
    fs::rename(runtime_dir, &previous_runtime)
        .map_err(|error| format!("无法备份当前私有运行时: {error}"))?;
    if let Err(error) = fs::rename(state_path, &previous_state) {
        let _ = fs::rename(&previous_runtime, runtime_dir);
        return Err(format!("无法备份当前私有运行时状态: {error}"));
    }
    if let Err(error) = fs::rename(staging_runtime, runtime_dir) {
        let _ = fs::rename(&previous_state, state_path);
        let _ = fs::rename(&previous_runtime, runtime_dir);
        return Err(format!("无法启用更新后的私有运行时: {error}"));
    }
    if let Err(error) = fs::rename(staging_state, state_path) {
        let _ = fs::rename(runtime_dir, staging_runtime);
        let _ = fs::rename(&previous_state, state_path);
        let _ = fs::rename(&previous_runtime, runtime_dir);
        return Err(format!("无法启用更新后的私有运行时状态: {error}"));
    }
    Ok(())
}

pub fn rollback_private_runtime_from_paths(
    runtime_dir: &Path,
    state_path: &Path,
) -> Result<RuntimeInstallationStatus, String> {
    if !detect_private_runtime(runtime_dir, state_path).private_runtime_installed {
        return Err("当前 Keyloom 私有运行时不完整，无法执行安全回退".to_owned());
    }
    let previous_runtime = previous_path(runtime_dir);
    let previous_state = previous_path(state_path);
    if !detect_private_runtime(&previous_runtime, &previous_state).private_runtime_installed {
        return Err("没有可用的私有运行时回退版本".to_owned());
    }

    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法创建回退事务标识: {error}"))?
        .as_nanos();
    let displaced_runtime = transaction_path(runtime_dir, token);
    let displaced_state = transaction_path(state_path, token);
    let operations = [
        (runtime_dir.to_path_buf(), displaced_runtime.clone()),
        (state_path.to_path_buf(), displaced_state.clone()),
        (previous_runtime.clone(), runtime_dir.to_path_buf()),
        (previous_state.clone(), state_path.to_path_buf()),
        (displaced_runtime, previous_runtime),
        (displaced_state, previous_state),
    ];
    let mut completed = Vec::new();
    for (source, destination) in operations {
        if let Err(error) = fs::rename(&source, &destination) {
            let rollback_errors = completed
                .iter()
                .rev()
                .filter_map(|(original, moved_to): &(PathBuf, PathBuf)| {
                    fs::rename(moved_to, original).err()
                })
                .map(|rollback_error| rollback_error.to_string())
                .collect::<Vec<_>>();
            let suffix = if rollback_errors.is_empty() {
                String::new()
            } else {
                format!("；恢复原路径时失败: {}", rollback_errors.join("；"))
            };
            return Err(format!(
                "无法交换私有运行时 {} -> {}: {error}{suffix}",
                source.display(),
                destination.display()
            ));
        }
        completed.push((source, destination));
    }

    Ok(runtime_installation_status_from_paths(
        runtime_dir,
        state_path,
    ))
}

fn transaction_path(path: &Path, token: u128) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(format!(".rollback-{token}"));
    PathBuf::from(value)
}

fn previous_path(path: &Path) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(".previous");
    PathBuf::from(value)
}

pub fn private_runtime_service_program() -> Result<ServiceProgram, String> {
    let paths =
        default_install_paths().ok_or_else(|| "无法确定本机 LOCALAPPDATA 目录".to_owned())?;
    private_runtime_service_program_from_paths(&paths.runtime_dir, &paths.state_path)
}

pub fn private_runtime_cli_program() -> Result<ServiceProgram, String> {
    Ok(ServiceProgram {
        executable: private_runtime_python()?,
        arguments: vec!["-m".to_owned(), "auto_model_key_router.main".to_owned()],
    })
}

pub fn private_runtime_python() -> Result<PathBuf, String> {
    let paths =
        default_install_paths().ok_or_else(|| "无法确定本机 LOCALAPPDATA 目录".to_owned())?;
    let status = detect_private_runtime(&paths.runtime_dir, &paths.state_path);
    if !status.private_runtime_installed {
        return Err(status
            .diagnostic
            .unwrap_or_else(|| "Keyloom 私有运行时尚未安装".to_owned()));
    }
    Ok(paths.runtime_dir.join("python.exe"))
}

pub fn initialize_config_with_runtime(python: &Path, config_path: &Path) -> Result<(), String> {
    if !python.is_file() {
        return Err("Keyloom 私有运行时缺少 python.exe".to_owned());
    }
    initialize_config_with_runner(python, config_path, |executable, arguments| {
        let mut command = Command::new(executable);
        command.args(arguments);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let status = command
            .status()
            .map_err(|error| format!("无法启动 Keyloom 私有运行时: {error}"))?;
        Ok(status.code().unwrap_or(-1))
    })
}

fn initialize_config_with_runner<F>(
    python: &Path,
    config_path: &Path,
    runner: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &[String]) -> Result<i32, String>,
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
        let exit_code =
            runner(python, &arguments).map_err(|_| "无法启动 Keyloom 私有运行时".to_owned())?;
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
        let _ = fs::remove_file(&staging);
    }
    result
}

pub fn private_runtime_service_program_from_paths(
    runtime_dir: &Path,
    state_path: &Path,
) -> Result<ServiceProgram, String> {
    let status = detect_private_runtime(runtime_dir, state_path);
    if !status.private_runtime_installed {
        return Err(status
            .diagnostic
            .unwrap_or_else(|| "Keyloom 私有运行时尚未安装".to_owned()));
    }
    Ok(ServiceProgram {
        executable: runtime_dir.join("pythonw.exe"),
        arguments: vec!["-m".to_owned(), "auto_model_key_router.main".to_owned()],
    })
}

pub fn detect_private_runtime(runtime_dir: &Path, state_path: &Path) -> RuntimeInstallationStatus {
    let python_available = runtime_dir.join("python.exe").is_file();
    let pythonw_available = runtime_dir.join("pythonw.exe").is_file();
    let amkr_package_available = runtime_dir
        .join("Lib")
        .join("site-packages")
        .join("auto_model_key_router")
        .join("__init__.py")
        .is_file();
    let mut status = RuntimeInstallationStatus {
        runtime_dir: runtime_dir.to_string_lossy().into_owned(),
        state_path: state_path.to_string_lossy().into_owned(),
        python_available,
        pythonw_available,
        amkr_package_available,
        private_runtime_installed: false,
        rollback_available: false,
        python_version: None,
        amkr_version: None,
        amkr_wheel_sha256: None,
        diagnostic: None,
    };

    if !python_available || !pythonw_available || !amkr_package_available {
        if python_available || pythonw_available || amkr_package_available || state_path.exists() {
            status.diagnostic = Some("私有运行时文件不完整".to_owned());
        }
        return status;
    }

    let raw_state = match fs::read_to_string(state_path) {
        Ok(raw_state) => raw_state,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            status.diagnostic = Some("缺少安装状态文件".to_owned());
            return status;
        }
        Err(_) => {
            status.diagnostic = Some("无法读取安装状态文件".to_owned());
            return status;
        }
    };
    let install_state = match serde_json::from_str::<InstallState>(&raw_state) {
        Ok(install_state)
            if install_state.schema_version == INSTALL_STATE_SCHEMA_VERSION
                && install_state.owner == INSTALL_STATE_OWNER
                && !install_state.python_version.trim().is_empty()
                && !install_state.amkr_version.trim().is_empty()
                && install_state.amkr_wheel_sha256.len() == 64
                && install_state
                    .amkr_wheel_sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) =>
        {
            install_state
        }
        _ => {
            status.diagnostic = Some("安装状态文件无效".to_owned());
            return status;
        }
    };

    status.private_runtime_installed = true;
    status.python_version = Some(install_state.python_version);
    status.amkr_version = Some(install_state.amkr_version);
    status.amkr_wheel_sha256 = Some(install_state.amkr_wheel_sha256);
    status
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        activate_staged_runtime, detect_private_runtime, initialize_config_with_runner,
        install_paths, previous_path, private_runtime_service_program_from_paths,
        rollback_private_runtime_from_paths, runtime_installation_status_from_paths, sibling_path,
        update_private_runtime_from_paths, validate_update_artifact,
    };

    fn temp_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("keyloom-{name}-{}", std::process::id()))
    }

    fn write_runtime(
        runtime: &std::path::Path,
        state: &std::path::Path,
        version: &str,
        hash: char,
    ) {
        fs::create_dir_all(runtime.join("Lib/site-packages/auto_model_key_router")).unwrap();
        fs::create_dir_all(state.parent().unwrap()).unwrap();
        fs::write(runtime.join("python.exe"), b"placeholder").unwrap();
        fs::write(runtime.join("pythonw.exe"), b"placeholder").unwrap();
        fs::write(
            runtime.join("Lib/site-packages/auto_model_key_router/__init__.py"),
            b"",
        )
        .unwrap();
        fs::write(
            state,
            format!(
                r#"{{"schema_version":1,"owner":"com.keyloom.app","python_version":"3.12.10","amkr_version":"{version}","amkr_wheel_sha256":"{}"}}"#,
                hash.to_string().repeat(64)
            ),
        )
        .unwrap();
    }

    #[test]
    fn uses_the_documented_local_app_data_layout() {
        let paths = install_paths(std::path::Path::new("C:/Users/test/AppData/Local"));

        assert_eq!(
            paths.runtime_dir,
            std::path::Path::new("C:/Users/test/AppData/Local/Programs/Keyloom/runtime")
        );
        assert_eq!(
            paths.state_path,
            std::path::Path::new("C:/Users/test/AppData/Local/Keyloom/install-state.json")
        );
    }

    #[test]
    fn accepts_only_hashed_pypi_wheels_for_private_runtime_updates() {
        assert!(validate_update_artifact(
            "https://files.pythonhosted.org/packages/amkr.whl",
            &"a".repeat(64)
        )
        .is_ok());
        assert!(
            validate_update_artifact("https://example.test/amkr.whl", &"a".repeat(64))
                .unwrap_err()
                .contains("files.pythonhosted.org")
        );
        assert!(validate_update_artifact(
            "https://files.pythonhosted.org/packages/amkr.whl",
            "not-a-hash"
        )
        .unwrap_err()
        .contains("SHA-256"));
    }

    #[test]
    fn requires_the_pinned_updater_before_touching_the_current_runtime() {
        let root = temp_root("runtime-without-updater");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        write_runtime(&runtime, &state, "3.1.1", 'a');

        let error = update_private_runtime_from_paths(
            &runtime,
            &state,
            "https://files.pythonhosted.org/packages/amkr.whl",
            &"b".repeat(64),
        )
        .unwrap_err();

        assert!(error.contains("不含安全更新器"));
        assert!(runtime.is_dir());
        assert!(state.is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomically_activates_a_staged_runtime_and_keeps_the_previous_version() {
        let root = temp_root("runtime-update-activation");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        let staging_runtime = sibling_path(&runtime, ".update-staging");
        let staging_state = sibling_path(&state, ".update-staging");
        write_runtime(&runtime, &state, "3.1.1", 'a');
        write_runtime(&staging_runtime, &staging_state, "3.2.0", 'b');

        activate_staged_runtime(&runtime, &state, &staging_runtime, &staging_state).unwrap();

        assert_eq!(
            detect_private_runtime(&runtime, &state)
                .amkr_version
                .as_deref(),
            Some("3.2.0")
        );
        assert_eq!(
            detect_private_runtime(&previous_path(&runtime), &previous_path(&state))
                .amkr_version
                .as_deref(),
            Some("3.1.1")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_a_complete_managed_private_runtime_without_exposing_unknown_state() {
        let root = temp_root("managed-runtime");
        let runtime = root.join("Programs").join("Keyloom").join("runtime");
        let state = root.join("Keyloom").join("install-state.json");
        fs::create_dir_all(runtime.join("Lib/site-packages/auto_model_key_router")).unwrap();
        fs::create_dir_all(state.parent().unwrap()).unwrap();
        fs::write(runtime.join("python.exe"), b"placeholder").unwrap();
        fs::write(runtime.join("pythonw.exe"), b"placeholder").unwrap();
        fs::write(
            runtime.join("Lib/site-packages/auto_model_key_router/__init__.py"),
            b"__version__ = '3.1.1'",
        )
        .unwrap();
        fs::write(
            &state,
            format!(
                r#"{{"schema_version":1,"owner":"com.keyloom.app","python_version":"3.12.10","amkr_version":"3.1.1","amkr_wheel_sha256":"{}"}}"#,
                "a".repeat(64)
            ),
        )
        .unwrap();

        let status = detect_private_runtime(&runtime, &state);

        assert!(status.python_available);
        assert!(status.pythonw_available);
        assert!(status.amkr_package_available);
        assert!(status.private_runtime_installed);
        assert_eq!(status.python_version.as_deref(), Some("3.12.10"));
        assert_eq!(status.amkr_version.as_deref(), Some("3.1.1"));
        assert_eq!(
            status.amkr_wheel_sha256.as_deref(),
            Some("a".repeat(64).as_str())
        );
        assert_eq!(status.diagnostic, None);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_partial_or_invalid_runtime_state_as_not_installed() {
        let root = temp_root("partial-runtime");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        fs::create_dir_all(&runtime).unwrap();
        fs::write(runtime.join("python.exe"), b"placeholder").unwrap();
        fs::write(
            &state,
            r#"{"schema_version":1,"amkr_version":"3.1.1","runtime_sha256":"bad"}"#,
        )
        .unwrap();

        let status = detect_private_runtime(&runtime, &state);

        assert!(status.python_available);
        assert!(!status.amkr_package_available);
        assert!(!status.private_runtime_installed);
        assert_eq!(status.python_version, None);
        assert_eq!(status.amkr_version, None);
        assert_eq!(status.amkr_wheel_sha256, None);
        assert_eq!(status.diagnostic.as_deref(), Some("私有运行时文件不完整"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn requires_the_windowless_python_entrypoint_for_service_startup() {
        let root = temp_root("runtime-without-pythonw");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        fs::create_dir_all(runtime.join("Lib/site-packages/auto_model_key_router")).unwrap();
        fs::write(runtime.join("python.exe"), b"placeholder").unwrap();
        fs::write(
            runtime.join("Lib/site-packages/auto_model_key_router/__init__.py"),
            b"",
        )
        .unwrap();
        fs::write(
            &state,
            format!(
                r#"{{"schema_version":1,"owner":"com.keyloom.app","python_version":"3.12.10","amkr_version":"3.1.1","amkr_wheel_sha256":"{}"}}"#,
                "a".repeat(64)
            ),
        )
        .unwrap();

        let status = detect_private_runtime(&runtime, &state);

        assert!(!status.pythonw_available);
        assert!(!status.private_runtime_installed);
        assert_eq!(status.diagnostic.as_deref(), Some("私有运行时文件不完整"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn treats_malformed_install_state_as_an_invalid_installation() {
        let root = temp_root("invalid-runtime-state");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        fs::create_dir_all(runtime.join("Lib/site-packages/auto_model_key_router")).unwrap();
        fs::write(runtime.join("python.exe"), b"placeholder").unwrap();
        fs::write(runtime.join("pythonw.exe"), b"placeholder").unwrap();
        fs::write(
            runtime.join("Lib/site-packages/auto_model_key_router/__init__.py"),
            b"",
        )
        .unwrap();
        fs::write(&state, b"not-json").unwrap();

        let status = detect_private_runtime(&runtime, &state);

        assert!(!status.private_runtime_installed);
        assert_eq!(status.diagnostic.as_deref(), Some("安装状态文件无效"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_install_state_with_unknown_fields_without_exposing_them() {
        let root = temp_root("unexpected-runtime-state");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        fs::create_dir_all(runtime.join("Lib/site-packages/auto_model_key_router")).unwrap();
        fs::write(runtime.join("python.exe"), b"placeholder").unwrap();
        fs::write(runtime.join("pythonw.exe"), b"placeholder").unwrap();
        fs::write(
            runtime.join("Lib/site-packages/auto_model_key_router/__init__.py"),
            b"",
        )
        .unwrap();
        fs::write(
            &state,
            format!(
                r#"{{"schema_version":1,"owner":"com.keyloom.app","python_version":"3.12.10","amkr_version":"3.1.1","amkr_wheel_sha256":"{}","local_api_key":"secret"}}"#,
                "a".repeat(64)
            ),
        )
        .unwrap();

        let status = detect_private_runtime(&runtime, &state);

        assert!(!status.private_runtime_installed);
        assert_eq!(status.diagnostic.as_deref(), Some("安装状态文件无效"));
        assert!(!serde_json::to_string(&status).unwrap().contains("secret"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_the_windowless_service_program_only_for_a_complete_runtime() {
        let root = temp_root("runtime-service-program");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        fs::create_dir_all(runtime.join("Lib/site-packages/auto_model_key_router")).unwrap();
        fs::write(runtime.join("python.exe"), b"placeholder").unwrap();
        fs::write(runtime.join("pythonw.exe"), b"placeholder").unwrap();
        fs::write(
            runtime.join("Lib/site-packages/auto_model_key_router/__init__.py"),
            b"",
        )
        .unwrap();
        fs::write(
            &state,
            format!(
                r#"{{"schema_version":1,"owner":"com.keyloom.app","python_version":"3.12.10","amkr_version":"3.1.1","amkr_wheel_sha256":"{}"}}"#,
                "a".repeat(64)
            ),
        )
        .unwrap();

        let program = private_runtime_service_program_from_paths(&runtime, &state).unwrap();

        assert_eq!(program.executable, runtime.join("pythonw.exe"));
        assert_eq!(program.arguments, ["-m", "auto_model_key_router.main"]);

        fs::remove_file(runtime.join("pythonw.exe")).unwrap();
        assert!(private_runtime_service_program_from_paths(&runtime, &state)
            .unwrap_err()
            .contains("私有运行时文件不完整"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomically_initializes_a_config_without_returning_its_secret() {
        let root = temp_root("initialize-config");
        let python = root.join("runtime/python.exe");
        let config = root.join("AutoModelKeyRouter/router-config.json");
        fs::create_dir_all(python.parent().unwrap()).unwrap();
        fs::write(&python, b"placeholder").unwrap();

        initialize_config_with_runner(&python, &config, |executable, arguments| {
            assert_eq!(executable, python);
            assert_eq!(arguments[0..2], ["-I", "-c"]);
            assert!(arguments[2].contains("RouterConfig.load"));
            assert!(!arguments[2].contains("local_api_key"));
            let staging = std::path::Path::new(&arguments[3]);
            fs::write(staging, br#"{"config_version":3,"local_api_key":"secret"}"#).unwrap();
            Ok(0)
        })
        .unwrap();

        assert!(config.is_file());
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            r#"{"config_version":3,"local_api_key":"secret"}"#
        );
        assert_eq!(fs::read_dir(config.parent().unwrap()).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn never_overwrites_an_existing_config_or_exposes_initializer_output() {
        let root = temp_root("existing-config");
        let python = root.join("runtime/python.exe");
        let config = root.join("AutoModelKeyRouter/router-config.json");
        fs::create_dir_all(python.parent().unwrap()).unwrap();
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(&python, b"placeholder").unwrap();
        fs::write(&config, b"user-owned-config").unwrap();
        let mut called = false;

        let error = initialize_config_with_runner(&python, &config, |_, _| {
            called = true;
            Err("local_api_key=secret".to_owned())
        })
        .unwrap_err();

        assert!(!called);
        assert_eq!(fs::read(&config).unwrap(), b"user-owned-config");
        assert!(!error.contains("secret"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleans_staging_after_a_private_runtime_failure() {
        let root = temp_root("failed-config");
        let python = root.join("runtime/python.exe");
        let config = root.join("AutoModelKeyRouter/router-config.json");
        fs::create_dir_all(python.parent().unwrap()).unwrap();
        fs::write(&python, b"placeholder").unwrap();

        let error = initialize_config_with_runner(&python, &config, |_, arguments| {
            fs::write(&arguments[3], b"local_api_key=secret").unwrap();
            Ok(1)
        })
        .unwrap_err();

        assert!(!config.exists());
        assert!(!error.contains("secret"));
        assert_eq!(fs::read_dir(config.parent().unwrap()).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn never_overwrites_a_config_created_during_initialization() {
        let root = temp_root("racing-config");
        let python = root.join("runtime/python.exe");
        let config = root.join("AutoModelKeyRouter/router-config.json");
        fs::create_dir_all(python.parent().unwrap()).unwrap();
        fs::write(&python, b"placeholder").unwrap();

        let error = initialize_config_with_runner(&python, &config, |_, arguments| {
            fs::write(&arguments[3], b"generated-config").unwrap();
            fs::write(&config, b"other-process-config").unwrap();
            Ok(0)
        })
        .unwrap_err();

        assert!(error.contains("其他进程"));
        assert_eq!(fs::read(&config).unwrap(), b"other-process-config");
        assert_eq!(fs::read_dir(config.parent().unwrap()).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_and_atomically_swaps_the_previous_private_runtime() {
        let root = temp_root("runtime-rollback");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        let previous_runtime = previous_path(&runtime);
        let previous_state = previous_path(&state);
        write_runtime(&runtime, &state, "3.1.1", 'a');
        write_runtime(&previous_runtime, &previous_state, "3.1.0", 'b');

        let before = runtime_installation_status_from_paths(&runtime, &state);
        assert!(before.rollback_available);

        let after = rollback_private_runtime_from_paths(&runtime, &state).unwrap();

        assert_eq!(after.amkr_version.as_deref(), Some("3.1.0"));
        assert!(after.rollback_available);
        let swapped_backup = detect_private_runtime(&previous_runtime, &previous_state);
        assert_eq!(swapped_backup.amkr_version.as_deref(), Some("3.1.1"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn leaves_the_current_runtime_untouched_when_no_valid_rollback_exists() {
        let root = temp_root("runtime-without-rollback");
        let runtime = root.join("runtime");
        let state = root.join("install-state.json");
        write_runtime(&runtime, &state, "3.1.1", 'a');
        let original_state = fs::read(&state).unwrap();

        let error = rollback_private_runtime_from_paths(&runtime, &state).unwrap_err();

        assert!(error.contains("没有可用的私有运行时回退版本"));
        assert_eq!(fs::read(&state).unwrap(), original_state);
        assert_eq!(
            detect_private_runtime(&runtime, &state)
                .amkr_version
                .as_deref(),
            Some("3.1.1")
        );

        fs::remove_dir_all(root).unwrap();
    }
}
