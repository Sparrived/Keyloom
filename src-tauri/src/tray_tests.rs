use crate::tray::{action_from_menu_id, TrayAction};

#[test]
fn maps_known_tray_menu_items_to_actions() {
    assert_eq!(action_from_menu_id("open"), Some(TrayAction::Open));
    assert_eq!(action_from_menu_id("start"), Some(TrayAction::Start));
    assert_eq!(action_from_menu_id("stop"), Some(TrayAction::Stop));
    assert_eq!(action_from_menu_id("restart"), Some(TrayAction::Restart));
    assert_eq!(action_from_menu_id("quit"), Some(TrayAction::Quit));
}

#[test]
fn ignores_unknown_tray_menu_items() {
    assert_eq!(action_from_menu_id("unknown"), None);
}
