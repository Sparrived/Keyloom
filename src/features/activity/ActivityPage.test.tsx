import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActivityPage } from "./ActivityPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("request completed") }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue("request completed");
});

afterEach(() => vi.restoreAllMocks());

it("renders live, model, and key metrics returned by AMKR", async () => {
  const stats = { requests: 12, successes: 11, failures: 1, retries: 2, prompt_tokens: 3000, completion_tokens: 1200, total_tokens: 4200, cached_tokens: 750, cached_token_rate: 0.25, avg_duration_ms: 320, avg_first_token_ms: 80 };
  render(<ActivityPage configPath={null} metrics={{
    total: stats,
    current_rpm: 4,
    current_tpm: 900,
    router_status: "green",
    active_requests: 2,
    caller_types: { codex: stats },
    models: { "model-a": stats },
    keys: { "model-a": { main: stats } },
  }} />);

  const summary = screen.getByRole("table", { name: "用量总览" });
  expect(summary).toHaveTextContent("当前流量4 RPM / 900 TPM");
  expect(summary).toHaveTextContent("输入 / 输出 Token3K / 1.2K");
  expect(summary).toHaveTextContent("路由状态正常");
  expect(screen.getByRole("row", { name: "codex 12 92% 4.2K 25% 320ms" })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "model-a 12 92% 4.2K 25% 320ms" })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "model-a / main 12 92% 4.2K 25% 320ms" })).toBeInTheDocument();
  expect(screen.queryByText(/个快照/)).not.toBeInTheDocument();
  expect(await screen.findByText("request completed")).toBeInTheDocument();
});

it("opens the service log at the bottom and colors each log level", async () => {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(480);
  invokeMock.mockResolvedValue([
    "2026-07-14 DEBUG refreshing metrics",
    "2026-07-14 INFO request completed",
    "2026-07-14 WARNING retry scheduled",
    "2026-07-14 ERROR upstream unavailable",
    "2026-07-14 request finished",
  ].join("\n"));

  render(<ActivityPage configPath={null} />);

  const output = await screen.findByLabelText("服务日志内容");
  expect(output.scrollTop).toBe(480);
  expect(within(output).getByText(/DEBUG/)).toHaveClass("log-line-debug");
  expect(within(output).getByText(/INFO/)).toHaveClass("log-line-info");
  expect(within(output).getByText(/WARNING/)).toHaveClass("log-line-warning");
  expect(within(output).getByText(/ERROR/)).toHaveClass("log-line-error");
  expect(within(output).getByText(/request finished/)).toHaveClass("log-line-default");
});

it("keeps the current log position when the user is reading older entries", async () => {
  invokeMock.mockResolvedValue("older entry");
  const { rerender } = render(<ActivityPage configPath={null} />);

  const output = await screen.findByLabelText("服务日志内容");
  Object.defineProperty(output, "scrollHeight", { configurable: true, value: 480 });
  Object.defineProperty(output, "clientHeight", { configurable: true, value: 120 });
  output.scrollTop = 100;
  output.dispatchEvent(new Event("scroll"));

  invokeMock.mockResolvedValue("older entry\nnew entry");
  rerender(<ActivityPage configPath="changed" />);
  await screen.findByText("new entry");
  expect(output.scrollTop).toBe(100);
});

it("shows only a copy action for selected log text", async () => {
  invokeMock.mockResolvedValue("copy this log");
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  Object.assign(navigator, { clipboard });
  render(<ActivityPage configPath={null} />);

  const output = await screen.findByLabelText("服务日志内容");
  window.getSelection()?.selectAllChildren(output);
  fireEvent.contextMenu(output, { clientX: 20, clientY: 20 });

  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "复制" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));
  await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("copy this log"));
});
