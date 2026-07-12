import { useEffect, useState } from "react";
import {
  controlAmkr,
  discoverAmkr,
  getAmkrHealth,
  getAmkrMetrics,
  type AmkrHealth,
  type AmkrMetrics,
  type AmkrMetadata,
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
function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatTokens(value: number) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : formatCount(value);
}

function formatDuration(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms`;
}

type AppProps = {
  now?: () => string;
};

export default function App({ now = () => new Date().toISOString() }: AppProps) {
  const [activePage, setActivePage] = useState<NavigationItem>("概览");
  const [trendMetric, setTrendMetric] = useState<UsageMetric>("请求");
  const [metadata, setMetadata] = useState<AmkrMetadata | null>(null);
  const [health, setHealth] = useState<AmkrHealth | null>(null);
  const [metrics, setMetrics] = useState<AmkrMetrics | null>(null);
  const [metricHistory, setMetricHistory] = useState<MetricSnapshot[]>([]);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [serviceAction, setServiceAction] = useState<"start_amkr" | "stop_amkr" | "restart_amkr" | null>(null);
  const [serviceActionError, setServiceActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let healthPoll: number | undefined;
    let metricsPoll: number | undefined;

    async function refreshHealth() {
      try {
        const healthResult = await getAmkrHealth();
        if (!cancelled) {
          setHealth(healthResult);
          setHealthError(null);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setHealth(null);
          setHealthError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    async function refreshMetrics() {
      try {
        const metricsResult = await getAmkrMetrics();
        if (!cancelled && metricsResult?.total) {
          setMetrics(metricsResult);
          setMetricHistory((history) => appendMetricSnapshot(history, metricsResult, now()));
        }
      } catch {
        if (!cancelled) {
          setMetrics(null);
        }
      }
    }

    async function discoverService() {
      try {
        const result = await discoverAmkr();
        if (!cancelled) {
          setMetadata(result);
        }
        await refreshHealth();
        await refreshMetrics();
        healthPoll = window.setInterval(() => void refreshHealth(), 5_000);
        metricsPoll = window.setInterval(() => void refreshMetrics(), 15_000);
      } catch (error: unknown) {
        if (!cancelled) {
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
  }, []);

  const serviceState = health?.status === "ok"
    ? "服务运行中"
    : healthError || discoveryError
      ? "服务未连接"
    : metadata
      ? "服务未运行"
      : "正在查找服务";
  const serviceTone = health?.status === "ok" ? "good" : healthError || discoveryError ? "bad" : "muted";
  const unifiedModel = health?.unified_model?.default?.primary?.model ?? "未设置";
  const latestSnapshot = metricHistory.at(-1);

  async function runServiceAction(action: "start_amkr" | "stop_amkr" | "restart_amkr") {
    setServiceAction(action);
    setServiceActionError(null);
    try {
      await controlAmkr(action);
      setHealth(await getAmkrHealth());
    } catch (error: unknown) {
      setServiceActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setServiceAction(null);
    }
  }

  return (
    <main className="app-shell">
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
      <section className="content" aria-live="polite">
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
                <div className="card-heading"><h3 id="unified-model-heading">统一模型</h3><button type="button">切换</button></div>
                <strong>{unifiedModel}</strong>
                <p>{unifiedModel === "未设置" ? "尚未配置统一路由" : "自动路由"}</p>
                <span className={health?.status === "ok" ? "status-good" : "status-muted"}>{serviceState}</span>
              </section>
              <section className="overview-card" aria-labelledby="metrics-heading">
                <div className="card-heading"><h3 id="metrics-heading">数据总览</h3><span>最近 60 分钟</span></div>
                {metrics ? (
                  <dl className="metric-grid">
                    <div><dt>请求</dt><dd>{formatCount(metrics.total.requests)}</dd></div>
                    <div><dt>Token</dt><dd>{formatTokens(metrics.total.total_tokens)}</dd></div>
                    <div><dt>缓存命中</dt><dd className="status-good">{Math.round(metrics.total.cached_token_rate * 100)}%</dd></div>
                    <div><dt>平均延迟</dt><dd>{formatDuration(metrics.total.avg_duration_ms)}</dd></div>
                  </dl>
                ) : <p className="empty-state">指标暂不可用</p>}
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
                  <div><span className="status-warn">●</span> 缓存命中 <b>{formatTokens(latestSnapshot.cached_tokens)} tokens</b></div>
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
                <button type="button" disabled={serviceAction !== null} onClick={() => void runServiceAction("start_amkr")}>{serviceAction === "start_amkr" ? "正在启动" : "启动服务"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => void runServiceAction("stop_amkr")}>{serviceAction === "stop_amkr" ? "正在停止" : "停止服务"}</button>
                <button type="button" disabled={serviceAction !== null} onClick={() => void runServiceAction("restart_amkr")}>{serviceAction === "restart_amkr" ? "正在重启" : "重启服务"}</button>
              </div>
            </header>
            {metadata ? <dl className="connection-summary"><div><dt>本机服务</dt><dd>{metadata.base_url}</dd></div><div><dt>配置文件</dt><dd>{metadata.config_path}</dd></div><div><dt>本地鉴权</dt><dd>{metadata.auth_enabled ? "已启用" : "未启用"}</dd></div></dl> : <p className="empty-state">正在查找本机 AMKR 配置。</p>}
            {serviceActionError ? <p className="service-action-error">服务操作失败: {serviceActionError}</p> : null}
          </section>
        ) : activePage === "供应商" ? <ProvidersPage /> : activePage === "模型路由" ? <RoutingPage /> : activePage === "活动" ? <ActivityPage history={metricHistory} />
          : activePage === "集成" ? <IntegrationsPage baseUrl={metadata?.base_url ?? null} authEnabled={metadata?.auth_enabled ?? false} />
            : <SettingsPage metadata={metadata} />}
      </section>
    </main>
  );
}
