import { useEffect, useRef, useState } from "react";
import {
  controlAmkr,
  discoverAmkr,
  getAmkrHealth,
  getAmkrMetrics,
  type AmkrHealth,
  type AmkrMetrics,
  type AmkrMetadata,
  type AmkrServiceCommandResult,
  type AmkrServiceAction,
  type AmkrUnifiedModel,
} from "./api/amkr";
import { UsageChart, type UsageMetric } from "./features/overview/UsageChart";
import { appendMetricSnapshot, type MetricSnapshot } from "./features/overview/useMetricHistory";
import { ActivityPage } from "./features/activity/ActivityPage";
import { IntegrationsPage } from "./features/integrations/IntegrationsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { ProvidersPage } from "./features/providers/ProvidersPage";
import { RoutingPage } from "./features/routing/RoutingPage";

const primaryNavigation = ["概览", "供应商", "模型路由", "活动", "集成", "设置"] as const;
const navigation = [...primaryNavigation, "服务状态"] as const;
type NavigationItem = (typeof navigation)[number];
const configPathStorageKey = "keyloom.configPath";
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
  const activePageRef = useRef<NavigationItem>(activePage);
  activePageRef.current = activePage;
  const [selectedConfigPath, setSelectedConfigPath] = useState<string | null>(() => localStorage.getItem(configPathStorageKey));
  const [trendMetric, setTrendMetric] = useState<UsageMetric>("请求");
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
        }
        const result = await discoverAmkr(selectedConfigPath);
        if (!cancelled) {
          setMetadata(result);
        }
        await refreshHealth();
        await refreshMetrics();
        healthPoll = window.setInterval(() => void refreshHealth(), 5_000);
        metricsPoll = window.setInterval(() => {
          if (activePageRef.current !== "活动") void refreshMetrics();
        }, 15_000);
      } catch (error: unknown) {
        if (!cancelled) {
          setMetadata(null);
          setHealth(null);
          setDiscoveryError(error instanceof Error ? error.message : String(error));
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
          setMetricHistory((history) => appendMetricSnapshot(history, metricsResult, now()));
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
  const serviceState = serviceUnavailable
    ? "服务未连接"
    : health?.status === "ok"
      ? configMismatch ? "配置不一致" : "服务运行中"
    : metadata
      ? "服务未运行"
      : "正在查找服务";
  const serviceTone = serviceUnavailable ? "bad" : health?.status === "ok" ? configMismatch ? "warn" : "good" : "muted";
  const serviceRunning = health?.status === "ok";
  const unifiedPlan = health?.unified_model?.default;
  const unifiedTarget = unifiedPlan?.primary;
  const unifiedTargetCount = unifiedPlan ? 1 + (unifiedPlan.fallback ? 1 : 0) : 0;
  const unifiedModel = unifiedTarget?.model ?? "未设置";
  const unifiedModelRouting = unifiedTarget
    ? `${unifiedTarget.key ? `固定 Key · ${unifiedTarget.key}` : "自动路由"} · ${unifiedTargetCount} 个目标`
    : "尚未配置统一路由";
  const unifiedModelStatus = unifiedTarget ? "已启用" : "未启用";
  const latestSnapshot = metricHistory.at(-1);

  async function waitForServiceHealth() {
    let lastError: unknown = new Error("服务未在预期时间内就绪");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await getAmkrHealth(selectedConfigPath);
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
    }[action];
  }

  async function runServiceAction(action: AmkrServiceAction) {
    setServiceAction(action);
    setServiceActionError(null);
    setServiceActionNotice(null);
    setServiceCommandOutput("");
    try {
      const results = await controlAmkr(action, selectedConfigPath);
      if (action === "start_amkr" || action === "restart_amkr") {
        setHealth(await waitForServiceHealth());
        setHealthError(null);
      } else if (action === "stop_amkr" || action === "uninstall_amkr") {
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

  return (
    <div className="app-shell">
      <aside aria-label="主导航" className="sidebar">
        <div className="brand-block">
          <h1>Keyloom</h1>
          <span>AMKR 控制面</span>
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
          <span className="sidebar-section-label">服务</span>
          <button
            aria-current={activePage === "服务状态" ? "page" : undefined}
            aria-label="服务状态"
            type="button"
            onClick={() => setActivePage("服务状态")}
          >
            <span aria-hidden="true" className={`status-dot status-${serviceTone}`}>●</span>
            {serviceState}
          </button>
          <p aria-label="服务状态" className="service-state" role="status">
            {serviceState}
          </p>
        </div>
      </aside>
      <main className="content" aria-live="polite">
        {activePage === "概览" && metadata ? (
          <>
            <header className="overview-header">
              <div>
                <h2>概览</h2>
                <p>
                  <span>本机路由服务 · </span>
                  <span>{metadata.base_url}</span>
                  <span> · </span>
                  <span>{metadata.auth_enabled ? "本地鉴权已启用" : "本地鉴权未启用"}</span>
                </p>
              </div>
              <button className="primary-action" type="button" onClick={() => setActivePage("服务状态")}>打开服务</button>
            </header>
            <div className="overview-cards">
              <section className="overview-card unified-model-card" aria-labelledby="unified-model-heading">
                <div className="card-heading"><h3 id="unified-model-heading">统一模型</h3><button type="button" onClick={() => setActivePage("模型路由")}>切换</button></div>
                <strong>{unifiedModel}</strong>
                <p>{unifiedModelRouting}</p>
                <span className={unifiedTarget ? "status-good" : "status-muted"}>{unifiedModelStatus}</span>
              </section>
              <section className="overview-card" aria-labelledby="metrics-heading">
                <div className="card-heading"><h3 id="metrics-heading">数据总览</h3>{metricsError && metrics ? <span aria-label="指标数据状态" className="status-warn" role="status">上次成功数据</span> : <span>最近 60 分钟</span>}</div>
                {metrics ? (
                  <dl className="metric-grid">
                    <div><dt>请求</dt><dd>{formatCount(metrics.total.requests)}</dd></div>
                    <div><dt>Token</dt><dd>{formatTokens(metrics.total.total_tokens)}</dd></div>
                    <div><dt>缓存命中</dt><dd className="status-good">{Math.round(metrics.total.cached_token_rate * 100)}%</dd></div>
                    <div><dt>平均延迟</dt><dd>{formatDuration(metrics.total.avg_duration_ms)}</dd></div>
                  </dl>
                ) : <p className="empty-state" role={metricsError ? "alert" : undefined}>指标暂不可用</p>}
              </section>
            </div>
            <section className="trend-panel" aria-labelledby="trend-heading">
              <div className="card-heading">
                <div><h3 id="trend-heading">用量趋势</h3><span>最近 60 分钟</span></div>
              </div>
              <UsageChart history={metricHistory} metric={trendMetric} onMetricChange={setTrendMetric} />
            </section>
            <section className="activity-panel" aria-labelledby="activity-heading">
              <div className="card-heading"><h3 id="activity-heading">最近活动</h3><button type="button" onClick={() => setActivePage("活动")}>查看全部 ›</button></div>
              {latestSnapshot ? (
                <div className="recent-activity-grid">
                  <div><span className="status-good">●</span> 指标采样成功 <b>{formatCount(latestSnapshot.requests)} 请求</b></div>
                  <div><span className="status-warn">●</span> 缓存命中 <b>{latestSnapshot.cached_tokens === null ? "缓存数据暂不可用" : `${formatTokens(latestSnapshot.cached_tokens)} tokens`}</b></div>
                </div>
              ) : <p className="empty-state">暂无来自服务的近期活动。</p>}
            </section>
            {serviceActionError ? <p className="service-action-error">服务操作失败: {serviceActionError}</p> : null}
          </>
        ) : activePage === "概览" ? (
          <><h2>概览</h2><p>{discoveryError ? "未找到可用的 AMKR 配置。" : "正在查找本机 AMKR 服务。"}</p></>
        ) : activePage === "服务状态" ? (
          <section className="service-page" aria-labelledby="service-heading">
            <header className="page-header">
              <div><h2 id="service-heading">服务状态</h2><p>{serviceState}</p></div>
              <div className="service-controls" aria-label="服务控制">
                <button type="button" disabled={serviceAction !== null || serviceRunning} onClick={() => requestServiceAction("start_amkr")}>{serviceAction === "start_amkr" ? "正在启动" : "启动服务"}</button>
                <button type="button" disabled={serviceAction !== null || !serviceRunning} onClick={() => requestServiceAction("stop_amkr")}>{serviceAction === "stop_amkr" ? "正在停止" : "停止服务"}</button>
                <button type="button" disabled={serviceAction !== null || !serviceRunning} onClick={() => requestServiceAction("restart_amkr")}>{serviceAction === "restart_amkr" ? "正在重启" : "重启服务"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("install_user_amkr")}>{serviceAction === "install_user_amkr" ? "正在注册" : "注册登录启动"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("status_amkr")}>{serviceAction === "status_amkr" ? "正在查询" : "查询任务"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => requestServiceAction("uninstall_amkr")}>{serviceAction === "uninstall_amkr" ? "正在取消" : "取消注册"}</button>
              </div>
            </header>
            {metadata ? <dl className="connection-summary"><div><dt>本机服务</dt><dd>{metadata.base_url}</dd></div><div><dt>选择配置</dt><dd>{metadata.config_path}</dd></div>{configMismatch ? <div><dt>运行配置</dt><dd>{health?.config_path}</dd></div> : null}<div><dt>本地鉴权</dt><dd>{metadata.auth_enabled ? "已启用" : "未启用"}</dd></div></dl> : <p className="empty-state">正在查找本机 AMKR 配置。</p>}
            {configMismatch ? <p className="status-warn" role="alert">当前服务使用的配置与 Keyloom 选择的配置不一致。请重启服务以应用当前配置。</p> : null}
            {serviceActionNotice ? <p className="status-good">{serviceActionNotice}</p> : null}
            {serviceCommandOutput ? <pre className="service-command-output">{serviceCommandOutput}</pre> : null}
            {serviceActionError ? <p className="service-action-error">服务操作失败: {serviceActionError}</p> : null}
          </section>
        ) : activePage === "供应商" ? <ProvidersPage configPath={selectedConfigPath} /> : activePage === "模型路由" ? <RoutingPage configPath={selectedConfigPath} onUnifiedModelChange={applyUnifiedModel} /> : activePage === "活动" ? <ActivityPage configPath={selectedConfigPath} history={metricHistory} />
          : activePage === "集成" ? <IntegrationsPage configPath={selectedConfigPath} baseUrl={metadata?.base_url ?? null} authEnabled={metadata?.auth_enabled ?? false} />
          : <SettingsPage configPath={selectedConfigPath} metadata={metadata} health={health} onConfigPathChange={applyConfigPath} />}
      </main>
    </div>
  );
}
