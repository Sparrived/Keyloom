import { useEffect, useState } from "react";
import { readAmkrLogTail } from "../../api/amkr";
import type { MetricSnapshot } from "../overview/useMetricHistory";

type ActivityPageProps = { history: readonly MetricSnapshot[] };

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit", hour12: false }).format(new Date(timestamp));
}

export function ActivityPage({ history }: ActivityPageProps) {
  const snapshots = [...history].reverse();
  const [logTail, setLogTail] = useState("");
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try { const result = await readAmkrLogTail(); if (!cancelled) { setLogTail(result); setLogError(null); } }
      catch (reason) { if (!cancelled) setLogError(reason instanceof Error ? reason.message : String(reason)); }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);
  return <section className="activity-page" aria-labelledby="activity-heading">
    <header className="page-header"><div><h2 id="activity-heading">活动</h2><p>本次运行期间从 AMKR 获取的真实用量快照。</p></div><span className="config-revision">{history.length} 个快照</span></header>
    {snapshots.length === 0 ? <p className="empty-state">尚未获取到可用的服务指标。</p> : <ol className="activity-list">{snapshots.map((snapshot) => <li key={snapshot.timestamp}><time dateTime={snapshot.timestamp}>{formatTime(snapshot.timestamp)}</time><div><strong>{snapshot.requests.toLocaleString("zh-CN")} 个请求</strong><span>{snapshot.total_tokens.toLocaleString("zh-CN")} Token，缓存 {snapshot.cached_tokens.toLocaleString("zh-CN")} Token，平均延迟 {snapshot.avg_duration_ms}ms</span></div></li>)}</ol>}
    <section className="log-panel" aria-labelledby="log-heading"><div className="card-heading"><h3 id="log-heading">服务日志</h3><span>最近 64 KiB</span></div>{logError ? <p className="empty-state">日志暂不可用: {logError}</p> : logTail ? <pre>{logTail}</pre> : <p className="empty-state">正在读取服务日志。</p>}</section>
  </section>;
}
