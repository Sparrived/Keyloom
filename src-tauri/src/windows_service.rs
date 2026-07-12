use std::path::Path;
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TaskCommandResult {
    pub command: Vec<String>,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub fn task_commands(
    action: ServiceAction,
    executable: &Path,
    config_path: &Path,
) -> Vec<Vec<String>> {
    let command = |arguments: &[&str]| arguments.iter().map(|value| (*value).to_owned()).collect();

    match action {
        ServiceAction::InstallUser => vec![vec![
            "schtasks".to_owned(),
            "/Create".to_owned(),
            "/F".to_owned(),
            "/SC".to_owned(),
            "ONLOGON".to_owned(),
            "/TN".to_owned(),
            WINDOWS_TASK_NAME.to_owned(),
            "/RL".to_owned(),
            "LIMITED".to_owned(),
            "/IT".to_owned(),
            "/TR".to_owned(),
            format!(
                "\"{}\" --config \"{}\" --serve-foreground",
                executable.display(),
                config_path.display()
            ),
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

pub fn execute_task_commands<F>(
    action: ServiceAction,
    executable: &Path,
    config_path: &Path,
    mut runner: F,
) -> Result<Vec<TaskCommandResult>, String>
where
    F: FnMut(&[String]) -> Result<TaskCommandResult, String>,
{
    let results = task_commands(action, executable, config_path)
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
    execute_task_commands(action, executable, config_path, |command| {
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
