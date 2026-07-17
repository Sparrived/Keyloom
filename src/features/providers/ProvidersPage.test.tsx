import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProvidersPage } from "./ProvidersPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);
const response = {
  config_revision: "revision-a",
  providers: [{
    id: "a.example.test",
    base_url: "https://a.example.test",
    keys: [{ name: "key-a", enabled: true, allow_visitor: false, api_key_fingerprint: "65bbff9a6cb9" }],
    pools: [{ name: "pool-a", keys: ["key-a"], models: ["model-a"] }],
    routes: { openai: "proxy/v1/chat/completions" },
  }],
};

describe("ProvidersPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_keys") return { probe_id: "probe-pools", status: "pending" };
      if (command === "get_amkr_probe") return { probe_id: "probe-pools", status: "complete", provider: "a.example.test", results: [], error: null };
      return response;
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("edits a provider without rebuilding its keys and pools", async () => {
    render(<ProvidersPage configPath="C:/amkr.json" />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "编辑供应商 a.example.test" }));
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "b.example.test" } });
    fireEvent.change(screen.getByLabelText("供应商地址"), { target: { value: "https://b.example.test" } });
    fireEvent.change(screen.getByLabelText("Anthropic 路径"), { target: { value: "gateway/v1/messages" } });
    fireEvent.click(screen.getByRole("button", { name: "保存供应商" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider", {
      configPath: "C:/amkr.json",
      configRevision: "revision-a",
      providerId: "a.example.test",
      id: "b.example.test",
      baseUrl: "https://b.example.test",
      routes: {
        openai: "proxy/v1/chat/completions",
        anthropic: "gateway/v1/messages",
      },
    }));
  });

  it("refreshes a conflicting revision without discarding the provider draft", async () => {
    let providerReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") {
        providerReads += 1;
        return { ...response, config_revision: providerReads === 1 ? "revision-a" : "revision-b" };
      }
      if (command === "update_amkr_provider" && providerReads === 1) {
        throw new Error("AMKR 更新供应商请求失败（HTTP 409）: 配置已被其他客户端修改");
      }
      return undefined;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "编辑供应商 a.example.test" }));
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "b.example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存供应商" }));

    expect(await screen.findByText(/HTTP 409/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("版本 revision-b")).toBeInTheDocument());
    expect(screen.getByLabelText("供应商名称")).toHaveValue("b.example.test");

    fireEvent.click(screen.getByRole("button", { name: "保存供应商" }));
    await waitFor(() => expect(invokeMock).toHaveBeenLastCalledWith("get_amkr_providers", { configPath: null }));
    expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider", expect.objectContaining({ configRevision: "revision-b" }));
  });

  it("updates and deletes a provider key", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("key-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑 Key key-a" }));
    fireEvent.change(screen.getByLabelText("替换 API Key"), { target: { value: "replacement-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Key" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider_key", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      keyName: "key-a",
      name: "key-a",
      apiKey: "replacement-secret",
      enabled: true,
      allowVisitor: false,
    }));

    fireEvent.click(screen.getByRole("button", { name: "删除 Key key-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_amkr_provider_key", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      keyName: "key-a",
    }));
  });

  it("adds a key to the existing pool when discovered models match", async () => {
    let current = response;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_amkr_providers") return current;
      if (command === "create_amkr_provider_key") {
        current = {
          ...current,
          config_revision: "revision-b",
          providers: [{ ...current.providers[0], keys: [...current.providers[0].keys, { name: "key-b", enabled: true, allow_visitor: false, api_key_fingerprint: "keybfingerprint" }] }],
        };
        return undefined;
      }
      if (command === "probe_amkr_keys") return { probe_id: "probe-key-b", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-key-b",
        status: "complete",
        provider: "a.example.test",
        results: [{ status: "ok", provider: "a.example.test", key: "key-b", endpoint: "https://a.example.test/v1/models", models: ["model-a"], latency_ms: 20, error: null }],
        error: null,
      };
      if (command === "update_amkr_pool") {
        current = {
          ...current,
          config_revision: "revision-c",
          providers: [{ ...current.providers[0], pools: [{ ...current.providers[0].pools[0], keys: ["key-a", "key-b"] }] }],
        };
        return undefined;
      }
      throw new Error(`unexpected command ${command} ${JSON.stringify(args)}`);
    });

    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
    fireEvent.change(screen.getByLabelText("Key 名称"), { target: { value: "key-b" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret-b" } });
    fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_pool", {
      configPath: null,
      configRevision: "revision-b",
      providerId: "a.example.test",
      poolName: "pool-a",
      name: "pool-a",
      keys: ["key-a", "key-b"],
      models: ["model-a"],
    }));
    expect(invokeMock).not.toHaveBeenCalledWith("create_amkr_pool", expect.anything());
  });

  it("creates a new pool only when discovered models do not match an existing pool", async () => {
    let current = response;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return current;
      if (command === "create_amkr_provider_key") {
        current = {
          ...current,
          config_revision: "revision-b",
          providers: [{ ...current.providers[0], keys: [...current.providers[0].keys, { name: "key-b", enabled: true, allow_visitor: false, api_key_fingerprint: "keybfingerprint" }] }],
        };
        return undefined;
      }
      if (command === "probe_amkr_keys") return { probe_id: "probe-key-b", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-key-b",
        status: "complete",
        provider: "a.example.test",
        results: [{ status: "ok", provider: "a.example.test", key: "key-b", endpoint: "https://a.example.test/v1/models", models: ["model-b", "model-c"], latency_ms: 20, error: null }],
        error: null,
      };
      if (command === "create_amkr_pool") return undefined;
      return undefined;
    });

    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
    fireEvent.change(screen.getByLabelText("Key 名称"), { target: { value: "key-b" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret-b" } });
    fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_amkr_pool", {
      configPath: null,
      configRevision: "revision-b",
      providerId: "a.example.test",
      name: "default",
      keys: ["key-b"],
      models: ["model-b", "model-c"],
    }));
  });

  it("updates and deletes a model pool", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));
    fireEvent.change(screen.getByLabelText("模型池名称"), { target: { value: "pool-b" } });
    fireEvent.click(screen.getByRole("button", { name: "添加自定义模型" }));
    fireEvent.change(screen.getByLabelText("自定义模型名称"), { target: { value: "model-b" } });
    fireEvent.click(screen.getByRole("button", { name: "确认添加自定义模型" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模型池" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_pool", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      poolName: "pool-a",
      name: "pool-b",
      keys: ["key-a"],
      models: ["model-a", "model-b"],
    }));

    fireEvent.click(screen.getByRole("button", { name: "删除模型池 pool-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_amkr_pool", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      poolName: "pool-a",
    }));
  });

  it("shows a card loader while probing an edited pool", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return response;
      if (command === "probe_amkr_keys") return { probe_id: "probe-pools", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-pools",
        status: "running",
        provider: "a.example.test",
        results: [],
        error: null,
      };
      return undefined;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));

    expect(screen.getByText("启用模型")).toBeInTheDocument();
    expect(await screen.findByLabelText("正在探测模型")).toHaveClass("pool-model-probe-indicator");
  });

  it("places the probe card after existing models", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return response;
      if (command === "probe_amkr_keys") return { probe_id: "probe-pools", status: "pending" };
      if (command === "get_amkr_probe") return { probe_id: "probe-pools", status: "running", provider: "a.example.test", results: [], error: null };
      return undefined;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));

    const grid = await screen.findByLabelText("模型池模型");
    expect(Array.from(grid.querySelectorAll(".pool-model-card")).map((card) => card.getAttribute("aria-label"))).toEqual(["关闭模型 model-a", "正在探测模型", "添加自定义模型"]);
  });

  it("submits model pool keys in the adjusted order", async () => {
    const twoKeyResponse = {
      ...response,
      providers: [{
        ...response.providers[0],
        keys: [
          response.providers[0].keys[0],
          { name: "key-b", enabled: true, allow_visitor: false, api_key_fingerprint: "keybfingerprint" },
        ],
        pools: [{ name: "pool-a", keys: ["key-a", "key-b"], models: ["model-a"] }],
      }],
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return twoKeyResponse;
      if (command === "probe_amkr_keys") return { probe_id: "probe-key-a", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-key-a",
        status: "complete",
        provider: "a.example.test",
        results: [],
        error: null,
      };
      return undefined;
    });

    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");
    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));
    fireEvent.click(screen.getByRole("button", { name: "移除模型池 Key key-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加模型池 Key key-a" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模型池" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_pool", expect.objectContaining({
      keys: ["key-b", "key-a"],
    })));
  });

  it("keeps discovered models unselected when the pool has no models", async () => {
    const emptyPoolResponse = {
      ...response,
      providers: [{ ...response.providers[0], pools: [{ ...response.providers[0].pools[0], models: [] }] }],
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return emptyPoolResponse;
      if (command === "probe_amkr_keys") return { probe_id: "probe-pools", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-pools",
        status: "complete",
        provider: "a.example.test",
        results: [{ status: "ok", provider: "a.example.test", key: "key-a", endpoint: "https://a.example.test/v1/models", models: ["model-a", "model-b"], latency_ms: 20, error: null }],
        error: null,
      };
      return undefined;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));

    expect(await screen.findByRole("button", { name: "打开模型 model-a" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "打开模型 model-b" })).toHaveAttribute("aria-pressed", "false");
  });

  it("probes the edited pool and combines discovered and custom models", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return response;
      if (command === "probe_amkr_keys") return { probe_id: "probe-pools", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-pools",
        status: "complete",
        provider: "a.example.test",
        results: [{ status: "ok", provider: "a.example.test", key: "key-a", endpoint: "https://a.example.test/v1/models", models: ["model-a", "model-b"], latency_ms: 20, error: null }],
        error: null,
      };
      return undefined;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("probe_amkr_keys", {
      configPath: null,
      providerId: "a.example.test",
      keys: ["key-a"],
      timeoutSeconds: 15,
    }));
    expect(invokeMock).not.toHaveBeenCalledWith("probe_amkr_pools", expect.anything());
    expect(screen.queryByLabelText("选择探测模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("自定义模型")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "打开模型 model-b" }));
    expect(screen.getByRole("button", { name: "关闭模型 model-a" })).toHaveClass("is-selected");
    expect(screen.getByRole("button", { name: "关闭模型 model-b" })).toHaveClass("is-selected");

    fireEvent.click(screen.getByRole("button", { name: "添加自定义模型" }));
    fireEvent.change(screen.getByLabelText("自定义模型名称"), { target: { value: "custom-delete" } });
    fireEvent.click(screen.getByRole("button", { name: "确认添加自定义模型" }));
    fireEvent.click(screen.getByRole("button", { name: "删除自定义模型 custom-delete" }));
    expect(screen.queryByText("custom-delete")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加自定义模型" }));
    fireEvent.change(screen.getByLabelText("自定义模型名称"), { target: { value: "custom-model" } });
    fireEvent.click(screen.getByRole("button", { name: "确认添加自定义模型" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模型池" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_pool", expect.objectContaining({
      models: ["model-a", "model-b", "custom-model"],
    })));
  });

  it("marks enabled models missing from the latest probe", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return response;
      if (command === "probe_amkr_keys") return { probe_id: "probe-pools", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-pools",
        status: "complete",
        provider: "a.example.test",
        results: [{ status: "ok", provider: "a.example.test", key: "key-a", endpoint: "https://a.example.test/v1/models", models: ["model-b"], latency_ms: 20, error: null }],
        error: null,
      };
      return undefined;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "关闭模型 model-a" })).toHaveClass("is-probe-missing"));
  });

  it("collapses each editor from its edit button", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "编辑供应商 a.example.test" }));
    expect(screen.getByLabelText("供应商名称")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起供应商 a.example.test" }));
    expect(screen.queryByLabelText("供应商名称")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑 Key key-a" }));
    expect(screen.getByLabelText("Key 名称")).toBeInTheDocument();
    expect(screen.getByLabelText("Key 名称").closest("li")).toHaveClass("provider-row");
    fireEvent.click(screen.getByRole("button", { name: "收起 Key key-a" }));
    expect(screen.queryByLabelText("Key 名称")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));
    expect(screen.getByLabelText("模型池名称")).toBeInTheDocument();
    expect(screen.getByLabelText("模型池名称").closest("li")).toHaveClass("provider-row");
    fireEvent.click(screen.getByRole("button", { name: "收起模型池 pool-a" }));
    expect(screen.queryByLabelText("模型池名称")).not.toBeInTheDocument();
  });

  it("does not delete a provider when confirmation is cancelled", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "删除供应商 a.example.test" }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(invokeMock).not.toHaveBeenCalledWith("delete_amkr_provider", expect.anything());
  });

  it("toggles key status cards directly and removes fingerprint copying", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("key-a");

    expect(screen.getByRole("button", { name: "仅本地" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制 Key 指纹 key-a" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已启用" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider_key", expect.objectContaining({ enabled: false, allowVisitor: false })));

    fireEvent.click(screen.getByRole("button", { name: "仅本地" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider_key", expect.objectContaining({ enabled: true, allowVisitor: true })));
  });

  it("probes an individual key and expires its success state", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_keys") return { probe_id: "probe-single-key", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-single-key",
        status: "complete",
        provider: "a.example.test",
        results: [{ key: "key-a", endpoint: "https://a.example.test/v1", models: ["model-a"], latency_ms: 42, error: null }],
        error: null,
      };
      return response;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("key-a");

    fireEvent.click(screen.getByRole("button", { name: "探测 Key key-a" }));
    expect(await screen.findByText("探测成功")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "探测 Key key-a" })).toHaveTextContent("已通过");

    await waitFor(() => expect(screen.queryByText("探测成功")).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByRole("button", { name: "探测 Key key-a" })).toHaveTextContent("探测");
  });
});
