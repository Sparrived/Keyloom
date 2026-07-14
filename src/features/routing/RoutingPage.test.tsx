import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

    fireEvent.click(screen.getByRole("button", { name: "编辑路由 model-a" }));
    expect(screen.getByRole("option", { name: "首 Key" })).toBeInTheDocument();
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

  it("edits a secondary target without changing the primary target", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑路由 model-a" }));
    fireEvent.change(screen.getByLabelText("编辑上游模型 2"), { target: { value: "fallback-b" } });
    fireEvent.click(screen.getByRole("button", { name: "保存路由" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_route", {
      configPath: "C:/amkr.json",
      configRevision: "revision-a",
      routeId: "model-a",
      id: "model-a",
      targets: [
        { provider: "a.example.test", pool: "pool-a", upstream_model: "upstream-a" },
        { provider: "fallback.example.test", pool: "pool-fallback", upstream_model: "fallback-b" },
      ],
      aliases: ["alias-a"],
      routingMode: "round_robin",
    }));
  });

  it("keeps the only route target from being removed", async () => {
    invokeMock.mockResolvedValue({
      config_revision: "revision-a",
      routes: [{
        id: "model-a",
        aliases: [],
        routing_mode: "round_robin",
        targets: [{ provider: "a.example.test", pool: "pool-a", upstream_model: "upstream-a" }],
      }],
    });
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");
    fireEvent.click(screen.getByRole("button", { name: "编辑路由 model-a" }));

    expect(screen.getByRole("button", { name: "删除路由目标 1" })).toBeDisabled();
  });

  it("creates a route with multiple upstream targets", async () => {
    let created = false;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_routes") return {
        config_revision: created ? "revision-b" : "revision-a",
        routes: created ? [{
          id: "model-b",
          aliases: [],
          routing_mode: "round_robin",
          targets: [
            { provider: "provider-a", pool: "pool-a", upstream_model: "upstream-a" },
            { provider: "provider-b", pool: "pool-b", upstream_model: "upstream-b" },
          ],
        }] : [],
      };
      if (command === "get_amkr_models") return { models: [] };
      if (command === "get_amkr_unified_model") return { unified_model: null };
      if (command === "create_amkr_route") { created = true; return undefined; }
      return undefined;
    });
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("尚未配置模型路由。");
    fireEvent.click(screen.getByRole("button", { name: "新增路由" }));

    fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "model-b" } });
    fireEvent.change(screen.getByLabelText("供应商"), { target: { value: "provider-a" } });
    fireEvent.change(screen.getByLabelText("模型池"), { target: { value: "pool-a" } });
    fireEvent.change(screen.getByLabelText("上游模型"), { target: { value: "upstream-a" } });
    fireEvent.click(screen.getByRole("button", { name: "添加路由目标" }));
    fireEvent.change(screen.getByLabelText("供应商 2"), { target: { value: "provider-b" } });
    fireEvent.change(screen.getByLabelText("模型池 2"), { target: { value: "pool-b" } });
    fireEvent.change(screen.getByLabelText("上游模型 2"), { target: { value: "upstream-b" } });
    fireEvent.click(screen.getByRole("button", { name: "添加路由" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_amkr_route", {
      configPath: "C:/amkr.json",
      configRevision: "revision-a",
      id: "model-b",
      targets: [
        { provider: "provider-a", pool: "pool-a", upstream_model: "upstream-a" },
        { provider: "provider-b", pool: "pool-b", upstream_model: "upstream-b" },
      ],
      aliases: [],
      routingMode: "round_robin",
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
    fireEvent.click(await screen.findByRole("button", { name: "配置统一模型" }));
    expect(within(await screen.findByLabelText("模型")).getByRole("option", { name: "model-a" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增路由" }));
    fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "model-b" } });
    fireEvent.change(screen.getByLabelText("供应商"), { target: { value: "provider-a" } });
    fireEvent.change(screen.getByLabelText("模型池"), { target: { value: "pool-a" } });
    fireEvent.change(screen.getByLabelText("上游模型"), { target: { value: "upstream-b" } });
    fireEvent.click(screen.getByRole("button", { name: "添加路由" }));

    await waitFor(() => expect(within(screen.getByLabelText("模型")).getByRole("option", { name: "model-b" })).toBeInTheDocument());
    expect(modelReads).toBe(2);
  });

  it("collapses route editing and clears a hidden create draft", async () => {
    render(<RoutingPage configPath="C:/amkr.json" />);
    await screen.findByText("model-a");

    fireEvent.click(screen.getByRole("button", { name: "新增路由" }));
    fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "unfinished" } });
    fireEvent.click(screen.getByRole("button", { name: "编辑路由 model-a" }));

    expect(screen.queryByDisplayValue("unfinished")).not.toBeInTheDocument();
    expect(screen.getByLabelText("编辑模型 ID")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起路由 model-a" }));
    expect(screen.queryByLabelText("编辑模型 ID")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新增路由" }));
    expect(screen.getByLabelText("模型 ID")).toHaveValue("");
  });
});
