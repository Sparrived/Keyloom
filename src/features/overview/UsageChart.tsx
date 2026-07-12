import { useEffect, useState } from "react";
import type { MetricSnapshot } from "./useMetricHistory";

export type UsageMetric = "请求" | "Token" | "缓存";

type UsageChartProps = {
  history: readonly MetricSnapshot[];
  metric: UsageMetric;
  onMetricChange?: (metric: UsageMetric) => void;
};

const metrics: UsageMetric[] = ["请求", "Token", "缓存"];

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).format(new Date(timestamp)).replaceAll("/", "-");
}

function formatPointTime(timestamp: string) {
  return timestamp.slice(11, 16);
}

function formatDuration(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMetricValue(value: number | null) {
  return value === null ? "暂不可用" : formatCount(value);
}

function valueFor(snapshot: MetricSnapshot, metric: UsageMetric) {
  if (metric === "请求") {
    return snapshot.requests;
  }
  return metric === "Token" ? snapshot.total_tokens : snapshot.cached_tokens ?? 0;
}

export function UsageChart({ history, metric, onMetricChange }: UsageChartProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(history.length - 1, 0));
  const latestTimestamp = history.at(-1)?.timestamp;
  useEffect(() => setSelectedIndex(Math.max(history.length - 1, 0)), [history.length, latestTimestamp]);
  const selectedSnapshot = history[Math.min(selectedIndex, Math.max(history.length - 1, 0))];

  if (history.length === 0) {
    return <><div className="series-switcher" aria-label="趋势指标">{metrics.map((series) => <button aria-pressed={metric === series} key={series} type="button" onClick={() => onMetricChange?.(series)}>{series}</button>)}</div><p className="trend-empty">正在收集真实用量数据，下一次采样后将在此显示趋势。</p></>;
  }

  const values = history.map((snapshot) => valueFor(snapshot, metric));
  const max = Math.max(...values, 1);
  const width = 640;
  const height = 160;
  const padding = 16;
  const points = values.map((value, index) => {
    const x = history.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (history.length - 1);
    const y = height - padding - (value / max) * (height - padding * 2);
    return { x, y };
  });
  const path = points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");

  return (
    <>
      <div className="series-switcher" aria-label="趋势指标">
        {metrics.map((series) => (
          <button
            aria-pressed={metric === series}
            key={series}
            type="button"
            onClick={() => onMetricChange?.(series)}
          >
            {series}
          </button>
        ))}
      </div>
      <figure aria-label="用量趋势图" className="usage-chart">
        <svg aria-label={`${metric}趋势`} role="img" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <path className="usage-chart-grid" d={`M${padding} ${height - padding}H${width - padding}`} />
          <path className="usage-chart-line" d={path} />
          {points.map(({ x, y }, index) => <circle cx={x} cy={y} key={history[index].timestamp} r="3" />)}
        </svg>
        <div aria-label="历史数据点" className="usage-chart-points">
          {history.map((snapshot, index) => (
            <button
              aria-label={formatPointTime(snapshot.timestamp)}
              aria-description={`${formatTime(snapshot.timestamp)} ${metric} ${formatCount(valueFor(snapshot, metric))}`}
              className={index === selectedIndex ? "is-selected" : undefined}
              key={snapshot.timestamp}
              type="button"
              onClick={() => setSelectedIndex(index)}
              onFocus={() => setSelectedIndex(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            />
          ))}
        </div>
        <figcaption>基于本次运行期间成功获取的汇总指标。</figcaption>
      </figure>
      {selectedSnapshot ? (
        <aside aria-label="所选用量快照" className="usage-chart-detail" role="status">
          <p>时间 {formatTime(selectedSnapshot.timestamp)}</p>
          <p>请求 {formatCount(selectedSnapshot.requests)}</p>
          <p>输入 Token {formatMetricValue(selectedSnapshot.prompt_tokens)}</p>
          <p>输出 Token {formatMetricValue(selectedSnapshot.completion_tokens)}</p>
          <p>总 Token {formatCount(selectedSnapshot.total_tokens)}</p>
          <p>缓存 {formatMetricValue(selectedSnapshot.cached_tokens)}</p>
          <p>成功率 {
            selectedSnapshot.successes === null || selectedSnapshot.failures === null || selectedSnapshot.successes + selectedSnapshot.failures === 0
              ? "暂不可用"
              : formatPercent(selectedSnapshot.successes / (selectedSnapshot.successes + selectedSnapshot.failures))
          }</p>
          <p>平均延迟 {formatDuration(selectedSnapshot.avg_duration_ms)}</p>
        </aside>
      ) : null}
    </>
  );
}
