import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import packageMetadata from "../package.json";
import {
  controlAmkr,
  deleteAmkrUnifiedModel,
  discoverAmkr,
  getAmkrHealth,
  getAmkrLocalApiKey,
  getAmkrMetricHistory,
  getAmkrMetrics,
  getRuntimeInstallationStatus,
  initializeDefaultAmkrConfig,
  isAmkrVersionCompatible,
  minimumCompatibleAmkrVersion,
  setAmkrWidgetVisible,
  updateAmkrUnifiedModel,
  type AmkrHealth,
  type AmkrMetrics,
  type AmkrMetadata,
  type AmkrServiceCommandResult,
  type AmkrServiceAction,
  type AmkrUnifiedModel,
  type RuntimeInstallationStatus,
} from "./api/amkr";
import { UsageChart, type UsageMetric } from "./features/overview/UsageChart";
import { appendMetricSnapshot, metricHistoryWindowMs, type MetricSnapshot } from "./features/overview/useMetricHistory";
import { ActivityPage } from "./features/activity/ActivityPage";
import { IntegrationsPage } from "./features/integrations/IntegrationsPage";
import { SettingsPage, type CloseBehavior } from "./features/settings/SettingsPage";
import { ProvidersPage } from "./features/providers/ProvidersPage";
import { RoutingPage } from "./features/routing/RoutingPage";
import { useCopyToast } from "./components/CopyToast";

const primaryNavigation = ["概览", "供应商", "模型路由", "活动", "集成", "设置"] as const;
const navigation = [...primaryNavigation, "服务状态"] as const;
type NavigationItem = (typeof navigation)[number];
const configPathStorageKey = "keyloom.configPath";
const closeBehaviorStorageKey = "keyloom.closeBehavior";
const widgetEnabledStorageKey = "keyloom.amkrWidgetEnabled";

function readCloseBehavior(): CloseBehavior {
  const stored = localStorage.getItem(closeBehaviorStorageKey);
  return stored === "quit" || stored === "tray" ? stored : "ask";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatTokens(value: number) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : formatCount(value);
}

function formatDuration(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms`;
}

function normalizeConfigPath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

type AppProps = {
  now?: () => string;
};

export default function App({ now = () => new Date().toISOString() }: AppProps) {
  const [activePage, setActivePage] = useState<NavigationItem>("概览");
  const [selectedConfigPath, setSelectedConfigPath] = useState<string | null>(() => localStorage.getItem(configPathStorageKey));
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>(readCloseBehavior);
  const [amkrWidgetEnabled, setAmkrWidgetEnabled] = useState(() => localStorage.getItem(widgetEnabledStorageKey) === "true");
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState(false);
  const [trendMetric, setTrendMetric] = useState<UsageMetric>("RPM");
  const [metadata, setMetadata] = useState<AmkrMetadata | null>(null);
  const [health, setHealth] = useState<AmkrHealth | null>(null);
  const [metrics, setMetrics] = useState<AmkrMetrics | null>(null);
  const [metricHistory, setMetricHistory] = useState<MetricSnapshot[]>([]);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [serviceAction, setServiceAction] = useState<AmkrServiceAction | null>(null);
  const [serviceActionError, setServiceActionError] = useState<string | null>(null);
  const [serviceActionNotice, setServiceActionNotice] = useState<string | null>(null);
  const [serviceCommandOutput, setServiceCommandOutput] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeInstallationStatus | null>(null);
  const [runtimeStatusLoading, setRuntimeStatusLoading] = useState(false);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);
  const [initializationInProgress, setInitializationInProgress] = useState(false);
  const [localKeyCopyError, setLocalKeyCopyError] = useState<string | null>(null);
  const [unifiedModelAction, setUnifiedModelAction] = useState(false);
  const [unifiedModelError, setUnifiedModelError] = useState<string | null>(null);
  const [unifiedModelPromptOpen, setUnifiedModelPromptOpen] = useState(false);
  const sidebarDragStart = useRef<{ x: number; y: number } | null>(null);
  const widgetStartupRequested = useRef(false);
  const { copyToast, showCopyToast } = useCopyToast();

  useEffect(() => {
    if (amkrWidgetEnabled && !widgetStartupRequested.current) {
      widgetStartupRequested.current = true;
      void setAmkrWidgetVisible(true).catch(() => { widgetStartupRequested.current = false; });
    }
    const syncWidgetSetting = (event: StorageEvent) => {
      if (event.key === widgetEnabledStorageKey) setAmkrWidgetEnabled(event.newValue === "true");
    };
    window.addEventListener("storage", syncWidgetSetting);
    return () => window.removeEventListener("storage", syncWidgetSetting);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let healthPoll: number | undefined;
    let metricsPoll: number | undefined;

    async function refreshHealth() {
      try {
        const healthResult = await getAmkrHealth(selectedConfigPath);
        if (!cancelled) {
          setHealth(healthResult);
          setHealthError(null);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setHealthError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    async function refreshMetrics() {
      try {
        const metricsResult = await getAmkrMetrics(selectedConfigPath);
        if (!cancelled && metricsResult?.total) {
          setMetrics(metricsResult);
          setMetricsError(null);
          setMetricHistory((history) => appendMetricSnapshot(history, metricsResult, now()));
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setMetricsError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    async function discoverService() {
      try {
        if (!cancelled) {
          setDiscoveryError(null);
          setHealthError(null);
          setMetricsError(null);
          setHealth(null);
          setMetrics(null);
          setMetricHistory([]);
          setLocalKeyCopyError(null);
        }
        const result = await discoverAmkr(selectedConfigPath);
        if (!cancelled) {
          setMetadata(result);
        }
        await refreshHealth();
        await refreshMetrics();
        if (result.metrics_db_path) {
          try {
            const history = await getAmkrMetricHistory(selectedConfigPath);
            if (!cancelled && history.length > 0) {
              setMetricHistory((current) => {
                const merged = [...history, ...current]
                  .filter((snapshot, index, snapshots) => snapshots.findIndex((item) => item.timestamp === snapshot.timestamp) === index)
                  .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
                const cutoff = new Date(merged.at(-1)!.timestamp).getTime() - metricHistoryWindowMs;
                return merged.filter((snapshot) => new Date(snapshot.timestamp).getTime() >= cutoff);
              });
            }
          } catch {
            // Older AMKR databases can still use live sampling without history preload.
          }
        }
        healthPoll = window.setInterval(() => void refreshHealth(), 5_000);
        metricsPoll = window.setInterval(() => void refreshMetrics(), 15_000);
      } catch (error: unknown) {
        if (!cancelled) {
          setMetadata(null);
          setHealth(null);
          setDiscoveryError(error instanceof Error ? error.message : String(error));
          setRuntimeStatusLoading(true);
          setRuntimeStatusError(null);
        }
        try {
          const status = await getRuntimeInstallationStatus();
          if (!cancelled) setRuntimeStatus(status);
        } catch (runtimeError: unknown) {
          if (!cancelled) {
            setRuntimeStatus(null);
            setRuntimeStatusError(runtimeError instanceof Error ? runtimeError.message : String(runtimeError));
          }
        } finally {
          if (!cancelled) setRuntimeStatusLoading(false);
        }
      }
    }

    void discoverService();

    return () => {
      cancelled = true;
      if (healthPoll !== undefined) {
        window.clearInterval(healthPoll);
      }
      if (metricsPoll !== undefined) {
        window.clearInterval(metricsPoll);
      }
    };
  }, [selectedConfigPath]);

  useEffect(() => {
    if (activePage !== "活动" || !metadata) return;
    let cancelled = false;
    const refreshMetrics = async () => {
      try {
        const metricsResult = await getAmkrMetrics(selectedConfigPath);
        if (!cancelled && metricsResult?.total) {
          setMetrics(metricsResult);
          setMetricsError(null);
        }
      } catch (error: unknown) {
        if (!cancelled) setMetricsError(error instanceof Error ? error.message : String(error));
      }
    };
    void refreshMetrics();
    const interval = window.setInterval(() => void refreshMetrics(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activePage, metadata?.config_path, selectedConfigPath]);

  const configMismatch = Boolean(
    metadata?.config_path
    && health?.config_path
    && normalizeConfigPath(metadata.config_path) !== normalizeConfigPath(health.config_path),
  );
  const serviceUnavailable = Boolean(healthError || discoveryError);
  const incompatibleVersion = Boolean(health?.version && !isAmkrVersionCompatible(health.version));
  const serviceState = serviceUnavailable
    ? "服务未连接"
    : incompatibleVersion
      ? "后端版本不兼容"
    : health?.status === "ok"
      ? configMismatch ? "配置不一致" : "服务运行中"
    : metadata
      ? "服务未运行"
      : "正在查找服务";
  const routerTone = metrics?.router_status === "red" ? "bad" : metrics?.router_status === "yellow" ? "warn" : "good";
  const serviceTone = serviceUnavailable ? "bad" : incompatibleVersion || configMismatch ? "warn" : health?.status === "ok" ? routerTone : "muted";
  const serviceRunning = health?.status === "ok";
  const localAuthEnabled = health?.local_auth_enabled ?? metadata?.auth_enabled ?? false;
  const unifiedPlan = health?.unified_model?.default;
  const unifiedTarget = unifiedPlan?.primary;
  const unifiedTargetCount = unifiedPlan ? 1 + (unifiedPlan.fallback ? 1 : 0) : 0;
  const unifiedModel = unifiedTarget?.model ?? "未设置";
  const unifiedModelRouting = unifiedTarget
    ? `${unifiedTarget.key ? `固定 Key · ${unifiedTarget.key}` : "自动路由"} · ${unifiedTargetCount} 个目标`
    : "尚未配置统一路由";
  const latestSnapshot = metricHistory.at(-1);

  async function waitForServiceHealth(configPath = selectedConfigPath) {
    let lastError: unknown = new Error("服务未在预期时间内就绪");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await getAmkrHealth(configPath);
      } catch (error: unknown) {
        lastError = error;
        if (attempt < 4) await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
      }
    }
    throw lastError;
  }

  function serviceNotice(action: AmkrServiceAction) {
    return {
      start_amkr: "服务已启动。",
      stop_amkr: "服务已停止。",
      restart_amkr: "服务已重启。",
      install_user_amkr: "登录启动任务已注册。",
      status_amkr: "任务状态已查询。",
      uninstall_amkr: "登录启动任务已取消。",
      install_system_amkr: "系统级服务已注册。",
      uninstall_system_amkr: "系统级服务已取消。",
      start_system_amkr: "系统级服务已启动。",
      stop_system_amkr: "系统级服务已停止。",
      restart_system_amkr: "系统级服务已重启。",
    }[action];
  }

  async function runServiceAction(action: AmkrServiceAction) {
    setServiceAction(action);
    setServiceActionError(null);
    setServiceActionNotice(null);
    setServiceCommandOutput("");
    try {
      const results = await controlAmkr(action, selectedConfigPath);
      if (["start_amkr", "restart_amkr", "install_system_amkr", "start_system_amkr", "restart_system_amkr"].includes(action)) {
        setHealth(await waitForServiceHealth());
        setHealthError(null);
      } else if (["stop_amkr", "uninstall_amkr", "stop_system_amkr", "uninstall_system_amkr"].includes(action)) {
        setHealth(null);
        setHealthError(null);
      }
      setServiceActionNotice(serviceNotice(action));
      setServiceCommandOutput(formatServiceCommandResults(results));
    } catch (error: unknown) {
      setServiceActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setServiceAction(null);
    }
  }

  function requestServiceAction(action: AmkrServiceAction) {
    if (action === "uninstall_amkr" && !window.confirm("取消登录启动任务？正在运行的服务也会停止。")) return;
    if (action === "install_system_amkr" && !window.confirm("注册系统级开机服务？Windows 将请求管理员授权。")) return;
    if (action === "uninstall_system_amkr" && !window.confirm("取消系统级服务？Windows 将请求管理员授权。")) return;
    void runServiceAction(action);
  }

  function formatServiceCommandResults(results: AmkrServiceCommandResult[]) {
    return results
      .flatMap((result) => [result.stdout, result.stderr].map((value) => value.trim()).filter(Boolean))
      .join("\n\n");
  }

  function applyConfigPath(configPath: string | null) {
    const normalized = configPath?.trim() || null;
    if (normalized) {
      localStorage.setItem(configPathStorageKey, normalized);
    } else {
      localStorage.removeItem(configPathStorageKey);
    }
    setSelectedConfigPath(normalized);
  }

  function applyUnifiedModel(unifiedModel: AmkrUnifiedModel | null) {
    setHealth((current) => current ? { ...current, unified_model: unifiedModel } : current);
  }

  async function enableUnifiedModel() {
    const model = health?.models?.[0];
    if (!model) {
      setActivePage("模型路由");
      return;
    }
    setUnifiedModelAction(true);
    setUnifiedModelError(null);
    try {
      const response = await updateAmkrUnifiedModel({ default: { primary: { model, key: null } } }, selectedConfigPath);
      applyUnifiedModel(response.unified_model);
    } catch (error: unknown) {
      setUnifiedModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setUnifiedModelAction(false);
    }
  }

  async function disableUnifiedModel() {
    setUnifiedModelPromptOpen(false);
    setUnifiedModelAction(true);
    setUnifiedModelError(null);
    try {
      await deleteAmkrUnifiedModel(selectedConfigPath);
      applyUnifiedModel(null);
    } catch (error: unknown) {
      setUnifiedModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setUnifiedModelAction(false);
    }
  }

  async function selectUnifiedModel(model: string) {
    if (!health?.unified_model || model === unifiedTarget?.model) return;
    setUnifiedModelAction(true);
    setUnifiedModelError(null);
    try {
      const current = health.unified_model;
      const response = await updateAmkrUnifiedModel({
        ...current,
        default: {
          ...current.default,
          primary: { model, key: null },
          fallback: current.default.fallback?.model === model ? null : current.default.fallback,
        },
      }, selectedConfigPath);
      applyUnifiedModel(response.unified_model);
    } catch (error: unknown) {
      setUnifiedModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setUnifiedModelAction(false);
    }
  }

  async function copyLocalApiKey() {
    setLocalKeyCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("当前环境不支持复制 Key");
      await navigator.clipboard.writeText(await getAmkrLocalApiKey(selectedConfigPath));
      showCopyToast("Key 已复制");
    } catch (error: unknown) {
      setLocalKeyCopyError(error instanceof Error ? error.message : String(error));
    }
  }

  function applyCloseBehavior(behavior: CloseBehavior) {
    setCloseBehavior(behavior);
    if (behavior === "ask") localStorage.removeItem(closeBehaviorStorageKey);
    else localStorage.setItem(closeBehaviorStorageKey, behavior);
  }

  async function applyAmkrWidgetEnabled(enabled: boolean) {
    const previous = amkrWidgetEnabled;
    setAmkrWidgetEnabled(enabled);
    localStorage.setItem(widgetEnabledStorageKey, String(enabled));
    try {
      await setAmkrWidgetVisible(enabled);
    } catch (error) {
      setAmkrWidgetEnabled(previous);
      localStorage.setItem(widgetEnabledStorageKey, String(previous));
      throw error;
    }
  }

  function performWindowClose(behavior: Exclude<CloseBehavior, "ask">) {
    if (rememberCloseChoice) applyCloseBehavior(behavior);
    setClosePromptOpen(false);
    const appWindow = getCurrentWindow();
    if (behavior === "tray") void appWindow.hide();
    else void appWindow.close();
  }

  function requestWindowClose() {
    if (closeBehavior === "ask") {
      setRememberCloseChoice(false);
      setClosePromptOpen(true);
    } else {
      performWindowClose(closeBehavior);
    }
  }

  async function initializeLocalInstance() {
    setInitializationInProgress(true);
    setServiceActionError(null);
    setServiceActionNotice(null);
    let initialized: AmkrMetadata | null = null;
    try {
      initialized = await initializeDefaultAmkrConfig();
      await controlAmkr("install_user_amkr", initialized.config_path);
      await controlAmkr("start_amkr", initialized.config_path);
      setMetadata(initialized);
      setHealth(await waitForServiceHealth(initialized.config_path));
      setHealthError(null);
      setDiscoveryError(null);
      setServiceActionNotice("默认配置已创建，服务已启动并注册登录启动。");
    } catch (error: unknown) {
      setServiceActionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (initialized) applyConfigPath(initialized.config_path);
      setInitializationInProgress(false);
    }
  }

  function beginSidebarDrag(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as Element).closest("button, input, select, textarea, a")) return;
    sidebarDragStart.current = { x: event.clientX, y: event.clientY };
  }

  function moveSidebarDrag(event: ReactMouseEvent<HTMLElement>) {
    const start = sidebarDragStart.current;
    if (!start) return;
    if ((event.buttons & 1) === 0) {
      sidebarDragStart.current = null;
      return;
    }
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return;
    sidebarDragStart.current = null;
    void getCurrentWindow().startDragging();
  }

  return (
    <div className="app-frame">
      <div className="app-shell">
      <aside
        aria-label="主导航"
        className="sidebar"
        onMouseDown={beginSidebarDrag}
        onMouseLeave={moveSidebarDrag}
        onMouseMove={moveSidebarDrag}
        onMouseUp={() => { sidebarDragStart.current = null; }}
      >
        <div className="sidebar-window-row">
          <div aria-label="窗口控制" className="window-controls">
            <button aria-label="关闭窗口" className="window-close" title="关闭" type="button" onClick={requestWindowClose}>
              <span aria-hidden="true">×</span>
            </button>
            <button aria-label="最小化窗口" className="window-minimize" title="最小化" type="button" onClick={() => void getCurrentWindow().minimize()}>
              <span aria-hidden="true">−</span>
            </button>
          </div>
          <div className="window-drag-region" data-tauri-drag-region />
        </div>
        <div className="brand-block" data-tauri-drag-region>
          <h1 className="brand-title">Keyloom</h1>
          <span>AMKR v{health?.version ?? "—"}</span>
          <span>Keyloom v{packageMetadata.version}</span>
        </div>
        <nav>
          {primaryNavigation.map((label) => (
            <button
              aria-current={activePage === label ? "page" : undefined}
              key={label}
              type="button"
              onClick={() => setActivePage(label)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-service">
          <button
            aria-current={activePage === "服务状态" ? "page" : undefined}
            aria-label={`服务状态：${serviceState}`}
            aria-live="polite"
            type="button"
            onClick={() => setActivePage("服务状态")}
          >
            <span aria-hidden="true" className={`status-dot status-${serviceTone}`}>●</span>
            {serviceState}
          </button>
        </div>
      </aside>
      <main className="content">
        {activePage === "概览" && metadata ? (
          <>
            <header className="overview-header">
              <h2>概览</h2>
              <p className="overview-service-summary">
                <button aria-label={`复制服务地址 ${metadata.base_url}`} className="service-address-button" title="复制服务地址" type="button" onClick={() => void navigator.clipboard?.writeText(metadata.base_url).then(() => showCopyToast("地址已复制")).catch(() => undefined)}>{metadata.base_url}</button>
                <span aria-hidden="true">·</span>
                {localAuthEnabled
                  ? <button aria-label="获取本地鉴权 Key" className="auth-status-button status-good" title="复制本地鉴权 Key" type="button" onClick={() => void copyLocalApiKey()}>本地鉴权已启用</button>
                  : <span className="status-bad">本地鉴权未启用</span>}
              </p>
            </header>
            {localKeyCopyError ? <p className="service-action-error" role="alert">本地鉴权 Key 获取失败: {localKeyCopyError}</p> : null}
            <div className="overview-cards">
              <section
                className={`overview-card unified-model-card ${unifiedTarget ? "is-enabled" : "is-disabled"}`}
                aria-labelledby="unified-model-heading"
                onClick={(event) => { if (!(event.target as Element).closest("button, select")) setActivePage("模型路由"); }}
              >
                <div className="card-heading"><h3 id="unified-model-heading">统一模型</h3><button className={unifiedTarget ? "status-bad" : "status-good"} disabled={unifiedModelAction} type="button" onClick={() => unifiedTarget ? setUnifiedModelPromptOpen(true) : void enableUnifiedModel()}>{unifiedTarget ? "关闭" : "启用"}</button></div>
                {unifiedTarget ? <select aria-label="快速选择统一模型" className="unified-model-quick-select" disabled={unifiedModelAction} value={unifiedModel} onChange={(event) => void selectUnifiedModel(event.target.value)}>
                  {Array.from(new Set([unifiedModel, ...(health?.models ?? [])])).map((model) => <option key={model} value={model}>{model}</option>)}
                </select> : <strong>{unifiedModel}</strong>}
                <p>{unifiedModelRouting}</p>
              </section>
              <section
                className="overview-card metrics-overview-card"
                aria-labelledby="metrics-heading"
                role="link"
                tabIndex={0}
                onClick={() => setActivePage("活动")}
                onKeyDown={(event) => { if (event.key === "Enter") setActivePage("活动"); }}
              >
                <div className="card-heading"><h3 id="metrics-heading">数据总览</h3>{metricsError && metrics ? <span aria-label="指标数据状态" className="status-warn" role="status">上次成功数据</span> : <span>最近 60 分钟</span>}</div>
                {metrics ? (
                  <dl className="metric-grid">
                    <div><dt>请求</dt><dd>{formatCount(metrics.total.requests)}</dd></div>
                    <div><dt>Token</dt><dd>{formatTokens(metrics.total.total_tokens)}</dd></div>
                    <div><dt>缓存命中</dt><dd className="status-good">{Math.round(metrics.total.cached_token_rate * 100)}%</dd></div>
                    <div><dt>RPM</dt><dd>{metrics.current_rpm == null ? "--" : formatCount(metrics.current_rpm)}</dd></div>
                    <div><dt>TPM</dt><dd>{metrics.current_tpm == null ? "--" : formatCount(metrics.current_tpm)}</dd></div>
                    <div><dt>平均延迟</dt><dd>{formatDuration(metrics.total.avg_duration_ms)}</dd></div>
                  </dl>
                ) : <p className="empty-state" role={metricsError ? "alert" : undefined}>指标暂不可用</p>}
              </section>
            </div>
            <section className="trend-panel" aria-labelledby="trend-heading">
              <div className="card-heading">
                <h3 id="trend-heading">近十分钟用量</h3>
              </div>
              <UsageChart history={metricHistory} metric={trendMetric} onMetricChange={setTrendMetric} />
            </section>
            <section className="activity-panel" aria-label="最近活动">
              {latestSnapshot ? (
                <div className="recent-activity-grid">
                  <div><span className="status-good">●</span> 指标采样成功 <b>{formatCount(latestSnapshot.requests)} 请求</b></div>
                  <div><span className="status-warn">●</span> 缓存命中 <b>{latestSnapshot.cached_tokens === null ? "缓存数据暂不可用" : `${formatTokens(latestSnapshot.cached_tokens)} tokens`}</b></div>
                </div>
              ) : <p className="empty-state">暂无来自服务的近期活动。</p>}
            </section>
            {unifiedModelError ? <p className="service-action-error" role="alert">统一模型操作失败: {unifiedModelError}</p> : null}
            {serviceActionError ? <p className="service-action-error">服务操作失败: {serviceActionError}</p> : null}
          </>
        ) : activePage === "概览" ? (
          discoveryError ? (
            <section className="onboarding-page" aria-busy={initializationInProgress} aria-labelledby="onboarding-heading">
              <h2 id="onboarding-heading">开始使用 Keyloom</h2>
              <p className="empty-state" role="alert">未找到可用的 AMKR 配置。</p>
              <p className={runtimeStatus?.private_runtime_installed ? "status-good" : "status-muted"} role="status">
                {runtimeStatusLoading
                  ? "正在检查 Keyloom 私有运行时"
                  : runtimeStatus?.private_runtime_installed
                    ? "私有运行时已就绪"
                    : "未检测到 Keyloom 私有运行时"}
              </p>
              {runtimeStatus?.private_runtime_installed ? <code>{runtimeStatus.runtime_dir}</code> : null}
              {runtimeStatusError ? <p className="service-action-error" role="alert">运行时状态读取失败: {runtimeStatusError}</p> : null}
              {serviceActionError ? <p className="service-action-error" role="alert">初始化失败: {serviceActionError}</p> : null}
              <div className="onboarding-actions">
                <button
                  className="primary-action"
                  type="button"
                  disabled={runtimeStatusLoading || !runtimeStatus?.private_runtime_installed || initializationInProgress}
                  onClick={() => void initializeLocalInstance()}
                >
                  {initializationInProgress ? "正在创建并启动" : "创建默认配置并启动"}
                </button>
                <button className="secondary-button" type="button" disabled={initializationInProgress} onClick={() => setActivePage("设置")}>选择已有配置</button>
              </div>
            </section>
          ) : <><h2>概览</h2><p role="status">正在查找本机 AMKR 服务。</p></>
        ) : activePage === "服务状态" ? (
          <section className="service-page" aria-labelledby="service-heading">
            <header className="page-header">
              <div><h2 id="service-heading">服务状态</h2><p>{serviceState}</p></div>
              <div className="service-controls" aria-label="服务控制">
                <button type="button" disabled={serviceAction !== null || serviceRunning || !metadata} onClick={() => requestServiceAction("start_amkr")}>{serviceAction === "start_amkr" ? "正在启动" : "启动服务"}</button>
                <button type="button" disabled={serviceAction !== null || !serviceRunning} onClick={() => requestServiceAction("stop_amkr")}>{serviceAction === "stop_amkr" ? "正在停止" : "停止服务"}</button>
                <button type="button" disabled={serviceAction !== null || !serviceRunning} onClick={() => requestServiceAction("restart_amkr")}>{serviceAction === "restart_amkr" ? "正在重启" : "重启服务"}</button>
                <button type="button" disabled={serviceAction !== null || !metadata} onClick={() => requestServiceAction("install_user_amkr")}>{serviceAction === "install_user_amkr" ? "正在注册" : "注册登录启动"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("status_amkr")}>{serviceAction === "status_amkr" ? "正在查询" : "查询任务"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("uninstall_amkr")}>{serviceAction === "uninstall_amkr" ? "正在取消" : "取消注册"}</button>
              </div>
            </header>
            {metadata ? <dl className="connection-summary"><div><dt>本机服务</dt><dd>{metadata.base_url}</dd></div><div><dt>选择配置</dt><dd>{metadata.config_path}</dd></div>{configMismatch ? <div><dt>运行配置</dt><dd>{health?.config_path}</dd></div> : null}<div><dt>本地鉴权</dt><dd>{metadata.auth_enabled ? "已启用" : "未启用"}</dd></div></dl> : discoveryError ? (
              <>
                <p className="empty-state" role="alert">未找到可用的 AMKR 配置。</p>
                <div className="onboarding-actions">
                  <button className="primary-action" type="button" onClick={() => setActivePage("概览")}>返回首次设置</button>
                  <button className="secondary-button" type="button" onClick={() => setActivePage("设置")}>选择已有配置</button>
                </div>
              </>
            ) : <p className="empty-state">正在查找本机 AMKR 配置。</p>}
            {configMismatch ? <p className="status-warn" role="alert">当前服务使用的配置与 Keyloom 选择的配置不一致。请重启服务以应用当前配置。</p> : null}
            <section className="system-service-panel" aria-labelledby="system-service-heading">
              <div className="card-heading"><h3 id="system-service-heading">系统级服务</h3><span>Windows UAC</span></div>
              <div className="service-controls" aria-label="系统级服务控制">
                <button type="button" disabled={serviceAction !== null || !metadata} onClick={() => requestServiceAction("install_system_amkr")}>{serviceAction === "install_system_amkr" ? "正在注册" : "注册开机服务"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("start_system_amkr")}>{serviceAction === "start_system_amkr" ? "正在启动" : "启动"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("stop_system_amkr")}>{serviceAction === "stop_system_amkr" ? "正在停止" : "停止"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("restart_system_amkr")}>{serviceAction === "restart_system_amkr" ? "正在重启" : "重启"}</button>
                <button className="danger-button" type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("uninstall_system_amkr")}>{serviceAction === "uninstall_system_amkr" ? "正在取消" : "取消系统服务"}</button>
              </div>
            </section>
            {serviceActionNotice ? <p className="status-good">{serviceActionNotice}</p> : null}
            {serviceCommandOutput ? <pre className="service-command-output">{serviceCommandOutput}</pre> : null}
            {serviceActionError ? <p className="service-action-error">服务操作失败: {serviceActionError}</p> : null}
          </section>
        ) : incompatibleVersion && ["供应商", "模型路由", "集成"].includes(activePage) ? (
          <section className="compatibility-page" aria-labelledby="compatibility-heading">
            <h2 id="compatibility-heading">后端版本不兼容</h2>
            <p role="alert">当前 AMKR {health?.version}，Keyloom 至少需要 {minimumCompatibleAmkrVersion}。升级前仅开放只读诊断、活动和设置。</p>
            <button className="primary-action" type="button" onClick={() => setActivePage("设置")}>打开更新设置</button>
          </section>
        ) : activePage === "供应商" ? <ProvidersPage configPath={selectedConfigPath} /> : activePage === "模型路由" ? <RoutingPage configPath={selectedConfigPath} onUnifiedModelChange={applyUnifiedModel} /> : activePage === "活动" ? <ActivityPage configPath={selectedConfigPath} metrics={metrics} />
          : activePage === "集成" ? <IntegrationsPage configPath={selectedConfigPath} baseUrl={metadata?.base_url ?? null} authEnabled={metadata?.auth_enabled ?? false} />
          : <SettingsPage amkrWidgetEnabled={amkrWidgetEnabled} closeBehavior={closeBehavior} configPath={selectedConfigPath} metadata={metadata} health={health} onAmkrWidgetEnabledChange={applyAmkrWidgetEnabled} onCloseBehaviorChange={applyCloseBehavior} onConfigPathChange={applyConfigPath} />}
      </main>
      </div>
      {closePromptOpen ? <div className="close-dialog-backdrop" onKeyDown={(event) => { if (event.key === "Escape") setClosePromptOpen(false); }}>
        <section aria-labelledby="close-dialog-heading" aria-modal="true" className="close-dialog" role="dialog">
          <h2 id="close-dialog-heading">关闭 Keyloom？</h2>
          <p>退出应用，或继续在系统托盘中运行。</p>
          <label className="close-dialog-remember"><input checked={rememberCloseChoice} type="checkbox" onChange={(event) => setRememberCloseChoice(event.target.checked)} />记住我的选择</label>
          <div className="close-dialog-actions">
            <button autoFocus className="secondary-button" type="button" onClick={() => setClosePromptOpen(false)}>取消</button>
            <button className="tray-action" type="button" onClick={() => performWindowClose("tray")}>缩小至托盘</button>
            <button className="danger-button" type="button" onClick={() => performWindowClose("quit")}>退出 Keyloom</button>
          </div>
        </section>
      </div> : null}
      {unifiedModelPromptOpen ? <div className="close-dialog-backdrop" onKeyDown={(event) => { if (event.key === "Escape") setUnifiedModelPromptOpen(false); }}>
        <section aria-labelledby="unified-model-dialog-heading" aria-modal="true" className="close-dialog" role="dialog">
          <h2 id="unified-model-dialog-heading">关闭统一模型？</h2>
          <p>关闭后，统一入口将不再接管请求。</p>
          <div className="close-dialog-actions">
            <button autoFocus className="secondary-button" type="button" onClick={() => setUnifiedModelPromptOpen(false)}>取消</button>
            <button className="danger-button" type="button" onClick={() => void disableUnifiedModel()}>确认关闭</button>
          </div>
        </section>
      </div> : null}
      {copyToast}
    </div>
  );
}
