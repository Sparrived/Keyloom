import type { AmkrMetrics } from "../../api/amkr";

export type MetricSnapshot = AmkrMetrics["total"] & {
  timestamp: string;
  current_rpm: number | null;
  current_tpm: number | null;
  cached_tokens: number | null;
  successes: number | null;
  failures: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

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

  if (history.at(-1)?.timestamp === timestamp) {
    return [...history.slice(0, -1), snapshot];
  }
  return [...history, snapshot].slice(-240);
}
