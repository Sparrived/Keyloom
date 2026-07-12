import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedModelPanel } from "./UnifiedModelPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);
const models = {
  models: [
    {
      id: "model-a",
      aliases: ["alias-a"],
      routing_mode: "round_robin",
      reasoning_effort: null,
      visitor_available: false,
      keys: [
        { name: "key-a", base_url: "https://a.example.test", enabled: true, allow_visitor: false, api_key_fingerprint: "65bbff9a6cb9" },
        { name: "disabled-key", base_url: null, enabled: false, allow_visitor: false, api_key_fingerprint: "1b4f0e985197" },
      ],
    },
    { id: "model-b", aliases: [], routing_mode: "priority", reasoning_effort: null, visitor_available: false, keys: [{ name: "key-b", base_url: null, enabled: true, allow_visitor: false, api_key_fingerprint: "e04f47ea9617" }] },
  ],
};

describe("UnifiedModelPanel", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_models") return models;
      if (command === "get_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-a", key: "key-a" } } } };
      if (command === "update_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-b", key: null } } } };
      return undefined;
    });
  });

  it("switches models and sends an explicit null key for automatic routing", async () => {
    const onChange = vi.fn();
    render(<UnifiedModelPanel configPath="C:/amkr.json" onChange={onChange} />);

    expect(await screen.findByText("固定 Key · key-a")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "model-b" } });
    fireEvent.click(screen.getByRole("radio", { name: "自动路由" }));
    fireEvent.click(screen.getByRole("button", { name: "保存统一模型" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_unified_model", {
      configPath: "C:/amkr.json",
      model: "model-b",
      key: null,
      fallback: null,
      image: null,
    }));
    expect(onChange).toHaveBeenCalledWith({ default: { primary: { model: "model-b", key: null } } });
  });

  it("offers only enabled keys and confirms before disabling the unified model", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChange = vi.fn();
    render(<UnifiedModelPanel configPath={null} onChange={onChange} />);

    await screen.findByText("固定 Key · key-a");
    expect(screen.getByRole("option", { name: "key-a" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "disabled-key" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停用统一模型" }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_amkr_unified_model", { configPath: null }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("reloads model candidates when the routing page refreshes its model token", async () => {
    let reads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_models") {
        reads += 1;
        return { models: reads === 1 ? models.models.slice(0, 1) : models.models };
      }
      if (command === "get_amkr_unified_model") return { unified_model: null };
      return undefined;
    });
    const { rerender } = render(<UnifiedModelPanel configPath={null} refreshToken={0} />);
    await screen.findByRole("option", { name: "model-a" });
    expect(screen.queryByRole("option", { name: "model-b" })).not.toBeInTheDocument();

    rerender(<UnifiedModelPanel configPath={null} refreshToken={1} />);
    expect(await screen.findByRole("option", { name: "model-b" })).toBeInTheDocument();
  });

  it("swaps the old primary into fallback when selecting the current fallback", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_models") return models;
      if (command === "get_amkr_unified_model") return {
        unified_model: {
          default: {
            primary: { model: "model-a", key: "key-a" },
            fallback: { model: "model-b", key: "key-b" },
          },
        },
      };
      if (command === "update_amkr_unified_model") return {
        unified_model: {
          default: {
            primary: { model: "model-b", key: "key-b" },
            fallback: { model: "model-a", key: "key-a" },
          },
        },
      };
      return undefined;
    });
    render(<UnifiedModelPanel configPath={null} />);
    await screen.findByText("固定 Key · key-a");

    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "model-b" } });
    fireEvent.click(screen.getByRole("button", { name: "保存统一模型" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_unified_model", {
      configPath: null,
      model: "model-b",
      key: "key-b",
      fallback: { model: "model-a", key: "key-a" },
      image: null,
    }));
  });

  it("saves an explicit fallback and image model mapping", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_models") return models;
      if (command === "get_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-a", key: null } } } };
      if (command === "update_amkr_unified_model") return {
        unified_model: {
          default: {
            primary: { model: "model-a", key: null },
            fallback: { model: "model-b", key: null },
          },
          image: { primary: { model: "model-b", key: null } },
        },
      };
      return undefined;
    });
    render(<UnifiedModelPanel configPath={null} />);
    await screen.findByRole("radio", { name: "自动路由" });

    fireEvent.click(screen.getByLabelText("启用回退目标"));
    fireEvent.change(screen.getByLabelText("回退模型"), { target: { value: "model-b" } });
    fireEvent.click(screen.getByLabelText("配置图像模型映射"));
    fireEvent.change(screen.getByLabelText("图像模型"), { target: { value: "model-b" } });
    fireEvent.click(screen.getByRole("button", { name: "保存统一模型" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_unified_model", {
      configPath: null,
      model: "model-a",
      key: null,
      fallback: { model: "model-b", key: null },
      image: { primary: { model: "model-b", key: null } },
    }));
  });
});
