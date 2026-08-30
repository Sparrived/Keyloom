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
      routes: [{ id: "model-a", aliases: ["alias-a"], routing_mode: "round_robin", targets: [{ provider: "provider-a", pool: "pool-a", upstream_model: "model-a" }, { provider: "provider-b", pool: "pool-b", upstream_model: "model-b" }] }],
    });
  });

  it("shows only the selected model route panel", async () => {
    const routes = [
      { id: "model-a", aliases: ["alias-a"], routing_mode: "round_robin", targets: [{ provider: "provider-a", pool: "pool-a", upstream_model: "model-a" }] },
      { id: "model-b", aliases: ["alias-b"], routing_mode: "priority", targets: [{ provider: "provider-b", pool: "pool-b", upstream_model: "model-b" }] },
    ];
    invokeMock.mockImplementation(async (command) => command === "get_amkr_routes"
      ? { config_revision: "revision-a", routes }
      : command === "get_amkr_models" ? { models: [] } : { unified_model: null });

    render(<RoutingPage configPath={null} />);
    await screen.findByRole("tab", { name: "model-a" });

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "model-a" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("model-a 的路由目标")).toBeInTheDocument();
    expect(screen.queryByLabelText("model-b 的路由目标")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "model-b" }));

    expect(screen.getByRole("tab", { name: "model-b" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("model-b 的路由目标")).toBeInTheDocument();
    expect(screen.queryByLabelText("model-a 的路由目标")).not.toBeInTheDocument();
  });

  it("keeps unified model configuration out of the routing page", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);

    await screen.findByRole("heading", { name: "模型路由" });
    expect(screen.queryByRole("heading", { name: "统一模型" })).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("get_amkr_models", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("get_amkr_unified_model", expect.anything());
  });

  it("does not expose model or upstream target configuration", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");
    expect(screen.getByText("轮询")).toBeInTheDocument();
    expect(screen.queryByText("round_robin")).not.toBeInTheDocument();
    expect(screen.getByText("provider-a / pool-a / model-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑路由 model-a" }));

    expect(screen.queryByLabelText("编辑模型 ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("编辑模型池")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("编辑上游模型")).not.toBeInTheDocument();
    expect(screen.getByLabelText("编辑别名")).toBeInTheDocument();
    expect(screen.getByLabelText("编辑模式")).toBeInTheDocument();
  });

  it("updates only aliases and routing mode", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");
    fireEvent.click(screen.getByRole("button", { name: "编辑路由 model-a" }));
    fireEvent.change(screen.getByLabelText("编辑别名"), { target: { value: "alias-b" } });
    fireEvent.change(screen.getByLabelText("编辑模式"), { target: { value: "priority" } });
    fireEvent.click(screen.getByRole("button", { name: "保存路由" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_route", {
      configPath: "C:/amkr.json",
      configRevision: "revision-a",
      routeId: "model-a",
      targets: [
        { provider: "provider-a", pool: "pool-a", upstream_model: "model-a" },
        { provider: "provider-b", pool: "pool-b", upstream_model: "model-b" },
      ],
      aliases: ["alias-b"],
      routingMode: "priority",
    }));
  });

  it("saves displayed upstream target order when the drop preview has moved the source row", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");
    const targetList = screen.getByLabelText("model-a 的路由目标");
    const rows = targetList.querySelectorAll("li");
    fireEvent.pointerDown(rows[1], { button: 0 });
    fireEvent.pointerEnter(rows[0]);
    expect(targetList.querySelectorAll("li")[0]).toHaveTextContent("provider-b / pool-b / model-b");
    fireEvent.pointerUp(targetList.querySelectorAll("li")[0]);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_route", expect.objectContaining({
      targets: [
        { provider: "provider-b", pool: "pool-b", upstream_model: "model-b" },
        { provider: "provider-a", pool: "pool-a", upstream_model: "model-a" },
      ],
    })));
  });

  it("returns the target list to its original order when dragging is cancelled", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");
    const targetList = screen.getByLabelText("model-a 的路由目标");
    const rows = targetList.querySelectorAll("li");

    fireEvent.pointerDown(rows[1], { button: 0 });
    fireEvent.pointerEnter(rows[0]);
    expect(targetList.querySelectorAll("li")[0]).toHaveTextContent("provider-b / pool-b / model-b");
    fireEvent.pointerCancel(rows[0]);

    await waitFor(() => expect(targetList.querySelectorAll("li")[0]).toHaveTextContent("provider-a / pool-a / model-a"));
  });
});
