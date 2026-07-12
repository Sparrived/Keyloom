import { describe, expect, it } from "vitest";
import type { AmkrMetrics } from "../../api/amkr";
import { appendMetricSnapshot } from "./useMetricHistory";

const metrics: AmkrMetrics = {
  total: {
    requests: 12,
    total_tokens: 1_001,
    cached_token_rate: 0.325,
    avg_duration_ms: 450,
  },
};

describe("appendMetricSnapshot", () => {
  it("appends an aggregate metrics snapshot with calculated cached tokens", () => {
    expect(appendMetricSnapshot([], metrics, "2026-07-12T10:00:00.000Z")).toEqual([
      {
        timestamp: "2026-07-12T10:00:00.000Z",
        requests: 12,
        total_tokens: 1_001,
        cached_token_rate: 0.325,
        avg_duration_ms: 450,
        cached_tokens: 325,
      },
    ]);
  });

  it("keeps the most recent 60 snapshots", () => {
    const history = Array.from({ length: 60 }, (_, index) => ({
      timestamp: `2026-07-12T10:${String(index).padStart(2, "0")}:00.000Z`,
      requests: index,
      total_tokens: index * 100,
      cached_token_rate: 0.5,
      avg_duration_ms: 100,
      cached_tokens: index * 50,
    }));

    const result = appendMetricSnapshot(history, metrics, "2026-07-12T11:00:00.000Z");

    expect(result).toHaveLength(60);
    expect(result[0]).toBe(history[1]);
    expect(result.at(-1)).toMatchObject({ timestamp: "2026-07-12T11:00:00.000Z" });
  });

  it("does not mutate the supplied history or samples", () => {
    const history = [
      {
        timestamp: "2026-07-12T09:00:00.000Z",
        requests: 1,
        total_tokens: 100,
        cached_token_rate: 0.2,
        avg_duration_ms: 100,
        cached_tokens: 20,
      },
    ];
    const originalSnapshot = history[0];

    const result = appendMetricSnapshot(history, metrics, "2026-07-12T10:00:00.000Z");

    expect(history).toEqual([originalSnapshot]);
    expect(result).not.toBe(history);
    expect(result[0]).toBe(originalSnapshot);
  });
});
