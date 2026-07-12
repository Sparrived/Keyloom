import type { AmkrMetrics } from "../../api/amkr";

export type MetricSnapshot = AmkrMetrics["total"] & {
  timestamp: string;
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
    cached_tokens: metrics.total.cached_tokens ?? null,
    successes: metrics.total.successes ?? null,
    failures: metrics.total.failures ?? null,
    prompt_tokens: metrics.total.prompt_tokens ?? null,
    completion_tokens: metrics.total.completion_tokens ?? null,
  };

  return [...history, snapshot].slice(-240);
}
