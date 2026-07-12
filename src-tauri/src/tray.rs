#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    Open,
    Start,
    Stop,
    Restart,
    Quit,
}

pub fn action_from_menu_id(menu_id: &str) -> Option<TrayAction> {
    match menu_id {
        "open" => Some(TrayAction::Open),
        "start" => Some(TrayAction::Start),
        "stop" => Some(TrayAction::Stop),
        "restart" => Some(TrayAction::Restart),
        "quit" => Some(TrayAction::Quit),
        _ => None,
    }
}
