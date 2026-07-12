use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::windows_service::ServiceProgram;

const INSTALL_STATE_SCHEMA_VERSION: u32 = 1;
const INSTALL_STATE_OWNER: &str = "com.keyloom.app";

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
        detect_private_runtime, install_paths, previous_path,
        private_runtime_service_program_from_paths, rollback_private_runtime_from_paths,
        runtime_installation_status_from_paths,
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
