use std::path::Path;

use keyloom_core::tray::{action_from_menu_id, TrayAction};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

#[tauri::command]
fn discover_amkr(config_path: Option<String>) -> Result<keyloom_core::AmkrMetadata, String> {
    keyloom_core::discover_amkr(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn get_amkr_health(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrHealth, String> {
    keyloom_core::get_amkr_health(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn get_amkr_metrics(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrMetrics, String> {
    keyloom_core::get_amkr_metrics(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn read_amkr_log_tail(config_path: Option<String>) -> Result<String, String> {
    keyloom_core::read_amkr_log_tail(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn get_amkr_providers(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrProvidersResponse, String> {
    keyloom_core::get_amkr_providers(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn get_amkr_routes(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrRoutesResponse, String> {
    keyloom_core::get_amkr_routes(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn create_amkr_provider(config_path: Option<String>, config_revision: String, id: String, base_url: String) -> Result<keyloom_core::amkr::client::AmkrProviderResponse, String> {
    keyloom_core::create_amkr_provider(config_path.as_deref().map(Path::new), &config_revision, &id, &base_url)
}

#[tauri::command]
fn delete_amkr_provider(config_path: Option<String>, config_revision: String, id: String) -> Result<(), String> {
    keyloom_core::delete_amkr_provider(config_path.as_deref().map(Path::new), &config_revision, &id)
}

#[tauri::command]
fn create_amkr_provider_key(config_path: Option<String>, config_revision: String, provider_id: String, name: String, api_key: String, allow_visitor: bool) -> Result<(), String> {
    keyloom_core::create_amkr_provider_key(config_path.as_deref().map(Path::new), &config_revision, &provider_id, &name, &api_key, allow_visitor)
}

#[tauri::command]
fn create_amkr_pool(config_path: Option<String>, config_revision: String, provider_id: String, name: String, keys: Vec<String>, models: Vec<String>) -> Result<(), String> {
    keyloom_core::create_amkr_pool(config_path.as_deref().map(Path::new), &config_revision, &provider_id, &name, keys, models)
}

#[tauri::command]
fn create_amkr_route(config_path: Option<String>, config_revision: String, id: String, provider: String, pool: String, upstream_model: String, aliases: Vec<String>, routing_mode: Option<String>) -> Result<(), String> {
    keyloom_core::create_amkr_route(config_path.as_deref().map(Path::new), &config_revision, &id, &provider, &pool, &upstream_model, aliases, routing_mode)
}

#[tauri::command]
fn delete_amkr_route(config_path: Option<String>, config_revision: String, id: String) -> Result<(), String> {
    keyloom_core::delete_amkr_route(config_path.as_deref().map(Path::new), &config_revision, &id)
}

#[tauri::command]
fn export_amkr_config(config_path: Option<String>) -> Result<keyloom_core::amkr::client::AmkrConfigTransfer, String> { keyloom_core::export_amkr_config(config_path.as_deref().map(Path::new)) }
#[tauri::command]
fn import_amkr_config(config_path: Option<String>, config_revision: String, config: serde_json::Value) -> Result<keyloom_core::amkr::client::AmkrConfigTransfer, String> { keyloom_core::import_amkr_config(config_path.as_deref().map(Path::new), &config_revision, config) }

fn run_amkr_service_action(
    action: keyloom_core::windows_service::ServiceAction,
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    keyloom_core::run_amkr_service(action, config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn start_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(keyloom_core::windows_service::ServiceAction::Start, config_path)
}

#[tauri::command]
fn stop_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(keyloom_core::windows_service::ServiceAction::Stop, config_path)
}

#[tauri::command]
fn restart_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(keyloom_core::windows_service::ServiceAction::Restart, config_path)
}

#[tauri::command]
fn install_user_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(keyloom_core::windows_service::ServiceAction::InstallUser, config_path)
}

#[tauri::command]
fn uninstall_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(keyloom_core::windows_service::ServiceAction::Uninstall, config_path)
}

#[tauri::command]
fn status_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(keyloom_core::windows_service::ServiceAction::Status, config_path)
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn run_tray_action(app: &tauri::AppHandle, action: TrayAction) {
    match action {
        TrayAction::Open => show_main_window(app),
        TrayAction::Start => {
            let _ = keyloom_core::run_amkr_service(
                keyloom_core::windows_service::ServiceAction::Start,
                None,
            );
        }
        TrayAction::Stop => {
            let _ = keyloom_core::run_amkr_service(
                keyloom_core::windows_service::ServiceAction::Stop,
                None,
            );
        }
        TrayAction::Restart => {
            let _ = keyloom_core::run_amkr_service(
                keyloom_core::windows_service::ServiceAction::Restart,
                None,
            );
        }
        TrayAction::Quit => app.exit(0),
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "打开 Keyloom", true, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "启动服务", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "停止服务", true, None::<&str>)?;
            let restart = MenuItem::with_id(app, "restart", "重启服务", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &separator, &start, &stop, &restart, &quit])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| std::io::Error::other("Keyloom 缺少托盘图标"))?;

            TrayIconBuilder::with_id("keyloom-tray")
                .icon(icon)
                .menu(&menu)
                .tooltip("Keyloom")
                .on_menu_event(|app, event| {
                    if let Some(action) = action_from_menu_id(event.id().as_ref()) {
                        run_tray_action(app, action);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            discover_amkr,
            get_amkr_health,
            get_amkr_metrics,
            read_amkr_log_tail,
            get_amkr_providers,
            get_amkr_routes,
            create_amkr_provider,
            delete_amkr_provider,
            create_amkr_provider_key,
            create_amkr_pool,
            create_amkr_route,
            delete_amkr_route,
            export_amkr_config,
            import_amkr_config,
            start_amkr,
            stop_amkr,
            restart_amkr,
            install_user_amkr,
            uninstall_amkr,
            status_amkr
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Keyloom");
}
