use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

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
        Some(paths) => detect_private_runtime(&paths.runtime_dir, &paths.state_path),
        None => RuntimeInstallationStatus {
            runtime_dir: String::new(),
            state_path: String::new(),
            python_available: false,
            pythonw_available: false,
            amkr_package_available: false,
            private_runtime_installed: false,
            python_version: None,
            amkr_version: None,
            amkr_wheel_sha256: None,
            diagnostic: Some("无法确定本机 LOCALAPPDATA 目录".to_owned()),
        },
    }
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

    use super::{detect_private_runtime, install_paths};

    fn temp_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("keyloom-{name}-{}", std::process::id()))
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
}
