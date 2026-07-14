#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;

use keyloom_core::tray::{action_from_menu_id, TrayAction};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

const AMKR_WIDGET_LABEL: &str = "amkr-widget";

#[tauri::command]
async fn set_amkr_widget_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AMKR_WIDGET_LABEL) {
        return if visible {
            window
                .show()
                .and_then(|_| window.unminimize())
                .and_then(|_| window.set_focus())
        } else {
            window.hide()
        }
        .map_err(|error| format!("无法切换 AMKR 挂件: {error}"));
    }

    if !visible {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        AMKR_WIDGET_LABEL,
        WebviewUrl::App("widget.html".into()),
    )
    .title("AMKR 仪表盘")
    .inner_size(360.0, 390.0)
    .transparent(false)
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .shadow(false)
    .devtools(false)
    .center()
    .build()
    .map_err(|error| format!("无法创建 AMKR 挂件: {error}"))?;

    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = close_window.hide();
        }
    });
    Ok(())
}

#[tauri::command]
fn discover_amkr(config_path: Option<String>) -> Result<keyloom_core::AmkrMetadata, String> {
    keyloom_core::discover_amkr(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn initialize_default_amkr_config() -> Result<keyloom_core::AmkrMetadata, String> {
    keyloom_core::initialize_default_amkr_config()
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
fn get_amkr_metric_history(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::metric_history::MetricHistoryPoint>, String> {
    keyloom_core::get_amkr_metric_history(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn get_amkr_settings(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrSettingsResponse, String> {
    keyloom_core::get_amkr_settings(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn get_amkr_local_api_key(config_path: Option<String>) -> Result<String, String> {
    keyloom_core::get_amkr_local_api_key(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn update_amkr_settings(
    config_path: Option<String>,
    config_revision: String,
    host: String,
    port: u16,
    request_timeout: f64,
    stream_first_byte_timeout: f64,
    stream_idle_timeout: f64,
    max_retries: u32,
) -> Result<keyloom_core::amkr::client::AmkrSettingsResponse, String> {
    keyloom_core::update_amkr_settings(
        config_path.as_deref().map(Path::new),
        &keyloom_core::amkr::client::AmkrSettingsUpdate {
            config_revision,
            host,
            port,
            request_timeout,
            stream_first_byte_timeout,
            stream_idle_timeout,
            max_retries,
        },
    )
}

#[tauri::command]
fn regenerate_amkr_local_api_key(
    config_path: Option<String>,
    config_revision: String,
) -> Result<keyloom_core::amkr::client::AmkrLocalApiKeyResponse, String> {
    keyloom_core::regenerate_amkr_local_api_key(
        config_path.as_deref().map(Path::new),
        &config_revision,
    )
}

#[tauri::command]
fn check_amkr_update(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrUpdateCheck, String> {
    keyloom_core::check_amkr_update(config_path.as_deref().map(Path::new))
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
fn get_amkr_models(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrModelsResponse, String> {
    keyloom_core::get_amkr_models(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn update_amkr_model_reasoning_effort(
    config_path: Option<String>,
    model_id: String,
    reasoning_effort: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrModel, String> {
    keyloom_core::update_amkr_model_reasoning_effort(
        config_path.as_deref().map(Path::new),
        &model_id,
        reasoning_effort.as_deref(),
    )
}

#[tauri::command]
fn get_amkr_unified_model(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrUnifiedModelResponse, String> {
    keyloom_core::get_amkr_unified_model(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn update_amkr_unified_model(
    config_path: Option<String>,
    model: String,
    key: Option<String>,
    fallback: Option<keyloom_core::amkr::client::AmkrUnifiedTarget>,
    image: Option<keyloom_core::amkr::client::AmkrUnifiedPlan>,
) -> Result<keyloom_core::amkr::client::AmkrUnifiedModelResponse, String> {
    let unified_model = keyloom_core::amkr::client::AmkrUnifiedModel {
        default: keyloom_core::amkr::client::AmkrUnifiedPlan {
            primary: keyloom_core::amkr::client::AmkrUnifiedTarget { model, key },
            fallback,
        },
        image,
    };
    keyloom_core::update_amkr_unified_model(config_path.as_deref().map(Path::new), &unified_model)
}

#[tauri::command]
fn delete_amkr_unified_model(config_path: Option<String>) -> Result<(), String> {
    keyloom_core::delete_amkr_unified_model(config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn create_amkr_provider(
    config_path: Option<String>,
    config_revision: String,
    id: String,
    base_url: String,
) -> Result<keyloom_core::amkr::client::AmkrProviderResponse, String> {
    keyloom_core::create_amkr_provider(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &id,
        &base_url,
    )
}

#[tauri::command]
fn update_amkr_provider(
    config_path: Option<String>,
    config_revision: String,
    provider_id: String,
    id: String,
    base_url: String,
    routes: std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    keyloom_core::update_amkr_provider(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &provider_id,
        &id,
        &base_url,
        routes,
    )
}

#[tauri::command]
fn delete_amkr_provider(
    config_path: Option<String>,
    config_revision: String,
    id: String,
) -> Result<(), String> {
    keyloom_core::delete_amkr_provider(config_path.as_deref().map(Path::new), &config_revision, &id)
}

#[tauri::command]
fn create_amkr_provider_key(
    config_path: Option<String>,
    config_revision: String,
    provider_id: String,
    name: String,
    api_key: String,
    allow_visitor: bool,
) -> Result<(), String> {
    keyloom_core::create_amkr_provider_key(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &provider_id,
        &name,
        &api_key,
        allow_visitor,
    )
}

#[tauri::command]
fn update_amkr_provider_key(
    config_path: Option<String>,
    config_revision: String,
    provider_id: String,
    key_name: String,
    name: String,
    api_key: Option<String>,
    enabled: bool,
    allow_visitor: bool,
) -> Result<(), String> {
    keyloom_core::update_amkr_provider_key(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &provider_id,
        &key_name,
        &name,
        api_key.as_deref(),
        enabled,
        allow_visitor,
    )
}

#[tauri::command]
fn delete_amkr_provider_key(
    config_path: Option<String>,
    config_revision: String,
    provider_id: String,
    key_name: String,
) -> Result<(), String> {
    keyloom_core::delete_amkr_provider_key(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &provider_id,
        &key_name,
    )
}

#[tauri::command]
fn create_amkr_pool(
    config_path: Option<String>,
    config_revision: String,
    provider_id: String,
    name: String,
    keys: Vec<String>,
    models: Vec<String>,
) -> Result<(), String> {
    keyloom_core::create_amkr_pool(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &provider_id,
        &name,
        keys,
        models,
    )
}

#[tauri::command]
fn update_amkr_pool(
    config_path: Option<String>,
    config_revision: String,
    provider_id: String,
    pool_name: String,
    name: String,
    keys: Vec<String>,
    models: Vec<String>,
) -> Result<(), String> {
    keyloom_core::update_amkr_pool(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &provider_id,
        &pool_name,
        &name,
        keys,
        models,
    )
}

#[tauri::command]
fn delete_amkr_pool(
    config_path: Option<String>,
    config_revision: String,
    provider_id: String,
    pool_name: String,
) -> Result<(), String> {
    keyloom_core::delete_amkr_pool(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &provider_id,
        &pool_name,
    )
}

#[tauri::command]
fn create_amkr_route(
    config_path: Option<String>,
    config_revision: String,
    id: String,
    targets: Vec<keyloom_core::amkr::client::AmkrRouteTarget>,
    aliases: Vec<String>,
    routing_mode: Option<String>,
) -> Result<(), String> {
    keyloom_core::create_amkr_route(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &id,
        targets,
        aliases,
        routing_mode,
    )
}

#[tauri::command]
fn update_amkr_route(
    config_path: Option<String>,
    config_revision: String,
    route_id: String,
    id: String,
    targets: Vec<keyloom_core::amkr::client::AmkrRouteTarget>,
    aliases: Vec<String>,
    routing_mode: Option<String>,
) -> Result<(), String> {
    keyloom_core::update_amkr_route(
        config_path.as_deref().map(Path::new),
        &config_revision,
        &route_id,
        &id,
        targets,
        aliases,
        routing_mode,
    )
}

#[tauri::command]
fn delete_amkr_route(
    config_path: Option<String>,
    config_revision: String,
    id: String,
) -> Result<(), String> {
    keyloom_core::delete_amkr_route(config_path.as_deref().map(Path::new), &config_revision, &id)
}

#[tauri::command]
fn export_amkr_config(
    config_path: Option<String>,
) -> Result<keyloom_core::amkr::client::AmkrConfigExport, String> {
    keyloom_core::export_amkr_config(config_path.as_deref().map(Path::new))
}
#[tauri::command]
fn import_amkr_config(
    config_path: Option<String>,
    config_revision: String,
    config: serde_json::Value,
) -> Result<keyloom_core::amkr::client::AmkrConfigImportResult, String> {
    keyloom_core::import_amkr_config(
        config_path.as_deref().map(Path::new),
        &config_revision,
        config,
    )
}

#[tauri::command]
fn get_agent_integration_status(
    agent: String,
) -> Result<keyloom_core::integrations::AgentIntegrationStatus, String> {
    keyloom_core::get_agent_integration_status(&agent)
}

#[tauri::command]
fn configure_agent_integration(
    config_path: Option<String>,
    agent: String,
    mode: String,
) -> Result<keyloom_core::integrations::AgentIntegrationStatus, String> {
    keyloom_core::configure_agent_integration(config_path.as_deref().map(Path::new), &agent, &mode)
}

#[tauri::command]
fn rollback_agent_integration(
    agent: String,
) -> Result<keyloom_core::integrations::AgentIntegrationStatus, String> {
    keyloom_core::rollback_agent_integration(&agent)
}

#[tauri::command]
fn get_runtime_installation_status() -> keyloom_core::installer::RuntimeInstallationStatus {
    keyloom_core::installer::get_runtime_installation_status()
}

#[tauri::command]
fn rollback_private_runtime() -> Result<keyloom_core::installer::RuntimeInstallationStatus, String>
{
    keyloom_core::installer::rollback_private_runtime()
}

#[tauri::command]
fn update_private_runtime(
    config_path: Option<String>,
    artifact_url: String,
    artifact_sha256: String,
) -> Result<keyloom_core::installer::RuntimeInstallationStatus, String> {
    if keyloom_core::get_amkr_health(config_path.as_deref().map(Path::new)).is_ok() {
        return Err("请先停止 AMKR 服务，再更新私有运行时".to_owned());
    }
    keyloom_core::installer::update_private_runtime(&artifact_url, &artifact_sha256)
}

#[tauri::command]
fn probe_amkr_keys(
    config_path: Option<String>,
    provider_id: String,
    keys: Vec<String>,
    timeout_seconds: f64,
) -> Result<keyloom_core::amkr::client::AmkrProbeStart, String> {
    keyloom_core::probe_amkr_keys(
        config_path.as_deref().map(Path::new),
        &provider_id,
        keys,
        timeout_seconds,
    )
}

#[tauri::command]
fn probe_amkr_pools(
    config_path: Option<String>,
    provider_id: String,
    pools: Vec<String>,
    timeout_seconds: f64,
) -> Result<keyloom_core::amkr::client::AmkrProbeStart, String> {
    keyloom_core::probe_amkr_pools(
        config_path.as_deref().map(Path::new),
        &provider_id,
        pools,
        timeout_seconds,
    )
}

#[tauri::command]
fn get_amkr_probe(
    config_path: Option<String>,
    probe_id: String,
) -> Result<keyloom_core::amkr::client::AmkrProbe, String> {
    keyloom_core::get_amkr_probe(config_path.as_deref().map(Path::new), &probe_id)
}

#[tauri::command]
fn cancel_amkr_probe(
    config_path: Option<String>,
    probe_id: String,
) -> Result<keyloom_core::amkr::client::AmkrProbe, String> {
    keyloom_core::cancel_amkr_probe(config_path.as_deref().map(Path::new), &probe_id)
}

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
    run_amkr_service_action(
        keyloom_core::windows_service::ServiceAction::Start,
        config_path,
    )
}

#[tauri::command]
fn stop_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(
        keyloom_core::windows_service::ServiceAction::Stop,
        config_path,
    )
}

#[tauri::command]
fn restart_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(
        keyloom_core::windows_service::ServiceAction::Restart,
        config_path,
    )
}

#[tauri::command]
fn install_user_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(
        keyloom_core::windows_service::ServiceAction::InstallUser,
        config_path,
    )
}

#[tauri::command]
fn uninstall_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(
        keyloom_core::windows_service::ServiceAction::Uninstall,
        config_path,
    )
}

#[tauri::command]
fn status_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_service_action(
        keyloom_core::windows_service::ServiceAction::Status,
        config_path,
    )
}

fn run_amkr_system_service_action(
    action: keyloom_core::windows_service::SystemServiceAction,
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    keyloom_core::run_amkr_system_service(action, config_path.as_deref().map(Path::new))
}

#[tauri::command]
fn install_system_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_system_service_action(
        keyloom_core::windows_service::SystemServiceAction::Install,
        config_path,
    )
}

#[tauri::command]
fn uninstall_system_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_system_service_action(
        keyloom_core::windows_service::SystemServiceAction::Uninstall,
        config_path,
    )
}

#[tauri::command]
fn start_system_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_system_service_action(
        keyloom_core::windows_service::SystemServiceAction::Start,
        config_path,
    )
}

#[tauri::command]
fn stop_system_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_system_service_action(
        keyloom_core::windows_service::SystemServiceAction::Stop,
        config_path,
    )
}

#[tauri::command]
fn restart_system_amkr(
    config_path: Option<String>,
) -> Result<Vec<keyloom_core::windows_service::TaskCommandResult>, String> {
    run_amkr_system_service_action(
        keyloom_core::windows_service::SystemServiceAction::Restart,
        config_path,
    )
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        .invoke_handler(tauri::generate_handler![
            set_amkr_widget_visible,
            discover_amkr,
            initialize_default_amkr_config,
            get_amkr_health,
            get_amkr_metrics,
            get_amkr_metric_history,
            get_amkr_settings,
            get_amkr_local_api_key,
            update_amkr_settings,
            regenerate_amkr_local_api_key,
            check_amkr_update,
            read_amkr_log_tail,
            get_amkr_providers,
            get_amkr_routes,
            get_amkr_models,
            update_amkr_model_reasoning_effort,
            get_amkr_unified_model,
            update_amkr_unified_model,
            delete_amkr_unified_model,
            create_amkr_provider,
            update_amkr_provider,
            delete_amkr_provider,
            create_amkr_provider_key,
            update_amkr_provider_key,
            delete_amkr_provider_key,
            create_amkr_pool,
            update_amkr_pool,
            delete_amkr_pool,
            create_amkr_route,
            update_amkr_route,
            delete_amkr_route,
            export_amkr_config,
            import_amkr_config,
            get_agent_integration_status,
            configure_agent_integration,
            rollback_agent_integration,
            get_runtime_installation_status,
            rollback_private_runtime,
            update_private_runtime,
            probe_amkr_keys,
            probe_amkr_pools,
            get_amkr_probe,
            cancel_amkr_probe,
            start_amkr,
            stop_amkr,
            restart_amkr,
            install_user_amkr,
            uninstall_amkr,
            status_amkr,
            install_system_amkr,
            uninstall_system_amkr,
            start_system_amkr,
            stop_system_amkr,
            restart_system_amkr
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Keyloom");
}
