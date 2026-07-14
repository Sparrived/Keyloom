import { useState } from "react";
import type { MetricSnapshot } from "./useMetricHistory";

export type UsageMetric = "RPM" | "TPM" | "缓存率";

type UsageChartProps = {
  history: readonly MetricSnapshot[];
  metric: UsageMetric;
  onMetricChange?: (metric: UsageMetric) => void;
};

const metrics: UsageMetric[] = ["RPM", "TPM", "缓存率"];

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

function formatPointTime(timestamp: string, includeSeconds = true) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(timestamp));
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
  if (metric === "RPM") {
    return snapshot.current_rpm;
  }
  return metric === "TPM" ? snapshot.current_tpm : snapshot.cached_token_rate * 100;
}

function formatSeriesValue(value: number | null, metric: UsageMetric) {
  if (value === null) return "暂不可用";
  if (metric === "缓存率") return `${value.toFixed(1)}%`;
  return `${formatCount(value)} ${metric === "RPM" ? "次/分" : "Token/分"}`;
}

function formatAxisValue(value: number, metric: UsageMetric) {
  if (metric === "缓存率") return `${Math.round(value)}%`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return formatCount(Math.round(value));
}

function niceMaximum(values: readonly number[], metric: UsageMetric) {
  if (metric === "缓存率") return 100;
  const maximum = Math.max(...values, 1);
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const interval = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return interval * magnitude;
}

export function UsageChart({ history, metric, onMetricChange }: UsageChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (history.length === 0) {
    return <><div className="series-switcher" aria-label="趋势指标">{metrics.map((series) => <button aria-pressed={metric === series} key={series} type="button" onClick={() => onMetricChange?.(series)}>{series}</button>)}</div><p className="trend-empty">正在收集真实用量数据，下一次采样后将在此显示趋势。</p></>;
  }

  const values = history.map((snapshot) => valueFor(snapshot, metric));
  const numericValues = values.filter((value): value is number => value !== null);
  const max = niceMaximum(numericValues, metric);
  const width = 640;
  const height = 160;
  const padding = 16;
  const points = values.map((value, index) => {
    if (value === null) return null;
    const x = history.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (history.length - 1);
    const y = height - padding - (value / max) * (height - padding * 2);
    return { x, y };
  });
  let previousPointExists = false;
  const path = points.map((point) => {
    if (!point) {
      previousPointExists = false;
      return "";
    }
    const command = previousPointExists ? "L" : "M";
    previousPointExists = true;
    return `${command}${point.x} ${point.y}`;
  }).join(" ");
  const currentValue = valueFor(history.at(-1)!, metric);
  const activeSnapshot = activeIndex === null ? null : history[activeIndex];
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const firstTimestamp = formatPointTime(history[0].timestamp, false);
  const lastTimestamp = formatPointTime(history.at(-1)!.timestamp, false);

  return (
    <>
      <div className="usage-chart-toolbar">
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
        <p className="usage-chart-current"><span>最新</span><strong>{formatSeriesValue(currentValue, metric)}</strong></p>
      </div>
      <figure aria-label="用量趋势图" className="usage-chart">
        <div className="usage-chart-plot">
          <div aria-hidden="true" className="usage-chart-y-axis">
            <span>{formatAxisValue(max, metric)}</span>
            <span>{formatAxisValue(max / 2, metric)}</span>
            <span>{formatAxisValue(0, metric)}</span>
          </div>
          <div className="usage-chart-canvas">
            <svg aria-label={`${metric}趋势`} role="img" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
              <path className="usage-chart-grid" d={`M${padding} ${padding}H${width - padding} M${padding} ${height / 2}H${width - padding} M${padding} ${height - padding}H${width - padding}`} />
              <path className="usage-chart-line" d={path} />
              {points.map((point, index) => point ? <circle className={index === activeIndex ? "is-selected" : undefined} cx={point.x} cy={point.y} key={history[index].timestamp} r={index === activeIndex ? "5" : "3"} /> : null)}
            </svg>
            {numericValues.length === 0 ? <p className="usage-chart-unavailable">当前 AMKR 版本未提供 {metric} 指标。</p> : null}
            <div aria-label="历史数据点" className="usage-chart-points">
              {history.map((snapshot, index) => {
                const value = valueFor(snapshot, metric);
                return (
                  <button
                    aria-label={formatPointTime(snapshot.timestamp)}
                    aria-description={`${formatTime(snapshot.timestamp)} ${metric} ${formatSeriesValue(value, metric)}`}
                    aria-pressed={index === activeIndex}
                    key={snapshot.timestamp}
                    type="button"
                    onBlur={() => setActiveIndex(null)}
                    onClick={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                  />
                );
              })}
            </div>
            {activeSnapshot && activePoint ? (
              <dl
                aria-label="所选用量快照"
                className={`usage-chart-tooltip ${activePoint.x < width / 3 ? "is-right" : activePoint.x > width * 2 / 3 ? "is-left" : "is-center"}`}
                role="status"
                style={{
                  left: `${(activePoint.x / width) * 100}%`,
                  top: `${Math.min(65, Math.max(35, (activePoint.y / height) * 100))}%`,
                }}
              >
                <div><dt>时间</dt><dd>{formatTime(activeSnapshot.timestamp)}</dd></div>
                <div><dt>RPM / TPM</dt><dd>{formatMetricValue(activeSnapshot.current_rpm)} / {formatMetricValue(activeSnapshot.current_tpm)}</dd></div>
                <div><dt>近 60 分钟请求</dt><dd>{formatCount(activeSnapshot.requests)}</dd></div>
                <div><dt>输入 Token</dt><dd>{formatMetricValue(activeSnapshot.prompt_tokens)}</dd></div>
                <div><dt>输出 Token</dt><dd>{formatMetricValue(activeSnapshot.completion_tokens)}</dd></div>
                <div><dt>近 60 分钟 Token</dt><dd>{formatCount(activeSnapshot.total_tokens)}</dd></div>
                <div><dt>缓存命中率</dt><dd>{formatPercent(activeSnapshot.cached_token_rate)}</dd></div>
                <div><dt>成功率</dt><dd>{
                  activeSnapshot.successes === null || activeSnapshot.failures === null || activeSnapshot.successes + activeSnapshot.failures === 0
                    ? "暂不可用"
                    : formatPercent(activeSnapshot.successes / (activeSnapshot.successes + activeSnapshot.failures))
                }</dd></div>
                <div><dt>平均延迟</dt><dd>{formatDuration(activeSnapshot.avg_duration_ms)}</dd></div>
              </dl>
            ) : null}
          </div>
        </div>
        <div aria-hidden="true" className={`usage-chart-x-axis${history.length === 1 ? " is-single" : ""}`}><span>{firstTimestamp}</span>{history.length > 1 ? <span>{lastTimestamp}</span> : null}</div>
        <figcaption>RPM、TPM 为过去 1 分钟的滚动速率；缓存率为最近 60 分钟汇总。</figcaption>
      </figure>
    </>
  );
}
