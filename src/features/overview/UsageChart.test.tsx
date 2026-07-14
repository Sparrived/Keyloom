import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageChart } from "./UsageChart";

const history = [
  { timestamp: "2026-07-12T10:00:00.000Z", current_rpm: 4, current_tpm: 900, requests: 12, successes: 10, failures: 2, prompt_tokens: 600, completion_tokens: 401, total_tokens: 1_001, cached_token_rate: 0.325, cached_tokens: 325, avg_duration_ms: 450 },
  { timestamp: "2026-07-12T10:15:00.000Z", current_rpm: 9, current_tpm: 1_800, requests: 30, successes: 22, failures: 2, prompt_tokens: 1_200, completion_tokens: 800, total_tokens: 2_000, cached_token_rate: 0.5, cached_tokens: 1_000, avg_duration_ms: 900 },
];

describe("UsageChart", () => {
  it("shows real metric details for a selected data point", () => {
    render(<UsageChart history={history} metric="RPM" onMetricChange={() => undefined} />);
    fireEvent.focus(screen.getByLabelText("历史数据点").querySelectorAll("button")[1]);
    expect(screen.getByLabelText("用量趋势图")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/RPM\s*9/);
    expect(screen.getByRole("status")).toHaveTextContent(/TPM\s*1,800/);
    expect(screen.getByRole("status")).toHaveTextContent(/近 60 分钟 Token\s*2,000/);
    expect(screen.getByRole("status")).toHaveTextContent(/输入 Token\s*1,200/);
    expect(screen.getByRole("status")).toHaveTextContent(/输出 Token\s*800/);
    expect(screen.getByRole("status")).toHaveTextContent(/缓存命中率\s*50.0%/);
    expect(screen.getByRole("status")).toHaveTextContent(/成功率\s*91.7%/);
    expect(screen.getByRole("status")).toHaveTextContent(/平均延迟\s*900ms/);
  });

  it("updates the selected detail on pointer hover as well as keyboard focus", () => {
    const { container } = render(<UsageChart history={history} metric="RPM" onMetricChange={() => undefined} />);
    const firstPoint = screen.getByLabelText("历史数据点").querySelectorAll("button")[0];
    fireEvent.mouseEnter(firstPoint);
    expect(screen.getByRole("status")).toHaveTextContent(/RPM\s*4/);
    expect(firstPoint).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll("circle")[0]).toHaveClass("is-selected");
    expect(container.querySelectorAll("circle")[1]).not.toHaveClass("is-selected");
  });

  it("selects a new latest sample when bounded history keeps the same length", () => {
    const { rerender } = render(<UsageChart history={history} metric="RPM" />);
    fireEvent.mouseEnter(screen.getByLabelText("历史数据点").querySelectorAll("button")[0]);
    rerender(<UsageChart history={[history[1], { ...history[1], timestamp: "2026-07-12T10:30:00.000Z", current_rpm: 36 }]} metric="RPM" />);
    expect(screen.getByRole("status")).toHaveTextContent(/RPM\s*36/);
  });

  it("uses live rate and cache percentage values instead of cumulative totals", () => {
    const { container, rerender } = render(<UsageChart history={history} metric="RPM" />);
    expect(container.querySelector(".usage-chart-current")).toHaveTextContent("9 次/分");

    rerender(<UsageChart history={history} metric="TPM" />);
    expect(container.querySelector(".usage-chart-current")).toHaveTextContent("1,800 Token/分");

    rerender(<UsageChart history={history} metric="缓存率" />);
    expect(container.querySelector(".usage-chart-current")).toHaveTextContent("50.0%");
  });

  it("shows time and value context for interpreting the chart", () => {
    render(<UsageChart history={history} metric="RPM" />);
    expect(document.querySelector(".usage-chart-x-axis")?.children).toHaveLength(2);
    expect(screen.getByText("RPM、TPM 为过去 1 分钟的滚动速率；缓存率为最近 60 分钟汇总。")).toBeInTheDocument();
  });

  it("explains when no real history has been observed", () => {
    render(<UsageChart history={[]} metric="缓存率" onMetricChange={() => undefined} />);
    expect(screen.getByText("正在收集真实用量数据，下一次采样后将在此显示趋势。")).toBeInTheDocument();
  });

  it("shows unavailable instead of fabricating legacy metric details", () => {
    render(<UsageChart history={[{ ...history[0], successes: null, failures: null, prompt_tokens: null, completion_tokens: null, cached_tokens: null }]} metric="缓存率" />);
    expect(screen.getByRole("status")).toHaveTextContent(/输入 Token\s*暂不可用/);
    expect(screen.getByRole("status")).toHaveTextContent(/输出 Token\s*暂不可用/);
    expect(screen.getByRole("status")).toHaveTextContent(/成功率\s*暂不可用/);
  });
});
