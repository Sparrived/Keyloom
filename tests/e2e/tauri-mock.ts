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
      version: "4.0.0",
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
    let keyloomAutostartEnabled = false;
    let health: typeof healthy | null = activeScenario === "existing" ? healthy : null;
    let providerRevision = "revision-a";
    let providers = [{ id: "provider-a", base_url: "https://api.example.test", keys: [{ name: "main", enabled: true, allow_visitor: false, api_key_fingerprint: "123456789abc", capabilities: { models: ["model-a"], route_status: { openai: "ok" }, errors: {}, checked_at: "2026-09-01T00:00:00+00:00" } }], routes: {} }];
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
      "pi-agent": {
        agent: "pi-agent",
        display_name: "Pi Agent",
        target_path: "C:/Users/test/.pi/agent/models.json",
        target_exists: false,
        backup_available: false,
        current_is_applied: false,
        mode: null,
      },
    };
    localStorage.clear();
    Object.defineProperty(window, "__KEYLOOM_CALLS__", { value: calls });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          calls.push({ command, args });
          switch (command) {
            case "plugin:updater|check":
              return null;
            case "plugin:autostart|is_enabled":
              return keyloomAutostartEnabled;
            case "plugin:autostart|enable":
              keyloomAutostartEnabled = true;
              return null;
            case "plugin:autostart|disable":
              keyloomAutostartEnabled = false;
              return null;
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
              return { current_rpm: 12, current_tpm: 48_000, total: { requests: 1284, successes: 1270, failures: 14, prompt_tokens: 800000, completion_tokens: 240000, total_tokens: 1040000, cached_tokens: 312000, cached_token_rate: 0.3, avg_duration_ms: 840 } };
            case "get_amkr_metric_history":
              return [];
            case "get_amkr_settings":
              return { config_revision: providerRevision, settings: { host: metadata.host, port: metadata.port, request_timeout: metadata.request_timeout, stream_first_byte_timeout: metadata.stream_first_byte_timeout, stream_idle_timeout: metadata.stream_idle_timeout, max_retries: metadata.max_retries, local_auth_enabled: true, local_api_key_fingerprint: healthy.local_api_key_fingerprint } };
            case "get_amkr_local_api_key":
              return "test-local-api-key";
            case "check_amkr_update":
              return { current_version: "4.0.0", latest_version: "4.0.0", release_url: "https://example.test/amkr", source: "PyPI", artifact_url: null, artifact_sha256: null, update_available: false, error: null };
            case "get_amkr_providers":
              return { config_revision: providerRevision, providers };
            case "create_amkr_provider_key": {
              const provider = providers.find((item) => item.id === args.providerId);
              if (provider) {
                provider.keys = [...provider.keys, { name: String(args.name), enabled: true, allow_visitor: Boolean(args.allowVisitor), api_key_fingerprint: "feedface0001", capabilities: null }];
              }
              providerRevision = "revision-b";
              return {};
            }
            case "probe_amkr_key": {
              const provider = providers.find((item) => item.id === args.providerId);
              const key = provider?.keys.find((item) => item.name === args.keyName);
              if (!provider || !key) throw new Error("AMKR key probe failed");
              key.capabilities = { models: ["model-a"], route_status: { openai: "ok" }, errors: {}, checked_at: "2026-09-01T00:00:00+00:00" };
              providerRevision = "revision-b";
              return { config_revision: providerRevision, provider };
            }
            case "update_amkr_provider":
              providers = providers.map((provider) => provider.id === args.providerId ? { ...provider, id: String(args.id), base_url: String(args.baseUrl), routes: args.routes as Record<string, string> } : provider);
              providerRevision = "revision-b";
              return {};
            case "get_amkr_routes":
              return { config_revision: "revision-a", routes: [{ id: "model-a", aliases: ["default"], routing_mode: "ordered", targets: [{ provider: "provider-a", key: "main", upstream_model: "model-a" }] }] };
            case "get_amkr_models":
              return { config_revision: providerRevision, models: [{ id: "model-a", aliases: ["default"], routing_mode: "ordered", reasoning_effort: "high", visitor_available: false, keys: [{ name: "main", base_url: null, enabled: true, allow_visitor: false, api_key_fingerprint: "123456789abc" }] }] };
            case "get_amkr_unified_model":
              return { config_revision: providerRevision, unified_model: healthy.unified_model };
            case "read_amkr_log_tail":
              return "2026-07-13 INFO request completed status=200";
            case "get_amkr_tool_status":
              return { installed: true, executable: "C:/Users/test/.local/bin/amkr.exe", version: "4.0.0", manager: "uv", uv_available: true, pipx_available: false, diagnostic: null };
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
            case "update_amkr_tool":
              return { installed: true, executable: "C:/Users/test/.local/bin/amkr.exe", version: "4.0.0", manager: "uv", uv_available: true, pipx_available: false, diagnostic: null };
            case "export_amkr_config":
              return { config_revision: "revision-a", config: { providers: {}, models: {} } };
            case "update_amkr_unified_model":
              return {
                config_revision: "revision-b",
                unified_model: {
                  default: {
                    primary: {
                      model: (args.default as { primary: { model: string } }).primary.model,
                      key: ((args.default as { primary: { key?: string | null } }).primary.key) ?? null,
                    },
                  },
                },
              };
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
