use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

pub const WINDOWS_TASK_NAME: &str = "AutoModelKeyRouter";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceAction {
    InstallUser,
    Uninstall,
    Start,
    Stop,
    Restart,
    Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemServiceAction {
    Install,
    Uninstall,
    Start,
    Stop,
    Restart,
}

impl SystemServiceAction {
    fn cli_value(self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Uninstall => "uninstall",
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TaskCommandResult {
    pub command: Vec<String>,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceProgram {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
}

impl ServiceProgram {
    pub fn executable(path: impl Into<PathBuf>) -> Self {
        Self {
            executable: path.into(),
            arguments: Vec::new(),
        }
    }
}

pub fn task_commands(
    action: ServiceAction,
    executable: &Path,
    config_path: &Path,
) -> Vec<Vec<String>> {
    task_commands_for_program(action, &ServiceProgram::executable(executable), config_path)
}

pub fn task_commands_for_program(
    action: ServiceAction,
    program: &ServiceProgram,
    config_path: &Path,
) -> Vec<Vec<String>> {
    let command = |arguments: &[&str]| arguments.iter().map(|value| (*value).to_owned()).collect();

    match action {
        ServiceAction::InstallUser => vec![vec![
            "schtasks".to_owned(),
            "/Create".to_owned(),
            "/SC".to_owned(),
            "ONLOGON".to_owned(),
            "/TN".to_owned(),
            WINDOWS_TASK_NAME.to_owned(),
            "/RL".to_owned(),
            "LIMITED".to_owned(),
            "/IT".to_owned(),
            "/TR".to_owned(),
            task_run_command(program, config_path),
        ]],
        ServiceAction::Uninstall => vec![
            command(&["schtasks", "/End", "/TN", WINDOWS_TASK_NAME]),
            command(&["schtasks", "/Delete", "/F", "/TN", WINDOWS_TASK_NAME]),
        ],
        ServiceAction::Start => vec![command(&["schtasks", "/Run", "/TN", WINDOWS_TASK_NAME])],
        ServiceAction::Stop => vec![command(&["schtasks", "/End", "/TN", WINDOWS_TASK_NAME])],
        ServiceAction::Restart => vec![
            command(&["schtasks", "/End", "/TN", WINDOWS_TASK_NAME]),
            command(&["schtasks", "/Run", "/TN", WINDOWS_TASK_NAME]),
        ],
        ServiceAction::Status => vec![command(&[
            "schtasks",
            "/Query",
            "/TN",
            WINDOWS_TASK_NAME,
            "/V",
            "/FO",
            "LIST",
        ])],
    }
}

pub fn system_service_command(
    action: SystemServiceAction,
    program: &ServiceProgram,
    config_path: &Path,
) -> Vec<String> {
    let mut command = vec![program.executable.to_string_lossy().into_owned()];
    command.extend(program.arguments.iter().cloned());
    command.extend([
        "--config".to_owned(),
        config_path.to_string_lossy().into_owned(),
        "--service".to_owned(),
        action.cli_value().to_owned(),
    ]);
    command
}

pub fn run_system_service_action(
    action: SystemServiceAction,
    program: &ServiceProgram,
    config_path: &Path,
) -> Result<Vec<TaskCommandResult>, String> {
    let command = system_service_command(action, program, config_path);
    let (executable, arguments) = command
        .split_first()
        .ok_or_else(|| "AMKR 系统服务命令不能为空".to_owned())?;
    let mut process = Command::new(executable);
    process.args(arguments);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }
    let output = process
        .output()
        .map_err(|error| format!("无法执行 AMKR 系统服务命令: {error}"))?;
    let result = TaskCommandResult {
        command,
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    };
    if result.exit_code != 0 {
        let detail = if result.stderr.is_empty() {
            result.stdout.as_str()
        } else {
            result.stderr.as_str()
        };
        return Err(format!(
            "AMKR 系统服务命令失败（退出码 {}）: {}",
            result.exit_code,
            if detail.is_empty() {
                "无命令输出"
            } else {
                detail
            }
        ));
    }
    Ok(vec![result])
}

fn task_run_command(program: &ServiceProgram, config_path: &Path) -> String {
    let mut arguments = vec![format!("\"{}\"", program.executable.display())];
    arguments.extend(program.arguments.iter().map(|argument| {
        if argument.is_empty() || argument.chars().any(char::is_whitespace) {
            format!("\"{argument}\"")
        } else {
            argument.to_owned()
        }
    }));
    arguments.extend([
        "--config".to_owned(),
        format!("\"{}\"", config_path.display()),
        "--serve-foreground".to_owned(),
    ]);
    arguments.join(" ")
}

pub fn execute_task_commands<F>(
    action: ServiceAction,
    executable: &Path,
    config_path: &Path,
    runner: F,
) -> Result<Vec<TaskCommandResult>, String>
where
    F: FnMut(&[String]) -> Result<TaskCommandResult, String>,
{
    execute_task_commands_for_program(
        action,
        &ServiceProgram::executable(executable),
        config_path,
        runner,
    )
}

pub fn execute_task_commands_for_program<F>(
    action: ServiceAction,
    program: &ServiceProgram,
    config_path: &Path,
    mut runner: F,
) -> Result<Vec<TaskCommandResult>, String>
where
    F: FnMut(&[String]) -> Result<TaskCommandResult, String>,
{
    let results = task_commands_for_program(action, program, config_path)
        .into_iter()
        .map(|command| runner(&command))
        .collect::<Result<Vec<_>, _>>()?;

    if let Some(failed) = results.iter().find(|result| result.exit_code != 0) {
        let diagnostic = if !failed.stderr.is_empty() {
            failed.stderr.as_str()
        } else if !failed.stdout.is_empty() {
            failed.stdout.as_str()
        } else {
            "无命令输出"
        };
        return Err(format!(
            "计划任务命令失败（退出码 {}）: {}: {}",
            failed.exit_code,
            failed.command.join(" "),
            diagnostic
        ));
    }

    Ok(results)
}

pub fn run_task_action(
    action: ServiceAction,
    executable: &Path,
    config_path: &Path,
) -> Result<Vec<TaskCommandResult>, String> {
    run_task_action_for_program(action, &ServiceProgram::executable(executable), config_path)
}

pub fn run_task_action_for_program(
    action: ServiceAction,
    program: &ServiceProgram,
    config_path: &Path,
) -> Result<Vec<TaskCommandResult>, String> {
    execute_task_commands_for_program(action, program, config_path, |command| {
        let (program, arguments) = command
            .split_first()
            .ok_or_else(|| "计划任务命令不能为空".to_owned())?;
        let output = Command::new(program)
            .args(arguments)
            .output()
            .map_err(|error| format!("无法执行 {program}: {error}"))?;

        Ok(TaskCommandResult {
            command: command.to_vec(),
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        })
    })
}
