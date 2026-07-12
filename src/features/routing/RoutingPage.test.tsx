import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoutingPage } from "./RoutingPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

describe("RoutingPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      config_revision: "revision-a",
      routes: [{
        id: "model-a",
        aliases: ["alias-a"],
        routing_mode: "round_robin",
        targets: [
          { provider: "a.example.test", pool: "pool-a", upstream_model: "upstream-a" },
          { provider: "fallback.example.test", pool: "pool-fallback", upstream_model: "fallback-a" },
        ],
      }],
    });
  });

  it("edits an existing route with one mutation", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");
    expect(screen.getByRole("option", { name: "首 Key" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑路由 model-a" }));
    fireEvent.change(screen.getByLabelText("编辑模型 ID"), { target: { value: "model-b" } });
    fireEvent.change(screen.getByLabelText("编辑上游模型"), { target: { value: "upstream-b" } });
    fireEvent.change(screen.getByLabelText("编辑别名"), { target: { value: "alias-b" } });
    fireEvent.change(screen.getByLabelText("编辑模式"), { target: { value: "priority" } });
    fireEvent.click(screen.getByRole("button", { name: "保存路由" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_route", {
      configPath: "C:/amkr.json",
      configRevision: "revision-a",
      routeId: "model-a",
      id: "model-b",
      targets: [
        { provider: "a.example.test", pool: "pool-a", upstream_model: "upstream-b" },
        { provider: "fallback.example.test", pool: "pool-fallback", upstream_model: "fallback-a" },
      ],
      aliases: ["alias-b"],
      routingMode: "priority",
    }));
  });

  it("refreshes unified model candidates after creating a route", async () => {
    let modelReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_routes") return { config_revision: "revision-a", routes: [] };
      if (command === "get_amkr_models") {
        modelReads += 1;
        const model = { id: "model-a", aliases: [], routing_mode: "round_robin", reasoning_effort: null, visitor_available: false, keys: [] };
        return { models: modelReads === 1 ? [model] : [model, { ...model, id: "model-b" }] };
      }
      if (command === "get_amkr_unified_model") return { unified_model: null };
      if (command === "create_amkr_route") return undefined;
      return undefined;
    });

    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByRole("option", { name: "model-a" });
    fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "model-b" } });
    fireEvent.change(screen.getByLabelText("供应商"), { target: { value: "provider-a" } });
    fireEvent.change(screen.getByLabelText("模型池"), { target: { value: "pool-a" } });
    fireEvent.change(screen.getByLabelText("上游模型"), { target: { value: "upstream-b" } });
    fireEvent.click(screen.getByRole("button", { name: "添加路由" }));

    expect(await screen.findByRole("option", { name: "model-b" })).toBeInTheDocument();
    expect(modelReads).toBe(2);
  });
});
