import { invoke } from "@tauri-apps/api/core";

export const minimumCompatibleAmkrVersion = "3.1.1";

export function isAmkrVersionCompatible(version: string) {
  const parse = (value: string) => value.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10));
  const current = parse(version);
  const minimum = parse(minimumCompatibleAmkrVersion);
  if (current.length !== 3 || current.some(Number.isNaN)) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index];
  }
  return true;
}

export type AmkrMetadata = {
  config_path: string;
  base_url: string;
  host?: string;
  port?: number;
  request_timeout?: number | null;
  stream_first_byte_timeout?: number | null;
  stream_idle_timeout?: number | null;
  max_retries?: number | null;
  metrics_db_path: string | null;
  log_file_path: string | null;
  auth_enabled: boolean;
};

export type AmkrHealth = {
  status: string;
  version?: string | null;
  local_auth_enabled: boolean;
  models?: string[];
  config_path?: string | null;
  local_api_key_fingerprint?: string | null;
  visitor_feature_installed?: boolean;
  visitor_access_enabled?: boolean;
  visitor_key_count?: number;
  native_endpoint_summary?: {
    supported: number;
    fallback: number;
    unknown: number;
  } | null;
  unified_model?: AmkrUnifiedModel | null;
};

export type AmkrUsageStats = {
  requests: number;
  successes?: number | null;
  failures?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens: number;
  cached_token_rate: number;
  cached_tokens?: number | null;
  avg_duration_ms: number;
};

export type AmkrMetrics = {
  total: AmkrUsageStats;
  current_rpm?: number;
  current_tpm?: number;
  router_status?: string | null;
  active_requests?: number;
  caller_types?: Record<string, AmkrUsageStats>;
  models?: Record<string, AmkrUsageStats>;
  keys?: Record<string, Record<string, AmkrUsageStats>>;
};

export type AmkrSettings = {
  host: string;
  port: number;
  request_timeout: number;
  stream_first_byte_timeout: number;
  stream_idle_timeout: number;
  max_retries: number;
  local_auth_enabled: boolean;
  local_api_key_fingerprint: string | null;
};

export type AmkrSettingsResponse = {
  config_revision: string;
  settings: AmkrSettings;
};

export type AmkrLocalApiKeyResponse = {
  config_revision: string;
  local_api_key: string;
  local_api_key_fingerprint: string;
};

export type AmkrUpdateCheck = {
  current_version: string;
  latest_version: string | null;
  release_url: string | null;
  source: string | null;
  update_available: boolean;
  error: string | null;
};

export type AmkrProviderKey = {
  name: string;
  enabled: boolean;
  allow_visitor: boolean;
  api_key_fingerprint: string;
};

export type AmkrProviderPool = {
  name: string;
  keys: string[];
  models: string[];
};

export type AmkrProvider = {
  id: string;
  base_url: string;
  keys: AmkrProviderKey[];
  pools: AmkrProviderPool[];
  routes: Record<string, string>;
};

export type AmkrProvidersResponse = {
  config_revision: string;
  providers: AmkrProvider[];
};

export type AmkrRouteTarget = {
  provider: string;
  pool: string;
  upstream_model: string;
};

export type AmkrRoute = {
  id: string;
  targets: AmkrRouteTarget[];
  aliases: string[];
  routing_mode: string | null;
};

export type AmkrRoutesResponse = {
  config_revision: string;
  routes: AmkrRoute[];
};

export type AmkrModelKey = {
  name: string;
  base_url: string | null;
  enabled: boolean;
  allow_visitor: boolean;
  api_key_fingerprint: string;
};

export type AmkrModel = {
  id: string;
  aliases: string[];
  routing_mode: string;
  reasoning_effort: string | null;
  visitor_available: boolean;
  keys: AmkrModelKey[];
};

export type AmkrModelsResponse = { models: AmkrModel[] };

export type AmkrUnifiedTarget = { model: string; key: string | null };
export type AmkrUnifiedPlan = { primary: AmkrUnifiedTarget; fallback?: AmkrUnifiedTarget | null };
export type AmkrUnifiedModel = { default: AmkrUnifiedPlan; image?: AmkrUnifiedPlan | null };
export type AmkrUnifiedModelResponse = { unified_model: AmkrUnifiedModel | null };

export type AmkrConfigExport = { config_revision: string; config: unknown };
export type AmkrConfigImportResult = { config_revision: string; imported: boolean };
export type AmkrProbeStart = { probe_id: string; status: string };
export type AmkrProbeResult = {
  status: string;
  provider: string;
  key: string;
  endpoint: string;
  models: string[];
  latency_ms: number | null;
  error: string | null;
};
export type AmkrProbe = {
  probe_id: string;
  status: string;
  provider: string;
  results: AmkrProbeResult[];
  error: string | null;
};
export type AmkrIntegrationAgent = "claude-code" | "codex";
export type AmkrIntegrationMode = "unified-model" | "native";
export type AmkrIntegrationStatus = {
  agent: AmkrIntegrationAgent;
  display_name: string;
  target_path: string;
  target_exists: boolean;
  backup_available: boolean;
  current_is_applied: boolean;
  mode: string | null;
};

export type RuntimeInstallationStatus = {
  runtime_dir: string;
  state_path: string;
  python_available: boolean;
  pythonw_available: boolean;
  amkr_package_available: boolean;
  private_runtime_installed: boolean;
  rollback_available: boolean;
  python_version: string | null;
  amkr_version: string | null;
  amkr_wheel_sha256: string | null;
  diagnostic: string | null;
};
export type AmkrServiceAction =
  | "start_amkr" | "stop_amkr" | "restart_amkr"
  | "install_user_amkr" | "uninstall_amkr" | "status_amkr"
  | "install_system_amkr" | "uninstall_system_amkr"
  | "start_system_amkr" | "stop_system_amkr" | "restart_system_amkr";
export type AmkrServiceCommandResult = { command: string[]; exit_code: number; stdout: string; stderr: string };

export function discoverAmkr(configPath: string | null = null) {
  return invoke<AmkrMetadata>("discover_amkr", { configPath });
}

export function initializeDefaultAmkrConfig() {
  return invoke<AmkrMetadata>("initialize_default_amkr_config");
}

export function getAmkrHealth(configPath: string | null = null) {
  return invoke<AmkrHealth>("get_amkr_health", { configPath });
}

export function getAmkrMetrics(configPath: string | null = null) {
  return invoke<AmkrMetrics>("get_amkr_metrics", { configPath });
}

export function getAmkrSettings(configPath: string | null = null) {
  return invoke<AmkrSettingsResponse>("get_amkr_settings", { configPath });
}

export function updateAmkrSettings(configRevision: string, settings: AmkrSettings, configPath: string | null = null) {
  return invoke<AmkrSettingsResponse>("update_amkr_settings", {
    configPath,
    configRevision,
    host: settings.host,
    port: settings.port,
    requestTimeout: settings.request_timeout,
    streamFirstByteTimeout: settings.stream_first_byte_timeout,
    streamIdleTimeout: settings.stream_idle_timeout,
    maxRetries: settings.max_retries,
  });
}

export function regenerateAmkrLocalApiKey(configRevision: string, configPath: string | null = null) {
  return invoke<AmkrLocalApiKeyResponse>("regenerate_amkr_local_api_key", { configPath, configRevision });
}

export function checkAmkrUpdate(configPath: string | null = null) {
  return invoke<AmkrUpdateCheck>("check_amkr_update", { configPath });
}

export function readAmkrLogTail(configPath: string | null = null) {
  return invoke<string>("read_amkr_log_tail", { configPath });
}

export function getAmkrProviders(configPath: string | null = null) {
  return invoke<AmkrProvidersResponse>("get_amkr_providers", { configPath });
}

export function getAmkrRoutes(configPath: string | null = null) {
  return invoke<AmkrRoutesResponse>("get_amkr_routes", { configPath });
}

export function getAmkrModels(configPath: string | null = null) {
  return invoke<AmkrModelsResponse>("get_amkr_models", { configPath });
}

export function updateAmkrModelReasoningEffort(modelId: string, reasoningEffort: string | null, configPath: string | null = null) {
  return invoke<AmkrModel>("update_amkr_model_reasoning_effort", { configPath, modelId, reasoningEffort });
}

export function getAmkrUnifiedModel(configPath: string | null = null) {
  return invoke<AmkrUnifiedModelResponse>("get_amkr_unified_model", { configPath });
}

export function updateAmkrUnifiedModel(unifiedModel: AmkrUnifiedModel, configPath: string | null = null) {
  return invoke<AmkrUnifiedModelResponse>("update_amkr_unified_model", {
    configPath,
    model: unifiedModel.default.primary.model,
    key: unifiedModel.default.primary.key,
    fallback: unifiedModel.default.fallback ?? null,
    image: unifiedModel.image ?? null,
  });
}

export function deleteAmkrUnifiedModel(configPath: string | null = null) {
  return invoke<void>("delete_amkr_unified_model", { configPath });
}

export function createAmkrProvider(configRevision: string, id: string, baseUrl: string, configPath: string | null = null) {
  return invoke("create_amkr_provider", { configPath, configRevision, id, baseUrl });
}

export function deleteAmkrProvider(configRevision: string, id: string, configPath: string | null = null) {
  return invoke("delete_amkr_provider", { configPath, configRevision, id });
}

export function updateAmkrProvider(configRevision: string, providerId: string, id: string, baseUrl: string, routes: Record<string, string>, configPath: string | null = null) {
  return invoke("update_amkr_provider", { configPath, configRevision, providerId, id, baseUrl, routes });
}

export function createAmkrProviderKey(configRevision: string, providerId: string, name: string, apiKey: string, allowVisitor: boolean, configPath: string | null = null) {
  return invoke("create_amkr_provider_key", { configPath, configRevision, providerId, name, apiKey, allowVisitor });
}

export function updateAmkrProviderKey(configRevision: string, providerId: string, keyName: string, name: string, apiKey: string | null, enabled: boolean, allowVisitor: boolean, configPath: string | null = null) {
  return invoke("update_amkr_provider_key", { configPath, configRevision, providerId, keyName, name, apiKey, enabled, allowVisitor });
}

export function deleteAmkrProviderKey(configRevision: string, providerId: string, keyName: string, configPath: string | null = null) {
  return invoke("delete_amkr_provider_key", { configPath, configRevision, providerId, keyName });
}

export function createAmkrPool(configRevision: string, providerId: string, name: string, keys: string[], models: string[], configPath: string | null = null) {
  return invoke("create_amkr_pool", { configPath, configRevision, providerId, name, keys, models });
}

export function updateAmkrPool(configRevision: string, providerId: string, poolName: string, name: string, keys: string[], models: string[], configPath: string | null = null) {
  return invoke("update_amkr_pool", { configPath, configRevision, providerId, poolName, name, keys, models });
}

export function deleteAmkrPool(configRevision: string, providerId: string, poolName: string, configPath: string | null = null) {
  return invoke("delete_amkr_pool", { configPath, configRevision, providerId, poolName });
}

export function createAmkrRoute(configRevision: string, id: string, targets: AmkrRouteTarget[], aliases: string[], routingMode: string | null, configPath: string | null = null) {
  return invoke("create_amkr_route", { configPath, configRevision, id, targets, aliases, routingMode });
}

export function deleteAmkrRoute(configRevision: string, id: string, configPath: string | null = null) {
  return invoke("delete_amkr_route", { configPath, configRevision, id });
}

export function updateAmkrRoute(configRevision: string, routeId: string, id: string, targets: AmkrRouteTarget[], aliases: string[], routingMode: string | null, configPath: string | null = null) {
  return invoke("update_amkr_route", { configPath, configRevision, routeId, id, targets, aliases, routingMode });
}

export function exportAmkrConfig(configPath: string | null = null) { return invoke<AmkrConfigExport>("export_amkr_config", { configPath }); }
export function importAmkrConfig(configRevision: string, config: Record<string, unknown>, configPath: string | null = null) { return invoke<AmkrConfigImportResult>("import_amkr_config", { configPath, configRevision, config }); }

export function probeAmkrKeys(providerId: string, keys: string[], timeoutSeconds = 15, configPath: string | null = null) {
  return invoke<AmkrProbeStart>("probe_amkr_keys", { configPath, providerId, keys, timeoutSeconds });
}

export function probeAmkrPools(providerId: string, pools: string[], timeoutSeconds = 15, configPath: string | null = null) {
  return invoke<AmkrProbeStart>("probe_amkr_pools", { configPath, providerId, pools, timeoutSeconds });
}

export function getAmkrProbe(probeId: string, configPath: string | null = null) {
  return invoke<AmkrProbe>("get_amkr_probe", { configPath, probeId });
}

export function cancelAmkrProbe(probeId: string, configPath: string | null = null) {
  return invoke<AmkrProbe>("cancel_amkr_probe", { configPath, probeId });
}

export function getAgentIntegrationStatus(agent: AmkrIntegrationAgent) {
  return invoke<AmkrIntegrationStatus>("get_agent_integration_status", { agent });
}

export function configureAgentIntegration(configPath: string | null, agent: AmkrIntegrationAgent, mode: AmkrIntegrationMode) {
  return invoke<AmkrIntegrationStatus>("configure_agent_integration", { configPath, agent, mode });
}

export function rollbackAgentIntegration(agent: AmkrIntegrationAgent) {
  return invoke<AmkrIntegrationStatus>("rollback_agent_integration", { agent });
}

export function getRuntimeInstallationStatus() {
  return invoke<RuntimeInstallationStatus>("get_runtime_installation_status");
}

export function rollbackPrivateRuntime() {
  return invoke<RuntimeInstallationStatus>("rollback_private_runtime");
}

export function controlAmkr(
  action: AmkrServiceAction,
  configPath: string | null = null,
) {
  return invoke<AmkrServiceCommandResult[]>(action, { configPath });
}
