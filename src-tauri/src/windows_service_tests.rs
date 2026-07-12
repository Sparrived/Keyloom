use std::path::Path;

use crate::windows_service::{execute_task_commands, task_commands, TaskCommandResult, ServiceAction, WINDOWS_TASK_NAME};

#[test]
fn creates_a_limited_current_user_login_task_without_uac() {
    let commands = task_commands(
        ServiceAction::InstallUser,
        Path::new("C:/Program Files/AMKR/amkr.exe"),
        Path::new("C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json"),
    );

    assert_eq!(commands.len(), 1);
    assert_eq!(
        commands[0],
        vec![
            "schtasks",
            "/Create",
            "/F",
            "/SC",
            "ONLOGON",
            "/TN",
            WINDOWS_TASK_NAME,
            "/RL",
            "LIMITED",
            "/IT",
            "/TR",
            "\"C:/Program Files/AMKR/amkr.exe\" --config \"C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json\" --serve-foreground",
        ]
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>(),
    );
}

#[test]
fn uses_the_existing_task_for_start_stop_restart_status_and_uninstall() {
    let executable = Path::new("C:/Program Files/AMKR/amkr.exe");
    let config = Path::new("C:/router-config.json");

    assert_eq!(
        task_commands(ServiceAction::Start, executable, config),
        vec![vec!["schtasks", "/Run", "/TN", WINDOWS_TASK_NAME]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()],
    );
    assert_eq!(
        task_commands(ServiceAction::Stop, executable, config),
        vec![vec!["schtasks", "/End", "/TN", WINDOWS_TASK_NAME]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()],
    );
    assert_eq!(
        task_commands(ServiceAction::Restart, executable, config),
        vec![
            vec!["schtasks", "/End", "/TN", WINDOWS_TASK_NAME],
            vec!["schtasks", "/Run", "/TN", WINDOWS_TASK_NAME],
        ]
        .into_iter()
        .map(|command| command.into_iter().map(String::from).collect::<Vec<_>>())
        .collect::<Vec<_>>(),
    );
    assert_eq!(
        task_commands(ServiceAction::Status, executable, config),
        vec![vec!["schtasks", "/Query", "/TN", WINDOWS_TASK_NAME, "/V", "/FO", "LIST"]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()],
    );
    assert_eq!(
        task_commands(ServiceAction::Uninstall, executable, config),
        vec![
            vec!["schtasks", "/End", "/TN", WINDOWS_TASK_NAME],
            vec!["schtasks", "/Delete", "/F", "/TN", WINDOWS_TASK_NAME],
        ]
        .into_iter()
        .map(|command| command.into_iter().map(String::from).collect::<Vec<_>>())
        .collect::<Vec<_>>(),
    );
}

#[test]
fn executes_restart_as_stop_then_start_and_returns_each_command_result() {
    let mut seen = Vec::new();

    let results = execute_task_commands(
        ServiceAction::Restart,
        Path::new("amkr.exe"),
        Path::new("C:/router-config.json"),
        |command| {
            seen.push(command.to_vec());
            Ok(TaskCommandResult {
                command: command.to_vec(),
                exit_code: 0,
                stdout: "ok".to_owned(),
                stderr: String::new(),
            })
        },
    )
    .unwrap();

    assert_eq!(seen, task_commands(ServiceAction::Restart, Path::new("amkr.exe"), Path::new("C:/router-config.json")));
    assert!(results.iter().all(|result| result.exit_code == 0));
}
