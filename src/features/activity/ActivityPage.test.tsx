import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityPage } from "./ActivityPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("request completed") }));

afterEach(() => vi.restoreAllMocks());

it("renders live, model, and key metrics returned by AMKR", async () => {
  const stats = { requests: 12, successes: 11, total_tokens: 4200, cached_token_rate: 0.25, avg_duration_ms: 320 };
  render(<ActivityPage configPath={null} history={[]} metrics={{
    total: stats,
    current_rpm: 4,
    current_tpm: 900,
    router_status: "healthy",
    active_requests: 2,
    models: { "model-a": stats },
    keys: { "model-a": { main: stats } },
  }} />);

  expect(screen.getByLabelText("实时流量")).toHaveTextContent("RPM4");
  expect(screen.getByRole("row", { name: "model-a 12 92% 4,200 320ms" })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "model-a / main 12 92% 4,200 320ms" })).toBeInTheDocument();
  expect(await screen.findByText("request completed")).toBeInTheDocument();
});
