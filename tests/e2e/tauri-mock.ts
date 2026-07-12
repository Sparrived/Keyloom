import type { Page } from "@playwright/test";

export async function installTauriMock(page: Page, scenario: "existing" | "fresh" = "existing") {
  await page.addInitScript((activeScenario) => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    const metadata = {
      config_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json",
      base_url: "http://127.0.0.1:19001",
      host: "127.0.0.1",
      port: 19001,
      request_timeout: 45,
      stream_first_byte_timeout: 60,
      stream_idle_timeout: 90,
      max_retries: 3,
      metrics_db_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/metrics.db",
      log_file_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/amkr.log",
      auth_enabled: true,
    };
    const healthy = {
      status: "ok",
      local_auth_enabled: true,
      config_path: metadata.config_path,
      models: ["model-a", "model-b"],
      local_api_key_fingerprint: "65bbff9a6cb9",
      unified_model: { default: { primary: { model: "model-a", key: null } } },
      native_endpoint_summary: { supported: 1, fallback: 0, unknown: 0 },
      visitor_feature_installed: false,
    };
    let configExists = activeScenario === "existing";
    let taskInstalled = activeScenario === "existing";
    let health: typeof healthy | null = activeScenario === "existing" ? healthy : null;
    let providerRevision = "revision-a";
    let providers = [{ id: "provider-a", base_url: "https://api.example.test", keys: [{ name: "main", enabled: true, allow_visitor: false, api_key_fingerprint: "123456789abc" }], pools: [{ name: "primary", keys: ["main"], models: ["model-a"] }] }];
    const integrations: Record<string, Record<string, unknown>> = {
      "claude-code": {
        agent: "claude-code",
        display_name: "Claude Code",
        target_path: "C:/Users/test/.claude/settings.json",
        target_exists: true,
        backup_available: false,
        current_is_applied: false,
        mode: null,
      },
      codex: {
        agent: "codex",
        display_name: "Codex",
        target_path: "C:/Users/test/.codex/config.toml",
        target_exists: true,
        backup_available: false,
        current_is_applied: false,
        mode: null,
      },
    };
    localStorage.clear();
    window.confirm = () => true;
    Object.defineProperty(window, "__KEYLOOM_CALLS__", { value: calls });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          calls.push({ command, args });
          switch (command) {
            case "discover_amkr":
              if (!configExists) throw new Error("AMKR configuration not found");
              return metadata;
            case "initialize_default_amkr_config":
              if (configExists) throw new Error("AMKR configuration already exists");
              configExists = true;
              return metadata;
            case "get_amkr_health":
              if (!health) throw new Error("AMKR service is stopped");
              return health;
            case "get_amkr_metrics":
              if (!health) throw new Error("AMKR service is stopped");
              return { total: { requests: 1284, successes: 1270, failures: 14, prompt_tokens: 800000, completion_tokens: 240000, total_tokens: 1040000, cached_tokens: 312000, cached_token_rate: 0.3, avg_duration_ms: 840 } };
            case "get_amkr_providers":
              return { config_revision: providerRevision, providers };
            case "update_amkr_provider":
              providers = providers.map((provider) => provider.id === args.providerId ? { ...provider, id: String(args.id), base_url: String(args.baseUrl) } : provider);
              providerRevision = "revision-b";
              return {};
            case "get_amkr_routes":
              return { config_revision: "revision-a", routes: [{ id: "model-a", aliases: ["default"], routing_mode: "ordered", targets: [{ provider: "provider-a", pool: "primary", upstream_model: "model-a" }] }] };
            case "get_amkr_models":
              return { models: [{ id: "model-a", aliases: ["default"], routing_mode: "ordered", reasoning_effort: "high", visitor_available: false, keys: [{ name: "main", base_url: null, enabled: true, allow_visitor: false, api_key_fingerprint: "123456789abc" }] }] };
            case "get_amkr_unified_model":
              return { unified_model: healthy.unified_model };
            case "read_amkr_log_tail":
              return "2026-07-13 INFO request completed status=200";
            case "get_runtime_installation_status":
              return { runtime_dir: "C:/Users/test/AppData/Local/Programs/Keyloom/runtime", state_path: "C:/Users/test/AppData/Local/Keyloom/install-state.json", python_available: true, pythonw_available: true, amkr_package_available: true, private_runtime_installed: true, rollback_available: true, python_version: "3.12.10", amkr_version: "3.1.1", amkr_wheel_sha256: "a".repeat(64), diagnostic: null };
            case "get_agent_integration_status":
              return integrations[String(args.agent)];
            case "configure_agent_integration": {
              const agent = String(args.agent);
              integrations[agent] = { ...integrations[agent], backup_available: true, current_is_applied: true, mode: args.mode };
              return integrations[agent];
            }
            case "rollback_agent_integration": {
              const agent = String(args.agent);
              integrations[agent] = { ...integrations[agent], backup_available: false, current_is_applied: false, mode: null };
              return integrations[agent];
            }
            case "stop_amkr":
              health = null;
              return [{ command: ["schtasks", "/End"], exit_code: 0, stdout: "SUCCESS", stderr: "" }];
            case "start_amkr":
            case "restart_amkr":
              if (!configExists || !taskInstalled) throw new Error("AMKR startup task is not installed");
              if (activeScenario === "fresh" && args.configPath !== metadata.config_path) throw new Error("AMKR config path mismatch");
              health = healthy;
              return [{ command: ["schtasks", "/Run"], exit_code: 0, stdout: "SUCCESS", stderr: "" }];
            case "status_amkr":
              return [{ command: ["schtasks"], exit_code: 0, stdout: "SUCCESS", stderr: "" }];
            case "install_user_amkr":
              if (!configExists) throw new Error("AMKR configuration not found");
              if (activeScenario === "fresh" && args.configPath !== metadata.config_path) throw new Error("AMKR config path mismatch");
              taskInstalled = true;
              return [{ command: ["schtasks"], exit_code: 0, stdout: "SUCCESS", stderr: "" }];
            case "uninstall_amkr":
              taskInstalled = false;
              health = null;
              return [{ command: ["schtasks"], exit_code: 0, stdout: "SUCCESS", stderr: "" }];
            case "rollback_private_runtime":
              return { runtime_dir: "C:/Users/test/AppData/Local/Programs/Keyloom/runtime", state_path: "C:/Users/test/AppData/Local/Keyloom/install-state.json", python_available: true, pythonw_available: true, amkr_package_available: true, private_runtime_installed: true, rollback_available: true, python_version: "3.12.10", amkr_version: "3.1.0", amkr_wheel_sha256: "b".repeat(64), diagnostic: null };
            case "export_amkr_config":
              return { config_revision: "revision-a", config: { providers: {}, models: {} } };
            case "update_amkr_unified_model":
              return { unified_model: { default: { primary: { model: args.model, key: args.key ?? null } } } };
            default:
              return {};
          }
        },
      },
    });
  }, scenario);
}

export async function commandCalls(page: Page, command: string) {
  return page.evaluate((expected) => ((window as unknown as { __KEYLOOM_CALLS__: Array<{ command: string; args: Record<string, unknown> }> }).__KEYLOOM_CALLS__).filter((call) => call.command === expected), command);
}
