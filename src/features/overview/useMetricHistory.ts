import type { AmkrMetrics } from "../../api/amkr";

export type MetricSnapshot = AmkrMetrics["total"] & {
  timestamp: string;
  cached_tokens: number;
};

export function appendMetricSnapshot(
  history: readonly MetricSnapshot[],
  metrics: AmkrMetrics,
  timestamp: string,
): MetricSnapshot[] {
  const snapshot: MetricSnapshot = {
    timestamp,
    ...metrics.total,
    cached_tokens: Math.round(metrics.total.total_tokens * metrics.total.cached_token_rate),
  };

  return [...history, snapshot].slice(-60);
}
