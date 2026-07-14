import type { AmkrMetricHistoryPoint, AmkrMetrics } from "../../api/amkr";

export type MetricSnapshot = Omit<AmkrMetricHistoryPoint, "current_rpm" | "current_tpm" | "cached_tokens" | "successes" | "failures" | "prompt_tokens" | "completion_tokens"> & {
  current_rpm: number | null;
  current_tpm: number | null;
  cached_tokens: number | null;
  successes: number | null;
  failures: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

export const metricHistoryWindowMs = 10 * 60 * 1_000;

export function appendMetricSnapshot(
  history: readonly MetricSnapshot[],
  metrics: AmkrMetrics,
  timestamp: string,
): MetricSnapshot[] {
  const snapshot: MetricSnapshot = {
    timestamp,
    ...metrics.total,
    current_rpm: metrics.current_rpm ?? null,
    current_tpm: metrics.current_tpm ?? null,
    cached_tokens: metrics.total.cached_tokens ?? null,
    successes: metrics.total.successes ?? null,
    failures: metrics.total.failures ?? null,
    prompt_tokens: metrics.total.prompt_tokens ?? null,
    completion_tokens: metrics.total.completion_tokens ?? null,
  };

  const next = history.at(-1)?.timestamp === timestamp
    ? [...history.slice(0, -1), snapshot]
    : [...history, snapshot];
  const cutoff = new Date(timestamp).getTime() - metricHistoryWindowMs;
  return next.filter((item) => new Date(item.timestamp).getTime() >= cutoff);
}
