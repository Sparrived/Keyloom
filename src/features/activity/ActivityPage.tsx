import { useEffect, useState } from "react";
import { readAmkrLogTail, type AmkrMetrics, type AmkrUsageStats } from "../../api/amkr";
import type { MetricSnapshot } from "../overview/useMetricHistory";

type ActivityPageProps = { configPath: string | null; history: readonly MetricSnapshot[]; metrics?: AmkrMetrics | null };

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit", hour12: false }).format(new Date(timestamp));
}


function successRate(stats: AmkrUsageStats) {
  return stats.requests ? `${Math.round(((stats.successes ?? 0) / stats.requests) * 100)}%` : "-";
}

export function ActivityPage({ configPath, history, metrics = null }: ActivityPageProps) {
  const snapshots = [...history].reverse();
  const modelRows = Object.entries(metrics?.models ?? {}).sort(([, left], [, right]) => right.requests - left.requests);
  const keyRows = Object.entries(metrics?.keys ?? {}).flatMap(([model, keys]) => Object.entries(keys).map(([key, stats]) => ({ model, key, stats }))).sort((left, right) => right.stats.requests - left.stats.requests);
  const [logTail, setLogTail] = useState("");
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try { const result = await readAmkrLogTail(configPath); if (!cancelled) { setLogTail(result); setLogError(null); } }
      catch (reason) { if (!cancelled) setLogError(reason instanceof Error ? reason.message : String(reason)); }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [configPath]);
  return <section className="activity-page" aria-labelledby="activity-heading">
    <header className="page-header"><div><h2 id="activity-heading">活动</h2><p>本次运行期间从 AMKR 获取的真实用量快照。</p></div><span className="config-revision">{history.length} 个快照</span></header>
    {metrics ? <dl className="live-metrics" aria-label="实时流量">
      <div><dt>RPM</dt><dd>{metrics.current_rpm ?? 0}</dd></div>
      <div><dt>TPM</dt><dd>{(metrics.current_tpm ?? 0).toLocaleString("zh-CN")}</dd></div>
      <div><dt>活动请求</dt><dd>{metrics.active_requests ?? 0}</dd></div>
      <div><dt>路由状态</dt><dd>{metrics.router_status ?? "空闲"}</dd></div>
    </dl> : null}
    {snapshots.length === 0 ? <p className="empty-state">尚未获取到可用的服务指标。</p> : <ol className="activity-list">{snapshots.map((snapshot) => <li key={snapshot.timestamp}><time dateTime={snapshot.timestamp}>{formatTime(snapshot.timestamp)}</time><div><strong>{snapshot.requests.toLocaleString("zh-CN")} 个请求</strong><span>{snapshot.total_tokens.toLocaleString("zh-CN")} Token，缓存 {snapshot.cached_tokens === null ? "暂不可用" : `${snapshot.cached_tokens.toLocaleString("zh-CN")} Token`}，平均延迟 {snapshot.avg_duration_ms}ms</span></div></li>)}</ol>}
    <section className="activity-breakdown" aria-labelledby="models-activity-heading"><div className="card-heading"><h3 id="models-activity-heading">模型用量</h3><span>{modelRows.length} 个模型</span></div>{modelRows.length ? <table><thead><tr><th>模型</th><th>请求</th><th>成功率</th><th>Token</th><th>延迟</th></tr></thead><tbody>{modelRows.map(([model, stats]) => <tr key={model}><th scope="row">{model}</th><td>{stats.requests.toLocaleString("zh-CN")}</td><td>{successRate(stats)}</td><td>{stats.total_tokens.toLocaleString("zh-CN")}</td><td>{stats.avg_duration_ms}ms</td></tr>)}</tbody></table> : <p className="empty-state">暂无模型调用数据。</p>}</section>
    <section className="activity-breakdown" aria-labelledby="keys-activity-heading"><div className="card-heading"><h3 id="keys-activity-heading">Key 用量</h3><span>{keyRows.length} 个 Key</span></div>{keyRows.length ? <table><thead><tr><th>模型 / Key</th><th>请求</th><th>成功率</th><th>Token</th><th>延迟</th></tr></thead><tbody>{keyRows.map(({ model, key, stats }) => <tr key={`${model}:${key}`}><th scope="row">{model} / {key}</th><td>{stats.requests.toLocaleString("zh-CN")}</td><td>{successRate(stats)}</td><td>{stats.total_tokens.toLocaleString("zh-CN")}</td><td>{stats.avg_duration_ms}ms</td></tr>)}</tbody></table> : <p className="empty-state">暂无 Key 调用数据。</p>}</section>
    <section className="log-panel" aria-labelledby="log-heading"><div className="card-heading"><h3 id="log-heading">服务日志</h3><span>最近 64 KiB</span></div>{logError ? <p className="empty-state">日志暂不可用: {logError}</p> : logTail ? <pre>{logTail}</pre> : <p className="empty-state">正在读取服务日志。</p>}</section>
  </section>;
}
