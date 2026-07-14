import { describe, expect, it } from "vitest";
import type { AmkrMetrics } from "../../api/amkr";
import { appendMetricSnapshot } from "./useMetricHistory";

const metrics: AmkrMetrics = {
  current_rpm: 7,
  current_tpm: 840,
  total: {
    requests: 12,
    successes: 11,
    failures: 1,
    prompt_tokens: 700,
    completion_tokens: 301,
    total_tokens: 1_001,
    cached_token_rate: 0.325,
    cached_tokens: 77,
    avg_duration_ms: 450,
  },
};

describe("appendMetricSnapshot", () => {
  it("appends real token and outcome fields without deriving cached tokens", () => {
    expect(appendMetricSnapshot([], metrics, "2026-07-12T10:00:00.000Z")).toEqual([
      {
        timestamp: "2026-07-12T10:00:00.000Z",
        current_rpm: 7,
        current_tpm: 840,
        requests: 12,
        successes: 11,
        failures: 1,
        prompt_tokens: 700,
        completion_tokens: 301,
        total_tokens: 1_001,
        cached_token_rate: 0.325,
        avg_duration_ms: 450,
        cached_tokens: 77,
      },
    ]);
  });

  it("keeps the most recent 240 snapshots", () => {
    const history = Array.from({ length: 240 }, (_, index) => ({
      timestamp: `2026-07-12T10:${String(index).padStart(2, "0")}:00.000Z`,
      current_rpm: index,
      current_tpm: index * 100,
      requests: index,
      successes: index,
      failures: 0,
      prompt_tokens: index * 100,
      completion_tokens: index * 50,
      total_tokens: index * 100,
      cached_token_rate: 0.5,
      avg_duration_ms: 100,
      cached_tokens: index * 50,
    }));

    const result = appendMetricSnapshot(history, metrics, "2026-07-12T11:00:00.000Z");

    expect(result).toHaveLength(240);
    expect(result[0]).toBe(history[1]);
    expect(result.at(-1)).toMatchObject({ timestamp: "2026-07-12T11:00:00.000Z" });
  });

  it("replaces the last snapshot when two samples share a timestamp", () => {
    const timestamp = "2026-07-12T10:00:00.000Z";
    const first = appendMetricSnapshot([], metrics, timestamp);
    const result = appendMetricSnapshot(first, { total: { ...metrics.total, requests: 99 } }, timestamp);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ timestamp, requests: 99 });
    expect(first[0]).toMatchObject({ timestamp, requests: 12 });
  });

  it("does not mutate the supplied history or samples", () => {
    const history = [
      {
        timestamp: "2026-07-12T09:00:00.000Z",
        current_rpm: 1,
        current_tpm: 100,
        requests: 1,
        successes: 1,
        failures: 0,
        prompt_tokens: 80,
        completion_tokens: 20,
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

  it("keeps unavailable fields unknown for older AMKR responses", () => {
    const legacy: AmkrMetrics = {
      total: { requests: 12, total_tokens: 1_001, cached_token_rate: 0.325, avg_duration_ms: 450 },
    };

    expect(appendMetricSnapshot([], legacy, "2026-07-12T10:00:00.000Z")[0]).toMatchObject({
      current_rpm: null,
      current_tpm: null,
      cached_tokens: null,
      successes: null,
      failures: null,
      prompt_tokens: null,
      completion_tokens: null,
    });
  });
});
