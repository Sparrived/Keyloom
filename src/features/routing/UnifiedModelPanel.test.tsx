import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedModelPanel } from "./UnifiedModelPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);
const openEditor = async () => fireEvent.click(await screen.findByRole("button", { name: /^(编辑|配置)统一模型$/ }));
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

    await screen.findByRole("button", { name: "编辑统一模型" });
    await openEditor();
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
    const onChange = vi.fn();
    render(<UnifiedModelPanel configPath={null} onChange={onChange} />);

    await screen.findByRole("button", { name: "编辑统一模型" });
    await openEditor();
    expect(screen.getByRole("option", { name: "key-a" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "disabled-key" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起统一模型" }));
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));

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
    await openEditor();
    const modelSelect = await screen.findByLabelText("模型");
    expect(within(modelSelect).getByRole("option", { name: "model-a" })).toBeInTheDocument();
    expect(within(modelSelect).queryByRole("option", { name: "model-b" })).not.toBeInTheDocument();

    rerender(<UnifiedModelPanel configPath={null} refreshToken={1} />);
    await waitFor(() => expect(within(screen.getByLabelText("模型")).getByRole("option", { name: "model-b" })).toBeInTheDocument());
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
    await screen.findByRole("button", { name: "编辑统一模型" });
    await openEditor();

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
    await openEditor();
    await screen.findByRole("radio", { name: "自动路由" });

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("回退 Key")).toBeDisabled();
    expect(screen.getByLabelText("图像 Key")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("回退模型"), { target: { value: "model-b" } });
    fireEvent.change(screen.getByLabelText("图像模型"), { target: { value: "model-b" } });
    expect(screen.getByLabelText("回退 Key")).toBeEnabled();
    expect(screen.getByLabelText("图像 Key")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存统一模型" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_unified_model", {
      configPath: null,
      model: "model-a",
      key: null,
      fallback: { model: "model-b", key: null },
      image: { primary: { model: "model-b", key: null } },
    }));
  });

  it("shows the selected model capabilities without exposing key material", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_models") return {
        models: [{
          id: "model-a",
          aliases: ["fast-a"],
          routing_mode: "only_first",
          reasoning_effort: "high",
          visitor_available: true,
          keys: [{ name: "key-a", base_url: "https://a.example.test", enabled: true, allow_visitor: true, api_key_fingerprint: "fingerprint-a" }],
        }],
      };
      if (command === "get_amkr_unified_model") return { unified_model: null };
      return undefined;
    });
    render(<UnifiedModelPanel configPath={null} />);

    await openEditor();
    expect(await screen.findByText("路由策略：only_first")).toBeInTheDocument();
    expect(screen.getByText("推理强度：high")).toBeInTheDocument();
    expect(screen.getByText("访客可用")).toBeInTheDocument();
    expect(screen.getByText("别名：fast-a")).toBeInTheDocument();
    expect(screen.queryByText("fingerprint-a")).not.toBeInTheDocument();
  });

  it("updates the selected model reasoning effort", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_models") return { models: [{ ...models.models[0], reasoning_effort: null }] };
      if (command === "get_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-a", key: null } } } };
      if (command === "update_amkr_model_reasoning_effort") return { ...models.models[0], reasoning_effort: "high" };
      if (command === "update_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-a", key: null } } } };
      return undefined;
    });
    render(<UnifiedModelPanel configPath="C:/amkr.json" />);

    await openEditor();
    await screen.findByLabelText("模型");
    fireEvent.change(screen.getByLabelText("推理强度"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "保存统一模型" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_model_reasoning_effort", {
      configPath: "C:/amkr.json",
      modelId: "model-a",
      reasoningEffort: "high",
    }));
  });

  it("sends null when clearing a model reasoning override", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_models") return { models: [{ ...models.models[0], reasoning_effort: "high" }] };
      if (command === "get_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-a", key: null } } } };
      if (command === "update_amkr_model_reasoning_effort") return { ...models.models[0], reasoning_effort: null };
      if (command === "update_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-a", key: null } } } };
      return undefined;
    });
    render(<UnifiedModelPanel configPath={null} />);

    await openEditor();
    await screen.findByLabelText("模型");
    fireEvent.change(screen.getByLabelText("推理强度"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存统一模型" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_model_reasoning_effort", {
      configPath: null,
      modelId: "model-a",
      reasoningEffort: null,
    }));
  });

  it("discards unsaved changes when editing is cancelled", async () => {
    render(<UnifiedModelPanel configPath={null} />);
    await openEditor();
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "model-b" } });

    fireEvent.click(screen.getByRole("button", { name: "收起统一模型" }));

    expect(screen.queryByLabelText("模型")).not.toBeInTheDocument();
    expect(screen.getByText("model-a")).toBeInTheDocument();
    await openEditor();
    expect(screen.getByLabelText("模型")).toHaveValue("model-a");
  });
});
