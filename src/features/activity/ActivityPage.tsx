import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readAmkrLogTail, type AmkrMetrics, type AmkrUsageStats } from "../../api/amkr";

type ActivityPageProps = { configPath: string | null; metrics?: AmkrMetrics | null };

function formatCount(value: number | null | undefined) {
  return value == null ? "-" : value.toLocaleString("zh-CN");
}

function formatCompact(value: number | null | undefined) {
  if (value == null) return "-";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return formatCount(value);
}

function percent(value: number | null | undefined) {
  return value == null ? "-" : `${Math.round(value * 100)}%`;
}

function successRate(stats: AmkrUsageStats) {
  return stats.successes == null || !stats.requests ? "-" : percent(stats.successes / stats.requests);
}

function routerStatus(status: string | null | undefined) {
  if (status === "green" || status === "healthy" || status === "ok") return ["正常", "good"] as const;
  if (status === "yellow") return ["警告", "warn"] as const;
  if (status === "red") return ["异常", "bad"] as const;
  return [status ?? "空闲", "muted"] as const;
}

function logLineTone(line: string) {
  const level = line.match(/\b(?:trace|debug|info|warn(?:ing)?|error|fatal|critical)\b/i)?.[0].toLowerCase();
  if (level === "error" || level === "fatal" || level === "critical") return "error";
  if (level === "warn" || level === "warning") return "warning";
  if (level === "info") return "info";
  if (level === "debug" || level === "trace") return "debug";
  return "default";
}

export function ActivityPage({ configPath, metrics = null }: ActivityPageProps) {
  const callerRows = Object.entries(metrics?.caller_types ?? {}).sort(([, left], [, right]) => right.requests - left.requests);
  const modelRows = Object.entries(metrics?.models ?? {}).sort(([, left], [, right]) => right.requests - left.requests);
  const keyRows = Object.entries(metrics?.keys ?? {}).flatMap(([model, keys]) => Object.entries(keys).map(([key, stats]) => [`${model} / ${key}`, stats] as const)).sort(([, left], [, right]) => right.requests - left.requests);
  const breakdowns = [
    { id: "callers-activity-heading", title: "调用方用量", label: "调用方", rows: callerRows, empty: "暂无调用方数据。" },
    { id: "models-activity-heading", title: "模型用量", label: "模型", rows: modelRows, empty: "暂无模型调用数据。" },
    { id: "keys-activity-heading", title: "Key 用量", label: "模型 / Key", rows: keyRows, empty: "暂无 Key 调用数据。" },
  ];
  const [statusLabel, statusTone] = routerStatus(metrics?.router_status);
  const [logTail, setLogTail] = useState("");
  const [logError, setLogError] = useState<string | null>(null);
  const logOutputRef = useRef<HTMLPreElement>(null);
  const logPinnedToBottomRef = useRef(true);

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

  useLayoutEffect(() => {
    const output = logOutputRef.current;
    if (output && logPinnedToBottomRef.current) output.scrollTop = output.scrollHeight;
  }, [logError, logTail]);

  function handleLogScroll() {
    const output = logOutputRef.current;
    if (output) logPinnedToBottomRef.current = output.scrollHeight - output.scrollTop - output.clientHeight <= 8;
  }

  const logLines = logTail.split(/\r?\n/);
  return <section className="activity-page" aria-labelledby="activity-heading">
    <header className="page-header"><div><h2 id="activity-heading">活动</h2><p>按 CLI 统计口径汇总最近一小时的请求用量。</p></div><span className="config-revision">最近 1 小时</span></header>
    {metrics ? <section className="activity-summary" aria-labelledby="usage-summary-heading">
      <div className="card-heading"><h3 id="usage-summary-heading">用量总览</h3><span>实时更新</span></div>
      <div className="usage-table-shell"><table aria-label="用量总览" className="usage-summary-table"><tbody>
        <tr><th>总请求</th><td>{formatCount(metrics.total.requests)}</td><th>成功率</th><td>{successRate(metrics.total)}</td></tr>
        <tr><th>成功 / 失败</th><td>{metrics.total.successes == null && metrics.total.failures == null ? "-" : `${formatCount(metrics.total.successes)} / ${formatCount(metrics.total.failures)}`}</td><th>重试</th><td>{formatCount(metrics.total.retries)}</td></tr>
        <tr><th>输入 / 输出 Token</th><td>{formatCompact(metrics.total.prompt_tokens)} / {formatCompact(metrics.total.completion_tokens)}</td><th>缓存 Token</th><td>{formatCompact(metrics.total.cached_tokens)}</td></tr>
        <tr><th>当前流量</th><td>{formatCount(metrics.current_rpm ?? 0)} RPM / {formatCompact(metrics.current_tpm ?? 0)} TPM</td><th>缓存率</th><td>{percent(metrics.total.cached_token_rate)}</td></tr>
        <tr><th>活动请求</th><td>{formatCount(metrics.active_requests ?? 0)}</td><th>路由状态</th><td className={`status-${statusTone}`}>{statusLabel}</td></tr>
        <tr><th>平均首字</th><td>{metrics.total.avg_first_token_ms == null ? "-" : `${formatCount(metrics.total.avg_first_token_ms)}ms`}</td><th>平均耗时</th><td>{formatCount(metrics.total.avg_duration_ms)}ms</td></tr>
      </tbody></table></div>
    </section> : <p className="empty-state">尚未获取到可用的服务指标。</p>}
    {metrics ? breakdowns.map(({ id, title, label, rows, empty }) => <section className="activity-breakdown" aria-labelledby={id} key={id}>
      <div className="card-heading"><h3 id={id}>{title}</h3><span>{rows.length} 项</span></div>
      {rows.length ? <div className="usage-table-shell"><table className="usage-breakdown-table"><thead><tr><th>{label}</th><th>请求</th><th>成功率</th><th>Token</th><th>缓存率</th><th>平均耗时</th></tr></thead><tbody>{rows.map(([name, stats]) => <tr key={name}><th scope="row">{name}</th><td>{formatCount(stats.requests)}</td><td>{successRate(stats)}</td><td>{formatCompact(stats.total_tokens)}</td><td>{percent(stats.cached_token_rate)}</td><td>{formatCount(stats.avg_duration_ms)}ms</td></tr>)}</tbody></table></div> : <p className="empty-state">{empty}</p>}
    </section>) : null}
    <section className="log-panel" aria-labelledby="log-heading"><div className="card-heading"><h3 id="log-heading">服务日志</h3><span>最近 64 KiB</span></div>{logError ? <p className="empty-state">日志暂不可用: {logError}</p> : logTail ? <pre aria-label="服务日志内容" ref={logOutputRef} onScroll={handleLogScroll}>{logLines.map((line, index) => <span className={`log-line log-line-${logLineTone(line)}`} key={index}>{line}{index < logLines.length - 1 ? "\n" : ""}</span>)}</pre> : <p className="empty-state">正在读取服务日志。</p>}</section>
  </section>;
}
