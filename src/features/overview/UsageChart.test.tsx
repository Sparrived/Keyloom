import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageChart } from "./UsageChart";

const history = [
  { timestamp: "2026-07-12T10:00:00.000Z", requests: 12, successes: 10, failures: 2, prompt_tokens: 600, completion_tokens: 401, total_tokens: 1_001, cached_token_rate: 0.325, cached_tokens: 325, avg_duration_ms: 450 },
  { timestamp: "2026-07-12T10:15:00.000Z", requests: 30, successes: 22, failures: 2, prompt_tokens: 1_200, completion_tokens: 800, total_tokens: 2_000, cached_token_rate: 0.5, cached_tokens: 1_000, avg_duration_ms: 900 },
];

describe("UsageChart", () => {
  it("shows real metric details for a selected data point", () => {
    render(<UsageChart history={history} metric="请求" onMetricChange={() => undefined} />);
    fireEvent.focus(screen.getByRole("button", { name: "10:15" }));
    expect(screen.getByLabelText("用量趋势图")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("请求 30");
    expect(screen.getByRole("status")).toHaveTextContent("总 Token 2,000");
    expect(screen.getByRole("status")).toHaveTextContent("输入 Token 1,200");
    expect(screen.getByRole("status")).toHaveTextContent("输出 Token 800");
    expect(screen.getByRole("status")).toHaveTextContent("缓存 1,000");
    expect(screen.getByRole("status")).toHaveTextContent("成功率 91.7%");
    expect(screen.getByRole("status")).toHaveTextContent("平均延迟 900ms");
  });

  it("updates the selected detail on pointer hover as well as keyboard focus", () => {
    const { container } = render(<UsageChart history={history} metric="请求" onMetricChange={() => undefined} />);
    const firstPoint = screen.getByRole("button", { name: "10:00" });
    fireEvent.mouseEnter(firstPoint);
    expect(screen.getByRole("status")).toHaveTextContent("请求 12");
    expect(firstPoint).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll("circle")[0]).toHaveClass("is-selected");
    expect(container.querySelectorAll("circle")[1]).not.toHaveClass("is-selected");
  });

  it("selects a new latest sample when bounded history keeps the same length", () => {
    const { rerender } = render(<UsageChart history={history} metric="请求" />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "10:00" }));
    rerender(<UsageChart history={[history[1], { ...history[1], timestamp: "2026-07-12T10:30:00.000Z", requests: 36 }]} metric="请求" />);
    expect(screen.getByRole("status")).toHaveTextContent("请求 36");
  });

  it("explains when no real history has been observed", () => {
    render(<UsageChart history={[]} metric="缓存" onMetricChange={() => undefined} />);
    expect(screen.getByText("正在收集真实用量数据，下一次采样后将在此显示趋势。")).toBeInTheDocument();
  });

  it("shows unavailable instead of fabricating legacy metric details", () => {
    render(<UsageChart history={[{ ...history[0], successes: null, failures: null, prompt_tokens: null, completion_tokens: null, cached_tokens: null }]} metric="缓存" />);
    expect(screen.getByRole("status")).toHaveTextContent("输入 Token 暂不可用");
    expect(screen.getByRole("status")).toHaveTextContent("输出 Token 暂不可用");
    expect(screen.getByRole("status")).toHaveTextContent("缓存 暂不可用");
    expect(screen.getByRole("status")).toHaveTextContent("成功率 暂不可用");
  });
});
