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

  it("saves displayed upstream target order immediately after dropping", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");
    const rows = screen.getByLabelText("model-a 的路由目标").querySelectorAll("li");
    fireEvent.pointerDown(rows[1], { button: 0 });
    fireEvent.pointerEnter(rows[0]);
    fireEvent.pointerUp(rows[0]);

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
