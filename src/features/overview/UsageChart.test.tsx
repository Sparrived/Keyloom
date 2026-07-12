import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageChart } from "./UsageChart";

const history = [
  { timestamp: "2026-07-12T10:00:00.000Z", requests: 12, total_tokens: 1_001, cached_token_rate: 0.325, cached_tokens: 325, avg_duration_ms: 450 },
  { timestamp: "2026-07-12T10:15:00.000Z", requests: 24, total_tokens: 2_000, cached_token_rate: 0.5, cached_tokens: 1_000, avg_duration_ms: 900 },
];

describe("UsageChart", () => {
  it("shows real metric details for a selected data point", () => {
    render(<UsageChart history={history} metric="请求" onMetricChange={() => undefined} />);
    fireEvent.focus(screen.getByRole("button", { name: "10:15" }));
    expect(screen.getByLabelText("用量趋势图")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("请求 24");
    expect(screen.getByRole("status")).toHaveTextContent("总 Token 2,000");
    expect(screen.getByRole("status")).toHaveTextContent("缓存 1,000");
    expect(screen.getByRole("status")).toHaveTextContent("平均延迟 900ms");
  });

  it("explains when no real history has been observed", () => {
    render(<UsageChart history={[]} metric="缓存" onMetricChange={() => undefined} />);
    expect(screen.getByText("正在收集真实用量数据，下一次采样后将在此显示趋势。")).toBeInTheDocument();
  });
});
